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

module.exports = { convertToPdf };
