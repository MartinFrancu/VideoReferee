// Turning a URL into a filename, without letting either one lie about the other.
//
// A URL path is always POSIX-shaped and always uses "/". A filesystem path is
// whatever the host says it is. `path.normalize` belongs to the second world,
// so running it over a URL is a category error: on Windows it rewrites
// "/operator/" as "\operator\", which then matches no route and resolves to a
// directory. So parse the URL as a URL, and only then hand whole, checked
// segments to `join`.
import * as nodePath from 'node:path';

/**
 * Just the parts of `node:path` this needs. Injectable so the Windows
 * behaviour can be tested from anywhere: this bug shipped because the hub had
 * only ever run on Linux, and no test could see the other platform.
 */
export type PathFlavour = Pick<typeof nodePath, 'join' | 'sep'>;

export interface StaticRoots {
  /** Plain files served as they are: the camera page and its assets. */
  readonly web: string;
  /** The operator screen, as built by `ng build`. */
  readonly operator: string;
}

export interface StaticTarget {
  readonly root: string;
  readonly file: string;
  readonly underOperator: boolean;
}

/** A segment must be exactly one path element, and must not climb. */
function decodeSegment(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (decoded === '..') return null;
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) return null;
  return decoded;
}

/**
 * Where on disk `pathname` lives, or null if it does not live under a root.
 *
 * A pathname ending in "/" asks for that directory's index. One that does not
 * resolves to the directory itself — the caller redirects, because a page
 * served at "/operator" would resolve its relative assets one level too high.
 */
export function resolveStaticPath(
  pathname: string,
  roots: StaticRoots,
  path: PathFlavour = nodePath
): StaticTarget | null {
  const segments: string[] = [];
  for (const raw of pathname.split('/')) {
    if (raw === '' || raw === '.') continue;
    const segment = decodeSegment(raw);
    if (segment === null) return null;
    if (segment === '.') continue;
    segments.push(segment);
  }

  const underOperator = segments[0] === 'operator';
  const root = underOperator ? roots.operator : roots.web;
  const rest = underOperator ? segments.slice(1) : segments;
  if (pathname.endsWith('/')) rest.push('index.html');

  const file = rest.length ? path.join(root, ...rest) : root;
  // Belt and braces: no segment can climb, so this cannot fail — but the cost
  // of being wrong here is handing out the private key.
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return { root, file, underOperator };
}
