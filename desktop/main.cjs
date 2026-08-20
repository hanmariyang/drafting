// Drafting Desktop — Electron shell over the Drafting server.
// The api server (api/dist) runs embedded via ELECTRON_RUN_AS_NODE on a loopback
// port; documents live in ~/.drafting/ (sqlite + master.key), independent of any
// docker/self-hosted instance the user may also run.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const EMBED_PORT = Number(process.env.DRAFTING_PORT || 8873);
const DATA_DIR = path.join(os.homedir(), '.drafting');
let win = null;

function serverRoot() {
  // packaged: resources/daemon ; dev: repo root (this file lives in <root>/desktop)
  return app.isPackaged ? path.join(process.resourcesPath, 'daemon') : path.join(__dirname, '..');
}

// 서버는 Electron 메인 프로세스 안에서 직접 구동한다 (in-process import).
// ELECTRON_RUN_AS_NODE 자식 스폰은 최신 Electron의 부모 서명 검증(fuse)에
// 막힐 수 있어 쓰지 않는다 — 같은 Node 24 런타임이라 node:sqlite 도 그대로.
async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  process.env.DATABASE_PATH = path.join(DATA_DIR, 'drafting.sqlite');
  const entry = pathToFileURL(path.join(serverRoot(), 'api', 'dist', 'index.js')).href;
  const mod = await import(entry);
  const server = await mod.buildServer();
  await server.listen({ port: EMBED_PORT, host: '127.0.0.1' });
}

function waitHealth(tries = 60) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      const req = http.get({ host: '127.0.0.1', port: EMBED_PORT, path: '/api/meta', timeout: 900 }, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry(n);
      });
      req.on('error', () => retry(n));
      req.on('timeout', () => { req.destroy(); retry(n); });
    };
    const retry = (n) => (n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => tick(n - 1), 500));
    tick(tries);
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920,
    minWidth: 900, minHeight: 600,
    backgroundColor: '#F7F7F5',
    title: 'Drafting',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('Drafting'); });
  try {
    await waitHealth();
    await win.loadURL('http://127.0.0.1:' + EMBED_PORT + '/');
  } catch (e) {
    await win.loadURL('data:text/html,<body style="background:%23F7F7F5;color:%23AA3333;font-family:monospace;padding:40px">Drafting server failed to start: ' + String(e.message) + '</body>');
  }
}

let updater = null;
let manualCheck = false;
let updateDownloaded = null;

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    updater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => {
      if (manualCheck) { manualCheck = false; dialog.showMessageBox({ type: 'warning', message: 'Update check failed', detail: String((e && e.message) || e) }); }
    });
    autoUpdater.on('update-not-available', () => {
      if (manualCheck) { manualCheck = false; dialog.showMessageBox({ type: 'info', message: 'You are up to date', detail: 'Drafting ' + app.getVersion() + ' is the latest version.' }); }
    });
    autoUpdater.on('update-downloaded', async (info) => {
      updateDownloaded = info.version;
      if (!manualCheck) return;
      manualCheck = false;
      const { response } = await dialog.showMessageBox({
        type: 'info', message: 'Drafting ' + info.version + ' is ready',
        detail: 'Restart now to apply the update, or it installs automatically when you quit.',
        buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.checkForUpdates().catch(() => { /* ignore */ });
    setInterval(() => autoUpdater.checkForUpdates().catch(() => { /* ignore */ }), 6 * 60 * 60 * 1000);
  } catch { /* updater not bundled — skip */ }
}

function checkForUpdatesManually() {
  if (!app.isPackaged || !updater) {
    dialog.showMessageBox({ type: 'info', message: 'Dev build', detail: 'Auto-update runs only in packaged builds.' });
    return;
  }
  if (updateDownloaded) {
    dialog.showMessageBox({
      type: 'info', message: 'Drafting ' + updateDownloaded + ' is ready',
      detail: 'Restart now to apply the update.',
      buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
    }).then(({ response }) => { if (response === 0) updater.quitAndInstall(); });
    return;
  }
  manualCheck = true;
  updater.checkForUpdates().catch(() => { /* error handler shows dialog */ });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: checkForUpdatesManually },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    ...(!isMac ? [{
      label: 'Help',
      submenu: [{ label: 'Check for Updates…', click: checkForUpdatesManually }],
    }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  buildMenu();
  try {
    await startServer();
  } catch (e) {
    try { fs.appendFileSync(path.join(DATA_DIR, 'server.log'), String((e && e.stack) || e) + '\n'); } catch { /* ignore */ }
    win = new BrowserWindow({ width: 900, height: 600, backgroundColor: '#F7F7F5', title: 'Drafting' });
    win.loadURL('data:text/html,<body style="background:%23F7F7F5;color:%23AA3333;font-family:monospace;padding:40px">Drafting server failed to start: ' + encodeURIComponent(String((e && e.message) || e)) + '<br><br>See ~/.drafting/server.log</body>');
    return;
  }
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
