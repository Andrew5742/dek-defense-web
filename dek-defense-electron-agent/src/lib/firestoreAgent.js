const path = require('path');
const fs = require('fs');
const { shell } = require('electron');
const { convertToPdf } = require('./converter');
const { getStudentPresentationDir, ensureDir } = require('./paths');

class FirestoreAgent {
  constructor({ firebase, stationId, stationName, uploadUrl, zoomUrl, sendToRenderer, openPdfFullscreen, openDisplayFullscreen }) {
    this.firebase = firebase;
    this.db = firebase.db;
    this.stationId = stationId;
    this.stationName = stationName;
    this.uploadUrl = uploadUrl;
    this.zoomUrl = zoomUrl;
    this.sendToRenderer = sendToRenderer;
    this.openPdfFullscreen = openPdfFullscreen;
    this.openDisplayFullscreen = openDisplayFullscreen;
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
    await this.setCommandStatus(commandId, 'running');
    this.sendToRenderer('command-running', { commandId, command });

    try {
      if (command.type === 'start_defense_display') {
        this.openDisplayFullscreen(command);
        await this.setCommandStatus(commandId, 'done');
        await this.addEvent('DISPLAY_STARTED', { sessionId: command.sessionId });
        return;
      }

      if (command.type === 'open_zoom') {
        await shell.openExternal(command.zoomUrl || this.zoomUrl || 'zoommtg://zoom.us/join');
        await this.setCommandStatus(commandId, 'done');
        await this.addEvent('ZOOM_OPENED', { sessionId: command.sessionId, studentId: command.studentId || null });
        return;
      }

      if (command.type === 'open_presentation') {
        const pdfPath = await this.preparePresentation(command.sessionId, command.studentId);
        this.openPdfFullscreen(pdfPath, command);
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

  async onUploaded(payload) {
    await this.updatePresentation(payload.sessionId, payload.studentId, {
      fileName: payload.fileName,
      storedName: payload.storedName,
      format: payload.format,
      size: payload.size,
      localPathHint: payload.storedName,
      localOnly: true,
      status: payload.format === 'pdf' ? 'ready' : 'conversion_required',
      uploadedAt: this.firebase.serverTimestamp()
    });
    await this.addEvent('PRESENTATION_UPLOADED_LOCAL', {
      sessionId: payload.sessionId,
      studentId: payload.studentId,
      fileName: payload.fileName,
      format: payload.format,
      size: payload.size
    });
    this.sendToRenderer('presentation-uploaded', payload);
  }

  async preparePresentation(sessionId, studentId) {
    const dir = getStudentPresentationDir(sessionId, studentId);
    const files = fs.readdirSync(dir)
      .map((name) => ({ name, full: path.join(dir, name), stat: fs.statSync(path.join(dir, name)) }))
      .filter((item) => item.stat.isFile())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (!files.length) throw new Error('Локальний файл презентації не знайдено на ПК захисту');

    const latestPdf = files.find((item) => path.extname(item.name).toLowerCase() === '.pdf');
    const latestOriginal = files.find((item) => ['.pptx', '.ppt', '.odp', '.pdf'].includes(path.extname(item.name).toLowerCase()));
    const source = latestPdf || latestOriginal;
    if (!source) throw new Error('Не знайдено підтримуваний файл презентації');

    if (path.extname(source.name).toLowerCase() === '.pdf') return source.full;

    const convertedDir = ensureDir(path.join(dir, 'converted'));
    await this.updatePresentation(sessionId, studentId, { status: 'converting' });
    const pdfPath = await convertToPdf(source.full, convertedDir);
    await this.updatePresentation(sessionId, studentId, {
      status: 'ready',
      convertedPdfName: path.basename(pdfPath),
      convertedAt: this.firebase.serverTimestamp()
    });
    return pdfPath;
  }
}

module.exports = { FirestoreAgent };
