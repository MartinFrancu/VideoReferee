// Cross-platform replacement for `openssl` — generates a throwaway
// self-signed TLS cert so phones on the local network can reach this server
// over https:// (required for getUserMedia()/Wake Lock off localhost).
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const certDir = path.join(__dirname, 'certs');
fs.mkdirSync(certDir, { recursive: true });

const pems = selfsigned.generate([{ name: 'commonName', value: 'videoreferee-spike' }], {
  days: 365,
  keySize: 2048,
});

fs.writeFileSync(path.join(certDir, 'key.pem'), pems.private);
fs.writeFileSync(path.join(certDir, 'cert.pem'), pems.cert);
console.log('Wrote certs/key.pem and certs/cert.pem');
