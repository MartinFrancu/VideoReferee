// Makes the throwaway TLS certificate the phones will connect through.
//
// getUserMedia and Wake Lock only work in a secure context, so plain http on a
// LAN address silently refuses the camera. Pure Node, so it behaves the same on
// Windows without bash or openssl.
//
// The certificate must carry every local address as a Subject Alternative Name:
// iOS Safari lets you click through the warning for a CommonName-only cert and
// then kills the connection anyway, which reads as a network fault rather than a
// certificate problem.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import selfsigned from 'selfsigned';

import { localAddresses } from '../src/hub/network.js';

const CERT_DIR = fileURLToPath(new URL('../certs/', import.meta.url));
const addresses = localAddresses();

const pems = await selfsigned.generate([{ name: 'commonName', value: 'videoreferee.local' }], {
  days: 3650,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        ...addresses.map((ip) => ({ type: 7 as const, ip })),
      ],
    },
  ],
});

mkdirSync(CERT_DIR, { recursive: true });
writeFileSync(`${CERT_DIR}key.pem`, pems.private);
writeFileSync(`${CERT_DIR}cert.pem`, pems.cert);

console.log('Wrote certs/key.pem and certs/cert.pem');
console.log(`Covers: localhost, 127.0.0.1, ${addresses.join(', ') || '(no local address found)'}`);
console.log('Switching Wi-Fi networks changes your address — re-run this if phones stop connecting.');
