const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { createLocalServer } = require('../src/lib/localServer');

const port = Number(process.env.TEST_PORT || 3157);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dek-defense-load-'));
const calls = { display: 0, closeDisplay: 0, presentation: 0, closePresentation: 0, zoom: 0, upload: 0 };
let failPresentationOnce = true;
const server = createLocalServer({
  port,
  stationId: 'load-station',
  stationName: 'Load Test Agent',
  zoomUrl: 'https://zoom.test/meeting',
  storageRoot: root,
  sendToRenderer() {},
  async openDisplayFullscreen() { calls.display += 1; },
  async closeDisplayFullscreen() { calls.closeDisplay += 1; },
  async openPresentationFullscreen() {
    calls.presentation += 1;
    if (failPresentationOnce) {
      failPresentationOnce = false;
      throw new Error('Synthetic one-time presentation launch failure');
    }
  },
  async closePresentationFullscreen() { calls.closePresentation += 1; },
  async openZoom() { calls.zoom += 1; },
  async openUploadPage() { calls.upload += 1; }
});

const baseUrl = `http://127.0.0.1:${port}`;
const now = new Date().toISOString();

async function getState() {
  const response = await fetch(`${baseUrl}/api/state`);
  assert.equal(response.status, 200);
  return response.json();
}

async function saveState(state) {
  const response = await fetch(`${baseUrl}/api/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state)
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForCommand(id, expected = ['done', 'error'], timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const command = (await getState()).commands.find((item) => item.id === id);
    if (command && expected.includes(command.status)) return command;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Command ${id} did not finish`);
}

async function addCommand(type, studentId, version) {
  const state = await getState();
  const id = `cmd-${type}-${version}-${Date.now()}`;
  const command = {
    id,
    sessionId: 'session-1',
    studentId,
    type,
    targetStationId: 'load-station',
    zoomUrl: 'https://zoom.test/meeting',
    status: 'pending',
    commandVersion: version,
    dedupeKey: `${type}:session-1:${studentId || ''}:load-station`,
    attempt: 1,
    maxAttempts: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveState({ ...state, commands: [command, ...state.commands] });
  const result = await waitForCommand(id);
  assert.equal(result.status, 'done', result.humanError || result.error);
  return result;
}

(async () => {
  try {
    await server.start();
    const students = Array.from({ length: 64 }, (_, index) => ({
      id: `student-${index + 1}`,
      sessionId: 'session-1',
      groupId: 'group-1',
      groupName: 'ICT-TEST',
      fullName: `Student ${index + 1}`,
      thesisTitleOriginal: `Topic ${index + 1}`,
      thesisTitleEdited: `Topic ${index + 1}`,
      supervisorOriginal: 'Supervisor',
      supervisorEdited: 'Supervisor',
      isAllowedToRegister: true,
      defenseFormat: index % 5 === 0 ? 'online' : 'offline',
      registrationStatus: 'registered',
      presentationStatus: 'ready',
      defenseStatus: 'waiting',
      token: `token-${index + 1}`,
      createdAt: now,
      updatedAt: now
    }));
    const queue = students.map((student, index) => ({ id: `queue-${index + 1}`, sessionId: 'session-1', studentId: student.id, position: index + 1, createdAt: now, updatedAt: now }));
    const presentations = students.map((student) => ({
      id: `presentation-${student.id}`,
      sessionId: 'session-1', studentId: student.id, fileName: `${student.id}.pptx`, originalFileName: `${student.id}.pptx`,
      fileSize: 8, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: 'pptx', version: 1,
      status: 'ready', uploadedAt: now, localOnly: true
    }));
    for (const student of students) {
      const dir = path.join(root, 'sessions', 'session-1', 'presentations', student.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${student.id}.pptx`), 'test-pptx');
    }
    await saveState({
      activeSessionId: 'session-1', sessions: [{ id: 'session-1', title: 'Load Test', date: '2026-06-18', groupNames: ['ICT-TEST'], registrationOpenFrom: '08:00', registrationOpenTo: '09:00', defenseStartsAt: '09:05', zoomUrl: 'https://zoom.test/meeting', manualRegistrationOpen: true, isRegistrationLocked: false, publicToken: 'public', stationId: 'load-station', createdAt: now, updatedAt: now }],
      groups: [{ id: 'group-1', name: 'ICT-TEST', sessionId: 'session-1' }], students, presentations, queue, commands: [], stations: [], protocols: [], events: [], importReviews: []
    });

    const shared = await getState();
    await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const changedAt = new Date(Date.now() + index + 10).toISOString();
      const next = {
        ...shared,
        students: shared.students.map((student) => student.id === `student-${index + 1}`
          ? { ...student, notes: `Concurrent note ${index + 1}`, updatedAt: changedAt }
          : student)
      };
      await saveState(next);
    }));
    const merged = await getState();
    for (let index = 0; index < 12; index += 1) {
      assert.equal(merged.students.find((student) => student.id === `student-${index + 1}`).notes, `Concurrent note ${index + 1}`);
    }

    const sameStudentBase = await getState();
    const sameStudent = sameStudentBase.students.find((student) => student.id === 'student-20');
    await Promise.all([
      saveState({
        ...sameStudentBase,
        students: sameStudentBase.students.map((student) => student.id === sameStudent.id
          ? { ...student, notes: 'Simultaneous commission note', updatedAt: new Date(Date.now() + 50).toISOString() }
          : student)
      }),
      saveState({
        ...sameStudentBase,
        students: sameStudentBase.students.map((student) => student.id === sameStudent.id
          ? { ...student, defenseStatus: 'presenting', updatedAt: new Date(Date.now() + 51).toISOString() }
          : student)
      })
    ]);
    const sameStudentMerged = (await getState()).students.find((student) => student.id === sameStudent.id);
    assert.equal(sameStudentMerged.notes, 'Simultaneous commission note');
    assert.equal(sameStudentMerged.defenseStatus, 'presenting');

    const mobileStarted = performance.now();
    const mobileResponses = await Promise.all(students.map((student) => fetch(`${baseUrl}/api/mobile/${student.token}`).then((response) => response.json())));
    const mobileDuration = performance.now() - mobileStarted;
    assert.equal(mobileResponses.length, 64);
    assert.equal(mobileResponses[63].studentPage.queuePosition, 64);

    await addCommand('start_defense_display', undefined, 1);
    await addCommand('open_presentation', 'student-1', 2);
    await addCommand('show_display', undefined, 3);
    await addCommand('open_zoom', 'student-6', 4);
    await addCommand('open_upload_page', 'student-2', 5);
    await addCommand('set_current_student', 'student-3', 6);
    await addCommand('close_presentation', 'student-3', 7);

    const beforeDuplicate = await getState();
    const oldTime = new Date(Date.now() - 1000).toISOString();
    const newTime = new Date().toISOString();
    const duplicateKey = 'show_display:session-1::load-station';
    await saveState({ ...beforeDuplicate, commands: [
      { id: 'duplicate-new', sessionId: 'session-1', type: 'show_display', targetStationId: 'load-station', status: 'pending', commandVersion: 9, dedupeKey: duplicateKey, createdAt: newTime, updatedAt: newTime },
      { id: 'duplicate-old', sessionId: 'session-1', type: 'show_display', targetStationId: 'load-station', status: 'pending', commandVersion: 8, dedupeKey: duplicateKey, createdAt: oldTime, updatedAt: oldTime },
      ...beforeDuplicate.commands
    ] });
    assert.equal((await waitForCommand('duplicate-new')).status, 'done');
    const duplicateState = await getState();
    assert.equal(duplicateState.commands.find((command) => command.id === 'duplicate-old').status, 'cancelled');

    assert.ok(calls.display >= 3, `display calls: ${calls.display}`);
    assert.ok(calls.presentation >= 2, `presentation retry calls: ${calls.presentation}`);
    assert.ok(calls.closeDisplay >= 2, `close display calls: ${calls.closeDisplay}`);
    assert.ok(calls.closePresentation >= 3, `close presentation calls: ${calls.closePresentation}`);
    assert.equal(calls.zoom, 1);
    assert.equal(calls.upload, 1);
    assert.equal((await getState()).students.find((student) => student.id === 'student-3').defenseStatus, 'presenting');

    await addCommand('close_day', undefined, 10);
    assert.equal(fs.existsSync(path.join(root, 'sessions', 'session-1')), false);

    console.log(JSON.stringify({ ok: true, students: students.length, concurrentWriters: 14, sameStudentFieldMerge: true, mobileRequests: 64, mobileDurationMs: Math.round(mobileDuration), calls }, null, 2));
    if (process.env.KEEP_ALIVE === '1') {
      console.log(`Preview server: ${baseUrl}`);
      await new Promise((resolve) => process.once('SIGINT', resolve));
    }
  } finally {
    await server.stop().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
