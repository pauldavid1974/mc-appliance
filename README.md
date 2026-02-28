# ⛏ Zero-Touch Minecraft Appliance

Turn any spare PC into a fully managed Minecraft Java (PaperMC) server — just plug in a USB drive and walk away.

## What Is This?

A complete, open-source system that transforms a bare PC into a Minecraft server appliance with:

- **Zero-Touch Install** — Boot from USB, walk away, come back to a running server
- **PaperMC** — Latest Paper server via Docker, auto-updated
- **Web-Based World Manager** — Create, delete, backup worlds from your browser
- **CasaOS Dashboard** — Beautiful web UI for managing the underlying system
- **Google Drive Backups** — One-time setup, then automatic cloud backups
- **Fully Dockerized** — Clean, portable, easy to maintain

## Quick Start

### Option A: Full Zero-Touch (USB Install)

1. Download the [Ubuntu Server 24.04 LTS ISO](https://ubuntu.com/download/server)
2. Flash it to a USB drive using [balenaEtcher](https://etcher.balena.io/) or [Rufus](https://rufus.ie/)
3. Copy the `user-data` file from this repo to the USB drive root
4. Plug the USB + Ethernet into the target PC
5. Boot from USB and walk away
6. Come back in ~15 minutes to a fully running server

### Option B: Install on Existing Ubuntu Server

```bash
curl -fsSL https://raw.githubusercontent.com/pauldavid1974/mc-appliance/main/install.sh | sudo bash
```

## What Gets Installed

| Component | Purpose | Access |
|-----------|---------|--------|
| Ubuntu Server 24.04 | Operating system | SSH on port 22 |
| Docker + Compose | Container runtime | — |
| CasaOS | System dashboard | `http://<ip>:80` |
| PaperMC (itzg/minecraft-server) | Game server | Port 25565 |
| World Manager | Web control panel | `http://<ip>:3000` |
| rclone | Google Drive sync | CLI / World Manager |

## World Manager Features

Access at `http://<your-server-ip>:3000`

- **Dashboard** — Server status, player count, online indicator
- **Worlds** — List all worlds with size, active status
- **Create World** — Name, seed, gamemode, difficulty, world type
- **Backups** — One-click local backup, upload to Google Drive
- **RCON Console** — Send commands directly from the browser
- **Server Properties** — View current server configuration
- **Google Drive** — Setup info for cloud backup integration

## Google Drive Setup

After installation:

1. SSH into your server: `ssh mcadmin@<your-server-ip>`
2. Run `rclone config`
3. Create a new remote named `gdrive` with type `drive`
4. Follow the OAuth flow (headless-friendly)
5. Done! Use the World Manager to push backups to Drive

## Project Structure

```
mc-appliance/
├── docker-compose.yml        # Minecraft server + World Manager
├── install.sh                # Master install script
├── user-data                 # Cloud-init autoinstall config
├── world-manager/
│   ├── Dockerfile            # World Manager container build
│   ├── package.json          # Node.js dependencies
│   └── server.js             # World Manager app (single file)
├── scripts/
│   └── nightly-backup.sh     # Automated backup cron script
├── docs/                     # Additional documentation
└── README.md
```

## Hardware Requirements

- Any x86_64 PC (Intel/AMD)
- 4GB RAM minimum (8GB recommended)
- 20GB+ storage
- Ethernet connection
- USB drive for installation (Option A only)

## Configuration

Edit `docker-compose.yml` to customize:

- `MEMORY` — JVM heap size (default: 2G)
- `MAX_PLAYERS` — Player limit (default: 20)
- `DIFFICULTY` — easy/normal/hard/peaceful
- `MODE` — survival/creative/adventure/spectator
- `RCON_PASSWORD` — Change this for security!
- `VERSION` — Pin to a specific Minecraft version

## License

MIT
