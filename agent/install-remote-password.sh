#!/usr/bin/env bash
# =============================================================================
# ServerPilot Agent — Remote Installer (Password Auth via sshpass)
# =============================================================================
# Runs ON YOUR LOCAL MACHINE. Uses sshpass for password-based SSH auth,
# uploads the agent, installs it as a systemd service, and prints a summary.
#
# Usage:
#   ./install-remote-password.sh --host 1.2.3.4 --user root --password 'MyPass!'
#
# Optional flags:
#   --port      Agent port on the VPS (default: 9000)
#   --ssh-port  SSH port to connect on (default: 22)
#   --name      Friendly name shown in the panel (default: hostname)
#
# Requires sshpass:
#   macOS:  brew install sshpass
#   Ubuntu: apt-get install sshpass
# =============================================================================

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[ServerPilot]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

# ─── Argument parsing ─────────────────────────────────────────────────────────
HOST=""
USER="root"
PASSWORD=""
AGENT_PORT="9000"
SSH_PORT="22"
SERVER_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)      HOST="$2";        shift 2 ;;
    --user)      USER="$2";        shift 2 ;;
    --password)  PASSWORD="$2";    shift 2 ;;
    --port)      AGENT_PORT="$2";  shift 2 ;;
    --ssh-port)  SSH_PORT="$2";    shift 2 ;;
    --name)      SERVER_NAME="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --host <IP> [--user root] --password '<password>' [--port 9000] [--ssh-port 22]"
      exit 0 ;;
    *)
      err "Unknown option: $1"
      ;;
  esac
done

# ─── Validate required args ───────────────────────────────────────────────────
[[ -z "$HOST" ]]     && err "Missing --host. Usage: $0 --host 1.2.3.4 --password 'MyPass!'"
[[ -z "$PASSWORD" ]] && err "Missing --password. Usage: $0 --host 1.2.3.4 --password 'MyPass!'"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "${SCRIPT_DIR}/agent.py" ]]        || err "agent.py not found in ${SCRIPT_DIR}"
[[ -f "${SCRIPT_DIR}/requirements.txt" ]] || err "requirements.txt not found in ${SCRIPT_DIR}"

# ─── Check sshpass is installed ──────────────────────────────────────────────
if ! command -v sshpass &>/dev/null; then
    echo ""
    echo -e "${RED}[ERROR]${NC} sshpass is not installed."
    echo ""
    echo "  Install it first:"
    echo ""
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "    brew install sshpass"
    else
        echo "    sudo apt-get install -y sshpass   # Debian/Ubuntu"
        echo "    sudo yum install -y sshpass        # RHEL/CentOS"
    fi
    echo ""
    exit 1
fi

command -v ssh &>/dev/null || err "ssh is required but not installed"
command -v scp &>/dev/null || err "scp is required but not installed"

# ─── SSH helpers using sshpass ────────────────────────────────────────────────
SSH_OPTS="-p ${SSH_PORT} -o StrictHostKeyChecking=no -o ConnectTimeout=10"

remote() {
  SSHPASS="${PASSWORD}" sshpass -e ssh ${SSH_OPTS} "${USER}@${HOST}" "$@"
}

remote_quiet() {
  SSHPASS="${PASSWORD}" sshpass -e ssh ${SSH_OPTS} "${USER}@${HOST}" "$@" &>/dev/null
}

remote_scp() {
  SSHPASS="${PASSWORD}" sshpass -e scp -P "${SSH_PORT}" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 \
    "$@"
}

# ─── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║     ServerPilot Agent — Remote Installer (PW)        ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
log "Target:     ${USER}@${HOST}:${SSH_PORT}"
log "Agent port: ${AGENT_PORT}"
echo ""

# ─── Step 1: Test SSH connectivity ───────────────────────────────────────────
step "Testing SSH connection..."
if ! remote_quiet "echo ok"; then
  err "Cannot connect to ${USER}@${HOST}. Check your password, host, and user."
fi
ok "SSH connection successful."

# ─── Step 2: Upload agent files ───────────────────────────────────────────────
step "Uploading agent files..."

remote "mkdir -p /opt/serverpilot-agent"

remote_scp \
    "${SCRIPT_DIR}/agent.py" \
    "${SCRIPT_DIR}/requirements.txt" \
    "${USER}@${HOST}:/opt/serverpilot-agent/"

ok "agent.py and requirements.txt uploaded."

# ─── Step 3: Generate a random agent token ───────────────────────────────────
step "Generating secure agent token..."
AGENT_TOKEN=$(remote "python3 -c \"import secrets; print(secrets.token_hex(32))\"")
[[ -n "$AGENT_TOKEN" ]] || err "Failed to generate token on remote. Is Python 3 available?"
ok "Token generated."

# ─── Step 4: Install Python dependencies ─────────────────────────────────────
step "Installing Python dependencies on remote..."

remote "bash -s" <<REMOTE_SCRIPT
set -euo pipefail

if command -v apt-get &>/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null
    apt-get install -y -qq python3 python3-pip python3-venv 2>/dev/null
elif command -v yum &>/dev/null; then
    yum install -y -q python3 python3-pip 2>/dev/null
elif command -v dnf &>/dev/null; then
    dnf install -y -q python3 python3-pip 2>/dev/null
fi

python3 --version >/dev/null 2>&1 || { echo "ERROR: Python 3 not available"; exit 1; }

INSTALL_DIR="/opt/serverpilot-agent"
VENV_DIR="\${INSTALL_DIR}/venv"

python3 -m venv "\${VENV_DIR}"
"\${VENV_DIR}/bin/pip" install --quiet --upgrade pip
"\${VENV_DIR}/bin/pip" install --quiet -r "\${INSTALL_DIR}/requirements.txt"

echo "Python OK"
REMOTE_SCRIPT

ok "Dependencies installed."

# ─── Step 5: Write .env and systemd service ──────────────────────────────────
step "Configuring systemd service..."

remote "bash -s" <<REMOTE_SCRIPT
INSTALL_DIR="/opt/serverpilot-agent"
VENV_DIR="\${INSTALL_DIR}/venv"
SERVICE_NAME="serverpilot-agent"

cat > "\${INSTALL_DIR}/.env" <<ENV
AGENT_TOKEN=${AGENT_TOKEN}
AGENT_PORT=${AGENT_PORT}
ENV
chmod 600 "\${INSTALL_DIR}/.env"

cat > "/etc/systemd/system/\${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=ServerPilot Agent
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=root
WorkingDirectory=\${INSTALL_DIR}
EnvironmentFile=\${INSTALL_DIR}/.env
ExecStart=\${VENV_DIR}/bin/python \${INSTALL_DIR}/agent.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=\${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "\${SERVICE_NAME}"
systemctl restart "\${SERVICE_NAME}"
echo "Service started"
REMOTE_SCRIPT

ok "Service created and started."

# ─── Step 6: Open firewall ────────────────────────────────────────────────────
step "Configuring firewall..."
remote "bash -s" <<REMOTE_SCRIPT || true
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow ${AGENT_PORT}/tcp comment "ServerPilot Agent" >/dev/null 2>&1
    echo "UFW rule added."
else
    echo "UFW not active or not installed — skipping."
fi
REMOTE_SCRIPT

# ─── Step 7: Verify agent is responding ──────────────────────────────────────
step "Waiting for agent to start..."
sleep 3

HEALTH_STATUS=$(remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:${AGENT_PORT}/health" 2>/dev/null || echo "000")

if [[ "$HEALTH_STATUS" == "200" ]]; then
    ok "Agent health check passed (HTTP ${HEALTH_STATUS})."
else
    warn "Agent health check returned HTTP ${HEALTH_STATUS}. It may still be starting."
    warn "Check logs: ssh ${USER}@${HOST} journalctl -u serverpilot-agent -n 30"
fi

# ─── Get remote hostname for display ─────────────────────────────────────────
if [[ -z "$SERVER_NAME" ]]; then
    SERVER_NAME=$(remote "hostname" 2>/dev/null || echo "${HOST}")
fi

# ─── Final summary ────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║          Agent installed successfully!                       ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Server:${NC}      ${HOST}"
echo -e "  ${BOLD}Agent URL:${NC}   ${CYAN}http://${HOST}:${AGENT_PORT}${NC}"
echo -e "  ${BOLD}Health:${NC}      ${CYAN}http://${HOST}:${AGENT_PORT}/health${NC}"
echo ""
echo -e "  ${BOLD}${YELLOW}Add this server to your panel:${NC}"
echo -e "  ┌────────────────────────────────────────────────────────┐"
echo -e "  │  Name:   ${SERVER_NAME}"
echo -e "  │  IP:     ${HOST}"
echo -e "  │  Port:   ${AGENT_PORT}"
echo -e "  │  Token:  ${AGENT_TOKEN}"
echo -e "  └────────────────────────────────────────────────────────┘"
echo ""
echo -e "  ${BOLD}Useful commands on the server:${NC}"
echo -e "  ssh ${USER}@${HOST} systemctl status serverpilot-agent"
echo -e "  ssh ${USER}@${HOST} journalctl -u serverpilot-agent -f"
echo ""
