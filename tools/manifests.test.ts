import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The four manifests a chunk has to bump, and what a careless bump can break.
 *
 * Every chunk raises the patch version in all four by hand. That is a search
 * and replace across two `package.json` files and two lockfiles, and a lockfile
 * is full of other packages' versions — three of which had already been dragged
 * up to ours before this test existed.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(root + name, 'utf8'));

const MANIFESTS = [
  'package.json',
  'package-lock.json',
  'web/operator/package.json',
  'web/operator/package-lock.json',
] as const;

const LOCKFILES = ['package-lock.json', 'web/operator/package-lock.json'] as const;

interface Lockfile {
  version: string;
  packages: Record<string, { version?: string; resolved?: string }>;
}

describe('the manifests a version bump touches', () => {
  it('all agree on which version this is', () => {
    const versions = MANIFESTS.map((name) => [name, read(name).version as string] as const);
    const [, first] = versions[0]!;
    for (const [name, version] of versions) expect([name, version]).toEqual([name, first]);
  });

  it('states its own version once per lockfile, in both places it is recorded', () => {
    for (const name of LOCKFILES) {
      const lock = read(name) as Lockfile;
      expect([name, lock.packages['']?.version]).toEqual([name, lock.version]);
    }
  });

  /**
   * A dependency's version and the tarball it was resolved from have to be the
   * same version. They stop agreeing the moment a bump replaces every version
   * that happens to read like ours — `stackback` and `typedarray` were both
   * carried from their own 0.0.x up to this project's.
   */
  it('leaves every other package saying the version it actually resolved', () => {
    const wrong: string[] = [];
    for (const name of LOCKFILES) {
      for (const [pkg, entry] of Object.entries((read(name) as Lockfile).packages)) {
        const inTarball = /-(\d+\.\d+\.\d+[^/]*)\.tgz$/.exec(entry.resolved ?? '')?.[1];
        if (inTarball && entry.version !== inTarball) {
          wrong.push(`${name}: ${pkg} says ${entry.version}, resolved ${inTarball}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
