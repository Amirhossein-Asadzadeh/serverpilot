#!/usr/bin/env bash
# =============================================================================
# ServerPilot Agent — Production Installer
# =============================================================================
#
# One-liner install on any VPS:
#   curl -sSL https://raw.githubusercontent.com/Amirhossein-Asadzadeh/serverpilot/main/agent/install.sh | bash
#
# Options (set as env vars before the command):
#   AGENT_PORT=9000        Agent listen port            (default: 9000)
#   PANEL_IP=1.2.3.4       Restrict port to this IP only (recommended)
#   REPO_RAW_URL=...       Override GitHub raw file URL
#
# Examples:
#   Basic install:
#     curl -sSL .../install.sh | bash
#
#   Recommended — lock port to your panel server:
#     PANEL_IP=85.192.61.185 curl -sSL .../install.sh | bash
#
#   Custom port:
#     AGENT_PORT=8765 PANEL_IP=1.2.3.4 curl -sSL .../install.sh | bash
#
# Re-running this script on an already-installed agent performs an in-place
# upgrade: agent.py and dependencies are updated, the token is preserved.
# =============================================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

AGENT_PORT="${AGENT_PORT:-9000}"
PANEL_IP="${PANEL_IP:-}"
REPO_RAW_URL="${REPO_RAW_URL:-https://raw.githubusercontent.com/Amirhossein-Asadzadeh/serverpilot/main/agent}"

INSTALL_DIR="/opt/serverpilot-agent"
CONFIG_DIR="/etc/serverpilot"
CONFIG_FILE="${CONFIG_DIR}/agent.conf"
LOG_FILE="/var/log/serverpilot-agent.log"
SERVICE_NAME="serverpilot-agent"
AGENT_USER="serverpilot"
MIN_PYTHON_MINOR=8

# ─── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[•]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}"; }

# ─── Checks ───────────────────────────────────────────────────────────────────

require_root() {
    [[ $EUID -eq 0 ]] || err "This installer must run as root. Try: sudo bash install.sh"
}

detect_os() {
    if command -v apt-get &>/dev/null; then
        PKG_INSTALL="apt-get install -y -qq"
        PKG_UPDATE="apt-get update -qq"
        OS_FAMILY="debian"
    elif command -v dnf &>/dev/null; then
        PKG_INSTALL="dnf install -y -q"
        PKG_UPDATE="dnf check-update -q || true"
        OS_FAMILY="rhel"
    elif command -v yum &>/dev/null; then
        PKG_INSTALL="yum install -y -q"
        PKG_UPDATE="yum check-update -q || true"
        OS_FAMILY="rhel"
    else
        PKG_INSTALL=""
        PKG_UPDATE=""
        OS_FAMILY="unknown"
        warn "Unknown package manager. Assuming Python 3 and required tools are installed."
    fi
}

check_python() {
    if ! command -v python3 &>/dev/null; then
        log "Python 3 not found — installing..."
        if [[ "$OS_FAMILY" == "debian" ]]; then
            eval "$PKG_UPDATE" && eval "$PKG_INSTALL python3 python3-pip python3-venv"
        elif [[ "$OS_FAMILY" == "rhel" ]]; then
            eval "$PKG_INSTALL python3 python3-pip"
        else
            err "Python 3 not found and cannot install automatically. Install it manually and re-run."
        fi
    fi

    local ver
    ver=$(python3 -c "import sys; print(sys.version_info.minor)")
    local major
    major=$(python3 -c "import sys; print(sys.version_info.major)")

    [[ "$major" -eq 3 && "$ver" -ge $MIN_PYTHON_MINOR ]] || \
        err "Python 3.${MIN_PYTHON_MINOR}+ required. Found: $(python3 --version)"

    ok "Python $(python3 --version 2>&1 | awk '{print $2}')"
}

wait_for_apt_lock() {
    local i=0
    while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
          fuser /var/lib/apt/lists/lock      >/dev/null 2>&1; do
        [[ $i -eq 0 ]] && log "Waiting for apt lock (another apt process is running)..."
        sleep 3
        (( i++ ))
        [[ $i -lt 40 ]] || err "Timed out waiting for apt lock after 2 minutes."
    done
}

check_dependencies() {
    local missing=()
    for cmd in curl openssl; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log "Installing missing tools: ${missing[*]}"
        if [[ -n "$PKG_INSTALL" ]]; then
            wait_for_apt_lock
            eval "$PKG_UPDATE" && eval "$PKG_INSTALL ${missing[*]}"
        else
            err "Missing: ${missing[*]}. Install them and re-run."
        fi
    fi

    # On Debian/Ubuntu, python3-venv is a separate package that must be
    # installed explicitly. 'import venv' succeeds even without it (the module
    # exists) but venv creation fails at ensurepip. Always install it.
    if [[ "$OS_FAMILY" == "debian" ]]; then
        local pyver
        pyver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        export DEBIAN_FRONTEND=noninteractive
        wait_for_apt_lock
        log "Refreshing package lists..."
        eval "$PKG_UPDATE"
        log "Installing python3-venv and pip..."
        eval "$PKG_INSTALL python3-venv python3-pip"
        # python3.X-venv is needed on some Ubuntu releases; ignore if unavailable
        eval "$PKG_INSTALL python3${pyver}-venv" 2>/dev/null || true
    fi
}

# ─── Install/upgrade detection ────────────────────────────────────────────────

is_upgrade() {
    [[ -f "$CONFIG_FILE" ]]
}

# ─── System user ──────────────────────────────────────────────────────────────

create_agent_user() {
    if id "$AGENT_USER" &>/dev/null; then
        ok "System user '$AGENT_USER' already exists."
        return
    fi
    useradd \
        --system \
        --no-create-home \
        --shell /sbin/nologin \
        --comment "ServerPilot Agent (do not login)" \
        "$AGENT_USER"
    ok "Created system user: $AGENT_USER (no login shell)"
}

# ─── Directories ──────────────────────────────────────────────────────────────

setup_directories() {
    # Install directory — owned by agent user
    mkdir -p "$INSTALL_DIR"
    chown "$AGENT_USER:$AGENT_USER" "$INSTALL_DIR"
    chmod 750 "$INSTALL_DIR"

    # Config directory — root:serverpilot, no world access
    mkdir -p "$CONFIG_DIR"
    chown "root:$AGENT_USER" "$CONFIG_DIR"
    chmod 750 "$CONFIG_DIR"

    # Log file — agent user can write, others can't read
    touch "$LOG_FILE"
    chown "$AGENT_USER:$AGENT_USER" "$LOG_FILE"
    chmod 640 "$LOG_FILE"

    ok "Directories ready (${INSTALL_DIR}, ${CONFIG_DIR})"
}

# ─── Sudoers rule for reboot ──────────────────────────────────────────────────

setup_sudoers() {
    local sudoers_file="/etc/sudoers.d/serverpilot-agent"
    cat > "$sudoers_file" <<EOF
# ServerPilot Agent — allow non-root agent to trigger system reboot
${AGENT_USER} ALL=(ALL) NOPASSWD: /sbin/reboot, /usr/sbin/reboot, /bin/systemctl reboot
EOF
    chmod 440 "$sudoers_file"
    # Validate the new sudoers fragment
    visudo -c -f "$sudoers_file" &>/dev/null || {
        rm -f "$sudoers_file"
        warn "sudoers validation failed — reboot command may not work. Continuing."
        return
    }
    ok "Sudoers rule added (reboot allowed without password)"
}

# ─── Agent files ──────────────────────────────────────────────────────────────

install_files() {
    # Detect if running locally (git clone) or via curl pipe
    local script_dir=""
    if [[ -n "${BASH_SOURCE[0]:-}" ]] && [[ "${BASH_SOURCE[0]:-}" != "/dev/stdin" ]]; then
        script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    fi

    if [[ -n "$script_dir" ]] && [[ -f "${script_dir}/agent.py" ]]; then
        log "Copying agent files from local directory..."
        cp "${script_dir}/agent.py"           "${INSTALL_DIR}/agent.py"
        cp "${script_dir}/requirements.txt"   "${INSTALL_DIR}/requirements.txt"
        ok "Copied local agent files."
    else
        log "Downloading agent files from GitHub..."
        curl -sSfL "${REPO_RAW_URL}/agent.py"          -o "${INSTALL_DIR}/agent.py"
        curl -sSfL "${REPO_RAW_URL}/requirements.txt"  -o "${INSTALL_DIR}/requirements.txt"
        ok "Downloaded agent files."
    fi

    chown "$AGENT_USER:$AGENT_USER" "${INSTALL_DIR}/agent.py" "${INSTALL_DIR}/requirements.txt"
    chmod 640 "${INSTALL_DIR}/agent.py" "${INSTALL_DIR}/requirements.txt"
}

# ─── Python venv ──────────────────────────────────────────────────────────────

setup_venv() {
    if [[ -d "${INSTALL_DIR}/venv" ]] && is_upgrade; then
        log "Updating Python dependencies..."
    else
        log "Creating Python virtual environment..."
        sudo -u "$AGENT_USER" python3 -m venv "${INSTALL_DIR}/venv"
    fi

    sudo -u "$AGENT_USER" "${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
    sudo -u "$AGENT_USER" "${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/requirements.txt"
    ok "Python venv ready."
}

# ─── Config file ──────────────────────────────────────────────────────────────

setup_config() {
    if is_upgrade && [[ -f "$CONFIG_FILE" ]]; then
        # Preserve existing token — changing it would break the panel connection
        AGENT_TOKEN=$(grep "^AGENT_TOKEN=" "$CONFIG_FILE" | cut -d= -f2- | tr -d '[:space:]')
        log "Preserving existing agent token."
    else
        # Generate token on the VPS — never transmitted over the network
        if command -v openssl &>/dev/null; then
            AGENT_TOKEN=$(openssl rand -hex 32)
        else
            AGENT_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
        fi
        log "Generated new agent token (64-char hex)."
    fi

    cat > "$CONFIG_FILE" <<EOF
# ServerPilot Agent Configuration
# Managed by install.sh — do not edit manually unless you know what you are doing.
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Bearer token the panel uses to authenticate against this agent.
# Changing this requires updating the server entry in the panel.
AGENT_TOKEN=${AGENT_TOKEN}

# TCP port the agent listens on.
AGENT_PORT=${AGENT_PORT}
EOF
    chown "root:$AGENT_USER" "$CONFIG_FILE"
    chmod 640 "$CONFIG_FILE"
    ok "Config written: ${CONFIG_FILE} (root:${AGENT_USER}, mode 640)"
}

# ─── Systemd service ──────────────────────────────────────────────────────────

setup_service() {
    cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=ServerPilot Agent
Documentation=https://github.com/Amirhossein-Asadzadeh/serverpilot
After=network-online.target
Wants=network-online.target
# No restart rate limit — ensures the agent always recovers after reboot
StartLimitIntervalSec=0

[Service]
Type=simple
User=${AGENT_USER}
Group=${AGENT_USER}
WorkingDirectory=${INSTALL_DIR}

# Config is read from the secure conf file, not the environment
ExecStart=${INSTALL_DIR}/venv/bin/python ${INSTALL_DIR}/agent.py
Restart=always
RestartSec=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# ── Security hardening ──────────────────────────────────────────────────
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

# Writable paths the agent needs at runtime
ReadWritePaths=${INSTALL_DIR} ${LOG_FILE}

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    ok "Systemd service configured: ${SERVICE_NAME}"
}

# ─── Firewall ─────────────────────────────────────────────────────────────────

setup_firewall() {
    if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
        _setup_ufw
    elif command -v iptables &>/dev/null; then
        _setup_iptables
    else
        warn "No active firewall detected. Manually ensure port ${AGENT_PORT} is reachable from your panel."
        return
    fi
}

_setup_ufw() {
    # Clean up any previous rules for this port
    ufw delete allow "${AGENT_PORT}/tcp"          comment "ServerPilot Agent" 2>/dev/null || true
    ufw delete deny  "${AGENT_PORT}/tcp"                                      2>/dev/null || true
    ufw delete allow proto tcp from any to any port "${AGENT_PORT}"           2>/dev/null || true
    ufw delete allow proto tcp from "${PANEL_IP:-0.0.0.0/0}" to any port "${AGENT_PORT}" 2>/dev/null || true

    if [[ -n "$PANEL_IP" ]]; then
        ufw allow proto tcp from "$PANEL_IP" to any port "$AGENT_PORT" \
            comment "ServerPilot Agent (panel only)" >/dev/null
        ufw deny "${AGENT_PORT}/tcp" comment "Block other ServerPilot traffic" >/dev/null
        ok "UFW: port ${AGENT_PORT} restricted to ${PANEL_IP} only."
    else
        ufw allow "${AGENT_PORT}/tcp" comment "ServerPilot Agent" >/dev/null
        ok "UFW: port ${AGENT_PORT} open from any IP."
        warn "TIP: Re-run with PANEL_IP=<your-panel-IP> to restrict access to your panel only."
    fi
}

_setup_iptables() {
    # Remove old rules
    iptables -D INPUT -p tcp --dport "$AGENT_PORT" -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -p tcp --dport "$AGENT_PORT" -j DROP   2>/dev/null || true
    if [[ -n "$PANEL_IP" ]]; then
        iptables -D INPUT -p tcp --dport "$AGENT_PORT" -s "$PANEL_IP" -j ACCEPT 2>/dev/null || true
    fi

    if [[ -n "$PANEL_IP" ]]; then
        iptables -I INPUT -p tcp --dport "$AGENT_PORT" -s "$PANEL_IP" -j ACCEPT
        iptables -A INPUT -p tcp --dport "$AGENT_PORT" -j DROP
        ok "iptables: port ${AGENT_PORT} restricted to ${PANEL_IP} only."
    else
        iptables -I INPUT -p tcp --dport "$AGENT_PORT" -j ACCEPT
        ok "iptables: port ${AGENT_PORT} open from any IP."
        warn "TIP: Re-run with PANEL_IP=<your-panel-IP> to restrict access."
    fi

    # Persist rules
    if command -v netfilter-persistent &>/dev/null; then
        netfilter-persistent save &>/dev/null || true
    elif [[ -d /etc/iptables ]]; then
        iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
    elif command -v service &>/dev/null && service iptables save &>/dev/null 2>&1; then
        true  # RHEL/CentOS style
    fi
}

# ─── Start service ────────────────────────────────────────────────────────────

start_service() {
    systemctl enable "$SERVICE_NAME" &>/dev/null
    systemctl restart "$SERVICE_NAME"

    # Wait up to 10s for the service to report active
    local i
    for i in $(seq 1 10); do
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            ok "Service '${SERVICE_NAME}' is running."
            return 0
        fi
        sleep 1
    done
    err "Service failed to start. Diagnose with: journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
}

# ─── Health check ─────────────────────────────────────────────────────────────

verify_health() {
    log "Waiting for agent HTTP server to be ready..."
    local i http_code
    for i in $(seq 1 12); do
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            "http://localhost:${AGENT_PORT}/health" 2>/dev/null || echo "000")
        if [[ "$http_code" == "200" ]]; then
            ok "Agent health check passed (HTTP 200)."
            return 0
        fi
        sleep 1
    done
    warn "Health check did not return 200 within 12s — agent may still be starting."
    warn "Check logs: journalctl -u ${SERVICE_NAME} -f"
}

# ─── Summary box ──────────────────────────────────────────────────────────────

print_summary() {
    local hostname ip short_token status mode
    hostname=$(hostname -s 2>/dev/null || echo "unknown")
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "?.?.?.?")
    short_token="${AGENT_TOKEN:0:16}..."

    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        status="${GREEN}● Running${NC}"
    else
        status="${RED}✗ Not running${NC}"
    fi

    if is_upgrade; then mode="Upgraded ✓"; else mode="Installed ✓"; fi

    # Inner content width = 52 chars
    local W=52
    local LINE; LINE=$(printf '═%.0s' $(seq 1 $W))

    echo ""
    echo -e "${GREEN}╔${LINE}╗${NC}"
    printf "${GREEN}║${NC}  ${BOLD}%-$((W-2))s${NC}${GREEN}║${NC}\n" "ServerPilot Agent — ${mode}"
    echo -e "${GREEN}╠${LINE}╣${NC}"
    printf "${GREEN}║${NC}  %-14s %-$((W-16))s${GREEN}║${NC}\n" "Host:"    "${hostname} (${ip})"
    printf "${GREEN}║${NC}  %-14s %-$((W-16))s${GREEN}║${NC}\n" "Port:"    "${AGENT_PORT}"
    printf "${GREEN}║${NC}  %-14s %-$((W-16))s${GREEN}║${NC}\n" "Token:"   "${short_token}"
    printf "${GREEN}║${NC}  %-14s ${status}%-$((W-16))s${GREEN}║${NC}\n" "Status:"  ""
    echo -e "${GREEN}╠${LINE}╣${NC}"
    printf "${GREEN}║${NC}  %-${W}s${GREEN}║${NC}\n" "Add to ServerPilot panel → Settings"
    echo -e "${GREEN}╚${LINE}╝${NC}"
    echo ""
    echo -e "  ${BOLD}Full token${NC} (copy into panel Settings):"
    echo -e "  ${CYAN}${AGENT_TOKEN}${NC}"
    echo ""
    echo -e "  ${BOLD}Useful commands:${NC}"
    echo -e "  systemctl status   ${SERVICE_NAME}"
    echo -e "  journalctl -u      ${SERVICE_NAME} -f"
    echo -e "  tail -f            ${LOG_FILE}"
    echo ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║           ServerPilot Agent Installer                ║${NC}"
    echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    require_root

    if is_upgrade; then
        log "Existing installation detected at ${CONFIG_FILE} — upgrading in-place."
    else
        log "Fresh installation starting..."
    fi

    step "System checks"
    detect_os
    check_python
    check_dependencies

    step "Creating agent user and directories"
    create_agent_user
    setup_directories
    setup_sudoers

    step "Installing agent files"
    install_files
    setup_venv
    setup_config

    step "Configuring system service"
    setup_service

    step "Configuring firewall"
    setup_firewall

    step "Starting service"
    start_service
    verify_health

    print_summary
}

main "$@"
