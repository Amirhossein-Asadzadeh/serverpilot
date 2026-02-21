"""
ServerPilot Backend — Schedules Router

Proxies scheduled task management to agent APIs.
Scheduled jobs persist in APScheduler on the agent process —
they are lost if the agent restarts (stateless design for simplicity).
For production persistence, the agent could write jobs to SQLite.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..models import ActionType, AuditLog, Server, User, get_session
from ..routers.commands import get_server_or_404, write_audit

router = APIRouter(tags=["Schedules"])


# ─── Pydantic schemas ─────────────────────────────────────────────────────────


class ScheduleCreate(BaseModel):
    job_id: str
    command: str
    cron: str  # standard cron: "*/5 * * * *"
    label: str


# ─── Routes ───────────────────────────────────────────────────────────────────


@router.get("/servers/{server_id}/schedule")
async def list_scheduled_jobs(
    server_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List all scheduled cron jobs from the server's agent."""
    server = await get_server_or_404(server_id, session)

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{server.agent_url}/schedule",
                headers={"Authorization": f"Bearer {server.agent_token}"},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Agent unreachable: {exc}")


@router.post("/servers/{server_id}/schedule")
async def add_scheduled_job(
    server_id: int,
    payload: ScheduleCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Add a new cron job to the server's agent scheduler.

    Cron format examples:
      "*/5 * * * *"   → every 5 minutes
      "0 3 * * *"     → daily at 3:00 AM
      "0 */6 * * *"   → every 6 hours
    """
    server = await get_server_or_404(server_id, session)

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{server.agent_url}/schedule",
                json={
                    "job_id": payload.job_id,
                    "command": payload.command,
                    "cron": payload.cron,
                    "label": payload.label,
                },
                headers={"Authorization": f"Bearer {server.agent_token}"},
            )
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.json().get("detail", "Agent error"),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Agent unreachable: {exc}")

    await write_audit(
        session,
        ActionType.SCHEDULE_ADD,
        current_user,
        server,
        f"Scheduled '{payload.label}': {payload.command} [{payload.cron}]",
    )

    return result


@router.delete("/servers/{server_id}/schedule/{job_id}")
async def delete_scheduled_job(
    server_id: int,
    job_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Remove a scheduled job from the server's agent."""
    server = await get_server_or_404(server_id, session)

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.delete(
                f"{server.agent_url}/schedule/{job_id}",
                headers={"Authorization": f"Bearer {server.agent_token}"},
            )
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.json().get("detail", "Agent error"),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Agent unreachable: {exc}")

    await write_audit(
        session,
        ActionType.SCHEDULE_DELETE,
        current_user,
        server,
        f"Removed scheduled job: {job_id}",
    )

    return result
