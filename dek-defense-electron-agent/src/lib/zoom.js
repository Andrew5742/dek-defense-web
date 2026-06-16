const { spawn } = require('child_process');

function normalizeZoomLaunchUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Zoom link / Meeting ID не задано в сесії захисту');

  if (/^zoommtg:\/\//i.test(raw)) return raw;

  const plainMeetingId = raw.replace(/\s+/g, '');
  if (/^\d{9,12}$/.test(plainMeetingId)) {
    return `zoommtg://zoom.us/join?action=join&confno=${encodeURIComponent(plainMeetingId)}`;
  }

  try {
    const url = new URL(raw);
    const pathMatch = url.pathname.match(/\/(?:j|wc)\/(\d{9,12})/);
    const confno = url.searchParams.get('confno') || pathMatch?.[1] || '';
    const pwd = url.searchParams.get('pwd') || url.searchParams.get('password') || '';
    if (confno) {
      const params = new URLSearchParams({ action: 'join', confno });
      if (pwd) params.set('pwd', pwd);
      return `zoommtg://zoom.us/join?${params.toString()}`;
    }
  } catch {
    // Fall through to the original value so custom enterprise Zoom links still work.
  }

  return raw;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], { windowsHide: true, stdio: 'ignore' });
    child.on('close', () => resolve(true));
    child.on('error', () => resolve(false));
  });
}

async function focusZoomMeetingWindow() {
  if (process.platform !== 'win32') return false;
  const script = `
$signature = @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
'@
try { Add-Type -MemberDefinition $signature -Name Win32 -Namespace Native -ErrorAction SilentlyContinue | Out-Null } catch {}
$windows = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and (
    $_.ProcessName -match '^(Zoom|CptHost)$' -or
    $_.MainWindowTitle -match 'Zoom|Meeting|Conference|Конференц|Демонстрац'
  )
} | Sort-Object -Property @{
  Expression = {
    if ($_.MainWindowTitle -match 'Zoom Workplace|Calendar|Scheduler|Meetings') { 20 }
    elseif ($_.MainWindowTitle -match 'Zoom Meeting|Meeting|Conference|Конференц') { 0 }
    elseif ($_.ProcessName -eq 'CptHost') { 1 }
    else { 10 }
  }
}
$target = $windows | Select-Object -First 1
if ($target) {
  [Native.Win32]::ShowWindowAsync($target.MainWindowHandle, 9) | Out-Null
  Start-Sleep -Milliseconds 120
  [Native.Win32]::SetForegroundWindow($target.MainWindowHandle) | Out-Null
}
`;
  return runPowerShell(script);
}

async function openZoomMeeting(shell, value) {
  try {
    const launchUrl = normalizeZoomLaunchUrl(value);
    await shell.openExternal(launchUrl).catch(() => { throw new Error('openExternal failed'); });
  } catch (error) {
    if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
      await shell.openExternal(value).catch(console.error);
    }
  }
  await delay(900);
  await focusZoomMeetingWindow();
  await delay(900);
  await focusZoomMeetingWindow();
}

module.exports = { normalizeZoomLaunchUrl, focusZoomMeetingWindow, openZoomMeeting };
