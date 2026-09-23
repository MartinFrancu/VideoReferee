// Making the throwaway TLS certificate the phones connect through.
//
// getUserMedia and Wake Lock only work in a secure context, so plain http on a
// LAN address silently refuses the camera. Pure Node, so it behaves the same on
// Windows without bash or openssl.
//
// Everything here is a condition a phone checks before the handshake completes.
// Fail one and iOS refuses the connection outright — no warning page, no
// "proceed anyway", just a closed connection that reads as a broken network.
// Android is far more forgiving, which is how a certificate missing half its
// extensions worked for a year.

import selfsigned from 'selfsigned';

/**
 * Apple will not accept a server certificate valid for longer than 398 days,
 * and a phone that refuses one gives no clue why. A year is comfortably inside
 * it and still outlasts any tournament season.
 */
const VALID_DAYS = 365;

/**
 * A certificate for a hub reachable at `addresses`.
 *
 * The extensions are given in full and on purpose. `selfsigned` supplies
 * sensible defaults — including the extended key usage that marks this as a
 * server certificate — but supplying *any* extension replaces the whole set, so
 * adding the addresses silently drops the rest. Listing them here is the only
 * way to have both.
 */
export async function certificateFor(
  addresses: readonly string[]
): Promise<{ key: string; cert: string }> {
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + VALID_DAYS * 86_400_000);

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'videoreferee.local' }], {
    notBeforeDate,
    notAfterDate,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      // An end-entity certificate: it terminates the chain, it does not issue.
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      // The one whose absence closed the connection. iOS 13 and later require a
      // TLS server certificate to say that is what it is.
      { name: 'extKeyUsage', serverAuth: true },
      // A certificate naming the hub only in its CommonName lets a phone click
      // through the warning and then kills the connection anyway.
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

  return { key: pems.private, cert: pems.cert };
}
