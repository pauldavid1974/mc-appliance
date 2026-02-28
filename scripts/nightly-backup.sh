#!/usr/bin/env bash
###############################################################################
# Nightly Backup Script
#
# Runs via cron. Backs up the active world, optionally uploads to Google Drive.
#
# Install in crontab:
#   0 3 * * * /home/mcadmin/mc-appliance/scripts/nightly-backup.sh
###############################################################################
set -euo pipefail

MC_DATA="/home/mcadmin/minecraft-data"
BACKUP_DIR="/home/mcadmin/backups"
RCLONE_REMOTE="gdrive:mc-appliance-backups"
RCLONE_CONFIG="/home/mcadmin/.config/rclone/rclone.conf"
KEEP_LOCAL=7
LOG="/var/log/mc-backup.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG"; }

rcon_cmd() {
  docker exec mc-server rcon-cli "$1" 2>/dev/null || true
}

ACTIVE_WORLD=$(grep "^level-name=" "$MC_DATA/server.properties" | cut -d= -f2)
if [ -z "$ACTIVE_WORLD" ]; then
  log "ERROR: Could not determine active world name."
  exit 1
fi

WORLD_PATH="$MC_DATA/$ACTIVE_WORLD"
if [ ! -d "$WORLD_PATH" ]; then
  log "ERROR: World directory not found: $WORLD_PATH"
  exit 1
fi

log "Starting backup of world: $ACTIVE_WORLD"

log "Saving world data..."
rcon_cmd "save-all flush"
sleep 3
rcon_cmd "save-off"

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')
FILENAME="${ACTIVE_WORLD}_${TIMESTAMP}.tar.gz"
BACKUP_PATH="$BACKUP_DIR/$FILENAME"

log "Creating archive: $FILENAME"
tar -czf "$BACKUP_PATH" -C "$MC_DATA" "$ACTIVE_WORLD"

rcon_cmd "save-on"
log "Server saves resumed."

SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
log "Backup complete: $FILENAME ($SIZE)"

if [ -f "$RCLONE_CONFIG" ] && rclone listremotes --config "$RCLONE_CONFIG" | grep -q "^gdrive:"; then
  log "Uploading to Google Drive..."
  rclone copy "$BACKUP_PATH" "$RCLONE_REMOTE" --config "$RCLONE_CONFIG"
  log "Upload complete."
else
  log "Google Drive not configured. Skipping cloud upload."
fi

LOCAL_COUNT=$(ls -1 "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l)
if [ "$LOCAL_COUNT" -gt "$KEEP_LOCAL" ]; then
  REMOVE_COUNT=$((LOCAL_COUNT - KEEP_LOCAL))
  log "Cleaning up $REMOVE_COUNT old backup(s)..."
  ls -1t "$BACKUP_DIR"/*.tar.gz | tail -n "$REMOVE_COUNT" | xargs rm -f
fi

log "Nightly backup finished."
