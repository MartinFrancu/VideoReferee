// Which build is this?
//
// Read from `package.json` and nowhere else. The version appears on the
// operator screen, on every phone, in the hub's console, on every response and
// inside every saved session — all of which would be a place to forget to
// change if any of them held their own copy.

/** The version in a package manifest, or "unknown" if it cannot be read. */
export function versionFrom(packageJson: unknown): string {
  if (typeof packageJson !== 'object' || packageJson === null || Array.isArray(packageJson)) {
    return 'unknown';
  }
  const version = (packageJson as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : 'unknown';
}
