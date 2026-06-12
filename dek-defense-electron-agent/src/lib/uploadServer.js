const express = require('express');
const multer = require('multer');
const path = require('path');
const { getStudentPresentationDir, safeName } = require('./paths');
const { getPreferredLocalAddress } = require('./network');

const allowedExt = new Set(['.pdf', '.pptx', '.ppt', '.odp']);

function normalizeUploadFileName(fileName) {
  const value = String(fileName || 'presentation');
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  const cyrillic = /[А-Яа-яІіЇїЄєҐґ]/;
  if (!cyrillic.test(value) && cyrillic.test(decoded)) return decoded;
  return value;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[ch] || ch));
}

function readUploadIdentity(req) {
  return {
    sessionId: req.body?.sessionId || req.query.sessionId || 'default-session',
    studentId: req.body?.studentId || req.query.studentId || '',
    studentName: req.body?.studentName || req.query.studentName || '',
    returnUrl: req.body?.returnUrl || req.query.returnUrl || ''
  };
}

function uploadPageUrl(identity, endpoint = '/upload-page') {
  const params = new URLSearchParams();
  if (identity.sessionId) params.set('sessionId', identity.sessionId);
  if (identity.studentId) params.set('studentId', identity.studentId);
  if (identity.studentName) params.set('studentName', identity.studentName);
  if (identity.returnUrl) params.set('returnUrl', identity.returnUrl);
  return `${endpoint}?${params.toString()}`;
}

function renderUploadPage({ identity, error = '', success = false, presentation = null }) {
  const fallbackAction = uploadPageUrl(identity, '/upload-page');
  const uploadAction = uploadPageUrl(identity, '/upload');
  const confirmTarget = identity.returnUrl || uploadPageUrl(identity, '/upload-page');
  const initialStatus = success
    ? `<div class="ok"><b>Презентацію прийнято.</b><br>${escapeHtml(presentation?.fileName || '')}</div>`
    : error
      ? `<div class="error"><b>Не вдалося завантажити презентацію.</b><br>${escapeHtml(error)}</div>`
      : '';

  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Завантаження презентації</title>
  <style>
    :root { font-family: Arial, sans-serif; color: #061225; background: #f3f4f6; }
    body { margin: 0; padding: 24px; }
    main { max-width: 760px; margin: 0 auto; background: #fff; border: 1px solid #cbd5e1; padding: 22px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    p { line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { width: 170px; background: #f8fafc; }
    form { border: 1px dashed #64748b; padding: 18px; margin-top: 16px; }
    input[type=file] { display: block; width: 100%; border: 1px solid #cbd5e1; padding: 10px; margin: 10px 0 14px; box-sizing: border-box; }
    .button, button { display: inline-block; border: 1px solid #111827; background: #111827; color: #fff; padding: 10px 14px; text-decoration: none; cursor: pointer; font: inherit; }
    .secondary { background: #fff; color: #111827; margin-left: 8px; }
    .ok { border: 1px solid #16a34a; background: #f0fdf4; color: #14532d; padding: 12px; margin: 14px 0; }
    .error { border: 1px solid #dc2626; background: #fef2f2; color: #991b1b; padding: 12px; margin: 14px 0; }
    .hint { color: #475569; border: 1px solid #cbd5e1; padding: 10px; background: #f8fafc; }
    .progress-wrap { display: none; margin: 14px 0; border: 1px solid #94a3b8; background: #f8fafc; padding: 10px; }
    .progress-track { height: 18px; border: 1px solid #64748b; background: #fff; overflow: hidden; }
    .progress-bar { height: 100%; width: 0%; background: #111827; transition: width .12s linear; }
    .progress-text { margin-top: 8px; color: #334155; }
    .confirm { display: none; margin-top: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Завантаження презентації</h1>
    <p>Це локальна сторінка Electron Agent на ПК захисту. Файл збережеться на цьому ПК, а у Firebase піде тільки статус і метадані.</p>
    <table>
      <tr><th>Студент</th><td>${escapeHtml(identity.studentName || identity.studentId)}</td></tr>
      <tr><th>Сесія</th><td>${escapeHtml(identity.sessionId)}</td></tr>
    </table>
    <p class="hint">Дозволені формати: PDF, PPTX, PPT, ODP. PPTX/PPT/ODP відкриваються через PowerPoint у повноекранному режимі.</p>
    <div id="status">${initialStatus}</div>
    <form id="uploadForm" method="post" action="${escapeHtml(fallbackAction)}" enctype="multipart/form-data">
      <input type="hidden" name="sessionId" value="${escapeHtml(identity.sessionId)}">
      <input type="hidden" name="studentId" value="${escapeHtml(identity.studentId)}">
      <input type="hidden" name="studentName" value="${escapeHtml(identity.studentName)}">
      <input type="hidden" name="returnUrl" value="${escapeHtml(identity.returnUrl)}">
      <label><b>Оберіть презентацію</b><input id="presentationInput" name="presentation" type="file" accept=".pdf,.pptx,.ppt,.odp" required></label>
      <button id="uploadBtn" type="submit">Завантажити в Agent</button>
    </form>
    <div id="progressWrap" class="progress-wrap">
      <div class="progress-track"><div id="progressBar" class="progress-bar"></div></div>
      <div id="progressText" class="progress-text">Підготовка завантаження...</div>
    </div>
    <a id="confirmBtn" class="button confirm" href="${escapeHtml(confirmTarget)}">Підтвердити запис</a>
  </main>
  <script>
    const form = document.getElementById('uploadForm');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressWrap = document.getElementById('progressWrap');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const statusBox = document.getElementById('status');
    const confirmBtn = document.getElementById('confirmBtn');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const file = document.getElementById('presentationInput').files[0];
      if (!file) return;
      uploadBtn.disabled = true;
      progressWrap.style.display = 'block';
      confirmBtn.style.display = 'none';
      statusBox.innerHTML = '';
      progressBar.style.width = '0%';
      progressText.textContent = 'Завантаження: 0%';

      const xhr = new XMLHttpRequest();
      xhr.open('POST', ${JSON.stringify(uploadAction)});
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          progressText.textContent = 'Завантаження триває...';
          return;
        }
        const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        progressBar.style.width = percent + '%';
        progressText.textContent = 'Завантаження: ' + percent + '%';
      };
      xhr.onload = () => {
        uploadBtn.disabled = false;
        let payload = {};
        try { payload = JSON.parse(xhr.responseText || '{}'); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && payload.ok !== false) {
          progressBar.style.width = '100%';
          progressText.textContent = 'Файл завантажено. Натисніть “Підтвердити запис”.';
          const name = payload.presentation?.fileName || file.name;
          statusBox.innerHTML = '<div class="ok"><b>Презентацію прийнято.</b><br>' + escapeHtmlClient(name) + '</div>';
          confirmBtn.style.display = 'inline-block';
          return;
        }
        statusBox.innerHTML = '<div class="error"><b>Не вдалося завантажити презентацію.</b><br>' + escapeHtmlClient(payload.error || ('HTTP ' + xhr.status)) + '</div>';
        progressText.textContent = 'Помилка завантаження.';
      };
      xhr.onerror = () => {
        uploadBtn.disabled = false;
        statusBox.innerHTML = '<div class="error"><b>Не вдалося завантажити презентацію.</b><br>Немає з’єднання з локальним Agent.</div>';
        progressText.textContent = 'Помилка мережі.';
      };
      xhr.send(data);
    });
    function escapeHtmlClient(value) {
      return String(value || '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch] || ch));
    }
  </script>
</body>
</html>`;
}

function startUploadServer({ port, onUploaded }) {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const storage = multer.diskStorage({
    destination(req, file, cb) {
      const sessionId = req.body.sessionId || req.query.sessionId || 'default-session';
      const studentId = req.body.studentId || req.query.studentId || 'unknown-student';
      cb(null, getStudentPresentationDir(sessionId, studentId));
    },
    filename(req, file, cb) {
      const originalName = normalizeUploadFileName(file.originalname);
      file.originalname = originalName;
      const ext = path.extname(originalName).toLowerCase();
      const base = path.basename(originalName, ext);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      cb(null, `${stamp}_${safeName(base)}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 250 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      const originalName = normalizeUploadFileName(file.originalname);
      file.originalname = originalName;
      const ext = path.extname(originalName).toLowerCase();
      if (!allowedExt.has(ext)) {
        cb(new Error('Дозволені тільки PDF, PPTX, PPT, ODP'));
        return;
      }
      cb(null, true);
    }
  });

  function buildUploadPayload(req) {
    const identity = readUploadIdentity(req);
    if (!identity.studentId) throw new Error('studentId is required');
    const file = req.file;
    if (!file) throw new Error('presentation file is required');
    return {
      sessionId: identity.sessionId,
      studentId: identity.studentId,
      fileName: file.originalname,
      storedName: path.basename(file.path),
      localPath: file.path,
      format: path.extname(file.originalname).replace('.', '').toLowerCase(),
      size: file.size,
      uploadedAt: new Date().toISOString()
    };
  }

  app.get('/health', (req, res) => {
    res.json({ ok: true, app: 'DEK Defense Station' });
  });

  app.get('/upload-page', (req, res) => {
    res.type('html').send(renderUploadPage({ identity: readUploadIdentity(req) }));
  });

  app.post('/upload-page', (req, res) => {
    upload.single('presentation')(req, res, async (uploadError) => {
      const identity = readUploadIdentity(req);
      if (uploadError) {
        res.status(400).type('html').send(renderUploadPage({ identity, error: uploadError.message }));
        return;
      }
      try {
        const payload = buildUploadPayload(req);
        const processed = await onUploaded?.(payload);
        res.type('html').send(renderUploadPage({
          identity,
          success: true,
          presentation: { ...payload, ...(processed || {}) }
        }));
      } catch (error) {
        res.status(500).type('html').send(renderUploadPage({ identity, error: error.message }));
      }
    });
  });

  app.post('/upload', (req, res) => {
    upload.single('presentation')(req, res, async (uploadError) => {
      if (uploadError) {
        res.status(400).json({ ok: false, error: uploadError.message });
        return;
      }
      try {
        const payload = buildUploadPayload(req);
        const processed = await onUploaded?.(payload);
        res.json({ ok: true, presentation: { ...payload, ...(processed || {}), localPath: undefined } });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });
  });

  const server = app.listen(port, '0.0.0.0');
  const address = getPreferredLocalAddress();

  return {
    app,
    server,
    localUrl: `http://localhost:${port}`,
    lanUrl: `http://${address}:${port}`,
    close: () => server.close()
  };
}

module.exports = { startUploadServer };
