import { describe, expect, it } from 'vitest';
import { join, win32 } from 'node:path';

import { resolveStaticPath } from './static-path.js';

const ROOTS = { web: join('/srv', 'web'), operator: join('/srv', 'web', 'operator', 'dist', 'browser') };

const resolve = (pathname: string) => resolveStaticPath(pathname, ROOTS);

describe('resolveStaticPath', () => {
  it('finds a file under the web root', () => {
    expect(resolve('/camera/camera.js')).toEqual({
      root: ROOTS.web,
      file: join(ROOTS.web, 'camera', 'camera.js'),
      underOperator: false,
    });
  });

  it('serves the index of a directory asked for with a trailing slash', () => {
    expect(resolve('/camera/')?.file).toBe(join(ROOTS.web, 'camera', 'index.html'));
  });

  // The operator screen is a built Angular bundle, not a file in web/.
  it('routes /operator/ to the built bundle rather than the web root', () => {
    const target = resolve('/operator/');
    expect(target?.underOperator).toBe(true);
    expect(target?.file).toBe(join(ROOTS.operator, 'index.html'));
  });

  it('routes the bundle assets too', () => {
    expect(resolve('/operator/main-A1B2.js')?.file).toBe(join(ROOTS.operator, 'main-A1B2.js'));
  });

  // Without a trailing slash the target is the directory itself. The caller
  // redirects rather than serving it: a page delivered at /operator would
  // resolve its relative asset paths one level too high.
  it('leaves a directory asked for without a trailing slash as the directory', () => {
    expect(resolve('/operator')?.file).toBe(ROOTS.operator);
  });

  // "operator" has to be a whole segment. Matching a raw prefix would send
  // /operators-guide.html into the bundle.
  it('only treats a whole segment as the operator prefix', () => {
    expect(resolve('/operators-guide.html')?.root).toBe(ROOTS.web);
  });

  it('collapses empty and current-directory segments', () => {
    expect(resolve('//camera///./camera.js')?.file).toBe(join(ROOTS.web, 'camera', 'camera.js'));
  });

  describe('refuses to leave its root', () => {
    it('on a parent segment', () => {
      expect(resolve('/../certs/key.pem')).toBeNull();
      expect(resolve('/camera/../../certs/key.pem')).toBeNull();
    });

    // Even one that would land back inside. Browsers resolve ".." before
    // sending, and so does `new URL`, so one arriving here is anomalous — and
    // this is not the place to be clever about anomalies.
    it('on a parent segment that would stay inside the root', () => {
      expect(resolve('/camera/../camera.js')).toBeNull();
    });

    it('on a percent-encoded parent segment', () => {
      expect(resolve('/%2e%2e/certs/key.pem')).toBeNull();
    });

    // A segment is one path element. Anything that a filesystem would read as a
    // separator has to be rejected, not passed through — on Windows join()
    // treats a backslash as a separator, so %5C would climb out of the root.
    it('on a separator smuggled into a segment', () => {
      expect(resolve('/camera/%2F..%2Fkey.pem')).toBeNull();
      expect(resolve('/camera/..%5Ckey.pem')).toBeNull();
    });

    it('on a NUL byte', () => {
      expect(resolve('/camera/camera.js%00.png')).toBeNull();
    });

    it('on undecodable escapes', () => {
      expect(resolve('/camera/%ZZ')).toBeNull();
    });
  });
});

/**
 * The hub is developed on Linux and run on a Windows laptop at the tournament,
 * so the platform it breaks on is the one no test can reach. `node:path` ships
 * the Windows implementation everywhere, which closes that gap.
 *
 * The bug this pins: routing used to run `path.normalize` over the URL, which
 * on Windows rewrites "/operator/" as "\operator\". That matched no route, so
 * the request fell through to the web root and resolved to the *directory*
 * web/operator — and reading a directory is an EISDIR that killed the hub on
 * its first page load.
 */
describe('resolveStaticPath on Windows', () => {
  const roots = {
    web: String.raw`C:\Users\Marci\gitrepos\VideoReferee\web`,
    operator: String.raw`C:\Users\Marci\gitrepos\VideoReferee\web\operator\dist\browser`,
  };
  const resolveOnWindows = (pathname: string) => resolveStaticPath(pathname, roots, win32);

  it('still routes /operator/ to the bundle, and to a file rather than a directory', () => {
    const target = resolveOnWindows('/operator/');
    expect(target?.underOperator).toBe(true);
    expect(target?.file).toBe(String.raw`${roots.operator}\index.html`);
  });

  it('builds asset paths with Windows separators', () => {
    expect(resolveOnWindows('/camera/camera.js')?.file).toBe(String.raw`${roots.web}\camera\camera.js`);
  });

  // On Windows a backslash is a separator, so this would otherwise climb out.
  it('refuses a backslash smuggled through an escape', () => {
    expect(resolveOnWindows('/camera/..%5C..%5Ccerts%5Ckey.pem')).toBeNull();
  });
});
