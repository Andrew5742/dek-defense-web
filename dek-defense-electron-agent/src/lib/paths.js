const os = require('os');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const store = new Store();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorageRoot() {
  const custom = store.get('storageRoot');
  if (custom) return ensureDir(custom);
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

const cyrillicToLatinMap = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ye', 'ж': 'zh',
  'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
  'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'yu', 'я': 'ya',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Ґ': 'G', 'Д': 'D', 'Е': 'E', 'Є': 'Ye', 'Ж': 'Zh',
  'З': 'Z', 'И': 'Y', 'І': 'I', 'Ї': 'Yi', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N',
  'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts',
  'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ь': '', 'Ю': 'Yu', 'Я': 'Ya'
};

function transliterate(text) {
  return String(text).split('').map(char => cyrillicToLatinMap[char] || char).join('');
}

function safeName(value) {
  let str = transliterate(value || '');
  // Replace non-latin/non-numeric characters (except dot, dash, underscore) with underscore
  return str
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .replace(/_+/g, '_')
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
