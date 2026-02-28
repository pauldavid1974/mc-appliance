/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MC World Manager — Zero-Touch Minecraft Appliance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A web-based world management interface for PaperMC servers running in
 * the itzg/minecraft-server Docker container.
 *
 * Features:
 *   - Server status & player list
 *   - World listing with size info
 *   - Create new worlds (name, seed, gamemode, difficulty, world type)
 *   - Delete, backup, and restore worlds
 *   - RCON console
 *   - Server properties viewer
 *   - Google Drive backup via rclone
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");
const { Rcon } = require("rcon-client");

// ── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  port: 3000,
  rcon: {
    host: process.env.MC_RCON_HOST || "localhost",
    port: parseInt(process.env.MC_RCON_PORT || "25575"),
    password: process.env.MC_RCON_PASSWORD || "appliance-rcon-changeme",
  },
  mcDataPath: process.env.MC_DATA_PATH || "/mc-data",
  rcloneConfigPath:
    process.env.RCLONE_CONFIG_PATH || "/config/rclone/rclone.conf",
  backupDir: process.env.BACKUP_DIR || "/backups",
};

// ── RCON Helper ────────────────────────────────────────────────────────────
async function rconCommand(command) {
  let rcon;
  try {
    rcon = await Rcon.connect({
      host: CONFIG.rcon.host,
      port: CONFIG.rcon.port,
      password: CONFIG.rcon.password,
      timeout: 5000,
    });
    const response = await rcon.send(command);
    await rcon.end();
    return { success: true, response: response.replace(/§[0-9a-fk-or]/g, "") };
  } catch (err) {
    if (rcon) try { await rcon.end(); } catch (_) {}
    return { success: false, response: err.message };
  }
}

// ── Server Status ──────────────────────────────────────────────────────────
async function getServerStatus() {
  const listResult = await rconCommand("list");
  if (!listResult.success) {
    return { online: false, players: [], playerCount: 0, maxPlayers: 0 };
  }

  const match = listResult.response.match(
    /There are (\d+) of a max of (\d+) players online/
  );
  const playerCount = match ? parseInt(match[1]) : 0;
  const maxPlayers = match ? parseInt(match[2]) : 20;

  let players = [];
  if (playerCount > 0) {
    const parts = listResult.response.split(":");
    if (parts[1]) {
      players = parts[1].split(",").map((p) => p.trim()).filter(Boolean);
    }
  }

  return { online: true, players, playerCount, maxPlayers };
}

// ── World Listing ──────────────────────────────────────────────────────────
function getWorlds() {
  const worlds = [];
  const dataPath = CONFIG.mcDataPath;

  let activeWorld = "world";
  const propsPath = path.join(dataPath, "server.properties");
  if (fs.existsSync(propsPath)) {
    const props = fs.readFileSync(propsPath, "utf-8");
    const match = props.match(/^level-name=(.+)$/m);
    if (match) activeWorld = match[1].trim();
  }

  try {
    const entries = fs.readdirSync(dataPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const worldPath = path.join(dataPath, entry.name);
      const levelDat = path.join(worldPath, "level.dat");
      if (!fs.existsSync(levelDat)) continue;

      let sizeBytes = 0;
      try {
        const output = execSync(`du -sb "${worldPath}" 2>/dev/null`).toString();
        sizeBytes = parseInt(output.split("\t")[0]) || 0;
      } catch (_) {}

      const stat = fs.statSync(levelDat);

      worlds.push({
        name: entry.name,
        active: entry.name === activeWorld,
        sizeBytes,
        sizeMB: (sizeBytes / 1048576).toFixed(1),
        lastModified: stat.mtime.toISOString(),
      });
    }
  } catch (err) {
    console.error("Error scanning worlds:", err.message);
  }

  return worlds;
}

// ── Server Properties ──────────────────────────────────────────────────────
function getServerProperties() {
  const propsPath = path.join(CONFIG.mcDataPath, "server.properties");
  if (!fs.existsSync(propsPath)) return {};

  const content = fs.readFileSync(propsPath, "utf-8");
  const props = {};
  for (const line of content.split("\n")) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...valueParts] = line.split("=");
    props[key.trim()] = valueParts.join("=").trim();
  }
  return props;
}

// ── Backup a World ─────────────────────────────────────────────────────────
async function backupWorld(worldName) {
  const worldPath = path.join(CONFIG.mcDataPath, worldName);
  if (!fs.existsSync(worldPath)) {
    return { success: false, error: "World not found" };
  }

  await rconCommand("save-all flush");
  await new Promise((r) => setTimeout(r, 2000));
  await rconCommand("save-off");

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${worldName}_${timestamp}.tar.gz`;
    const backupPath = path.join(CONFIG.backupDir, filename);

    if (!fs.existsSync(CONFIG.backupDir)) {
      fs.mkdirSync(CONFIG.backupDir, { recursive: true });
    }

    execSync(
      `tar -czf "${backupPath}" -C "${CONFIG.mcDataPath}" "${worldName}"`,
      { timeout: 120000 }
    );

    await rconCommand("save-on");

    const stat = fs.statSync(backupPath);
    return {
      success: true,
      filename,
      sizeMB: (stat.size / 1048576).toFixed(1),
      path: backupPath,
    };
  } catch (err) {
    await rconCommand("save-on");
    return { success: false, error: err.message };
  }
}

// ── List Backups ───────────────────────────────────────────────────────────
function listBackups() {
  if (!fs.existsSync(CONFIG.backupDir)) return [];

  return fs
    .readdirSync(CONFIG.backupDir)
    .filter((f) => f.endsWith(".tar.gz"))
    .map((f) => {
      const stat = fs.statSync(path.join(CONFIG.backupDir, f));
      return {
        filename: f,
        sizeMB: (stat.size / 1048576).toFixed(1),
        created: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

// ── Delete a World ─────────────────────────────────────────────────────────
async function deleteWorld(worldName) {
  const worlds = getWorlds();
  const world = worlds.find((w) => w.name === worldName);
  if (!world) return { success: false, error: "World not found" };
  if (world.active)
    return { success: false, error: "Cannot delete the active world" };

  const worldPath = path.join(CONFIG.mcDataPath, worldName);
  try {
    fs.rmSync(worldPath, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Create a World ─────────────────────────────────────────────────────────
async function createWorld(options) {
  const { name, seed, gamemode, difficulty, worldType } = options;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { success: false, error: "Invalid world name. Use letters, numbers, hyphens, underscores only." };
  }

  const worldPath = path.join(CONFIG.mcDataPath, name);
  if (fs.existsSync(worldPath)) {
    return { success: false, error: "A world with that name already exists." };
  }

  const propsPath = path.join(CONFIG.mcDataPath, "server.properties");
  if (fs.existsSync(propsPath)) {
    let content = fs.readFileSync(propsPath, "utf-8");
    content = content.replace(/^level-name=.*/m, `level-name=${name}`);
    if (seed) content = content.replace(/^level-seed=.*/m, `level-seed=${seed}`);
    else content = content.replace(/^level-seed=.*/m, `level-seed=`);
    if (gamemode) content = content.replace(/^gamemode=.*/m, `gamemode=${gamemode}`);
    if (difficulty) content = content.replace(/^difficulty=.*/m, `difficulty=${difficulty}`);
    if (worldType) content = content.replace(/^level-type=.*/m, `level-type=${worldType}`);
    fs.writeFileSync(propsPath, content);
  }

  await rconCommand("stop");

  return {
    success: true,
    message: `World "${name}" configured. The server is restarting to generate it. This may take a minute.`,
  };
}

// ── Google Drive Status ────────────────────────────────────────────────────
function getGDriveStatus() {
  try {
    if (!fs.existsSync(CONFIG.rcloneConfigPath)) {
      return { configured: false, message: "rclone not configured" };
    }
    const config = fs.readFileSync(CONFIG.rcloneConfigPath, "utf-8");
    if (!config.includes("[gdrive]")) {
      return { configured: false, message: "Google Drive remote not set up" };
    }
    return { configured: true, message: "Google Drive connected" };
  } catch (_) {
    return { configured: false, message: "Could not read rclone config" };
  }
}

// ── Push Backup to Google Drive ────────────────────────────────────────────
async function pushToGDrive(filename) {
  const status = getGDriveStatus();
  if (!status.configured) {
    return { success: false, error: "Google Drive not configured" };
  }

  const backupPath = path.join(CONFIG.backupDir, filename);
  if (!fs.existsSync(backupPath)) {
    return { success: false, error: "Backup file not found" };
  }

  return new Promise((resolve) => {
    exec(
      `rclone copy "${backupPath}" gdrive:mc-appliance-backups/ --config "${CONFIG.rcloneConfigPath}"`,
      { timeout: 300000 },
      (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true, message: `Uploaded ${filename} to Google Drive` });
      }
    );
  });
}

// ── API Router ─────────────────────────────────────────────────────────────
async function handleAPI(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const apiPath = url.pathname.replace("/api/", "");

  let body = {};
  if (req.method === "POST") {
    body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (_) { resolve({}); }
      });
    });
  }

  let result;

  switch (apiPath) {
    case "status":
      const status = await getServerStatus();
      const props = getServerProperties();
      const gdrive = getGDriveStatus();
      result = { ...status, serverProperties: props, gdrive };
      break;
    case "worlds":
      result = getWorlds();
      break;
    case "worlds/create":
      result = await createWorld(body);
      break;
    case "worlds/delete":
      result = await deleteWorld(body.name);
      break;
    case "worlds/backup":
      result = await backupWorld(body.name);
      break;
    case "backups":
      result = listBackups();
      break;
    case "backups/upload":
      result = await pushToGDrive(body.filename);
      break;
    case "rcon":
      result = await rconCommand(body.command);
      break;
    case "properties":
      result = getServerProperties();
      break;
    case "gdrive/status":
      result = getGDriveStatus();
      break;
    default:
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

// ── HTML Frontend ──────────────────────────────────────────────────────────
function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MC World Manager</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #1a1a2e;
      --bg-card: #16213e;
      --bg-input: #0f3460;
      --accent-green: #4ecca3;
      --accent-blue: #00b4d8;
      --accent-red: #e74c3c;
      --accent-yellow: #f39c12;
      --text-primary: #e6e6e6;
      --text-muted: #8899aa;
      --border: #2a3a5e;
      --radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      min-height: 100vh;
    }

    .header {
      background: linear-gradient(135deg, #0f3460, #16213e);
      border-bottom: 2px solid var(--accent-green);
      padding: 16px 24px;
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 12px;
    }
    .header h1 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 20px; color: var(--accent-green); letter-spacing: -0.5px;
    }
    .header h1 span { color: var(--text-muted); font-weight: 400; }

    .status-bar {
      display: flex; gap: 16px; font-size: 13px;
      font-family: 'JetBrains Mono', monospace;
    }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block; margin-right: 6px;
    }
    .status-dot.online { background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green); }
    .status-dot.offline { background: var(--accent-red); box-shadow: 0 0 6px var(--accent-red); }

    .container { max-width: 1100px; margin: 0 auto; padding: 24px; }

    .tabs {
      display: flex; gap: 4px; margin-bottom: 24px;
      border-bottom: 2px solid var(--border); padding-bottom: 0;
    }
    .tab {
      padding: 10px 20px; background: transparent; border: none;
      color: var(--text-muted); font-family: 'Outfit', sans-serif;
      font-size: 14px; font-weight: 600; cursor: pointer;
      border-bottom: 2px solid transparent; margin-bottom: -2px;
      transition: all 0.2s;
    }
    .tab:hover { color: var(--text-primary); }
    .tab.active { color: var(--accent-green); border-bottom-color: var(--accent-green); }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 20px; margin-bottom: 16px;
    }
    .card-title {
      font-size: 14px; font-weight: 600; color: var(--accent-green);
      text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;
    }

    .world-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; background: var(--bg-dark);
      border-radius: var(--radius); margin-bottom: 8px;
      flex-wrap: wrap; gap: 8px;
    }
    .world-info { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 200px; }
    .world-name { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 15px; }
    .world-badge {
      font-size: 10px; padding: 2px 8px; border-radius: 4px;
      font-weight: 600; text-transform: uppercase;
    }
    .badge-active { background: var(--accent-green); color: #000; }
    .badge-inactive { background: var(--border); color: var(--text-muted); }
    .world-meta { font-size: 12px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }
    .world-actions { display: flex; gap: 6px; }

    .btn {
      padding: 8px 16px; border: none; border-radius: var(--radius);
      font-family: 'Outfit', sans-serif; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.15s;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn-primary { background: var(--accent-green); color: #000; }
    .btn-danger  { background: var(--accent-red); color: #fff; }
    .btn-blue    { background: var(--accent-blue); color: #000; }
    .btn-small   { padding: 5px 10px; font-size: 12px; }

    .form-group { margin-bottom: 14px; }
    .form-group label {
      display: block; font-size: 12px; font-weight: 600;
      color: var(--text-muted); text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 6px;
    }
    .form-group input, .form-group select {
      width: 100%; padding: 10px 14px; background: var(--bg-input);
      border: 1px solid var(--border); border-radius: var(--radius);
      color: var(--text-primary); font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
    }
    .form-group input:focus, .form-group select:focus {
      outline: none; border-color: var(--accent-green);
    }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

    .console {
      background: #000; border-radius: var(--radius); padding: 16px;
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
      max-height: 300px; overflow-y: auto;
    }
    .console-line { margin-bottom: 4px; }
    .console-line .cmd { color: var(--accent-green); }
    .console-line .resp { color: var(--text-muted); }
    .console-input-row { display: flex; gap: 8px; margin-top: 12px; }
    .console-input-row input {
      flex: 1; padding: 10px 14px; background: #111;
      border: 1px solid var(--border); border-radius: var(--radius);
      color: var(--accent-green); font-family: 'JetBrains Mono', monospace; font-size: 13px;
    }
    .console-input-row input:focus { outline: none; border-color: var(--accent-green); }

    .props-table {
      width: 100%; border-collapse: collapse;
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
    }
    .props-table tr { border-bottom: 1px solid var(--border); }
    .props-table td { padding: 8px 12px; }
    .props-table td:first-child { color: var(--accent-blue); width: 280px; }

    .backup-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px; background: var(--bg-dark);
      border-radius: var(--radius); margin-bottom: 6px;
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
      flex-wrap: wrap; gap: 8px;
    }

    .gdrive-status { padding: 16px; border-radius: var(--radius); text-align: center; }
    .gdrive-connected { background: rgba(78, 204, 163, 0.1); border: 1px solid var(--accent-green); }
    .gdrive-disconnected { background: rgba(243, 156, 18, 0.1); border: 1px solid var(--accent-yellow); }
    .gdrive-instructions {
      background: var(--bg-dark); border-radius: var(--radius);
      padding: 20px; margin-top: 16px; font-size: 14px; line-height: 1.8;
    }
    .gdrive-instructions code {
      background: var(--bg-input); padding: 2px 8px; border-radius: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
    }

    .toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999; }
    .toast {
      padding: 12px 20px; border-radius: var(--radius); margin-bottom: 8px;
      font-size: 13px; font-weight: 600; animation: slideIn 0.3s ease;
    }
    .toast-success { background: var(--accent-green); color: #000; }
    .toast-error   { background: var(--accent-red); color: #fff; }
    .toast-info    { background: var(--accent-blue); color: #000; }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0); opacity: 1; }
    }

    @media (max-width: 640px) {
      .form-row { grid-template-columns: 1fr; }
      .header { padding: 12px 16px; }
      .container { padding: 16px; }
      .tabs { overflow-x: auto; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>\\u26CF MC World Manager <span>// Appliance</span></h1>
    <div class="status-bar">
      <span><span class="status-dot" id="statusDot"></span><span id="statusText">Checking...</span></span>
      <span id="playerCount"></span>
    </div>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('worlds')">Worlds</button>
      <button class="tab" onclick="switchTab('create')">Create World</button>
      <button class="tab" onclick="switchTab('backups')">Backups</button>
      <button class="tab" onclick="switchTab('console')">Console</button>
      <button class="tab" onclick="switchTab('properties')">Properties</button>
      <button class="tab" onclick="switchTab('gdrive')">Google Drive</button>
    </div>

    <div class="tab-content active" id="tab-worlds">
      <div class="card">
        <div class="card-title">Worlds</div>
        <div id="worldList">Loading...</div>
      </div>
    </div>

    <div class="tab-content" id="tab-create">
      <div class="card">
        <div class="card-title">Create New World</div>
        <div class="form-group">
          <label>World Name</label>
          <input type="text" id="newWorldName" placeholder="my-world">
        </div>
        <div class="form-group">
          <label>Seed (leave blank for random)</label>
          <input type="text" id="newWorldSeed" placeholder="Optional seed value">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Gamemode</label>
            <select id="newWorldGamemode">
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
              <option value="adventure">Adventure</option>
              <option value="spectator">Spectator</option>
            </select>
          </div>
          <div class="form-group">
            <label>Difficulty</label>
            <select id="newWorldDifficulty">
              <option value="easy">Easy</option>
              <option value="normal" selected>Normal</option>
              <option value="hard">Hard</option>
              <option value="peaceful">Peaceful</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>World Type</label>
          <select id="newWorldType">
            <option value="minecraft\\\\:normal">Normal</option>
            <option value="minecraft\\\\:flat">Flat / Superflat</option>
            <option value="minecraft\\\\:large_biomes">Large Biomes</option>
            <option value="minecraft\\\\:amplified">Amplified</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="createWorld()">Create World & Restart Server</button>
      </div>
    </div>

    <div class="tab-content" id="tab-backups">
      <div class="card">
        <div class="card-title">Local Backups</div>
        <div id="backupList">Loading...</div>
      </div>
    </div>

    <div class="tab-content" id="tab-console">
      <div class="card">
        <div class="card-title">RCON Console</div>
        <div class="console" id="consoleOutput">
          <div class="console-line"><span class="resp">Type a command below. e.g. "list", "time set day", "gamerule keepInventory true"</span></div>
        </div>
        <div class="console-input-row">
          <input type="text" id="consoleInput" placeholder="Enter RCON command..." onkeydown="if(event.key==='Enter')sendCommand()">
          <button class="btn btn-primary" onclick="sendCommand()">Send</button>
        </div>
      </div>
    </div>

    <div class="tab-content" id="tab-properties">
      <div class="card">
        <div class="card-title">Server Properties (read-only)</div>
        <table class="props-table" id="propsTable">
          <tr><td colspan="2">Loading...</td></tr>
        </table>
      </div>
    </div>

    <div class="tab-content" id="tab-gdrive">
      <div class="card">
        <div class="card-title">Google Drive Backup</div>
        <div id="gdriveStatus">Checking...</div>
        <div class="gdrive-instructions">
          <strong>Setup Instructions:</strong><br><br>
          To link your Google Drive for cloud backups, SSH into the appliance and run:<br><br>
          <code>rclone config</code><br><br>
          Follow the prompts to create a remote named <code>gdrive</code> with type <code>drive</code>.<br>
          Since this is a headless server, choose <strong>"No"</strong> when asked about auto config,
          then complete the OAuth flow on your local machine and paste the token back.<br><br>
          Once configured, backups uploaded from the Backups tab will sync to your
          <code>mc-appliance-backups</code> folder on Google Drive.
        </div>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toasts"></div>

  <script>
    async function api(path, body) {
      const opts = body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {};
      const res = await fetch("/api/" + path, opts);
      return res.json();
    }

    function toast(message, type = "info") {
      const container = document.getElementById("toasts");
      const el = document.createElement("div");
      el.className = "toast toast-" + type;
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }

    function switchTab(name) {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
      event.target.classList.add("active");
      document.getElementById("tab-" + name).classList.add("active");
      if (name === "worlds") loadWorlds();
      if (name === "backups") loadBackups();
      if (name === "properties") loadProperties();
      if (name === "gdrive") loadGDriveStatus();
    }

    async function refreshStatus() {
      try {
        const data = await api("status");
        const dot = document.getElementById("statusDot");
        const text = document.getElementById("statusText");
        const count = document.getElementById("playerCount");
        if (data.online) {
          dot.className = "status-dot online";
          text.textContent = "Online";
          count.textContent = data.playerCount + "/" + data.maxPlayers + " players";
        } else {
          dot.className = "status-dot offline";
          text.textContent = "Offline";
          count.textContent = "";
        }
      } catch (_) {
        document.getElementById("statusDot").className = "status-dot offline";
        document.getElementById("statusText").textContent = "Unreachable";
      }
    }

    async function loadWorlds() {
      const worlds = await api("worlds");
      const el = document.getElementById("worldList");
      if (!worlds.length) {
        el.innerHTML = '<div style="color:var(--text-muted);padding:12px;">No worlds found. The server may still be starting.</div>';
        return;
      }
      el.innerHTML = worlds.map(w => \`
        <div class="world-item">
          <div class="world-info">
            <span class="world-name">\${w.name}</span>
            <span class="world-badge \${w.active ? 'badge-active' : 'badge-inactive'}">\${w.active ? 'ACTIVE' : 'INACTIVE'}</span>
          </div>
          <div class="world-meta">\${w.sizeMB} MB</div>
          <div class="world-actions">
            <button class="btn btn-blue btn-small" onclick="backupWorld('\${w.name}')">Backup</button>
            \${!w.active ? \`<button class="btn btn-danger btn-small" onclick="deleteWorld('\${w.name}')">Delete</button>\` : ''}
          </div>
        </div>
      \`).join("");
    }

    async function backupWorld(name) {
      toast("Backing up " + name + "...", "info");
      const result = await api("worlds/backup", { name });
      if (result.success) toast("Backup created: " + result.filename + " (" + result.sizeMB + " MB)", "success");
      else toast("Backup failed: " + result.error, "error");
    }

    async function deleteWorld(name) {
      if (!confirm("Delete world '" + name + "'? This cannot be undone!")) return;
      const result = await api("worlds/delete", { name });
      if (result.success) { toast("World deleted: " + name, "success"); loadWorlds(); }
      else toast("Delete failed: " + result.error, "error");
    }

    async function createWorld() {
      const name = document.getElementById("newWorldName").value.trim();
      if (!name) { toast("Please enter a world name", "error"); return; }
      const result = await api("worlds/create", {
        name,
        seed: document.getElementById("newWorldSeed").value.trim(),
        gamemode: document.getElementById("newWorldGamemode").value,
        difficulty: document.getElementById("newWorldDifficulty").value,
        worldType: document.getElementById("newWorldType").value,
      });
      if (result.success) {
        toast(result.message, "success");
        document.getElementById("newWorldName").value = "";
        document.getElementById("newWorldSeed").value = "";
      } else toast("Failed: " + result.error, "error");
    }

    async function loadBackups() {
      const backups = await api("backups");
      const el = document.getElementById("backupList");
      if (!backups.length) {
        el.innerHTML = '<div style="color:var(--text-muted);padding:12px;">No backups yet. Go to Worlds tab and click Backup.</div>';
        return;
      }
      el.innerHTML = backups.map(b => \`
        <div class="backup-item">
          <span>\${b.filename}</span>
          <span>\${b.sizeMB} MB</span>
          <span style="color:var(--text-muted)">\${new Date(b.created).toLocaleString()}</span>
          <button class="btn btn-blue btn-small" onclick="uploadBackup('\${b.filename}')">Upload to GDrive</button>
        </div>
      \`).join("");
    }

    async function uploadBackup(filename) {
      toast("Uploading to Google Drive...", "info");
      const result = await api("backups/upload", { filename });
      if (result.success) toast(result.message, "success");
      else toast("Upload failed: " + result.error, "error");
    }

    async function sendCommand() {
      const input = document.getElementById("consoleInput");
      const cmd = input.value.trim();
      if (!cmd) return;
      const output = document.getElementById("consoleOutput");
      output.innerHTML += '<div class="console-line"><span class="cmd">> ' + cmd + '</span></div>';
      input.value = "";
      const result = await api("rcon", { command: cmd });
      output.innerHTML += '<div class="console-line"><span class="resp">' + (result.response || "(no response)") + '</span></div>';
      output.scrollTop = output.scrollHeight;
    }

    async function loadProperties() {
      const props = await api("properties");
      const el = document.getElementById("propsTable");
      el.innerHTML = Object.entries(props)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => \`<tr><td>\${k}</td><td>\${v}</td></tr>\`)
        .join("");
    }

    async function loadGDriveStatus() {
      const status = await api("gdrive/status");
      const el = document.getElementById("gdriveStatus");
      if (status.configured) {
        el.innerHTML = '<div class="gdrive-status gdrive-connected">\\u2705 ' + status.message + '</div>';
      } else {
        el.innerHTML = '<div class="gdrive-status gdrive-disconnected">\\u26A0\\uFE0F ' + status.message + '</div>';
      }
    }

    refreshStatus();
    loadWorlds();
    setInterval(refreshStatus, 15000);
  </script>
</body>
</html>`;
}

// ── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) return handleAPI(req, res);
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(getHTML());
});

server.listen(CONFIG.port, () => {
  console.log(`
  ═══════════════════════════════════════════════════════
  ⛏  MC World Manager running on port ${CONFIG.port}
  ═══════════════════════════════════════════════════════
     RCON:    ${CONFIG.rcon.host}:${CONFIG.rcon.port}
     MC Data: ${CONFIG.mcDataPath}
     Backups: ${CONFIG.backupDir}
  ═══════════════════════════════════════════════════════
  `);
});
