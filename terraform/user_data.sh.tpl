#!/usr/bin/env bash
# =============================================================================
# ServerPilot — EC2 User Data Bootstrap Script
# =============================================================================
# This script runs once on first boot via cloud-init.
# It installs Docker, clones the repo, and starts all services.

set -euo pipefail
exec > >(tee /var/log/serverpilot-init.log | logger -t serverpilot-init) 2>&1

echo "=== ServerPilot Bootstrap starting at $(date) ==="

# ─── System update ────────────────────────────────────────────────────────────
apt-get update -qq
apt-get upgrade -y -qq

# ─── Install Docker ───────────────────────────────────────────────────────────
apt-get install -y -qq curl git ca-certificates gnupg

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker apt repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
    tee /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add ubuntu user to docker group
usermod -aG docker ubuntu

# Enable and start Docker
systemctl enable docker
systemctl start docker

echo "Docker installed: $(docker --version)"

# ─── Clone repository ─────────────────────────────────────────────────────────
cd /opt
git clone https://github.com/${github_repository}.git serverpilot || \
    (cd serverpilot && git pull)
cd serverpilot

# ─── Create environment file ──────────────────────────────────────────────────
cat > .env <<EOF
SECRET_KEY=${secret_key}
DEFAULT_ADMIN_PASSWORD=${admin_password}
DATABASE_URL=sqlite:///./data/serverpilot.db
CORS_ORIGINS=http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
DOMAIN=${domain}
EOF

mkdir -p data

# ─── Start services ───────────────────────────────────────────────────────────
docker compose pull
docker compose up -d

echo "=== ServerPilot Bootstrap complete at $(date) ==="
echo "Panel available at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
