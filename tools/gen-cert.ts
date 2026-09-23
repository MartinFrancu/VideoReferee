// Writes the certificate the phones connect through. What goes into it, and
// why each part is not optional, is in cert.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { certificateFor } from './cert.js';
import { localAddresses } from '../src/hub/network.js';

const CERT_DIR = fileURLToPath(new URL('../certs/', import.meta.url));
const addresses = localAddresses();

const { key, cert } = await certificateFor(addresses);

mkdirSync(CERT_DIR, { recursive: true });
writeFileSync(`${CERT_DIR}key.pem`, key);
writeFileSync(`${CERT_DIR}cert.pem`, cert);

console.log('Wrote certs/key.pem and certs/cert.pem');
console.log(`Covers: localhost, 127.0.0.1, ${addresses.join(', ') || '(no local address found)'}`);
console.log('Switching Wi-Fi networks changes your address — re-run this if phones stop connecting.');
