// Drafting Desktop — Electron shell over the Drafting server.
// The api server (api/dist) runs embedded via ELECTRON_RUN_AS_NODE on a loopback
// port; documents live in ~/.drafting/ (sqlite + master.key), independent of any
// docker/self-hosted instance the user may also run.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');

const EMBED_PORT = Number(process.env.DRAFTING_PORT || 8873);
const DATA_DIR = path.join(os.homedir(), '.drafting');
let server = null;
let win = null;

function serverRoot() {
  // packaged: resources/daemon ; dev: repo root (this file lives in <root>/desktop)
  return app.isPackaged ? path.join(process.resourcesPath, 'daemon') : path.join(__dirname, '..');
}

function startServer() {
  const root = serverRoot();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  server = spawn(process.execPath, [path.join(root, 'api', 'dist', 'index.js')], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: '127.0.0.1',
      PORT: String(EMBED_PORT),
      DATABASE_PATH: path.join(DATA_DIR, 'drafting.sqlite'),
    },
    stdio: 'ignore',
  });
  server.on('exit', (code) => {
    server = null;
    if (win && !win.isDestroyed()) {
      win.loadURL('data:text/html,<body style="background:%23F7F7F5;color:%23AA3333;font-family:monospace;padding:40px">Drafting server exited (code ' + code + '). Restart the app.</body>');
    }
  });
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

app.whenReady().then(() => {
  buildMenu();
  startServer();
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (server) { try { server.kill(); } catch { /* gone */ } } });
