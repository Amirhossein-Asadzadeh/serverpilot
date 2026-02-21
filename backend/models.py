"""
ServerPilot Backend — SQLAlchemy ORM Models

Database schema:
  - User: panel admin accounts (JWT auth)
  - Server: registered VPS servers with agent connection info
  - AuditLog: immutable record of all actions (reboot, exec, schedule)

Uses SQLAlchemy 2.x async ORM with support for both SQLite (dev) and
PostgreSQL (prod) via DATABASE_URL environment variable.
"""

import enum
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.ext.asyncio import AsyncAttrs, AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func

from .config import settings


# ─── Base + Engine setup ──────────────────────────────────────────────────────


class Base(AsyncAttrs, DeclarativeBase):
    pass


def get_engine():
    """
    Create async SQLAlchemy engine.
    SQLite uses aiosqlite driver; PostgreSQL uses asyncpg.
    The check_same_thread=False arg is SQLite-specific.
    """
    db_url = settings.database_url
    if db_url.startswith("sqlite"):
        # Convert sqlite:/// → sqlite+aiosqlite:///
        db_url = db_url.replace("sqlite://", "sqlite+aiosqlite://", 1)
        return create_async_engine(
            db_url,
            connect_args={"check_same_thread": False},
            echo=False,
        )
    else:
        # PostgreSQL: postgresql:// → postgresql+asyncpg://
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return create_async_engine(db_url, echo=False, pool_pre_ping=True)


engine = get_engine()


async def init_db():
    """Create all tables on startup (idempotent)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    """FastAPI dependency: yields a database session per request."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with AsyncSessionLocal() as session:
        yield session


# ─── Enums ────────────────────────────────────────────────────────────────────


class ActionType(str, enum.Enum):
    REBOOT = "reboot"
    EXEC = "exec"
    SCHEDULE_ADD = "schedule_add"
    SCHEDULE_DELETE = "schedule_delete"
    SERVER_ADD = "server_add"
    SERVER_UPDATE = "server_update"
    SERVER_DELETE = "server_delete"
    LOGIN = "login"


# ─── Models ───────────────────────────────────────────────────────────────────


class User(Base):
    """
    Panel administrator account.
    Passwords are stored as bcrypt hashes — never plaintext.
    """

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    hashed_password = Column(String(128), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship to audit logs this user created
    audit_logs = relationship("AuditLog", back_populates="user", lazy="dynamic")

    def __repr__(self):
        return f"<User id={self.id} username={self.username!r}>"


class Server(Base):
    """
    Registered VPS server with agent connection info.
    The agent_token is the shared secret used to authenticate to the agent API.
    It should be a cryptographically random string (e.g., secrets.token_hex(32)).
    """

    __tablename__ = "servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    ip = Column(String(45), nullable=False)  # IPv4 or IPv6
    port = Column(Integer, default=8765, nullable=False)
    agent_token = Column(String(256), nullable=False)
    tags = Column(JSON, default=list)  # e.g. ["prod", "web", "us-east"]

    # Status fields updated by background health-check task
    is_online = Column(Boolean, default=False)
    last_seen = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Audit logs for this server
    audit_logs = relationship("AuditLog", back_populates="server", lazy="dynamic")

    @property
    def agent_url(self) -> str:
        return f"http://{self.ip}:{self.port}"

    def __repr__(self):
        return f"<Server id={self.id} name={self.name!r} ip={self.ip}>"


class AuditLog(Base):
    """
    Immutable audit trail of all actions performed through the panel.

    DevOps best practice: never delete audit logs. If you need to archive,
    export to S3/object storage and truncate old rows.
    """

    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(Enum(ActionType), nullable=False)
    detail = Column(Text, nullable=True)  # JSON-serialized action details
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Foreign keys (nullable: server might be deleted, user might be removed)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=True)

    # Denormalized for historical accuracy (server/user names can change)
    username = Column(String(64), nullable=True)
    server_name = Column(String(128), nullable=True)

    user = relationship("User", back_populates="audit_logs")
    server = relationship("Server", back_populates="audit_logs")

    def __repr__(self):
        return f"<AuditLog id={self.id} action={self.action} server={self.server_name!r}>"
