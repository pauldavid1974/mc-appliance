#!/usr/bin/env bash
###############################################################################
# Zero-Touch Minecraft Appliance - Master Install Script
#
# This script is fetched and executed automatically on first boot by
# cloud-init (user-data). It can also be run manually:
#
#   curl -fsSL https://raw.githubusercontent.com/pauldavid1974/mc-appliance/main/install.sh | sudo bash
#
# What it does:
#   1. Installs Docker Engine + Docker Compose
#   2. Installs CasaOS (web dashboard)
#   3. Installs rclone (Google Drive backup tool)
#   4. Clones this repo and starts the Minecraft appliance
#
###############################################################################
set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
REPO_URL="https://github.com/pauldavid1974/mc-appliance.git"
INSTALL_DIR="/home/mcadmin/mc-appliance"
MC_USER="mcadmin"

# ── Colors for output ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[MC-APPLIANCE]${NC} $1"; }
warn() { echo -e "${YELLOW}[MC-APPLIANCE]${NC} $1"; }
err()  { echo -e "${RED}[MC-APPLIANCE]${NC} $1"; }

# ── Preflight ───────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (or with sudo)."
  exit 1
fi

log "============================================="
log "  Zero-Touch Minecraft Appliance Installer"
log "============================================="
log ""
log "This will install Docker, CasaOS, rclone,"
log "and deploy your Minecraft server."
log ""

# ── Ensure mcadmin user exists ──────────────────────────────────────────────
if ! id "$MC_USER" &>/dev/null; then
  log "Creating user: $MC_USER"
  useradd -m -s /bin/bash "$MC_USER"
  echo "$MC_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$MC_USER
fi

# ── System updates ──────────────────────────────────────────────────────────
log "Step 1/6: Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget git unzip jq apt-transport-https \
  ca-certificates gnupg lsb-release software-properties-common

# ── Docker Engine ───────────────────────────────────────────────────────────
log "Step 2/6: Installing Docker Engine..."
if command -v docker &>/dev/null; then
  warn "Docker already installed, skipping."
else
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  usermod -aG docker "$MC_USER"
fi

if ! docker compose version &>/dev/null; then
  err "Docker Compose plugin not found. Installing..."
  apt-get install -y -qq docker-compose-plugin
fi

log "  Docker $(docker --version | awk '{print $3}') installed."

# ── CasaOS ──────────────────────────────────────────────────────────────────
log "Step 3/6: Installing CasaOS..."
if command -v casaos &>/dev/null || systemctl is-active --quiet casaos 2>/dev/null; then
  warn "CasaOS already installed, skipping."
else
  curl -fsSL https://get.casaos.io | bash
fi

# ── rclone (for Google Drive backups) ───────────────────────────────────────
log "Step 4/6: Installing rclone..."
if command -v rclone &>/dev/null; then
  warn "rclone already installed, skipping."
else
  curl -fsSL https://rclone.org/install.sh | bash
fi

log "  rclone $(rclone --version | head -1 | awk '{print $2}') installed."

# ── Clone the appliance repo ───────────────────────────────────────────────
log "Step 5/6: Downloading Minecraft Appliance..."
if [[ -d "$INSTALL_DIR" ]]; then
  warn "Appliance directory exists. Pulling latest..."
  cd "$INSTALL_DIR"
  sudo -u "$MC_USER" git pull
else
  sudo -u "$MC_USER" git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Create required host directories ───────────────────────────────────────
log "Creating data directories..."
sudo -u "$MC_USER" mkdir -p /home/mcadmin/minecraft-data
sudo -u "$MC_USER" mkdir -p /home/mcadmin/.config/rclone
sudo -u "$MC_USER" mkdir -p /home/mcadmin/backups

# ── Start the appliance ────────────────────────────────────────────────────
log "Step 6/6: Starting Minecraft Appliance..."
cd "$INSTALL_DIR"
docker compose up -d --build

# ── Done! ───────────────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I | awk '{print $1}')

log ""
log "============================================="
log "  ✅ Installation Complete!"
log "============================================="
log ""
log "  Your services are starting up now."
log "  Give it 2-3 minutes for the Minecraft"
log "  server to download and generate the world."
log ""
log "  ┌─────────────────────────────────────────┐"
log "  │  Minecraft Server:  $LOCAL_IP:25565      "
log "  │  World Manager:     http://$LOCAL_IP:3000"
log "  │  CasaOS Dashboard:  http://$LOCAL_IP     "
log "  │  SSH:               ssh mcadmin@$LOCAL_IP"
log "  └─────────────────────────────────────────┘"
log ""
log "  First thing to do:"
log "  → Open World Manager to set up Google Drive backups"
log ""
