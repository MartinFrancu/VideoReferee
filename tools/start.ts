// Everything that has to be true before the hub is useful, checked in order.
//
// This exists because the failure it prevents is silent. `tsx src/hub/server.ts`
// starts a perfectly healthy hub serving whatever operator bundle was last
// built — so new code arrives, the screen does not change, and nothing says so.
// A tournament is the wrong place to discover that.
//
// Each step prints what it is doing and why, so a run that goes wrong says
// where. Run `npm run start:hub` instead to skip all of it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localAddresses } from '../src/hub/network.js';
import { uncoveredAddresses } from '../src/hub/reachability.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CERT = join(ROOT, 'certs', 'cert.pem');
const OPERATOR = join(ROOT, 'web', 'operator');

/** Node's own major version, so an ancient one is caught before anything else. */
const NEEDED_NODE = 20;

function say(step: string, detail: string): void {
  console.log(`\n[${step}] ${detail}`);
}

/** Run a command, and stop the whole thing if it fails. Output goes straight through. */
function run(command: string, args: string[], cwd = ROOT): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`\n  ${command} ${args.join(' ')} failed. Nothing was started.`);
    process.exit(1);
  }
}

// ---- 1. a Node that can run this ---------------------------------------------
const major = Number(process.versions.node.split('.')[0]);
if (major < NEEDED_NODE) {
  console.error(`VideoReferee needs Node ${NEEDED_NODE} or newer. This is ${process.versions.node}.`);
  process.exit(1);
}

// ---- 2. the operator screen's own dependencies -------------------------------
// Its own npm project, so a fresh clone has nothing there. Only installed when
// missing: this is the one step that needs the internet, and a venue may not
// have any.
if (!existsSync(join(OPERATOR, 'node_modules'))) {
  say('setup', 'installing the operator screen’s dependencies (needs internet, once)');
  run('npm', ['--prefix', 'web/operator', 'install']);
}

// ---- 3. a certificate that covers this network -------------------------------
// Phones refuse a certificate that does not name the address they connect to,
// and the address changes with the network. Regenerating costs a second.
const addresses = localAddresses();
let certificateReason: string | null = null;

if (!existsSync(CERT)) {
  certificateReason = 'there is no certificate yet';
} else {
  try {
    const { subjectAltName } = new X509Certificate(readFileSync(CERT));
    const missing = uncoveredAddresses({ addresses, subjectAltName });
    if (missing.length > 0) certificateReason = `it does not cover ${missing.join(', ')}`;
  } catch {
    certificateReason = 'the existing one could not be read';
  }
}

if (certificateReason) {
  say('setup', `making a certificate — ${certificateReason}`);
  run('npx', ['tsx', 'tools/gen-cert.ts']);
  console.log('  Every phone will be asked to accept this certificate once.');
}

// ---- 4. the operator screen, built from the source that is here now ----------
say('build', 'building the operator screen (~6s, so the page always matches the code)');
run('npm', ['--prefix', 'web/operator', 'run', 'build']);

// ---- 5. go --------------------------------------------------------------------
say('start', 'starting the hub — leave this window open for the whole event');
run('npx', ['tsx', 'src/hub/server.ts']);
