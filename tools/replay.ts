// Re-run a bookmark the hub has already answered, from what it was answered with.
//
//   npm run replay -- captures/2026-08-12T20-22-08-520_1f420bb6_872356a4.json
//
// Prints what the hub decided at the time, and — when the upload itself was
// kept — decides it again here and now, through the same code the hub runs.
// Two things make that worth doing. A clip that came out wrong becomes a case
// that can be re-run in milliseconds with no phone, no browser and no Wi-Fi;
// and a difference between then and now is a change this build made to the
// answer, which is the one thing a regression test is for.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { cutClipForBookmark } from '../src/core/alignment.js';
import type { CaptureRecord } from '../src/core/capture.js';
import { readClusters, readInitSegment, readVideoTrackNumber } from '../src/core/media/webm.js';
import { estimateClock } from '../src/core/timeline/clock.js';
import { estimateMediaOrigin, originSamples } from '../src/core/timeline/media-origin.js';
import type { UploadHeader } from '../src/core/protocol.js';

const given = process.argv[2];
if (!given) {
  console.error('Usage: npm run replay -- captures/<capture>.json');
  process.exit(1);
}

const recordPath = given.endsWith('.bin') ? `${given.slice(0, -4)}.json` : given;
if (!existsSync(recordPath)) {
  console.error(`No capture at ${recordPath}`);
  process.exit(1);
}

const record = JSON.parse(readFileSync(recordPath, 'utf8')) as CaptureRecord;
const ms = (value: number) => `${value.toFixed(0)}ms`;

console.log(`\n  ${basename(recordPath)}`);
console.log(`  captured ${record.capturedAt} by version ${record.version}\n`);
console.log(`  bookmark   ${record.bookmark.id.slice(0, 8)} at ${record.bookmark.sessionMs} (session time)`);
console.log(`  camera     ${record.camera.name || '(unnamed)'} ${record.camera.id.slice(0, 8)}`);
console.log(
  `  settings   pre-roll ${ms(record.settings.preRollMs)}, post-roll ${ms(record.settings.postRollMs)}, ` +
    `ring ${ms(record.settings.ringWindowMs)}`
);
console.log(
  `  upload     ${(record.upload.bytes / 1024 / 1024).toFixed(2)}MB — ` +
    `prefix ${record.upload.prefixLength}, run ${record.upload.runLength}, ` +
    `${record.upload.arrivals.length} arrival(s)`
);

console.log(
  record.clock === null
    ? '  clock      none — the hub had no idea where this camera`s clock was'
    : `  clock      offset ${record.clock.offsetMs} ±${ms(record.clock.uncertaintyMs)} ` +
      `from ${record.clock.samples.length} sample(s)`
);
console.log(
  record.origin === null
    ? '  origin     none — the hub could not tell when the recording started'
    : `  origin     device ${ms(record.origin.originDeviceMs)} ±${ms(record.origin.uncertaintyMs)} ` +
      `from ${record.origin.samples.length} sample(s)`
);

const keyframes = record.clusters.filter((cluster) => cluster.keyframe);
console.log(
  `  clusters   ${record.clusters.length}, ${keyframes.length} of them keyframes` +
    (record.clusters.length
      ? ` — media ${ms(record.clusters[0]!.timeMs)} to ${ms(record.clusters[record.clusters.length - 1]!.timeMs)}`
      : '')
);
console.log(
  record.outcome.cut
    ? `  outcome    cut ${(record.outcome.bytes / 1024).toFixed(0)}KB starting ${record.outcome.startSessionMs}, ` +
      `bookmark at +${(record.outcome.bookmarkOffsetMs / 1000).toFixed(2)}s`
    : `  outcome    refused — ${record.outcome.why}`
);

// ------------------------------------------------------------- replaying ----

const uploadPath = record.upload.keptAs ? join(dirname(recordPath), record.upload.keptAs) : null;
if (uploadPath === null || !existsSync(uploadPath)) {
  console.log(
    `\n  The upload itself is not here${record.upload.keptAs ? ` (${record.upload.keptAs} has been rolled off)` : ''},\n` +
      '  so this is the record alone. The numbers above are still the whole decision.\n'
  );
  process.exit(0);
}

const body = readFileSync(uploadPath);
const headerLength = body.readUInt32BE(0);
const header = JSON.parse(body.subarray(4, 4 + headerLength).toString()) as UploadHeader;
const prefixAt = 4 + headerLength;
const prefix = new Uint8Array(body.subarray(prefixAt, prefixAt + header.prefixLength));
const run = new Uint8Array(body.subarray(prefixAt + header.prefixLength));

// Everything from the raw samples again, not from the recorded conclusions: an
// estimator that has changed since is exactly what wants noticing.
const clock = estimateClock(record.clock?.samples ?? []);
const clusters = readClusters(run);
const origin = estimateMediaOrigin(originSamples({ clusters, arrivals: header.arrivals }));
const videoTrack = readVideoTrackNumber(prefix) ?? 1;

console.log('\n  --- replayed here, now ---\n');
console.log(`  clusters   ${clusters.length}, ${clusters.length === record.clusters.length ? 'same' : 'DIFFERENT'}`);
console.log(
  `  clock      ${clock === null ? 'none' : `offset ${clock.offsetMs} ±${ms(clock.uncertaintyMs)}`}` +
    (clock?.offsetMs === record.clock?.offsetMs ? ' — same' : ' — DIFFERENT')
);
console.log(
  `  origin     ${origin === null ? 'none' : `device ${ms(origin.originDeviceMs)} ±${ms(origin.uncertaintyMs)}`}` +
    (origin?.originDeviceMs === record.origin?.originDeviceMs ? ' — same' : ' — DIFFERENT')
);

const clip =
  clock && origin
    ? cutClipForBookmark({
        initSegment: readInitSegment(prefix),
        clusters,
        videoTrack,
        timeline: { clock, recordingStartedAt: origin.originDeviceMs },
        bookmarkSessionMs: record.bookmark.sessionMs,
        preRollMs: record.settings.preRollMs,
        postRollMs: record.settings.postRollMs,
      })
    : null;

if (clip === null) {
  console.log(`  outcome    refused${record.outcome.cut ? ' — but the hub cut a clip at the time' : ' — same as then'}\n`);
  process.exit(record.outcome.cut ? 1 : 0);
}

const written = `${recordPath.replace(/\.json$/, '')}.replay.webm`;
writeFileSync(written, clip.bytes);
console.log(
  `  outcome    cut ${(clip.bytes.length / 1024).toFixed(0)}KB starting ${clip.startSessionMs}, ` +
    `bookmark at +${(clip.bookmarkOffsetMs / 1000).toFixed(2)}s`
);

const same =
  record.outcome.cut &&
  record.outcome.startSessionMs === clip.startSessionMs &&
  record.outcome.bookmarkOffsetMs === clip.bookmarkOffsetMs &&
  record.outcome.bytes === clip.bytes.length;

console.log(
  same
    ? `\n  Reproduced exactly. Clip written to ${basename(written)}\n`
    : `\n  DIFFERENT from what the hub decided at the time. Clip written to ${basename(written)}\n`
);
process.exit(same ? 0 : 1);
