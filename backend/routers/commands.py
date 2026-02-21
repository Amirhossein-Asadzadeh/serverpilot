"""
ServerPilot Backend — Commands Router

Proxies command execution and reboot requests to agent APIs.
Every action is written to the audit log for compliance and debugging.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..models import ActionType, AuditLog, Server, User, get_session

router = APIRouter(tags=["Commands"])


# ─── Pydantic schemas ─────────────────────────────────────────────────────────


class ExecRequest(BaseModel):
    command: str
    timeout: Optional[int] = 30


# ─── Helpers ──────────────────────────────────────────────────────────────────


async def get_server_or_404(server_id: int, session: AsyncSession) -> Server:
    result = await session.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


async def write_audit(
    session: AsyncSession,
    action: ActionType,
    user: User,
    server: Server,
    detail: str,
):
    log = AuditLog(
        action=action,
        user_id=user.id,
        server_id=server.id,
        username=user.username,
        server_name=server.name,
        detail=detail,
    )
    session.add(log)
    await session.commit()


# ─── Routes ───────────────────────────────────────────────────────────────────


@router.post("/servers/{server_id}/reboot")
async def reboot_server(
    server_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Trigger a reboot on the remote server.
    The agent schedules the reboot 2s in the future so the HTTP response can
    be returned before the machine goes down.
    """
    server = await get_server_or_404(server_id, session)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{server.agent_url}/reboot",
                headers={"Authorization": f"Bearer {server.agent_token}"},
            )
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Agent unreachable: {exc}",
        )

    await write_audit(
        session,
        ActionType.REBOOT,
        current_user,
        server,
        f"Reboot initiated by {current_user.username}",
    )

    return {
        "status": "ok",
        "server": server.name,
        "agent_response": result,
    }


@router.post("/servers/{server_id}/exec")
async def exec_command(
    server_id: int,
    payload: ExecRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Execute a shell command on the remote server and return output.
    Commands run with the same privileges as the agent process (typically root).

    Security note: Access to this endpoint should be restricted to trusted users
    via RBAC in production deployments.
    """
    server = await get_server_or_404(server_id, session)

    try:
        async with httpx.AsyncClient(timeout=payload.timeout + 5.0) as client:
            resp = await client.post(
                f"{server.agent_url}/exec",
                json={"command": payload.command, "timeout": payload.timeout},
                headers={"Authorization": f"Bearer {server.agent_token}"},
            )
            resp.raise_for_status()
            result = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=408,
            detail=f"Command timed out after {payload.timeout}s",
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Agent unreachable: {exc}",
        )

    await write_audit(
        session,
        ActionType.EXEC,
        current_user,
        server,
        f"Command: {payload.command[:200]}",
    )

    return {
        "server": server.name,
        "command": payload.command,
        **result,
    }
