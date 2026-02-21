"""
ServerPilot Backend — Servers Router

CRUD endpoints for managing registered VPS servers.
Each server record stores the agent connection info (IP, port, token).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..models import ActionType, AuditLog, Server, User, get_session

router = APIRouter(prefix="/servers", tags=["Servers"])


# ─── Pydantic schemas ─────────────────────────────────────────────────────────


class ServerCreate(BaseModel):
    name: str
    ip: str
    port: int = 8765
    agent_token: str
    tags: Optional[List[str]] = []


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    ip: Optional[str] = None
    port: Optional[int] = None
    agent_token: Optional[str] = None
    tags: Optional[List[str]] = None


class ServerResponse(BaseModel):
    id: int
    name: str
    ip: str
    port: int
    tags: List[str]
    is_online: bool
    last_seen: Optional[str]
    created_at: str

    model_config = {"from_attributes": True}


def server_to_dict(s: Server) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "ip": s.ip,
        "port": s.port,
        "tags": s.tags or [],
        "is_online": s.is_online,
        "last_seen": s.last_seen.isoformat() if s.last_seen else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


# ─── Routes ───────────────────────────────────────────────────────────────────


@router.get("", response_model=List[dict])
async def list_servers(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return all registered servers with their current online status."""
    result = await session.execute(select(Server).order_by(Server.created_at))
    servers = result.scalars().all()
    return [server_to_dict(s) for s in servers]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_server(
    payload: ServerCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Register a new server. The agent must already be installed on the VPS."""
    server = Server(
        name=payload.name,
        ip=payload.ip,
        port=payload.port,
        agent_token=payload.agent_token,
        tags=payload.tags or [],
        is_online=False,
    )
    session.add(server)
    await session.flush()  # Get the ID before commit

    # Audit log
    log = AuditLog(
        action=ActionType.SERVER_ADD,
        user_id=current_user.id,
        server_id=server.id,
        username=current_user.username,
        server_name=server.name,
        detail=f"Added server {server.name} ({server.ip}:{server.port})",
    )
    session.add(log)
    await session.commit()
    await session.refresh(server)

    return server_to_dict(server)


@router.get("/{server_id}")
async def get_server(
    server_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get a single server by ID."""
    result = await session.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server_to_dict(server)


@router.put("/{server_id}")
async def update_server(
    server_id: int,
    payload: ServerUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Update server registration details."""
    result = await session.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(server, field, value)

    log = AuditLog(
        action=ActionType.SERVER_UPDATE,
        user_id=current_user.id,
        server_id=server.id,
        username=current_user.username,
        server_name=server.name,
        detail=f"Updated server {server.name}",
    )
    session.add(log)
    await session.commit()
    await session.refresh(server)

    return server_to_dict(server)


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    server_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Remove a server from the panel (does not uninstall the agent)."""
    result = await session.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    server_name = server.name
    await session.delete(server)

    log = AuditLog(
        action=ActionType.SERVER_DELETE,
        user_id=current_user.id,
        server_id=None,  # Server is gone
        username=current_user.username,
        server_name=server_name,
        detail=f"Deleted server {server_name}",
    )
    session.add(log)
    await session.commit()
