"""
ServerPilot Backend — Metrics Router

Proxies metric requests from the panel to individual agent APIs.
Caches the last known metric value in memory for fast dashboard loads.

The WebSocket endpoint keeps connections alive while a SINGLE shared
background task (started in main.py lifespan) polls all servers every
5 seconds and broadcasts to all connected clients simultaneously.
This prevents N WebSocket clients from each independently hitting every
agent — which would overwhelm agents with N×request_rate concurrent calls.
"""

import asyncio
import json
from typing import Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..auth import decode_token, get_current_user
from ..models import Server, User, engine, get_session

router = APIRouter(tags=["Metrics"])

# In-memory cache: server_id → last successful metrics dict.
# In production at scale, use Redis for multi-process cache sharing.
_metrics_cache: Dict[int, dict] = {}

# Consecutive failure counter for the metrics fetch path (separate from the
# health-check loop counter in main.py). Tracks how many back-to-back /metrics
# requests have failed for each server.
_metrics_failure_counts: Dict[int, int] = {}

# Number of consecutive metrics-fetch failures required before the WebSocket
# broadcast reports is_online=False for a server.
# At 5s between broadcasts, threshold=3 means the server must fail for ~15s
# before the dashboard shows it as offline — absorbing brief network blips.
METRICS_OFFLINE_THRESHOLD = 3

# Timeout for agent /metrics requests.  Same as the health-check timeout.
METRICS_FETCH_TIMEOUT = 8.0


async def fetch_agent_metrics(server: Server) -> dict:
    """
    Fetch live metrics from a single agent.

    Failure policy (prevents the dashboard from flashing offline on blips):
      - On success: reset failure counter, cache result, return with is_online=True.
      - On failure < METRICS_OFFLINE_THRESHOLD: return the last cached metrics
        dict unchanged (is_online stays True from the last successful fetch).
        This means a single timed-out request is completely invisible to the UI.
      - On failure >= METRICS_OFFLINE_THRESHOLD: flip is_online=False so the
        dashboard correctly shows the server as unreachable.
    """
    try:
        async with httpx.AsyncClient(timeout=METRICS_FETCH_TIMEOUT) as client:
            resp = await client.get(
                f"{server.agent_url}/metrics",
                headers={"Authorization": f"Bearer {server.agent_token}"},
            )
            resp.raise_for_status()
            data = resp.json()
            data["server_id"] = server.id
            data["server_name"] = server.name
            data["is_online"] = True
            _metrics_cache[server.id] = data
            _metrics_failure_counts[server.id] = 0  # reset on success
            return data

    except Exception:
        # Increment consecutive-failure counter
        count = _metrics_failure_counts.get(server.id, 0) + 1
        _metrics_failure_counts[server.id] = count

        # Work from the last successfully cached metrics snapshot
        cached = dict(_metrics_cache.get(server.id, {}))
        cached["server_id"] = server.id
        cached["server_name"] = server.name

        if count >= METRICS_OFFLINE_THRESHOLD:
            # Sustained failure — tell the frontend this server is offline
            cached["is_online"] = False
        else:
            # Transient failure — preserve the last known is_online value so
            # the dashboard doesn't flash.  If we've never had a successful
            # fetch (no cache entry yet), default to False.
            if "is_online" not in cached:
                cached["is_online"] = False
            # else: cached["is_online"] stays True from the last good response

        return cached


# ─── Shared broadcast loop ────────────────────────────────────────────────────


async def metrics_broadcast_loop():
    """
    Single background task: fetch all servers' metrics every 5 seconds and
    broadcast the result to every connected WebSocket client.

    This runs ONCE (started in main.py lifespan), regardless of how many
    browser tabs are open. Previously each WebSocket connection ran its own
    loop, meaning N open tabs produced N concurrent metric fetches per server
    per 5-second cycle — which overwhelmed agents.

    Now: 1 fetch per server per 5 seconds, no matter how many clients watch.
    """
    AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    while True:
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Server))
                servers = result.scalars().all()

            metrics_tasks = [fetch_agent_metrics(s) for s in servers]
            all_metrics = await asyncio.gather(*metrics_tasks, return_exceptions=True)

            payload = {
                "type": "metrics_update",
                "servers": [m for m in all_metrics if isinstance(m, dict)],
            }

            await manager.broadcast(payload)

        except Exception as exc:
            print(f"[MetricsBroadcast] Error: {exc}")

        await asyncio.sleep(5)


# ─── REST endpoint ────────────────────────────────────────────────────────────


@router.get("/servers/{server_id}/metrics")
async def get_server_metrics(
    server_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Fetch current metrics for a single server by proxying to its agent."""
    result = await session.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    return await fetch_agent_metrics(server)


# ─── WebSocket connections ────────────────────────────────────────────────────


class ConnectionManager:
    """
    Manages active WebSocket connections.
    Allows broadcasting to all connected dashboard clients simultaneously.
    """

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections:
            self.active_connections.remove(ws)

    async def broadcast(self, data: dict):
        """Send metrics payload to all connected clients, clean up dead connections."""
        dead = []
        for ws in self.active_connections:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


@router.websocket("/ws/metrics")
async def websocket_metrics(ws: WebSocket):
    """
    WebSocket endpoint: authenticates the client and keeps the connection open
    so the shared metrics_broadcast_loop() can push updates to it.

    The poll loop runs once globally (started in main.py lifespan) and calls
    manager.broadcast() every 5 seconds — all connected clients receive the
    same payload from that single poll, eliminating redundant agent requests.

    Authentication: JWT sent as ?token= query param (browsers can't set
    custom headers on WebSocket connections).
    """
    token = ws.query_params.get("token")
    if not token:
        await ws.close(code=4001)
        return

    try:
        decode_token(token)
    except Exception:
        await ws.close(code=4001)
        return

    await manager.connect(ws)
    try:
        # Block here so the connection stays alive.
        # iter_text() yields on each client message and raises
        # WebSocketDisconnect when the client closes the connection.
        async for _ in ws.iter_text():
            pass  # clients don't send anything; this is just a keep-alive loop
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)
