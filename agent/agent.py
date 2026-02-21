"""
ServerPilot Agent - Lightweight FastAPI service installed on each monitored VPS.

This agent runs as a systemd service under the 'serverpilot' system user and
exposes a secure HTTP API for:
  - Real-time system metrics (CPU, RAM, disk, network, uptime)
  - Remote command execution with timeout support
  - Scheduled task management via APScheduler
  - Remote reboot capability (via sudo reboot)
  - Version reporting

Security:
  - All routes except /health are protected by Bearer token authentication
    using HMAC-safe constant-time comparison to prevent timing attacks.
  - Token is read from /etc/serverpilot/agent.conf (falls back to AGENT_TOKEN
    env var for backwards compatibility / development use).
  - Service runs as non-root 'serverpilot' user with ProtectSystem=strict.
  - Reboot uses 'sudo reboot' (sudoers rule added by install.sh).

Logging:
  - Access logs written to /var/log/serverpilot-agent.log
    (falls back to stderr if not writable, e.g. in development).
"""

import asyncio
import hmac
import logging
import os
import platform
import subprocess
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import psutil
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ─── Version ──────────────────────────────────────────────────────────────────

AGENT_VERSION = "1.1.0"

# ─── Configuration ────────────────────────────────────────────────────────────

_CONFIG_FILE = "/etc/serverpilot/agent.conf"
_LOG_FILE    = "/var/log/serverpilot-agent.log"


def _read_conf(path: str) -> dict:
    """Parse a KEY=VALUE env-style config file, ignoring comments and blanks."""
    conf: dict = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    conf[key.strip()] = val.strip()
    except (FileNotFoundError, PermissionError):
        pass
    return conf


_conf = _read_conf(_CONFIG_FILE)

# Env var overrides config file (env var kept for backwards compat / dev use)
AGENT_TOKEN = os.environ.get("AGENT_TOKEN") or _conf.get("AGENT_TOKEN", "changeme-set-in-env")
AGENT_PORT  = int(os.environ.get("AGENT_PORT")  or _conf.get("AGENT_PORT",  "9000"))

# ─── Access logging ───────────────────────────────────────────────────────────

_access_log = logging.getLogger("serverpilot.access")
_access_log.setLevel(logging.INFO)
_access_log.propagate = False

try:
    _fh = logging.FileHandler(_LOG_FILE)
    _fh.setFormatter(logging.Formatter("%(message)s"))
    _access_log.addHandler(_fh)
except (IOError, PermissionError, OSError):
    # Log file not accessible (development mode or wrong permissions)
    # Fall back to stderr so logs still appear in journald
    _sh = logging.StreamHandler()
    _sh.setFormatter(logging.Formatter("[access] %(message)s"))
    _access_log.addHandler(_sh)

# ─── APScheduler ──────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start/stop the APScheduler alongside the FastAPI app."""
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


# ─── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ServerPilot Agent",
    version=AGENT_VERSION,
    description="Lightweight monitoring and control agent for ServerPilot",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Panel IP controlled via token, not CORS
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request access logging middleware ────────────────────────────────────────

@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    """
    Log every request to /var/log/serverpilot-agent.log.
    Format: ISO-timestamp | client-ip | METHOD /path | status | duration_ms
    """
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 1)

    # Respect X-Forwarded-For if behind a proxy (the panel nginx)
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "?")
    )

    _access_log.info(
        "%sZ | %-15s | %-6s %-30s | %d | %.1fms",
        datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        client_ip,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


# ─── Auth dependency ──────────────────────────────────────────────────────────

async def require_token(request: Request):
    """
    Validate Bearer token using constant-time HMAC comparison to prevent
    timing-based token enumeration attacks.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    token = auth_header[7:]
    if not hmac.compare_digest(token.encode(), AGENT_TOKEN.encode()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid agent token",
        )
    return token


# ─── Pydantic models ──────────────────────────────────────────────────────────

class ExecRequest(BaseModel):
    command: str
    timeout: Optional[int] = 30


class ScheduleRequest(BaseModel):
    job_id: str
    command: str
    cron: str   # e.g. "*/5 * * * *"
    label: str


class ExecResult(BaseModel):
    stdout: str
    stderr: str
    returncode: int
    duration_ms: float


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_system_metrics() -> dict:
    """Collect a full system metrics snapshot using psutil."""
    cpu_percent  = psutil.cpu_percent(interval=1)
    mem          = psutil.virtual_memory()
    disk         = psutil.disk_usage("/")
    uptime_secs  = int(time.time() - psutil.boot_time())
    net          = psutil.net_io_counters()

    try:
        load_avg = list(os.getloadavg())
    except AttributeError:
        load_avg = [0.0, 0.0, 0.0]

    return {
        "hostname":        platform.node(),
        "os":              f"{platform.system()} {platform.release()}",
        "cpu_percent":     cpu_percent,
        "cpu_count":       psutil.cpu_count(logical=True),
        "ram_percent":     mem.percent,
        "ram_total_mb":    round(mem.total  / 1024 / 1024, 1),
        "ram_used_mb":     round(mem.used   / 1024 / 1024, 1),
        "disk_percent":    disk.percent,
        "disk_total_gb":   round(disk.total / 1024 / 1024 / 1024, 1),
        "disk_used_gb":    round(disk.used  / 1024 / 1024 / 1024, 1),
        "uptime_seconds":  uptime_secs,
        "load_avg":        load_avg,
        "net_bytes_sent":  net.bytes_sent,
        "net_bytes_recv":  net.bytes_recv,
        "timestamp":       datetime.utcnow().isoformat() + "Z",
    }


async def _do_reboot():
    """Background coroutine: wait 2 seconds then reboot the system."""
    await asyncio.sleep(2)
    # Agent runs as non-root; install.sh adds a sudoers rule for reboot.
    subprocess.run(["sudo", "reboot"], check=False)


# ─── Routes ───────────────────────────────────────────────────────────────────


@app.get("/health", tags=["Health"])
async def health_check():
    """
    Public endpoint — no authentication required.
    The panel pings this every 30 seconds to determine online/offline status.
    """
    return {
        "status":    "ok",
        "hostname":  platform.node(),
        "version":   AGENT_VERSION,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/version", tags=["Health"])
async def get_version():
    """Return the agent version string. Used by upgrade.sh to report before/after versions."""
    return {
        "version":  AGENT_VERSION,
        "hostname": platform.node(),
    }


@app.get("/metrics", tags=["Metrics"], dependencies=[Depends(require_token)])
async def get_metrics():
    """
    Return a full system metrics snapshot.
    Called by the panel's shared background task every 5 seconds.
    """
    return get_system_metrics()


@app.post("/reboot", tags=["Control"], dependencies=[Depends(require_token)])
async def reboot_server(background_tasks: BackgroundTasks):
    """
    Schedule a reboot after a 2-second delay.
    The delay ensures the HTTP response is sent before the system goes down.
    Uses 'sudo reboot' — requires the sudoers rule created by install.sh.
    """
    background_tasks.add_task(_do_reboot)
    return {
        "status":    "reboot_scheduled",
        "message":   "Server will reboot in ~2 seconds",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.post(
    "/exec",
    tags=["Control"],
    response_model=ExecResult,
    dependencies=[Depends(require_token)],
)
async def execute_command(req: ExecRequest):
    """
    Execute a shell command and return stdout/stderr/returncode.

    Commands run as the 'serverpilot' system user (non-root).
    Commands requiring root can be prefixed with 'sudo' if a sudoers rule exists.
    """
    start = time.perf_counter()
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(
                    req.command,
                    shell=True,
                    capture_output=True,
                    text=True,
                ),
            ),
            timeout=req.timeout,
        )
        duration_ms = (time.perf_counter() - start) * 1000
        return ExecResult(
            stdout=result.stdout,
            stderr=result.stderr,
            returncode=result.returncode,
            duration_ms=round(duration_ms, 2),
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_408_REQUEST_TIMEOUT,
            detail=f"Command timed out after {req.timeout}s",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )


@app.post("/schedule", tags=["Scheduler"], dependencies=[Depends(require_token)])
async def add_scheduled_job(req: ScheduleRequest):
    """Add or replace a cron-scheduled shell command."""
    if scheduler.get_job(req.job_id):
        scheduler.remove_job(req.job_id)

    try:
        trigger = CronTrigger.from_crontab(req.cron)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid cron expression: {exc}",
        )

    async def run_job():
        subprocess.run(req.command, shell=True, capture_output=True)

    scheduler.add_job(run_job, trigger=trigger, id=req.job_id, name=req.label, replace_existing=True)

    job      = scheduler.get_job(req.job_id)
    next_run = job.next_run_time.isoformat() if job and job.next_run_time else None

    return {
        "status":        "scheduled",
        "job_id":        req.job_id,
        "label":         req.label,
        "command":       req.command,
        "cron":          req.cron,
        "next_run_time": next_run,
    }


@app.delete("/schedule/{job_id}", tags=["Scheduler"], dependencies=[Depends(require_token)])
async def remove_scheduled_job(job_id: str):
    """Remove a scheduled job by its ID."""
    if not scheduler.get_job(job_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No job found with id '{job_id}'",
        )
    scheduler.remove_job(job_id)
    return {"status": "removed", "job_id": job_id}


@app.get("/schedule", tags=["Scheduler"], dependencies=[Depends(require_token)])
async def list_scheduled_jobs():
    """List all active scheduled jobs with next run times."""
    jobs = [
        {
            "job_id":        job.id,
            "label":         job.name,
            "trigger":       str(job.trigger),
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
        }
        for job in scheduler.get_jobs()
    ]
    return {"jobs": jobs, "total": len(jobs)}


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "agent:app",
        host="0.0.0.0",
        port=AGENT_PORT,
        log_level="info",
        access_log=False,  # We use our own middleware for access logging
    )
