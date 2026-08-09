// Can a phone actually get here?
//
// The hub is reached two ways at once: the operator opens it on the laptop it
// is running on, and the phones come across the Wi-Fi. Those are different
// addresses, and confusing them is silent — the laptop's own view keeps working
// perfectly while nothing else can connect.

/**
 * Strip the port.
 *
 * Only has to be exact for the things that can match a LAN address — IPv4 and
 * hostnames. An IPv6 literal comes out mangled and simply fails to match, which
 * is the right answer anyway: the addresses it is compared against are IPv4.
 */
function bareHost(host: string): string {
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * The address to put in a camera's join URL.
 *
 * Built from what the hub knows about itself rather than from the request,
 * because the natural thing for an operator to do — open the hub at localhost
 * on the laptop — produces a QR pointing every phone at *itself*. The operator
 * screen carries on working, so the only symptom is that no camera ever joins.
 *
 * An operator who reached the hub by a real address keeps it: with two networks
 * on one laptop, the one they typed is the one they meant.
 */
export function joinHost({
  requestHost,
  addresses,
  port,
}: {
  readonly requestHost: string | undefined;
  readonly addresses: readonly string[];
  readonly port: number;
}): string {
  // One test covers every case: a phone can use this host only if it is one of
  // the addresses this machine answers to on the network. `localhost`, the
  // loopback address and the laptop's own hostname all fail it, because none of
  // them is a LAN address.
  const asked = requestHost === undefined ? undefined : bareHost(requestHost);
  if (asked !== undefined && addresses.includes(asked)) return `${asked}:${port}`;

  if (addresses.length > 0) return `${addresses[0]}:${port}`;

  // Nothing better to offer. Better a URL that at least works on this machine
  // than one built from a guess.
  return requestHost ?? `localhost:${port}`;
}

/**
 * The names a certificate is good for.
 *
 * `X509Certificate.subjectAltName` hands back one string, formatted like
 * `DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.1.3`.
 */
export function certificateNames(subjectAltName: string | undefined): string[] {
  if (!subjectAltName) return [];
  return subjectAltName
    .split(',')
    .map((entry) => entry.trim().replace(/^(DNS|IP Address|URI|email):/, ''))
    .filter((name) => name.length > 0);
}

/**
 * Which of this laptop's addresses the certificate does not name.
 *
 * A phone stores its "accept this certificate" decision against the address it
 * visited. Move to another network and the new address is a different site to
 * it, so every phone is asked again — which is worth warning about before the
 * phones are handed out rather than after.
 */
export function uncoveredAddresses({
  addresses,
  subjectAltName,
}: {
  readonly addresses: readonly string[];
  readonly subjectAltName: string | undefined;
}): string[] {
  // Unreadable is not the same as mismatched; do not cry wolf.
  if (!subjectAltName) return [];
  const covered = new Set(certificateNames(subjectAltName));
  return addresses.filter((address) => !covered.has(address));
}
