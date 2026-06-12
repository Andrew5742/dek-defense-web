const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./paths');

function getLibreOfficeCandidates() {
  if (process.platform === 'win32') {
    return [
      process.env.LIBREOFFICE_PATH,
      'soffice.exe',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      'soffice'
    ];
  }
  return ['soffice', '/usr/bin/soffice', '/usr/local/bin/soffice'];
}

function commandExists(command) {
  if (command.includes('/') || command.includes('\\')) return fs.existsSync(command);
  return true;
}

async function convertToPdf(inputPath, outputDir) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.pdf') return inputPath;

  ensureDir(outputDir);
  const candidates = getLibreOfficeCandidates().filter(commandExists);
  let lastError;

  for (const soffice of candidates) {
    try {
      const output = await runLibreOffice(soffice, inputPath, outputDir);
      if (fs.existsSync(output)) return output;
    } catch (error) {
      lastError = error;
    }
  }

  if (process.platform === 'win32' && ['.pptx', '.ppt', '.odp'].includes(ext)) {
    try {
      const output = await runPowerPointExport(inputPath, outputDir);
      if (fs.existsSync(output)) return output;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'LibreOffice не знайдено або конвертація не вдалася');
}

function runLibreOffice(soffice, inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(soffice, [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      inputPath
    ], { windowsHide: true });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `LibreOffice exited with code ${code}`));
        return;
      }
      const parsed = path.parse(inputPath);
      resolve(path.join(outputDir, `${parsed.name}.pdf`));
    });
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerPointExport(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const parsed = path.parse(inputPath);
    const output = path.join(outputDir, `${parsed.name}.pdf`);
    const script = `
$ErrorActionPreference = 'Stop'
$inputPath = ${psQuote(inputPath)}
$outputDir = ${psQuote(outputDir)}
$outputPath = ${psQuote(output)}
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$powerPoint = $null
$presentation = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPoint.Visible = -1
  $presentation = $powerPoint.Presentations.Open($inputPath, -1, 0, 0)
  $presentation.SaveAs($outputPath, 32)
  Write-Output $outputPath
} finally {
  if ($presentation -ne $null) { $presentation.Close() | Out-Null }
  if ($powerPoint -ne $null) { $powerPoint.Quit() | Out-Null }
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
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerPoint export exited with code ${code}`));
        return;
      }
      resolve(output);
    });
  });
}

module.exports = { convertToPdf };
