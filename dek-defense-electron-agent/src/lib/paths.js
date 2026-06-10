const os = require('os');
const path = require('path');
const fs = require('fs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorageRoot() {
  return ensureDir(path.join(os.homedir(), 'Documents', 'DEK Defense Station'));
}

function getSessionDir(sessionId) {
  return ensureDir(path.join(getStorageRoot(), 'sessions', safeName(sessionId || 'default-session')));
}

function getPresentationsDir(sessionId) {
  return ensureDir(path.join(getSessionDir(sessionId), 'presentations'));
}

function getStudentPresentationDir(sessionId, studentId) {
  return ensureDir(path.join(getPresentationsDir(sessionId), safeName(studentId || 'unknown-student')));
}

function safeName(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 160);
}

module.exports = {
  ensureDir,
  getStorageRoot,
  getSessionDir,
  getPresentationsDir,
  getStudentPresentationDir,
  safeName
};
