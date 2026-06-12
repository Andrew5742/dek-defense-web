const logEl = document.getElementById('log');
function log(message, payload) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<strong>${new Date().toLocaleTimeString()}</strong> ${message}`;
  if (payload) {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(payload, null, 2);
    line.appendChild(pre);
  }
  logEl.prepend(line);
}

async function init() {
  const status = await window.dekAgent.getStatus();
  document.getElementById('stationId').textContent = status.stationId;
  document.getElementById('stationName').textContent = status.stationName;
  document.getElementById('uploadUrl').textContent = status.uploadUrl;
  document.getElementById('storageRoot').textContent = status.storageRoot;
  document.getElementById('addresses').textContent = status.addresses.map((x) => `${x.name}: ${x.address}`).join(', ') || '—';
  log('Агент запущено', status);
}

window.dekAgent.on('agent-ready', (payload) => log('Firebase/Upload готові', payload));
window.dekAgent.on('agent-error', (payload) => log('Помилка агента', payload));
window.dekAgent.on('command-running', (payload) => log(`Команда: ${payload.command?.type}`, payload.command));
window.dekAgent.on('presentation-uploaded', (payload) => log('Презентацію завантажено локально', payload));
window.dekAgent.on('presentation-converted', (payload) => log('Презентацію сконвертовано у PDF', payload));

document.getElementById('openStorageBtn').addEventListener('click', () => window.dekAgent.openStorage());
init().catch((error) => log('Помилка запуску UI', { error: error.message }));
