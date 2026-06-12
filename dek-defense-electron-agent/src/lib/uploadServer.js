const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getStudentPresentationDir, safeName } = require('./paths');
const { getPreferredLocalAddress } = require('./network');

const allowedExt = new Set(['.pdf', '.pptx', '.ppt', '.odp']);

function normalizeUploadFileName(fileName) {
  const value = String(fileName || 'presentation');
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  if (/[ÐÑÃ]/.test(value) && /[А-Яа-яІіЇїЄєҐґ]/.test(decoded)) return decoded;
  return value;
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

  app.get('/health', (req, res) => {
    res.json({ ok: true, app: 'DEK Defense Station' });
  });

  app.post('/upload', upload.single('presentation'), async (req, res) => {
    try {
      const sessionId = req.body.sessionId || req.query.sessionId || 'default-session';
      const studentId = req.body.studentId || req.query.studentId;
      if (!studentId) {
        res.status(400).json({ ok: false, error: 'studentId is required' });
        return;
      }
      const file = req.file;
      const payload = {
        sessionId,
        studentId,
        fileName: file.originalname,
        storedName: path.basename(file.path),
        localPath: file.path,
        format: path.extname(file.originalname).replace('.', '').toLowerCase(),
        size: file.size,
        uploadedAt: new Date().toISOString()
      };
      const processed = await onUploaded?.(payload);
      res.json({ ok: true, presentation: { ...payload, ...(processed || {}), localPath: undefined } });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
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
