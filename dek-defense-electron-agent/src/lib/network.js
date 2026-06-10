const os = require('os');

function getLocalIPv4Addresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        if (/virtual|vmware|vbox|loopback|docker|wsl/i.test(name)) continue;
        results.push({ name, address: net.address });
      }
    }
  }
  return results;
}

function getPreferredLocalAddress() {
  const addresses = getLocalIPv4Addresses();
  return addresses[0]?.address || '127.0.0.1';
}

module.exports = { getLocalIPv4Addresses, getPreferredLocalAddress };
