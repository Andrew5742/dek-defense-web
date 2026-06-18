const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const multer = require('multer');
const initSqlJs = require('sql.js');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { getLocalIPv4Addresses, getPreferredLocalAddress } = require('./network');
const { getStorageRoot, safeName } = require('./paths');

const MOBILE_PAGE_TTL_MS = 15 * 60 * 1000;
const COMPLETED_COMMAND_TTL_MS = 5 * 60 * 1000;

function findSqlJsDistDir() {
  const candidates = [
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist'),
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules', 'sql.js', 'dist'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist')
  ];
  return candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'sql-wasm.wasm'))) || candidates[0];
}

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyAppState() {
  return {
    _revision: 0,
    _serverUpdatedAt: '',
    activeSessionId: '',
    sessions: [],
    groups: [],
    students: [],
    presentations: [],
    queue: [],
    commands: [],
    stations: [],
    protocols: [],
    events: [],
    importReviews: []
  };
}

const STATE_COLLECTIONS = [
  'sessions', 'groups', 'students', 'presentations', 'queue', 'commands',
  'stations', 'protocols', 'events', 'importReviews'
];

function entityTime(item) {
  const value = item?.updatedAt || item?.lastHeartbeat || item?.uploadedAt || item?.createdAt || '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeCollection(currentItems = [], incomingItems = []) {
  const merged = new Map(currentItems.map((item) => [item.id, item]));
  for (const incoming of incomingItems) {
    const current = merged.get(incoming.id);
    if (!current || entityTime(incoming) >= entityTime(current)) merged.set(incoming.id, incoming);
  }
  return [...merged.values()];
}

function mergeConcurrentState(current, incoming) {
  const merged = {
    ...current,
    ...incoming,
    activeSessionId: incoming.activeSessionId || current.activeSessionId
  };
  for (const key of STATE_COLLECTIONS) merged[key] = mergeCollection(current[key], incoming[key]);
  return merged;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeEntityThreeWay(base, current, incoming) {
  if (!base) return entityTime(incoming) >= entityTime(current) ? incoming : current;
  if (!incoming) return sameValue(current, base) ? undefined : current;
  if (!current) return sameValue(incoming, base) ? undefined : incoming;

  const merged = { ...current };
  for (const key of new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(incoming)])) {
    if (sameValue(incoming[key], base[key])) continue;
    if (incoming[key] === undefined) delete merged[key];
    else merged[key] = incoming[key];
  }
  return merged;
}

function mergeCollectionThreeWay(baseItems = [], currentItems = [], incomingItems = []) {
  const base = new Map(baseItems.map((item) => [item.id, item]));
  const current = new Map(currentItems.map((item) => [item.id, item]));
  const incoming = new Map(incomingItems.map((item) => [item.id, item]));
  const merged = [];

  for (const id of new Set([...base.keys(), ...current.keys(), ...incoming.keys()])) {
    const item = mergeEntityThreeWay(base.get(id), current.get(id), incoming.get(id));
    if (item) merged.push(item);
  }
  return merged;
}

function mergeStateThreeWay(base, current, incoming) {
  const merged = { ...current };
  if (!sameValue(incoming.activeSessionId, base.activeSessionId)) {
    merged.activeSessionId = incoming.activeSessionId;
  }
  for (const key of STATE_COLLECTIONS) {
    merged[key] = mergeCollectionThreeWay(base[key], current[key], incoming[key]);
  }
  return merged;
}

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map((item) => withoutUndefined(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = withoutUndefined(item);
    }
    return out;
  }
  return value;
}

function addMs(iso, ms) {
  const base = Date.parse(iso || '');
  if (!Number.isFinite(base)) return undefined;
  return new Date(base + ms).toISOString();
}

function getStudentPageExpiresAt(student) {
  if (student.defenseStatus !== 'defended') return undefined;
  return student.mobilePageExpiresAt || addMs(student.updatedAt, MOBILE_PAGE_TTL_MS);
}

function isStudentPageExpired(student, nowMs = Date.now()) {
  const expiresAt = getStudentPageExpiresAt(student);
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs <= nowMs;
}

function publicQueueItems(state, session) {
  const studentById = new Map((state.students || []).map((student) => [student.id, student]));
  return (state.queue || [])
    .filter((item) => item.sessionId === session.id)
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
    .map((queue) => ({ queue, student: studentById.get(queue.studentId) }))
    .filter((item) => item.student && !['defended', 'absent', 'problem'].includes(item.student.defenseStatus));
}

function buildPublicStudentPage(student, queueItem) {
  if (!student || isStudentPageExpired(student)) return null;
  const token = student.token || student.id;
  const queuePosition = Number(queueItem?.position ?? student.queuePosition);
  return {
    token,
    studentId: student.id,
    sessionId: student.sessionId,
    fullName: student.fullName || '',
    groupName: student.groupName || '',
    thesisTitle: student.thesisTitleEdited || student.thesisTitleOriginal || '',
    queuePosition: Number.isFinite(queuePosition) && queuePosition > 0 ? queuePosition : null,
    registrationConfirmed: student.registrationConfirmed === true,
    defenseStatus: student.defenseStatus || 'waiting',
    presentationStatus: student.presentationStatus || 'missing',
    wantsZoomDemo: student.wantsZoomDemo === true,
    problemDetails: student.problemDetails || null,
    expiresAt: getStudentPageExpiresAt(student),
    updatedAt: student.updatedAt || nowIso()
  };
}

function buildPublicMobileDisplay(state, session) {
  const settings = session.mobileDisplaySettings || {
    enabled: true,
    currentlyDefendingCount: 5,
    nextDefendingCount: 7,
    publicMessage: ''
  };
  const queue = publicQueueItems(state, session);
  const currentCount = Number(settings.currentlyDefendingCount) || 5;
  const nextCount = Number(settings.nextDefendingCount) || 7;
  const queuePositions = Object.fromEntries(
    queue
      .map((item) => [item.student.id, Number(item.queue.position) || 0])
      .filter(([, position]) => position > 0)
  );
  const toPublic = (item) => ({
    studentId: item.student.id,
    fullName: item.student.fullName || '',
    groupName: item.student.groupName || '',
    position: Number(item.queue.position) || 0
  });
  return {
    sessionId: session.id,
    enabled: settings.enabled !== false,
    publicMessage: settings.publicMessage || '',
    zoomUrl: session.zoomUrl || '',
    queuePositions,
    currentlyDefending: queue.slice(0, currentCount).map(toPublic),
    nextDefending: queue.slice(currentCount, currentCount + nextCount).map(toPublic),
    updatedAt: session.updatedAt || nowIso()
  };
}

function isPrivateHost(hostname) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname || '');
}

function getCommandKey(command) {
  return command.dedupeKey || [
    command.type || 'command',
    command.sessionId || '',
    command.studentId || '',
    command.targetStationId || ''
  ].join(':');
}

function isFinalCommandStatus(status) {
  return ['done', 'error', 'expired', 'cancelled'].includes(status);
}

function commandTime(command) {
  const parsed = Date.parse(command.updatedAt || command.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

class SqlStateStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;
    this.writeChain = Promise.resolve();
    this.revisionSnapshots = new Map();
  }

  async init() {
    const sqlJsDistDir = findSqlJsDistDir();
    this.SQL = await initSqlJs({
      locateFile: (file) => path.join(sqlJsDistDir, file)
    });
    if (fs.existsSync(this.dbPath)) {
      this.db = new this.SQL.Database(fs.readFileSync(this.dbPath));
    } else {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      this.db = new this.SQL.Database();
    }
    this.db.run('CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)');
    this.flush();
    const state = this.getState();
    this.revisionSnapshots.set(Number(state._revision || 0), state);
  }

  getState() {
    const result = this.db.exec("SELECT json FROM app_state WHERE id = 'state' LIMIT 1");
    if (!result.length || !result[0].values.length) return emptyAppState();
    try {
      return { ...emptyAppState(), ...JSON.parse(result[0].values[0][0]) };
    } catch {
      return emptyAppState();
    }
  }

  async saveState(state) {
    let saved;
    this.writeChain = this.writeChain.then(() => {
      const current = this.getState();
      const currentRevision = Number(current._revision || 0);
      const incomingRevision = Number(state?._revision || 0);
      const next = incomingRevision < currentRevision
        ? (this.revisionSnapshots.has(incomingRevision)
          ? mergeStateThreeWay(this.revisionSnapshots.get(incomingRevision), current, state || {})
          : mergeConcurrentState(current, state || {}))
        : { ...emptyAppState(), ...(state || {}) };
      const updatedAt = nowIso();
      const clean = withoutUndefined({
        ...next,
        _revision: currentRevision + 1,
        _serverUpdatedAt: updatedAt
      });
      const json = JSON.stringify(clean);
      this.db.run(
        'INSERT INTO app_state (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
        ['state', json, updatedAt]
      );
      this.flush();
      saved = clean;
      this.revisionSnapshots.set(Number(clean._revision || 0), clean);
      while (this.revisionSnapshots.size > 100) {
        this.revisionSnapshots.delete(this.revisionSnapshots.keys().next().value);
      }
    });
    await this.writeChain;
    return saved;
  }

  flush() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }
}

function createLocalServer(options) {
  const {
    port,
    stationId,
    stationName,
    zoomUrl,
    sendToRenderer,
    openPresentationFullscreen,
    openUploadPage,
    openDisplayFullscreen,
    closeDisplayFullscreen,
    closePresentationFullscreen,
    openZoom
  } = options;

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const storageRoot = options.storageRoot || getStorageRoot();
  const getLocalSessionDir = (sessionId) => path.join(storageRoot, 'sessions', safeName(sessionId || 'default-session'));
  const getLocalStudentPresentationDir = (sessionId, studentId) => {
    const dir = path.join(getLocalSessionDir(sessionId), 'presentations', safeName(studentId || 'unknown-student'));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const dbPath = path.join(storageRoot, 'dek-defense-local.sqlite');
  const store = new SqlStateStore(dbPath);
  const processingCommandIds = new Set();
  let localUrl = `http://localhost:${port}`;
  let lanUrl = `http://${getPreferredLocalAddress()}:${port}`;
  let heartbeatTimer = null;
  let commandTimer = null;

  function broadcast(type, payload) {
    const message = JSON.stringify({ type, ...payload });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(message);
    }
  }

  async function saveAndBroadcast(state) {
    const saved = await store.saveState(state);
    broadcast('state', { state: saved });
    void processPendingCommands(saved);
    return saved;
  }

  function getPublicBaseUrl(req) {
    const forwardedHost = req.get('x-forwarded-host');
    const host = forwardedHost || req.get('host') || `${getPreferredLocalAddress()}:${port}`;
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const hostname = host.split(':')[0];
    if (/^(localhost|127\.)/.test(hostname)) return lanUrl || localUrl;
    if (isPrivateHost(hostname)) return `${proto}://${host}`;
    return lanUrl || localUrl;
  }

  function sendUploadPage(req, res, result = null, error = '') {
    const { sessionId = '', studentId = '', studentName = '', zoomUrl: pageZoomUrl = '' } = req.query;
    const baseUrl = getPublicBaseUrl(req);
    const qrBlock = result?.token
      ? `<section class="ok"><h2>Презентацію завантажено</h2><p>Місце в черзі: <b>№${result.queuePosition || ''}</b></p><img src="${result.qrDataUrl}" alt="QR"><p>Відскануйте QR телефоном, щоб підтвердити реєстрацію.</p><p class="mono">/s/${result.token}</p></section>`
      : '';
    const errorBlock = error ? `<section class="err">${String(error).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</section>` : '';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Завантаження презентації</title>
<style>
body{font-family:Arial,sans-serif;background:#f4f6f8;color:#0f172a;margin:0;padding:32px}main{max-width:860px;margin:0 auto;background:white;border:1px solid #cbd5e1;padding:28px}label{display:block;font-weight:700;margin:16px 0 6px}input,button{font:inherit}input[type=file]{width:100%;border:1px solid #cbd5e1;padding:10px;background:#f8fafc}button{background:#0f172a;color:white;border:0;padding:12px 18px;font-weight:700;margin-top:18px}.hint{background:#f8fafc;border:1px solid #cbd5e1;padding:12px}.ok{background:#ecfdf5;border:1px solid #10b981;padding:16px;margin:16px 0;text-align:center}.ok img{width:220px;height:220px;background:white;padding:12px}.err{background:#fef2f2;border:1px solid #ef4444;color:#991b1b;padding:16px;margin:16px 0}.mono{font-family:monospace;color:#475569}
</style></head><body><main>
<h1>Завантаження презентації</h1>
<p class="hint">Файл зберігається локально на ПК захисту. Firebase Storage не використовується.</p>
<table><tr><th align="left">Студент</th><td>${String(studentName || studentId).replace(/[<>&]/g, '')}</td></tr><tr><th align="left">Сесія</th><td>${String(sessionId).replace(/[<>&]/g, '')}</td></tr></table>
${errorBlock}${qrBlock}
<form method="post" action="/api/upload" enctype="multipart/form-data">
<input type="hidden" name="sessionId" value="${String(sessionId).replace(/"/g, '&quot;')}">
<input type="hidden" name="studentId" value="${String(studentId).replace(/"/g, '&quot;')}">
<input type="hidden" name="studentName" value="${String(studentName).replace(/"/g, '&quot;')}">
<input type="hidden" name="zoomUrl" value="${String(pageZoomUrl).replace(/"/g, '&quot;')}">
<input type="hidden" name="publicBaseUrl" value="${baseUrl}">
<label>Оберіть презентацію</label><input name="presentation" type="file" accept=".pdf,.pptx,.ppt,.odp" required>
<label>Відео за потреби</label><input name="video" type="file" accept=".mp4,.mov,.avi,.mkv,.webm">
<label><input name="wantsZoomDemo" type="checkbox" value="1"> Бажаю демонструвати в Zoom результати роботи</label>
<button type="submit">Завантажити в Agent</button>
</form>
</main></body></html>`);
  }

  function updateStateAfterUpload(state, payload) {
    const now = nowIso();
    const presentationId = `${payload.sessionId}_${payload.studentId}`;
    const existingStudent = state.students.find((student) => student.id === payload.studentId);
    if (!existingStudent) throw new Error('Student not found in local DB');
    const session = state.sessions.find((item) => item.id === payload.sessionId);
    if (session?.isClosed) throw new Error('Defense day is closed: upload is blocked');

    const sessionQueue = (state.queue || []).filter((item) => item.sessionId === payload.sessionId);
    const existingQueueItem = sessionQueue.find((item) => item.studentId === payload.studentId);
    const queuePosition = existingQueueItem?.position || Math.max(0, ...sessionQueue.map((item) => Number(item.position) || 0)) + 1;
    const token = existingStudent.token || uid('token');
    const ext = payload.extension || path.extname(payload.fileName || '').replace('.', '').toLowerCase();
    const presentationStatus = 'ready';
    const presentation = {
      id: presentationId,
      sessionId: payload.sessionId,
      studentId: payload.studentId,
      fileName: payload.storedName || payload.fileName,
      originalFileName: payload.fileName,
      fileSize: payload.size || 0,
      mimeType: payload.mimeType || 'application/octet-stream',
      extension: ext,
      version: 1,
      status: presentationStatus,
      uploadedAt: now,
      localOnly: true,
      convertedPdfReady: ext === 'pdf'
    };

    return {
      state: withoutUndefined({
        ...state,
        activeSessionId: state.activeSessionId || payload.sessionId,
        students: state.students.map((student) => student.id === payload.studentId ? {
          ...student,
          token,
          registrationStatus: 'registered',
          registeredAt: student.registeredAt || now,
          presentationStatus,
          queuePosition,
          wantsZoomDemo: payload.wantsZoomDemo === true || student.wantsZoomDemo === true,
          hasVideo: payload.hasVideo === true || student.hasVideo === true,
          updatedAt: now
        } : student),
        presentations: [
          ...state.presentations.filter((item) => item.id !== presentationId && item.studentId !== payload.studentId),
          presentation
        ],
        queue: existingQueueItem
          ? state.queue.map((item) => item.id === existingQueueItem.id ? { ...item, position: queuePosition, updatedAt: now } : item)
          : [...state.queue, { id: uid('queue'), sessionId: payload.sessionId, studentId: payload.studentId, position: queuePosition, createdAt: now, updatedAt: now }],
        events: [{
          id: uid('event'),
          sessionId: payload.sessionId,
          type: 'PRESENTATION_UPLOADED',
          actor: 'student',
          message: `Presentation uploaded in local Agent: ${existingStudent.fullName || payload.studentId}`,
          payload: { studentId: payload.studentId, fileName: payload.fileName, hasVideo: payload.hasVideo, wantsZoomDemo: payload.wantsZoomDemo === true, stationId },
          createdAt: now
        }, ...state.events].slice(0, 1000)
      }),
      token,
      queuePosition
    };
  }

  function preparePresentation(sessionId, studentId) {
    const dir = getLocalStudentPresentationDir(sessionId, studentId);
    const files = fs.readdirSync(dir)
      .map((name) => ({ name, full: path.join(dir, name), stat: fs.statSync(path.join(dir, name)) }))
      .filter((item) => item.stat.isFile())
      .filter((item) => !item.name.startsWith('~$') && !item.name.endsWith('.tmp') && !item.name.endsWith('.crdownload'))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const source = files.find((item) => ['.pptx', '.ppt', '.odp', '.pdf'].includes(path.extname(item.name).toLowerCase()));
    if (!source) throw new Error('Local presentation file not found on defense PC');
    const ext = path.extname(source.name).toLowerCase();
    return { kind: ext === '.pdf' ? 'pdf' : 'ppt', path: source.full, sourcePath: source.full };
  }

  async function setCommandStatus(commandId, status, extra = {}) {
    const base = store.getState();
    const now = nowIso();
    const next = {
      ...base,
      commands: (base.commands || []).map((command) => command.id === commandId
        ? withoutUndefined({
          ...command,
          status,
          error: extra.error || command.error,
          humanError: extra.humanError || command.humanError,
          attempt: extra.attempt ?? command.attempt,
          nextAttemptAt: extra.nextAttemptAt,
          handledAt: isFinalCommandStatus(status) ? now : command.handledAt,
          updatedAt: now
        })
        : command)
    };
    await saveAndBroadcast(next);
  }

  function humanizeCommandError(error) {
    const message = String(error?.message || error || '');
    if (/Failed to fetch|network|offline|timeout/i.test(message)) return 'Local Agent або мережа недоступні. Перевірте, що Agent запущений і ПК у тій самій мережі.';
    if (/presentation.*not found|No presentation|Missing|not found/i.test(message)) return 'Презентацію не знайдено на ПК захисту. Завантажте її через Agent.';
    return message || 'Команда не виконалась. Спробуйте ще раз або перезапустіть Agent.';
  }

  async function processSingleCommand(command) {
    if (processingCommandIds.has(command.id)) return;
    processingCommandIds.add(command.id);
    try {
      await setCommandStatus(command.id, 'running');
      sendToRenderer('command-running', { commandId: command.id, command });

      if (command.type === 'start_defense_display' || command.type === 'show_display') {
        await closePresentationFullscreen?.({ restoreDisplay: false, restoreTaskbar: false });
        await openDisplayFullscreen(command);
        await setCommandStatus(command.id, 'done');
        return;
      }

      if (command.type === 'open_zoom') {
        await closePresentationFullscreen?.({ restoreDisplay: false, restoreTaskbar: false });
        await closeDisplayFullscreen?.({ restoreMain: false });
        await openZoom(command.zoomUrl || zoomUrl);
        await setCommandStatus(command.id, 'done');
        return;
      }

      if (command.type === 'open_upload_page') {
        await openUploadPage(command);
        await setCommandStatus(command.id, 'done');
        return;
      }

      if (command.type === 'close_day') {
        await closePresentationFullscreen?.({ restoreDisplay: false });
        await closeDisplayFullscreen?.({ restoreMain: true });
        if (command.sessionId) await fs.promises.rm(getLocalSessionDir(command.sessionId), { recursive: true, force: true });
        await setCommandStatus(command.id, 'done');
        return;
      }

      if (command.type === 'close_presentation') {
        await closePresentationFullscreen?.({ restoreDisplay: true, restoreTaskbar: false });
        await setCommandStatus(command.id, 'done');
        return;
      }

      if (command.type === 'set_current_student') {
        const base = store.getState();
        const now = nowIso();
        const next = {
          ...base,
          students: (base.students || []).map((student) => {
            if (student.sessionId !== command.sessionId) return student;
            if (student.id === command.studentId) return { ...student, defenseStatus: 'presenting', updatedAt: now };
            if (student.defenseStatus === 'presenting') return { ...student, defenseStatus: 'waiting', updatedAt: now };
            return student;
          }),
          stations: (base.stations || []).map((station) => station.id === stationId
            ? { ...station, activeSessionId: command.sessionId, currentStudentId: command.studentId, updatedAt: now }
            : station)
        };
        await saveAndBroadcast(next);
        await setCommandStatus(command.id, 'done');
        return;
      }

      if (command.type === 'open_presentation') {
        const prepared = preparePresentation(command.sessionId, command.studentId);
        await closeDisplayFullscreen?.({ restoreMain: false });
        await openPresentationFullscreen(prepared, command);
        const base = store.getState();
        const now = nowIso();
        const next = {
          ...base,
          presentations: (base.presentations || []).map((item) => item.sessionId === command.sessionId && item.studentId === command.studentId ? { ...item, status: 'ready', updatedAt: now } : item)
        };
        await saveAndBroadcast(next);
        await setCommandStatus(command.id, 'done');
        return;
      }

      await setCommandStatus(command.id, 'done');
    } catch (error) {
      const attempt = Number(command.attempt || 1);
      const maxAttempts = Number(command.maxAttempts || 5);
      if (attempt < maxAttempts && command.type !== 'open_upload_page') {
        const retryDelayMs = Math.min(4000, 500 * Math.max(1, attempt));
        await setCommandStatus(command.id, 'pending', {
          attempt: attempt + 1,
          nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString(),
          error: error.message,
          humanError: humanizeCommandError(error)
        });
      } else {
        await setCommandStatus(command.id, 'error', {
          attempt,
          error: error.message,
          humanError: humanizeCommandError(error)
        });
      }
    } finally {
      processingCommandIds.delete(command.id);
    }
  }

  async function processPendingCommands(incomingState = null) {
    const state = incomingState || store.getState();
    const nowMs = Date.now();
    const commands = [...(state.commands || [])];
    const targetCommands = commands.filter((command) => {
      if (command.status !== 'pending') return false;
      if (command.targetStationId && ![stationId, 'station_local_demo'].includes(command.targetStationId)) return false;
      const nextAttemptMs = Date.parse(command.nextAttemptAt || '');
      if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) return false;
      const expiresMs = Date.parse(command.expiresAt || '');
      return !Number.isFinite(expiresMs) || expiresMs > nowMs;
    });

    const latestByKey = new Map();
    for (const command of targetCommands) {
      const key = getCommandKey(command);
      const previous = latestByKey.get(key);
      if (!previous || commandTime(command) >= commandTime(previous)) latestByKey.set(key, command);
    }

    let changed = false;
    const cleaned = commands.map((command) => {
      const key = getCommandKey(command);
      const latest = latestByKey.get(key);
      const completedAge = nowMs - commandTime(command);
      if (command.status === 'pending' && latest && latest.id !== command.id) {
        changed = true;
        return { ...command, status: 'cancelled', handledAt: nowIso(), updatedAt: nowIso(), humanError: 'Cancelled because a newer duplicate command exists' };
      }
      if (isFinalCommandStatus(command.status) && completedAge > COMPLETED_COMMAND_TTL_MS) {
        changed = true;
        return null;
      }
      return command;
    }).filter(Boolean);

    let stateForProcessing = state;
    if (changed) {
      stateForProcessing = await saveAndBroadcast({ ...state, commands: cleaned });
    }

    const runnable = [...latestByKey.values()]
      .filter((command) => (stateForProcessing.commands || []).some((item) => item.id === command.id && item.status === 'pending'))
      .sort((a, b) => (Number(b.commandVersion) || 0) - (Number(a.commandVersion) || 0) || commandTime(b) - commandTime(a));
    for (const command of runnable) {
      void processSingleCommand(command);
    }
  }

  async function touchStation() {
    const state = store.getState();
    const now = nowIso();
    const preferredAddress = getPreferredLocalAddress();
    lanUrl = `http://${preferredAddress}:${port}`;
    const station = {
      id: stationId,
      name: stationName,
      activeSessionId: state.activeSessionId || '',
      online: true,
      localUploadUrl: localUrl,
      lanUploadUrl: lanUrl,
      lastHeartbeat: now
    };
    const exists = (state.stations || []).some((item) => item.id === stationId);
    const next = {
      ...state,
      stations: exists
        ? state.stations.map((item) => item.id === stationId ? { ...item, ...station } : item)
        : [...(state.stations || []), station]
    };
    await saveAndBroadcast(next);
  }

  async function start() {
    await store.init();
    const upload = multer({ dest: path.join(storageRoot, '_tmp_uploads') });
    app.use((req, res, next) => {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type,x-requested-with');
      res.setHeader('access-control-allow-private-network', 'true');
      if (req.method === 'OPTIONS') return res.end();
      next();
    });
    app.use(express.json({ limit: '25mb' }));

    app.get('/api/health', (req, res) => res.json({ ok: true, stationId, stationName, localUrl, lanUrl, dbPath, storageRoot, addresses: getLocalIPv4Addresses() }));
    app.get('/api/state', (req, res) => res.json(store.getState()));
    app.post('/api/state', async (req, res, next) => {
      try {
        const saved = await saveAndBroadcast({ ...emptyAppState(), ...(req.body || {}) });
        res.json(saved);
      } catch (error) {
        next(error);
      }
    });

    app.get('/api/mobile/:token', (req, res) => {
      const state = store.getState();
      const token = req.params.token;
      const student = (state.students || []).find((item) => item.token === token || item.id === token);
      if (!student) return res.json({ studentPage: null, mobileDisplay: null });
      const session = (state.sessions || []).find((item) => item.id === student.sessionId);
      if (!session) return res.json({ studentPage: null, mobileDisplay: null });
      const queueItem = (state.queue || []).find((item) => item.sessionId === student.sessionId && item.studentId === student.id) || (state.queue || []).find((item) => item.studentId === student.id);
      res.json({
        studentPage: buildPublicStudentPage(student, queueItem),
        mobileDisplay: buildPublicMobileDisplay(state, session)
      });
    });

    app.post('/api/mobile/:token/confirm', async (req, res, next) => {
      try {
        const state = store.getState();
        const now = nowIso();
        const token = req.params.token;
        const student = (state.students || []).find((item) => item.token === token || item.id === token);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        const nextState = {
          ...state,
          students: state.students.map((item) => item.id === student.id ? { ...item, registrationConfirmed: true, token: item.token || token, updatedAt: now } : item)
        };
        await saveAndBroadcast(nextState);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    });

    app.get('/api/mobile/queue-position/:sessionId/:studentId', (req, res) => {
      const state = store.getState();
      const item = (state.queue || []).find((queue) => queue.sessionId === req.params.sessionId && queue.studentId === req.params.studentId)
        || (state.queue || []).find((queue) => queue.studentId === req.params.studentId);
      res.json({ position: item ? Number(item.position) || null : null });
    });

    app.post('/api/mobile/:token/expire', async (req, res) => res.json({ ok: true }));
    app.get('/upload-page', (req, res) => sendUploadPage(req, res));
    app.post('/api/upload', upload.fields([{ name: 'presentation', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res, next) => {
      try {
        const presentation = req.files?.presentation?.[0];
        const video = req.files?.video?.[0];
        const sessionId = req.body.sessionId;
        const studentId = req.body.studentId;
        if (!presentation || !sessionId || !studentId) throw new Error('Missing presentation, sessionId or studentId');
        const dir = getLocalStudentPresentationDir(sessionId, studentId);
        fs.mkdirSync(dir, { recursive: true });
        const storedName = presentation.originalname;
        fs.copyFileSync(presentation.path, path.join(dir, storedName));
        fs.rmSync(presentation.path, { force: true });
        if (video) {
          fs.copyFileSync(video.path, path.join(dir, video.originalname));
          fs.rmSync(video.path, { force: true });
        }
        const state = store.getState();
        const updated = updateStateAfterUpload(state, {
          sessionId,
          studentId,
          fileName: presentation.originalname,
          storedName,
          size: presentation.size,
          mimeType: presentation.mimetype,
          extension: path.extname(presentation.originalname).replace('.', '').toLowerCase(),
          hasVideo: Boolean(video),
          wantsZoomDemo: req.body.wantsZoomDemo === '1'
        });
        await saveAndBroadcast(updated.state);
        const publicBaseUrl = req.body.publicBaseUrl || getPublicBaseUrl(req);
        const mobileUrl = `${publicBaseUrl.replace(/\/+$/, '')}/s/${encodeURIComponent(updated.token)}`;
        const qrDataUrl = await QRCode.toDataURL(mobileUrl, { margin: 1, width: 240 });
        sendToRenderer('presentation-uploaded', { sessionId, studentId, fileName: presentation.originalname, token: updated.token, queuePosition: updated.queuePosition });
        if ((req.get('accept') || '').includes('application/json')) return res.json({ ok: true, token: updated.token, queuePosition: updated.queuePosition, mobileUrl });
        sendUploadPage(req, res, { token: updated.token, queuePosition: updated.queuePosition, qrDataUrl });
      } catch (error) {
        if ((req.get('accept') || '').includes('application/json')) return next(error);
        sendUploadPage(req, res, null, error.message);
      }
    });

    const distCandidates = [
      path.resolve(__dirname, '..', '..', 'dist'),
      path.resolve(__dirname, '..', '..', '..', 'dist'),
      path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'dist')
    ];
    const distDir = distCandidates.find((dir) => dir && fs.existsSync(path.join(dir, 'index.html')));
    if (distDir) {
      app.use(express.static(distDir));
      app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
    }

    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      res.status(500).json({ error: error.message || String(error) });
    });

    await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
    localUrl = `http://localhost:${port}`;
    lanUrl = `http://${getPreferredLocalAddress()}:${port}`;
    await touchStation();
    heartbeatTimer = setInterval(() => void touchStation().catch(() => undefined), 15000);
    commandTimer = setInterval(() => void processPendingCommands().catch(() => undefined), 1000);
    void processPendingCommands().catch(() => undefined);
    return { localUrl, lanUrl, dbPath };
  }

  async function stop() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (commandTimer) clearInterval(commandTimer);
    await touchStation().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'state', state: store.getState() }));
  });

  return {
    get localUrl() { return localUrl; },
    get lanUrl() { return lanUrl; },
    get dbPath() { return dbPath; },
    start,
    stop,
    getState: () => store.getState(),
    saveState: saveAndBroadcast,
    processPendingCommands
  };
}

module.exports = { createLocalServer };
