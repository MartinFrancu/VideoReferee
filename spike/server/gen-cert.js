// Cross-platform replacement for `openssl` — generates a throwaway
// self-signed TLS cert so phones on the local network can reach this server
// over https:// (required for getUserMedia()/Wake Lock off localhost).
//
// Crucially includes a Subject Alternative Name (SAN) for every local IPv4
// address: iOS Safari silently kills the connection ("network connection
// was lost") right after you accept the warning if the cert only has a
// CommonName and no SAN — it doesn't just warn, it refuses the connection.
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

function getLocalIPs() {
  const ips = new Set(['127.0.0.1']);
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.add(addr.address);
    }
  }
  return [...ips];
}

const certDir = path.join(__dirname, 'certs');
fs.mkdirSync(certDir, { recursive: true });

const ips = getLocalIPs();
const altNames = [
  { type: 2, value: 'localhost' }, // DNS
  ...ips.map((ip) => ({ type: 7, ip })), // IP
];

const pems = selfsigned.generate([{ name: 'commonName', value: 'videoreferee-spike' }], {
  days: 365,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: false },
    { name: 'subjectAltName', altNames },
  ],
});

fs.writeFileSync(path.join(certDir, 'key.pem'), pems.private);
fs.writeFileSync(path.join(certDir, 'cert.pem'), pems.cert);
console.log('Wrote certs/key.pem and certs/cert.pem');
console.log('Certificate covers: localhost, ' + ips.join(', '));
console.log('If you switch Wi-Fi networks (your IP changes), re-run `npm run gen-cert`.');
