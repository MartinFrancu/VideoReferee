import { X509Certificate } from 'node:crypto';

import { beforeAll, describe, expect, test } from 'vitest';

import { certificateFor } from './cert.js';

/**
 * What a phone demands of a certificate before it will talk to the hub at all.
 *
 * These are not opinions about good practice. Since iOS 13 they are conditions
 * Safari checks before the handshake completes, and a certificate that fails
 * one is refused outright — no warning page, no "proceed anyway", just a closed
 * connection that reads as a broken network. Android is far more forgiving,
 * which is exactly why this went unnoticed.
 */
describe('the certificate the phones connect through', () => {
  let certificate: X509Certificate;

  beforeAll(async () => {
    const { cert } = await certificateFor(['192.168.1.3', '10.0.0.7']);
    certificate = new X509Certificate(cert);
  }, 30_000);

  /**
   * The one that broke it. A TLS server certificate must say that is what it
   * is, and `selfsigned` drops its own default extensions — this one among
   * them — the moment any extension is supplied to add the addresses.
   */
  test('says it is for authenticating a server', () => {
    // id-kp-serverAuth.
    expect(certificate.keyUsage).toContain('1.3.6.1.5.5.7.3.1');
  });

  test('is an end-entity certificate that may sign a handshake', () => {
    expect(certificate.ca).toBe(false);
    expect(certificate.raw.length).toBeGreaterThan(0);
  });

  /**
   * A certificate naming the hub only in its CommonName lets a phone click
   * through the warning and then kills the connection anyway — the same
   * symptom, a different cause, and the reason the addresses are here at all.
   */
  test('names every address the hub can be reached on', () => {
    expect(certificate.subjectAltName).toContain('IP Address:192.168.1.3');
    expect(certificate.subjectAltName).toContain('IP Address:10.0.0.7');
    expect(certificate.subjectAltName).toContain('DNS:localhost');
    expect(certificate.subjectAltName).toContain('IP Address:127.0.0.1');
  });

  /**
   * Apple refuses anything valid for more than 398 days. A certificate made to
   * last ten years would be the obvious convenience — it is the one that cannot
   * be connected to.
   */
  test('expires inside the year that phones will accept', () => {
    const days = (certificate.validToDate.getTime() - certificate.validFromDate.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(90);
    expect(days).toBeLessThanOrEqual(398);
  });

  /**
   * The other floor Apple sets. The signature algorithm matters as much and is
   * asserted nowhere, because Node's certificate reader does not expose it and
   * reaching for openssl would cost this the Windows laptops it has to run on.
   */
  test('carries a key strong enough to be accepted: 2048-bit RSA', () => {
    expect(certificate.publicKey.asymmetricKeyType).toBe('rsa');
    expect(certificate.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });
});
