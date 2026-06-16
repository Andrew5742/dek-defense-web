const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, powerSaveBlocker } = require('electron');
const { spawn } = require('child_process');
const Store = require('electron-store');
const { createFirebaseClient } = require('./lib/firebaseClient');
const { FirestoreAgent } = require('./lib/firestoreAgent');
const { getLocalIPv4Addresses, getPreferredLocalAddress } = require('./lib/network');
const { getStorageRoot } = require('./lib/paths');
const { openZoomMeeting } = require('./lib/zoom');

const store = new Store();
let mainWindow;
let presentationWindow;
let displayWindow;
let firebase;
let agent;
let powerBlockerId = null;

const STATION_ID = process.env.STATION_ID || store.get('stationId') || `station-${Date.now()}`;
const os = require('os');
const STATION_NAME = process.env.STATION_NAME || os.hostname() || '\u041F\u041A \u0437\u0430\u0445\u0438\u0441\u0442\u0443';
const UPLOAD_PORT = Number(process.env.UPLOAD_PORT || 3050);
const ZOOM_URL = process.env.ZOOM_URL || '';
const WEB_APP_URL = process.env.WEB_APP_URL || process.env.VITE_PUBLIC_APP_URL || 'https://dek-defence.web.app/';

store.set('stationId', STATION_ID);

function getAppIconPath() {
  return path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function createMainWindow() {
  const windowState = store.get('windowState', {
    width: 1280,
    height: 820,
  });

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'DEK Defense Station',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  const saveWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      store.set('windowState', {
        ...bounds,
        isMaximized: mainWindow.isMaximized()
      });
    }
  };

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);

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
    // Display already exists — bring it to front WITHOUT minimizing anything else
    displayWindow.setAlwaysOnTop(false);
    displayWindow.show();
    displayWindow.setFullScreen(true);
    displayWindow.moveTop();
    displayWindow.focus();
    return;
  }

  const { screen } = require('electron');
  const bounds = screen.getPrimaryDisplay().bounds;

  displayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#111827',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  displayWindow.once('ready-to-show', () => {
    displayWindow.setKiosk(false);
    displayWindow.setFullScreen(true);
    displayWindow.show();
    displayWindow.setAlwaysOnTop(false);
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

function bringDisplayToFront() {
  if (!displayWindow || displayWindow.isDestroyed()) return;
  displayWindow.setFocusable(true);
  if (displayWindow.isMinimized()) displayWindow.restore();
  displayWindow.show();
  displayWindow.setFullScreen(true);
  displayWindow.setAlwaysOnTop(false);
  displayWindow.moveTop();
  displayWindow.focus();
}

function releaseDisplayFocus() {
  if (!displayWindow || displayWindow.isDestroyed()) return;
  displayWindow.setAlwaysOnTop(false);
  displayWindow.blur();
  displayWindow.setFocusable(false);
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
  bringDisplayToFront();
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
    icon: getAppIconPath(),
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
  // Close any existing presentation (PDF viewer) but NEVER close the display window
  await closePresentationFullscreen();
  // Lower display below presentation level (don't close it)
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.setAlwaysOnTop(false);
  }
  if (prepared.kind === 'pdf') {
    if (displayWindow && !displayWindow.isDestroyed()) displayWindow.setFocusable(true);
    openPdfFullscreen(prepared.path, command);
    return;
  }
  try {
    releaseDisplayFocus();
    await openPowerPointFullscreen(prepared.path);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await focusPowerPointSlideShow();
  } catch {
    releaseDisplayFocus();
    await openPowerPointProcessFallback(prepared.path);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await focusPowerPointSlideShow();
  } finally {
    if (displayWindow && !displayWindow.isDestroyed()) displayWindow.setFocusable(true);
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
  if (command.zoomUrl) url.searchParams.set('zoomUrl', command.zoomUrl);

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
  await mainWindow.loadURL(returnUrl.toString());
}

async function startAgent() {
  if (!firebase) firebase = await createFirebaseClient();

  agent = new FirestoreAgent({
    firebase,
    stationId: STATION_ID,
    stationName: STATION_NAME,
    uploadUrl: '',
    lanUploadUrl: '',
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
    uploadUrl: '',
    lanUploadUrl: '',
    storageRoot: getStorageRoot(),
    addresses: getLocalIPv4Addresses()
  });
}

app.whenReady().then(async () => {
  const { session } = require('electron');
  await session.defaultSession.clearCache();
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
  if (powerBlockerId) powerSaveBlocker.stop(powerBlockerId);
});

ipcMain.handle('agent:get-status', async () => ({
  stationId: STATION_ID,
  stationName: STATION_NAME,
  uploadUrl: '',
  lanUploadUrl: '',
  storageRoot: getStorageRoot(),
  addresses: getLocalIPv4Addresses()
}));

ipcMain.handle('agent:open-storage', async () => {
  await shell.openPath(getStorageRoot());
});

ipcMain.handle('agent:change-storage', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Оберіть папку для презентацій'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    store.set('storageRoot', result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('agent:get-storage', () => {
  return getStorageRoot();
});

ipcMain.handle('agent:delete-presentation', async (_, sessionId, studentId) => {
  const { getStudentPresentationDir } = require('./lib/paths');
  const dir = getStudentPresentationDir(sessionId, studentId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return true;
});

ipcMain.handle('agent:open-zoom', async (_, zoomUrl) => {
  await openZoomMeeting(shell, zoomUrl || ZOOM_URL);
});

ipcMain.handle('agent:set-kiosk-mode', async (event, enabled) => {
  const { BrowserWindow } = require('electron');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    if (enabled) {
      if (win.isMinimized()) win.restore();
      if (win.isMaximized()) win.unmaximize();
      win.setFullScreen(true);
      win.setKiosk(true);
      win.show();
      win.moveTop();
      win.focus();
    } else {
      win.setKiosk(false);
      win.setFullScreen(false);
    }
  }
  return true;
});

ipcMain.handle('agent:close-presentation', async (_, password) => {
  if (password !== '0987Kiis') throw new Error('Неправильний пароль');
  await closePresentationFullscreen();
  if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close();
  return true;
});

ipcMain.handle('agent:list-drives', async () => {
  if (process.platform !== 'win32') return [];
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('wmic logicaldisk get name,volumename,description', (err, stdout) => {
      if (err) return resolve([]);
      const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
      lines.shift(); // remove header
      const drives = lines.map(line => {
        const parts = line.split(/\s{2,}/);
        return {
          path: parts[1] || parts[0],
          name: parts.length > 2 ? parts[2] : (parts[1] || parts[0]),
          description: parts[0]
        };
      }).filter(d => d.path && d.path.endsWith(':'));
      resolve(drives);
    });
  });
});

ipcMain.handle('agent:read-dir', async (_, dirPath) => {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    return files
      .filter(f => !f.name.startsWith('$') && !f.name.startsWith('System Volume'))
      .map(f => ({
        name: f.name,
        isDirectory: f.isDirectory(),
        path: path.join(dirPath, f.name)
      }));
  } catch (e) {
    return [];
  }
});

ipcMain.handle('agent:upload-local-files', async (_, files, studentId, sessionId) => {
  if (!studentId || !sessionId) throw new Error('Missing studentId or sessionId');
  const { getStudentPresentationDir } = require('./lib/paths');
  const dir = getStudentPresentationDir(sessionId, studentId);
  fs.mkdirSync(dir, { recursive: true });

  const uploaded = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!['.pptx', '.ppt', '.pdf', '.odp', '.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) continue;
    const fileName = path.basename(file);
    const dest = path.join(dir, fileName);
    fs.copyFileSync(file, dest);
    uploaded.push({ originalFileName: fileName, storedName: fileName, path: dest, extension: ext.replace('.', '') });
  }

  return uploaded;
});
