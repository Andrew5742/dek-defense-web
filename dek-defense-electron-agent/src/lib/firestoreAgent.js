const path = require('path');
const fs = require('fs');
const { shell } = require('electron');
const { getStudentPresentationDir } = require('./paths');

const APP_STATE_COLLECTION = 'dek_app';
const APP_STATE_DOC = 'state';

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyAppState() {
  return {
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

class FirestoreAgent {
  constructor({ firebase, stationId, stationName, uploadUrl, lanUploadUrl, zoomUrl, sendToRenderer, openPdfFullscreen, openPresentationFullscreen, openUploadPage, openDisplayFullscreen, closeDisplayFullscreen, closePresentationFullscreen }) {
    this.firebase = firebase;
    this.db = firebase.db;
    this.stationId = stationId;
    this.stationName = stationName;
    this.uploadUrl = uploadUrl;
    this.lanUploadUrl = lanUploadUrl;
    this.zoomUrl = zoomUrl;
    this.sendToRenderer = sendToRenderer;
    this.openPdfFullscreen = openPdfFullscreen;
    this.openPresentationFullscreen = openPresentationFullscreen;
    this.openUploadPage = openUploadPage;
    this.openDisplayFullscreen = openDisplayFullscreen;
    this.closeDisplayFullscreen = closeDisplayFullscreen;
    this.closePresentationFullscreen = closePresentationFullscreen;
    this.unsubscribers = [];
    this.heartbeatTimer = null;
  }

  async start() {
    await this.updateStation({ online: true });
    this.heartbeatTimer = setInterval(() => this.updateStation({ online: true }).catch(() => {}), 10000);
    this.listenCommands();
  }

  stop() {
    for (const unsub of this.unsubscribers) unsub();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  async updateStation(extra = {}) {
    const { doc, setDoc, serverTimestamp } = this.firebase;
    await setDoc(doc(this.db, 'dek_stations', this.stationId), {
      stationId: this.stationId,
      name: this.stationName,
      role: 'defense_station',
      localUploadUrl: this.uploadUrl,
      lanUploadUrl: this.lanUploadUrl || null,
      lastHeartbeat: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...extra
    }, { merge: true });
    this.sendToRenderer('station-status', { online: true, uploadUrl: this.uploadUrl, stationId: this.stationId });
  }

  async addEvent(type, payload = {}) {
    const { addDoc, collection, serverTimestamp } = this.firebase;
    await addDoc(collection(this.db, 'dek_events'), {
      type,
      stationId: this.stationId,
      createdAt: serverTimestamp(),
      ...payload
    });
  }

  listenCommands() {
    const { collection, query, where, onSnapshot } = this.firebase;
    const q = query(
      collection(this.db, 'dek_commands'),
      where('targetStationId', '==', this.stationId),
      where('status', '==', 'pending')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          this.handleCommand(change.doc.id, change.doc.data()).catch((error) => {
            this.sendToRenderer('agent-error', { error: error.message });
          });
        }
      });
    });
    this.unsubscribers.push(unsub);
  }

  async setCommandStatus(commandId, status, extra = {}) {
    const { doc, updateDoc, serverTimestamp } = this.firebase;
    await updateDoc(doc(this.db, 'dek_commands', commandId), {
      status,
      updatedAt: serverTimestamp(),
      handledAt: status === 'done' || status === 'error' ? serverTimestamp() : null,
      ...extra
    });
  }

  async handleCommand(commandId, command) {
    if (this.isStaleCommand(command)) {
      await this.setCommandStatus(commandId, 'error', { errorMessage: 'Stale command ignored by local agent' });
      await this.addEvent('COMMAND_STALE_IGNORED', { commandId, commandType: command.type, sessionId: command.sessionId });
      return;
    }

    await this.setCommandStatus(commandId, 'running');
    this.sendToRenderer('command-running', { commandId, command });

    try {
      if (command.type === 'start_defense_display' || command.type === 'show_display') {
        await this.closePresentationFullscreen?.();
        this.openDisplayFullscreen(command);
        await this.setCommandStatus(commandId, 'done');
        await this.addEvent('DISPLAY_STARTED', { sessionId: command.sessionId });
        return;
      }

      if (command.type === 'open_zoom') {
        await this.closePresentationFullscreen?.();
        this.closeDisplayFullscreen?.();
        await shell.openExternal(command.zoomUrl || this.zoomUrl || 'zoommtg://zoom.us/join');
        await this.setCommandStatus(commandId, 'done');
        await this.addEvent('ZOOM_OPENED', { sessionId: command.sessionId, studentId: command.studentId || null });
        return;
      }

      if (command.type === 'open_upload_page') {
        await this.openUploadPage(command);
        await this.setCommandStatus(commandId, 'done');
        await this.addEvent('UPLOAD_PAGE_OPENED', { sessionId: command.sessionId, studentId: command.studentId || null });
        return;
      }

      if (command.type === 'open_presentation') {
        const prepared = await this.preparePresentation(command.sessionId, command.studentId);
        await this.openPresentationFullscreen(prepared, command);
        await this.updatePresentation(command.sessionId, command.studentId, {
          status: 'presenting',
          lastOpenedAt: this.firebase.serverTimestamp()
        });
        await this.setCommandStatus(commandId, 'done');
        await this.addEvent('PRESENTATION_OPENED', { sessionId: command.sessionId, studentId: command.studentId });
        return;
      }

      throw new Error(`Unknown command type: ${command.type}`);
    } catch (error) {
      await this.setCommandStatus(commandId, 'error', { errorMessage: error.message });
      await this.addEvent('COMMAND_ERROR', { commandId, commandType: command.type, errorMessage: error.message });
      throw error;
    }
  }

  isStaleCommand(command) {
    const createdAt = command.createdAt;
    let createdMs = 0;
    if (createdAt?.toDate) createdMs = createdAt.toDate().getTime();
    else if (createdAt instanceof Date) createdMs = createdAt.getTime();
    else if (typeof createdAt === 'string') createdMs = Date.parse(createdAt);
    if (!Number.isFinite(createdMs) || createdMs <= 0) return false;
    return Date.now() - createdMs > 5 * 60 * 1000;
  }

  async updatePresentation(sessionId, studentId, extra) {
    const { doc, setDoc, serverTimestamp } = this.firebase;
    const id = `${sessionId}_${studentId}`;
    await setDoc(doc(this.db, 'dek_presentations', id), {
      sessionId,
      studentId,
      stationId: this.stationId,
      updatedAt: serverTimestamp(),
      ...extra
    }, { merge: true });
  }

  async updateAppStateAfterUpload(payload, processed = {}) {
    const { doc, getDoc, setDoc, serverTimestamp } = this.firebase;
    const stateRef = doc(this.db, APP_STATE_COLLECTION, APP_STATE_DOC);
    const snapshot = await getDoc(stateRef);
    const base = snapshot.exists() && snapshot.data()?.state
      ? { ...emptyAppState(), ...snapshot.data().state }
      : emptyAppState();
    const now = nowIso();
    const presentationId = `${payload.sessionId}_${payload.studentId}`;
    const existingStudent = base.students.find((student) => student.id === payload.studentId);
    const currentQueue = base.queue.filter((item) => item.sessionId === payload.sessionId);
    const existingQueueItem = base.queue.find((item) => item.sessionId === payload.sessionId && item.studentId === payload.studentId);
    const queuePosition = existingQueueItem?.position || Math.max(0, ...currentQueue.map((item) => Number(item.position) || 0)) + 1;
    const presentationStatus = processed.status || 'ready';
    const presentation = {
      id: presentationId,
      sessionId: payload.sessionId,
      studentId: payload.studentId,
      fileName: payload.storedName || payload.fileName,
      originalFileName: payload.fileName,
      fileSize: payload.size || 0,
      mimeType: 'application/octet-stream',
      extension: payload.format,
      version: 1,
      status: presentationStatus,
      uploadedAt: now,
      localOnly: true,
      convertedPdfReady: processed.convertedPdfReady === true || payload.format === 'pdf',
      error: processed.errorMessage
    };
    const next = {
      ...base,
      activeSessionId: base.activeSessionId || payload.sessionId,
      students: base.students.map((student) => student.id === payload.studentId ? {
        ...student,
        registrationStatus: 'registered',
        registeredAt: student.registeredAt || now,
        presentationStatus,
        queuePosition,
        wantsZoomDemo: payload.wantsZoomDemo === true || student.wantsZoomDemo === true,
        hasVideo: Boolean(payload.video) || student.hasVideo === true,
        updatedAt: now
      } : student),
      presentations: [
        ...base.presentations.filter((item) => item.id !== presentationId && item.studentId !== payload.studentId),
        presentation
      ],
      queue: existingQueueItem
        ? base.queue.map((item) => item.id === existingQueueItem.id ? { ...item, position: queuePosition, updatedAt: now } : item)
        : [...base.queue, {
          id: uid('queue'),
          sessionId: payload.sessionId,
          studentId: payload.studentId,
          position: queuePosition,
          createdAt: now,
          updatedAt: now
        }],
      events: [{
        id: uid('event'),
        sessionId: payload.sessionId,
        type: 'PRESENTATION_UPLOADED',
        actor: 'student',
        message: `Презентацію завантажено в Electron Agent: ${existingStudent?.fullName || payload.studentId}`,
        payload: { studentId: payload.studentId, fileName: payload.fileName, videoFileName: payload.video?.fileName || null, wantsZoomDemo: payload.wantsZoomDemo === true, stationId: this.stationId },
        createdAt: now
      }, ...base.events].slice(0, 1000)
    };

    await setDoc(stateRef, {
      state: withoutUndefined(next),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  async onUploaded(payload) {
    const isPdf = payload.format === 'pdf';
    await this.updatePresentation(payload.sessionId, payload.studentId, {
      fileName: payload.fileName,
      storedName: payload.storedName,
      format: payload.format,
      size: payload.size,
      localPathHint: payload.storedName,
      localOnly: true,
      status: isPdf ? 'ready' : 'converting',
      uploadedAt: this.firebase.serverTimestamp(),
      convertedPdfReady: isPdf
    });
    await this.addEvent('PRESENTATION_UPLOADED_LOCAL', {
      sessionId: payload.sessionId,
      studentId: payload.studentId,
      fileName: payload.fileName,
      format: payload.format,
      size: payload.size
    });
    this.sendToRenderer('presentation-uploaded', payload);
    if (isPdf) {
      const processed = { status: 'ready', convertedPdfReady: true };
      await this.updateAppStateAfterUpload(payload, processed);
      return processed;
    }

    if (!isPdf) {
      try {
        const prepared = await this.preparePresentation(payload.sessionId, payload.studentId);
        const convertedPdfName = prepared.kind === 'pdf' ? path.basename(prepared.path) : null;
        await this.updatePresentation(payload.sessionId, payload.studentId, {
          status: 'ready',
          convertedPdfReady: prepared.kind === 'pdf',
          directOpenFallback: prepared.kind !== 'pdf',
          convertedPdfName,
          convertedAt: this.firebase.serverTimestamp()
        });
        await this.addEvent('PRESENTATION_CONVERTED_LOCAL', {
          sessionId: payload.sessionId,
          studentId: payload.studentId,
          fileName: payload.fileName,
          convertedPdfName,
          directOpenFallback: prepared.kind !== 'pdf'
        });
        this.sendToRenderer('presentation-converted', { ...payload, convertedPdfName, directOpenFallback: prepared.kind !== 'pdf' });
        const processed = { status: 'ready', convertedPdfReady: prepared.kind === 'pdf', convertedPdfName, directOpenFallback: prepared.kind !== 'pdf', errorMessage: prepared.conversionError };
        await this.updateAppStateAfterUpload(payload, processed);
        return processed;
      } catch (error) {
        await this.updatePresentation(payload.sessionId, payload.studentId, {
          status: 'ready',
          convertedPdfReady: false,
          directOpenFallback: true,
          errorMessage: error.message
        });
        await this.addEvent('PRESENTATION_CONVERSION_ERROR', {
          sessionId: payload.sessionId,
          studentId: payload.studentId,
          fileName: payload.fileName,
          errorMessage: error.message
        });
        this.sendToRenderer('agent-error', { error: error.message });
        const processed = { status: 'ready', convertedPdfReady: false, directOpenFallback: true, errorMessage: error.message };
        await this.updateAppStateAfterUpload(payload, processed);
        return processed;
      }
    }
  }

  async preparePresentation(sessionId, studentId) {
    const dir = getStudentPresentationDir(sessionId, studentId);
    const files = fs.readdirSync(dir)
      .map((name) => ({ name, full: path.join(dir, name), stat: fs.statSync(path.join(dir, name)) }))
      .filter((item) => item.stat.isFile())
      .filter((item) => !item.name.startsWith('~$') && !item.name.endsWith('.tmp') && !item.name.endsWith('.crdownload'))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (!files.length) throw new Error('Локальний файл презентації не знайдено на ПК захисту');

    const source = files.find((item) => ['.pptx', '.ppt', '.odp', '.pdf'].includes(path.extname(item.name).toLowerCase()));
    if (!source) throw new Error('Не знайдено підтримуваний файл презентації');

    const ext = path.extname(source.name).toLowerCase();
    if (ext === '.pdf') {
      await this.updatePresentation(sessionId, studentId, {
        status: 'ready',
        convertedPdfReady: true,
        convertedPdfName: source.name
      });
      return { kind: 'pdf', path: source.full, sourcePath: source.full, extension: '.pdf' };
    }

    await this.updatePresentation(sessionId, studentId, {
      status: 'ready',
      convertedPdfReady: false,
      directOpenFallback: true,
      sourceFileName: source.name
    });
    return { kind: 'source', path: source.full, sourcePath: source.full, extension: ext };
  }
}

module.exports = { FirestoreAgent };
