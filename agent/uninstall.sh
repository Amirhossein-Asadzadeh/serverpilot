#!/usr/bin/env bash
# =============================================================================
# ServerPilot Agent — Uninstaller
# =============================================================================
# Cleanly removes the ServerPilot agent and all related files from a VPS.
#
# Usage:
#   sudo bash uninstall.sh
#
# What gets removed:
#   - systemd service (stopped, disabled, unit file deleted)
#   - /opt/serverpilot-agent    (agent code and venv)
#   - /etc/serverpilot          (token and config)
#   - /var/log/serverpilot-agent.log
#   - /etc/sudoers.d/serverpilot-agent
#   - 'serverpilot' system user
#   - Firewall rules for the agent port
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[•]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

SERVICE_NAME="serverpilot-agent"
INSTALL_DIR="/opt/serverpilot-agent"
CONFIG_DIR="/etc/serverpilot"
LOG_FILE="/var/log/serverpilot-agent.log"
AGENT_USER="serverpilot"
SUDOERS_FILE="/etc/sudoers.d/serverpilot-agent"

# ─── Guard ────────────────────────────────────────────────────────────────────

[[ $EUID -eq 0 ]] || err "Run as root: sudo bash uninstall.sh"

echo ""
echo -e "${BOLD}${RED}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${RED}║          ServerPilot Agent — Uninstaller             ║${NC}"
echo -e "${BOLD}${RED}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${YELLOW}This will permanently remove the ServerPilot agent${NC}"
echo -e "  ${YELLOW}and all its data from this server.${NC}"
echo ""

# Detect agent port for firewall cleanup
AGENT_PORT=9000
if [[ -f "${CONFIG_DIR}/agent.conf" ]]; then
    AGENT_PORT=$(grep "^AGENT_PORT=" "${CONFIG_DIR}/agent.conf" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || echo "9000")
fi

read -r -p "  Continue? [y/N] " confirm
[[ "${confirm,,}" == "y" ]] || { echo "Aborted."; exit 0; }
echo ""

# ─── Stop and disable service ────────────────────────────────────────────────

if systemctl list-unit-files --quiet "${SERVICE_NAME}.service" &>/dev/null; then
    log "Stopping and disabling systemd service..."
    systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    ok "Service removed."
else
    warn "Service '${SERVICE_NAME}' not found — skipping."
fi

# ─── Remove files ─────────────────────────────────────────────────────────────

if [[ -d "$INSTALL_DIR" ]]; then
    log "Removing install directory: ${INSTALL_DIR}"
    rm -rf "$INSTALL_DIR"
    ok "Removed ${INSTALL_DIR}"
else
    warn "${INSTALL_DIR} not found — skipping."
fi

if [[ -d "$CONFIG_DIR" ]]; then
    log "Removing config directory: ${CONFIG_DIR}"
    rm -rf "$CONFIG_DIR"
    ok "Removed ${CONFIG_DIR}"
else
    warn "${CONFIG_DIR} not found — skipping."
fi

if [[ -f "$LOG_FILE" ]]; then
    log "Removing log file: ${LOG_FILE}"
    rm -f "$LOG_FILE"
    ok "Removed ${LOG_FILE}"
fi

if [[ -f "$SUDOERS_FILE" ]]; then
    log "Removing sudoers rule..."
    rm -f "$SUDOERS_FILE"
    ok "Removed ${SUDOERS_FILE}"
fi

# ─── Remove system user ───────────────────────────────────────────────────────

if id "$AGENT_USER" &>/dev/null; then
    log "Removing system user: ${AGENT_USER}"
    userdel "$AGENT_USER" 2>/dev/null || true
    ok "User '${AGENT_USER}' removed."
else
    warn "User '${AGENT_USER}' not found — skipping."
fi

# ─── Remove firewall rules ────────────────────────────────────────────────────

if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    log "Removing UFW rules for port ${AGENT_PORT}..."
    ufw delete allow "${AGENT_PORT}/tcp"          2>/dev/null || true
    ufw delete deny  "${AGENT_PORT}/tcp"          2>/dev/null || true
    ufw delete allow proto tcp to any port "${AGENT_PORT}" 2>/dev/null || true
    ok "UFW rules removed."
elif command -v iptables &>/dev/null; then
    log "Removing iptables rules for port ${AGENT_PORT}..."
    iptables -D INPUT -p tcp --dport "$AGENT_PORT" -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -p tcp --dport "$AGENT_PORT" -j DROP   2>/dev/null || true
    # Persist removal
    if command -v netfilter-persistent &>/dev/null; then
        netfilter-persistent save &>/dev/null || true
    elif [[ -d /etc/iptables ]]; then
        iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
    fi
    ok "iptables rules removed."
fi

# ─── Verify ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Uninstall complete.${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo ""

# Confirm nothing is left
local_checks=(
    "/etc/systemd/system/${SERVICE_NAME}.service"
    "$INSTALL_DIR"
    "$CONFIG_DIR"
    "$LOG_FILE"
    "$SUDOERS_FILE"
)
all_clean=true
for path in "${local_checks[@]}"; do
    if [[ -e "$path" ]]; then
        warn "Still exists: ${path}"
        all_clean=false
    fi
done

if $all_clean; then
    ok "All ServerPilot agent files removed."
fi
if ! id "$AGENT_USER" &>/dev/null; then
    ok "System user '${AGENT_USER}' removed."
fi

echo ""
echo -e "  ${YELLOW}Remember to remove this server from your ServerPilot panel (Settings page).${NC}"
echo ""
