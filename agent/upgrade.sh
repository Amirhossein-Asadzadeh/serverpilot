#!/usr/bin/env bash
# =============================================================================
# ServerPilot Agent — In-Place Upgrader
# =============================================================================
# Downloads the latest agent.py and requirements.txt from GitHub, reinstalls
# dependencies, and restarts the service.  Existing token and config are
# preserved.
#
# Usage:
#   sudo bash upgrade.sh
#
# Override the source URL:
#   REPO_RAW_URL=https://... sudo bash upgrade.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[•]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}"; }

SERVICE_NAME="serverpilot-agent"
INSTALL_DIR="/opt/serverpilot-agent"
CONFIG_DIR="/etc/serverpilot"
CONFIG_FILE="${CONFIG_DIR}/agent.conf"
AGENT_USER="serverpilot"
REPO_RAW_URL="${REPO_RAW_URL:-https://raw.githubusercontent.com/Amirhossein-Asadzadeh/serverpilot/main/agent}"

# ─── Guard ────────────────────────────────────────────────────────────────────

[[ $EUID -eq 0 ]] || err "Run as root: sudo bash upgrade.sh"

[[ -f "$CONFIG_FILE" ]] || err "No existing installation found (${CONFIG_FILE} missing). Run install.sh first."
[[ -d "$INSTALL_DIR" ]] || err "Install directory not found: ${INSTALL_DIR}. Run install.sh first."

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║           ServerPilot Agent Upgrader                 ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Read current agent port
AGENT_PORT=$(grep "^AGENT_PORT=" "$CONFIG_FILE" | cut -d= -f2- | tr -d '[:space:]' || echo "9000")

# Read current version if endpoint exists
CURRENT_VERSION="unknown"
CURRENT_VERSION=$(curl -s --connect-timeout 3 "http://localhost:${AGENT_PORT}/version" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version','unknown'))" 2>/dev/null \
    || echo "unknown")

log "Current version: ${CURRENT_VERSION}"
log "Source URL:      ${REPO_RAW_URL}"
echo ""

# ─── Detect local vs GitHub source ───────────────────────────────────────────

LOCAL_SRC=""
if [[ -n "${BASH_SOURCE[0]:-}" ]] && [[ "${BASH_SOURCE[0]:-}" != "/dev/stdin" ]]; then
    LOCAL_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# ─── Backup current agent.py ──────────────────────────────────────────────────

step "Backing up current agent"
BACKUP="${INSTALL_DIR}/agent.py.bak.$(date +%Y%m%d%H%M%S)"
cp "${INSTALL_DIR}/agent.py" "$BACKUP"
ok "Backup saved: ${BACKUP}"

# ─── Download new files ────────────────────────────────────────────────────────

step "Downloading new agent files"

if [[ -n "$LOCAL_SRC" ]] && [[ -f "${LOCAL_SRC}/agent.py" ]]; then
    log "Using local source files..."
    cp "${LOCAL_SRC}/agent.py"          "${INSTALL_DIR}/agent.py"
    cp "${LOCAL_SRC}/requirements.txt"  "${INSTALL_DIR}/requirements.txt"
else
    log "Downloading from GitHub..."
    curl -sSfL "${REPO_RAW_URL}/agent.py"         -o "${INSTALL_DIR}/agent.py"
    curl -sSfL "${REPO_RAW_URL}/requirements.txt" -o "${INSTALL_DIR}/requirements.txt"
fi

chown "$AGENT_USER:$AGENT_USER" "${INSTALL_DIR}/agent.py" "${INSTALL_DIR}/requirements.txt"
chmod 640 "${INSTALL_DIR}/agent.py" "${INSTALL_DIR}/requirements.txt"
ok "Agent files updated."

# ─── Update dependencies ──────────────────────────────────────────────────────

step "Updating Python dependencies"
sudo -u "$AGENT_USER" "${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
sudo -u "$AGENT_USER" "${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/requirements.txt"
ok "Dependencies up to date."

# ─── Restart service ──────────────────────────────────────────────────────────

step "Restarting service"
systemctl restart "$SERVICE_NAME"

# Wait up to 10s for the service to come up
started=false
for i in $(seq 1 10); do
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        started=true
        break
    fi
    sleep 1
done

if $started; then
    ok "Service '${SERVICE_NAME}' restarted successfully."
else
    # Rollback
    warn "Service failed to restart — rolling back to previous version..."
    cp "$BACKUP" "${INSTALL_DIR}/agent.py"
    systemctl restart "$SERVICE_NAME" || true
    err "Upgrade failed. Rolled back to ${BACKUP}. Check: journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
fi

# ─── Health check ─────────────────────────────────────────────────────────────

step "Verifying health"
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:${AGENT_PORT}/health" 2>/dev/null || echo "000")

if [[ "$http_code" == "200" ]]; then
    ok "Agent health check passed (HTTP 200)."
else
    warn "Health check returned HTTP ${http_code}. Agent may still be starting."
fi

NEW_VERSION=$(curl -s --connect-timeout 3 "http://localhost:${AGENT_PORT}/version" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version','?'))" 2>/dev/null \
    || echo "?")

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Upgrade complete.${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Previous version : ${CYAN}${CURRENT_VERSION}${NC}"
echo -e "  New version      : ${CYAN}${NEW_VERSION}${NC}"
echo -e "  Backup           : ${BACKUP}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "  systemctl status ${SERVICE_NAME}"
echo -e "  journalctl -u ${SERVICE_NAME} -f"
echo ""
