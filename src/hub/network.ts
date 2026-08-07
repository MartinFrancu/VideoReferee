import { networkInterfaces } from 'node:os';

/**
 * Every address this machine can be reached at from the local network.
 *
 * A laptop on Wi-Fi with a VPN or a virtual adapter has several, and only one of
 * them is on the subnet the phones are on — so we print them all and let the
 * person running it pick.
 */
export function localAddresses(): string[] {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) found.push(address.address);
    }
  }
  return found;
}
