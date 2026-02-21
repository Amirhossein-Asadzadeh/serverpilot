"""
ServerPilot Backend — Main FastAPI Application

Entry point for the central panel API server.

Startup sequence:
  1. Initialize database (create tables if not exist)
  2. Create default admin user if no users exist
  3. Start background health-check task (pings all agents every 30s)
  4. Mount all routers
"""

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    hash_password,
)
from .config import settings
from .models import ActionType, AuditLog, Server, User, engine, get_session, init_db
from .routers import commands, metrics, schedules, servers
from .routers.metrics import metrics_broadcast_loop

# ─── Background health-check task ────────────────────────────────────────────

# Consecutive failure counter per server (in-memory, resets on process restart).
# key: server_id → number of consecutive failed pings since last success.
_hc_failure_counts: Dict[int, int] = {}

# Require this many consecutive failures before writing is_online=False to the DB.
# At the default 30s interval, HC_OFFLINE_THRESHOLD=3 means the server must be
# unreachable for at least 90 seconds before the panel marks it offline.
HC_OFFLINE_THRESHOLD = 3

# Ping timeout in seconds. Generous enough to survive moderate VPS latency spikes
# without triggering false-positive failures.
HC_PING_TIMEOUT = 8.0


async def health_check_loop():
    """
    Background task: pings all registered agents every 30 seconds.

    Resilience rules (prevents flapping on transient network blips):
      - Timeout raised to 8s (was 5s) to absorb latency spikes.
      - A server is only marked OFFLINE after HC_OFFLINE_THRESHOLD (3) consecutive
        failed pings. A single blip keeps the current DB status unchanged.
      - A single successful ping immediately resets the counter and marks ONLINE.
      - Offline transitions are logged with the failure count for diagnostics.
    """
    AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    while True:
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Server))
                servers_list = result.scalars().all()

                async def check_server(server: Server):
                    was_online = server.is_online
                    ping_ok = False
                    fail_reason = ""

                    try:
                        async with httpx.AsyncClient(timeout=HC_PING_TIMEOUT) as client:
                            resp = await client.get(f"{server.agent_url}/health")
                            ping_ok = resp.status_code == 200
                            if not ping_ok:
                                fail_reason = f"HTTP {resp.status_code}"
                    except httpx.TimeoutException:
                        fail_reason = f"timeout after {HC_PING_TIMEOUT}s"
                    except Exception as exc:
                        fail_reason = str(exc)[:120]

                    if ping_ok:
                        # Success — reset counter, mark online, record last_seen
                        prev_failures = _hc_failure_counts.get(server.id, 0)
                        _hc_failure_counts[server.id] = 0
                        server.is_online = True
                        server.last_seen = datetime.now(timezone.utc)
                        if not was_online:
                            print(
                                f"[HealthCheck] '{server.name}' is back ONLINE"
                                + (f" (was failing for {prev_failures} cycles)" if prev_failures else "")
                            )
                    else:
                        # Failure — increment counter but only flip DB after threshold
                        count = _hc_failure_counts.get(server.id, 0) + 1
                        _hc_failure_counts[server.id] = count

                        if count >= HC_OFFLINE_THRESHOLD:
                            # Threshold reached — mark offline in DB
                            if was_online:
                                print(
                                    f"[HealthCheck] '{server.name}' marked OFFLINE "
                                    f"after {count} consecutive failures "
                                    f"(last reason: {fail_reason})"
                                )
                            server.is_online = False
                        else:
                            # Still below threshold — leave DB status unchanged
                            print(
                                f"[HealthCheck] '{server.name}' ping failed "
                                f"({count}/{HC_OFFLINE_THRESHOLD}) — "
                                f"{fail_reason} — "
                                f"keeping status {'ONLINE' if was_online else 'OFFLINE'}"
                            )

                await asyncio.gather(
                    *[check_server(s) for s in servers_list],
                    return_exceptions=True,
                )
                await session.commit()

        except Exception as exc:
            print(f"[HealthCheck] Error in health check loop: {exc}")

        await asyncio.sleep(settings.health_check_interval)


# ─── App lifecycle ────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and start background tasks on startup."""
    # Create tables
    await init_db()

    # Create default admin if no users exist
    AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User))
        if not result.scalars().first():
            admin = User(
                username=settings.default_admin_username,
                hashed_password=hash_password(settings.default_admin_password),
            )
            session.add(admin)
            await session.commit()
            print(
                f"[Init] Created default admin user: '{settings.default_admin_username}'"
            )

    # Start background tasks: health check and the shared metrics broadcaster.
    # Running metrics_broadcast_loop as a single task means all WebSocket clients
    # share one set of agent requests, preventing request storms.
    hc_task = asyncio.create_task(health_check_loop())
    metrics_task = asyncio.create_task(metrics_broadcast_loop())

    yield

    hc_task.cancel()
    metrics_task.cancel()
    for t in (hc_task, metrics_task):
        try:
            await t
        except asyncio.CancelledError:
            pass


# ─── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ServerPilot Panel API",
    version="1.0.0",
    description="Central management API for ServerPilot — self-hosted server management panel",
    lifespan=lifespan,
    root_path="/api",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount sub-routers
app.include_router(servers.router)
app.include_router(metrics.router)
app.include_router(commands.router)
app.include_router(schedules.router)


# ─── Auth routes ──────────────────────────────────────────────────────────────


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    username: str
    user_id: int


@app.post("/auth/login", response_model=TokenResponse, tags=["Auth"])
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
):
    """
    Authenticate with username + password, returns JWT access token.
    Token should be stored in localStorage and sent as Authorization: Bearer <token>.
    """
    user = await authenticate_user(form_data.username, form_data.password, session)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    token = create_access_token(
        data={"sub": user.username, "user_id": user.id}
    )

    # Audit the login
    log = AuditLog(
        action=ActionType.LOGIN,
        user_id=user.id,
        username=user.username,
        detail=f"Login from panel",
    )
    session.add(log)
    await session.commit()

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        username=user.username,
        user_id=user.id,
    )


@app.get("/auth/me", tags=["Auth"])
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the current authenticated user's info."""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "is_active": current_user.is_active,
    }


# ─── Audit log route ──────────────────────────────────────────────────────────


@app.get("/audit", tags=["Audit"])
async def get_audit_log(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    server_id: Optional[int] = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Return paginated audit log.
    Optionally filter by server_id.
    """
    query = select(AuditLog).order_by(AuditLog.timestamp.desc())

    if server_id is not None:
        query = query.where(AuditLog.server_id == server_id)

    # Count total for pagination
    from sqlalchemy import func, select as sa_select

    count_query = sa_select(func.count()).select_from(AuditLog)
    if server_id is not None:
        count_query = count_query.where(AuditLog.server_id == server_id)
    total_result = await session.execute(count_query)
    total = total_result.scalar()

    # Apply pagination
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)
    result = await session.execute(query)
    logs = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
        "items": [
            {
                "id": log.id,
                "action": log.action,
                "detail": log.detail,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "username": log.username,
                "server_name": log.server_name,
                "server_id": log.server_id,
            }
            for log in logs
        ],
    }


# ─── Health ────────────────────────────────────────────────────────────────────


@app.get("/health", tags=["Health"])
async def panel_health():
    """Panel health check — used by load balancers and uptime monitors."""
    return {"status": "ok", "service": "serverpilot-panel"}


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.panel_host,
        port=settings.panel_port,
        reload=True,
        log_level="info",
    )
