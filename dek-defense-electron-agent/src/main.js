const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const fs = require('fs');
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

  const url = new URL(WEB_APP_URL);
  url.searchParams.set('desktop', 'defense');
  url.searchParams.set('role', 'student');
  url.searchParams.set('station', STATION_ID);

  await mainWindow.loadURL(url.toString()).catch(async () => {
    await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  });
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
  url.searchParams.set('desktop', 'defense');
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
  Start-Sleep -Milliseconds 250
  foreach ($presentation in @($powerPoint.Presentations)) {
    try { $presentation.Saved = -1 } catch {}
    try { $presentation.Close() | Out-Null } catch {}
  }
  try { $powerPoint.Quit() | Out-Null } catch {}
}
Start-Sleep -Milliseconds 250
$remaining = Get-Process -Name POWERPNT -ErrorAction SilentlyContinue
foreach ($process in @($remaining)) {
  try {
    if ($process.MainWindowTitle -eq '' -or $process.MainWindowTitle -match 'PowerPoint|Slide Show|Показ|Презентац') {
      Stop-Process -Id $process.Id -Force
    }
  } catch {}
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

function getPowerPointCandidates() {
  if (process.platform !== 'win32') return ['powerpnt'];
  return [
    process.env.POWERPOINT_PATH,
    'powerpnt.exe',
    'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
    'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
    'C:\\Program Files\\Microsoft Office\\Office16\\POWERPNT.EXE',
    'C:\\Program Files (x86)\\Microsoft Office\\Office16\\POWERPNT.EXE',
    'C:\\Program Files\\Microsoft Office\\Office15\\POWERPNT.EXE',
    'C:\\Program Files (x86)\\Microsoft Office\\Office15\\POWERPNT.EXE'
  ].filter(Boolean);
}

function commandExists(command) {
  if (command.includes('/') || command.includes('\\')) return fs.existsSync(command);
  return true;
}

function openPowerPointProcessFallback(filePath) {
  return new Promise((resolve, reject) => {
    const candidates = getPowerPointCandidates().filter(commandExists);
    let lastError = null;

    function tryNext(index) {
      const command = candidates[index];
      if (!command) {
        reject(lastError || new Error('PowerPoint executable not found'));
        return;
      }

      const child = spawn(command, ['/S', filePath], {
        windowsHide: false,
        detached: true,
        stdio: 'ignore'
      });
      child.on('error', (error) => {
        lastError = error;
        tryNext(index + 1);
      });
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    }

    tryNext(0);
  });
}

function focusPowerPointSlideShow() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
Add-Type -AssemblyName System.Windows.Forms
$SW_SHOWMAXIMIZED = 3
$HWND_TOPMOST = [IntPtr]::new(-1)
$SWP_SHOWWINDOW = 0x0040
function Focus-Hwnd($hwnd) {
  if ($hwnd -eq $null -or [int64]$hwnd -eq 0) { return }
  $ptr = [IntPtr]::new([int64]$hwnd)
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  [Win32Focus]::ShowWindowAsync($ptr, $SW_SHOWMAXIMIZED) | Out-Null
  [Win32Focus]::SetWindowPos($ptr, $HWND_TOPMOST, $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, $SWP_SHOWWINDOW) | Out-Null
  Start-Sleep -Milliseconds 120
  [Win32Focus]::SetForegroundWindow($ptr) | Out-Null
}
$powerPoint = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
if ($powerPoint -ne $null) {
  foreach ($show in @($powerPoint.SlideShowWindows)) {
    try {
      Focus-Hwnd $show.HWND
    } catch {}
  }
  foreach ($show in @($powerPoint.SlideShowWindows)) {
    try { Focus-Hwnd $show.HWND } catch {}
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

function openPowerPointFullscreen(filePath) {
  return new Promise((resolve, reject) => {
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
Add-Type -AssemblyName System.Windows.Forms
$SW_SHOWMAXIMIZED = 3
$HWND_TOPMOST = [IntPtr]::new(-1)
$SWP_SHOWWINDOW = 0x0040
function Focus-Hwnd($hwnd) {
  if ($hwnd -eq $null -or [int64]$hwnd -eq 0) { return }
  $ptr = [IntPtr]::new([int64]$hwnd)
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  [Win32Focus]::ShowWindowAsync($ptr, $SW_SHOWMAXIMIZED) | Out-Null
  [Win32Focus]::SetWindowPos($ptr, $HWND_TOPMOST, $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, $SWP_SHOWWINDOW) | Out-Null
  Start-Sleep -Milliseconds 120
  [Win32Focus]::SetForegroundWindow($ptr) | Out-Null
}
$filePath = ${psQuote(filePath)}
$powerPoint = New-Object -ComObject PowerPoint.Application
$powerPoint.Visible = -1
$presentation = $powerPoint.Presentations.Open($filePath, -1, 0, 0)
try { $presentation.SlideShowSettings.ShowPresenterView = 0 } catch {}
$presentation.SlideShowSettings.ShowType = 1
$presentation.SlideShowSettings.Run() | Out-Null
$slideShow = $null
for ($i = 0; $i -lt 30; $i++) {
  try {
    if ($presentation.SlideShowWindow -ne $null) {
      $slideShow = $presentation.SlideShowWindow
      break
    }
  } catch {}
  Start-Sleep -Milliseconds 100
}
if ($slideShow -ne $null) {
  try {
    Focus-Hwnd $slideShow.HWND
    Start-Sleep -Milliseconds 120
    Focus-Hwnd $slideShow.HWND
  } catch {}
}
try { $powerPoint.WindowState = 2 } catch {}
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
      try {
        await openPowerPointProcessFallback(filePath);
        await new Promise((resolve) => setTimeout(resolve, 900));
        await focusPowerPointSlideShow();
        resolve(true);
        return;
      } catch (fallbackError) {
        const fallback = await shell.openPath(filePath);
        if (fallback) reject(new Error(stderr || fallbackError.message || fallback));
        else resolve(false);
      }
    });
  });
}

async function openPresentationFullscreen(prepared, command = {}) {
  await closePresentationFullscreen();
  closeDisplayFullscreen();
  if (prepared.kind === 'pdf') {
    openPdfFullscreen(prepared.path, command);
    return;
  }
  try {
    await openPowerPointProcessFallback(prepared.path);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await focusPowerPointSlideShow();
  } catch {
    await openPowerPointFullscreen(prepared.path);
  }
}

async function openUploadPage(command = {}) {
  await closePresentationFullscreen();
  closeDisplayFullscreen();

  if (!mainWindow || mainWindow.isDestroyed()) {
    await createMainWindow();
  }

  const base = uploadServer?.lanUrl || uploadServer?.localUrl || `http://localhost:${UPLOAD_PORT}`;
  const url = new URL(`${base.replace(/\/+$/, '')}/upload-page`);
  url.searchParams.set('sessionId', command.sessionId || '');
  url.searchParams.set('studentId', command.studentId || '');
  if (command.studentName) url.searchParams.set('studentName', command.studentName);

  const returnUrl = new URL(WEB_APP_URL);
  returnUrl.searchParams.set('desktop', 'defense');
  returnUrl.searchParams.set('role', 'student');
  returnUrl.searchParams.set('station', STATION_ID);
  if (command.sessionId) returnUrl.searchParams.set('session', command.sessionId);
  url.searchParams.set('returnUrl', returnUrl.toString());

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.maximize();
  mainWindow.moveTop();
  mainWindow.focus();
  await mainWindow.loadURL(url.toString());
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
    openUploadPage,
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
