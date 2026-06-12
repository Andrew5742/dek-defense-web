require('dotenv').config();

const path = require('path');
const { app, BrowserWindow, ipcMain, shell, powerSaveBlocker } = require('electron');
const { spawn } = require('child_process');
const Store = require('electron-store');
const { createFirebaseClient } = require('./lib/firebaseClient');
const { startUploadServer } = require('./lib/uploadServer');
const { FirestoreAgent } = require('./lib/firestoreAgent');
const { getLocalIPv4Addresses, getPreferredLocalAddress } = require('./lib/network');
const { getStorageRoot } = require('./lib/paths');

const store = new Store();
let mainWindow;
let presentationWindow;
let displayWindow;
let firebase;
let agent;
let uploadServer;
let powerBlockerId = null;

const STATION_ID = process.env.STATION_ID || store.get('stationId') || `station-${Date.now()}`;
const STATION_NAME = process.env.STATION_NAME || 'ПК захисту';
const UPLOAD_PORT = Number(process.env.UPLOAD_PORT || 3050);
const ZOOM_URL = process.env.ZOOM_URL || '';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://andrew5742.github.io/dek-defense-web/';

store.set('stationId', STATION_ID);

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'DEK Defense Station',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function openDisplayFullscreen(command = {}) {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.show();
    displayWindow.setAlwaysOnTop(true, 'screen-saver');
    displayWindow.setFullScreen(true);
    displayWindow.moveTop();
    displayWindow.focus();
    return;
  }

  displayWindow = new BrowserWindow({
    fullscreen: true,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#111827',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  displayWindow.setAlwaysOnTop(true, 'screen-saver');
  displayWindow.once('ready-to-show', () => {
    displayWindow.setFullScreen(true);
    displayWindow.moveTop();
    displayWindow.focus();
  });

  const url = new URL(WEB_APP_URL);
  url.searchParams.set('role', 'display');
  url.searchParams.set('kiosk', '1');
  url.searchParams.set('station', STATION_ID);
  if (command.sessionId) url.searchParams.set('session', command.sessionId);
  displayWindow.loadURL(url.toString()).catch(() => {
    displayWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'), {
      query: {
        sessionId: command.sessionId || '',
        stationId: STATION_ID
      }
    });
  });
}

function closeDisplayFullscreen() {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.close();
  }
}

function closePowerPointSlideShows() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$powerPoint = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
if ($powerPoint -ne $null) {
  foreach ($show in @($powerPoint.SlideShowWindows)) {
    try { $show.View.Exit() | Out-Null } catch {}
  }
}
`;
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], { windowsHide: true });
    child.on('close', () => resolve(true));
    child.on('error', () => resolve(false));
  });
}

async function closePresentationFullscreen() {
  if (presentationWindow && !presentationWindow.isDestroyed()) presentationWindow.close();
  await closePowerPointSlideShows();
}

function openPdfFullscreen(pdfPath, command = {}) {
  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.close();
  }

  presentationWindow = new BrowserWindow({
    fullscreen: true,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  presentationWindow.setAlwaysOnTop(true, 'screen-saver');
  presentationWindow.once('ready-to-show', () => {
    presentationWindow.setFullScreen(true);
    presentationWindow.moveTop();
    presentationWindow.focus();
  });

  presentationWindow.loadFile(path.join(__dirname, 'renderer', 'pdf-viewer.html'), {
    query: {
      file: encodeURIComponent(pdfPath),
      studentId: command.studentId || '',
      sessionId: command.sessionId || ''
    }
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function openPowerPointFullscreen(filePath) {
  return new Promise((resolve, reject) => {
    const script = `
$ErrorActionPreference = 'Stop'
$filePath = ${psQuote(filePath)}
$powerPoint = New-Object -ComObject PowerPoint.Application
$powerPoint.Visible = -1
$presentation = $powerPoint.Presentations.Open($filePath, -1, 0, -1)
try { $presentation.SlideShowSettings.ShowPresenterView = 0 } catch {}
$presentation.SlideShowSettings.ShowType = 1
$presentation.SlideShowSettings.Run() | Out-Null
`;
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], { windowsHide: true });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', async (code) => {
      if (code === 0) {
        resolve(true);
        return;
      }
      const fallback = await shell.openPath(filePath);
      if (fallback) reject(new Error(stderr || fallback));
      else resolve(false);
    });
  });
}

async function openPresentationFullscreen(prepared, command = {}) {
  closeDisplayFullscreen();
  if (prepared.kind === 'pdf') {
    openPdfFullscreen(prepared.path, command);
    return;
  }
  await openPowerPointFullscreen(prepared.path);
}

async function startAgent() {
  if (!firebase) firebase = await createFirebaseClient();

  uploadServer = startUploadServer({
    port: UPLOAD_PORT,
    onUploaded: async (payload) => agent?.onUploaded(payload)
  });

  agent = new FirestoreAgent({
    firebase,
    stationId: STATION_ID,
    stationName: STATION_NAME,
    uploadUrl: uploadServer.localUrl,
    lanUploadUrl: uploadServer.lanUrl,
    zoomUrl: ZOOM_URL,
    sendToRenderer,
    openPdfFullscreen,
    openPresentationFullscreen,
    openDisplayFullscreen,
    closeDisplayFullscreen,
    closePresentationFullscreen
  });

  await agent.start();

  if (!powerBlockerId) {
    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  }

  sendToRenderer('agent-ready', {
    stationId: STATION_ID,
    stationName: STATION_NAME,
    uploadUrl: uploadServer.localUrl,
    lanUploadUrl: uploadServer.lanUrl,
    storageRoot: getStorageRoot(),
    addresses: getLocalIPv4Addresses()
  });
}

app.whenReady().then(async () => {
  await createMainWindow();
  try {
    await startAgent();
  } catch (error) {
    sendToRenderer('agent-error', { error: error.message });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  agent?.stop();
  uploadServer?.close();
  if (powerBlockerId) powerSaveBlocker.stop(powerBlockerId);
});

ipcMain.handle('agent:get-status', async () => ({
  stationId: STATION_ID,
  stationName: STATION_NAME,
  uploadUrl: uploadServer?.localUrl || `http://${getPreferredLocalAddress()}:${UPLOAD_PORT}`,
  lanUploadUrl: uploadServer?.lanUrl || `http://${getPreferredLocalAddress()}:${UPLOAD_PORT}`,
  storageRoot: getStorageRoot(),
  addresses: getLocalIPv4Addresses()
}));

ipcMain.handle('agent:open-storage', async () => {
  await shell.openPath(getStorageRoot());
});

ipcMain.handle('agent:open-zoom', async (_, zoomUrl) => {
  await shell.openExternal(zoomUrl || ZOOM_URL || 'zoommtg://zoom.us/join');
});

ipcMain.handle('agent:close-presentation', async (_, password) => {
  if (password !== '0987Kiis') throw new Error('Неправильний пароль');
  await closePresentationFullscreen();
  if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close();
  return true;
});
