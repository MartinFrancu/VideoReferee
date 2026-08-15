// Saving a session to one file, and reading one back.
//
// The point is troubleshooting: when something looks wrong mid-bout, the whole
// state — cameras, bookmarks, and the clips themselves — goes into a single file
// that can be handed to someone else and loaded on another machine. One file,
// because a folder of parts is something to get wrong while sending it on.
//
// A loaded file is untrusted input: it may have travelled through a chat, an
// email, or a USB stick, and its clip names become filenames on the hub. So
// everything is checked on the way in, and the errors say what is wrong.

import type { Bookmark, Resolution } from './bookmarks.js';
import type { CameraView } from './protocol.js';

/** Bumped when the shape changes in a way an older build could misread. */
export const STATE_FORMAT = 1;

export interface SavedClip {
  /** A bare filename inside the clips directory — never a path. */
  readonly name: string;
  /** The clip's bytes, base64 so the whole state stays one file. */
  readonly base64: string;
}

export interface SavedState {
  readonly format: number;
  readonly savedAt: string;
  /**
   * Which build wrote this — the first question worth asking of a file someone
   * hands you. "unknown" for a file written before it was recorded.
   */
  readonly version: string;
  readonly cameras: readonly CameraView[];
  readonly bookmarks: readonly Bookmark[];
  readonly clips: readonly SavedClip[];
}

/**
 * Whether a clip name may be joined onto the clips directory.
 *
 * Deliberately a whitelist rather than a search for bad characters: the hub
 * generates `<uuid>_<uuid>.webm` and nothing else, so anything that is not a
 * bare filename ending in `.webm` is refused without needing to be understood.
 */
export function isSafeClipName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.webm$/.test(name) && !name.includes('..');
}

function fail(what: string): never {
  throw new Error(what);
}

function asArray(value: unknown, field: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${field} is not a list`);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(what);
}

function asNumber(value: unknown, field: string): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fail(`${field} is not a number`);
}

function asString(value: unknown, field: string): string {
  return typeof value === 'string' ? value : fail(`${field} is missing`);
}

/**
 * What to call a saved session.
 *
 * Lives here rather than in the hub because both ends need it: the hub offers
 * it in `Content-Disposition`, and the operator screen has to name the file it
 * builds. Colons are stripped because Windows will not have them in a filename,
 * and the obvious ISO timestamp is full of them.
 */
export function savedStateFilename(at: Date): string {
  return `videoreferee-${at.toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * Whether the operator should be told the file came from a different build.
 *
 * Saving exists so a session can be handed to someone else, which means the two
 * ends are routinely different builds. Naming both beats puzzling over
 * behaviour that changed between them — so this is said out loud rather than
 * left to be noticed.
 */
export function versionNotice({
  savedVersion,
  hubVersion,
}: {
  readonly savedVersion: string;
  readonly hubVersion: string;
}): string | null {
  if (savedVersion === hubVersion) return null;
  if (savedVersion === 'unknown') {
    return `That file was saved before versions were recorded; this hub is ${hubVersion}.`;
  }
  return `That file was saved by version ${savedVersion}; this hub is ${hubVersion}.`;
}

/** Read a saved state, or throw with a message worth showing to the operator. */
export function parseSavedState(input: unknown): SavedState {
  const state = asRecord(input, 'That file is not a saved state.');

  const format = asNumber(state['format'], 'format');
  if (format !== STATE_FORMAT) {
    fail(`That file is format ${format}; this hub reads format ${STATE_FORMAT}.`);
  }

  const bookmarks = asArray(state['bookmarks'], 'bookmarks').map((entry, index) => {
    const bookmark = asRecord(entry, `bookmarks[${index}] is not an object`);
    const angles = asArray(bookmark['angles'], `bookmarks[${index}].angles`).map((raw, position) => {
      const angle = asRecord(raw, `bookmarks[${index}].angles[${position}] is not an object`);
      return {
        cameraId: asString(angle['cameraId'], `bookmarks[${index}].angles[${position}].cameraId`),
        status: angle['status'] === 'received' ? ('received' as const) : ('pending' as const),
        // Why it never arrived is the reason to open the file at all.
        ...(typeof angle['note'] === 'string' ? { note: angle['note'] } : {}),
        // Absent in a file from before it was recorded, which is not the same as
        // an angle that was certain — so it stays absent rather than becoming 0.
        ...(typeof angle['uncertaintyMs'] === 'number'
          ? { uncertaintyMs: angle['uncertaintyMs'] }
          : {}),
        ...(typeof angle['url'] === 'string' ? { url: angle['url'] } : {}),
        ...(typeof angle['startSessionMs'] === 'number'
          ? { startSessionMs: angle['startSessionMs'] }
          : {}),
        ...(typeof angle['bookmarkOffsetMs'] === 'number'
          ? { bookmarkOffsetMs: angle['bookmarkOffsetMs'] }
          : {}),
      };
    });

    // A file written before bookmarks could be resolved simply has none.
    const RESOLUTIONS: Resolution[] = ['unresolved', 'red', 'blue', 'purple', 'done'];
    const given = bookmark['resolution'];
    const resolution = RESOLUTIONS.find((known) => known === given) ?? 'unresolved';

    return {
      id: asString(bookmark['id'], `bookmarks[${index}].id`),
      sessionMs: asNumber(bookmark['sessionMs'], `bookmarks[${index}].sessionMs`),
      triggeredBy: asString(bookmark['triggeredBy'], `bookmarks[${index}].triggeredBy`),
      angles,
      resolution,
    };
  });

  const cameras = asArray(state['cameras'], 'cameras').map((entry, index) => {
    const camera = asRecord(entry, `cameras[${index}] is not an object`);
    return {
      id: asString(camera['id'], `cameras[${index}].id`),
      name: asString(camera['name'], `cameras[${index}].name`),
      live: false, // Nothing loaded from a file is filming now.
      everJoined: camera['everJoined'] === true,
      heldMs: typeof camera['heldMs'] === 'number' ? camera['heldMs'] : null,
      syncUncertaintyMs:
        typeof camera['syncUncertaintyMs'] === 'number' ? camera['syncUncertaintyMs'] : null,
    };
  });

  const clips = asArray(state['clips'] ?? [], 'clips').map((entry, index) => {
    const clip = asRecord(entry, `clips[${index}] is not an object`);
    const name = asString(clip['name'], `clips[${index}].name`);
    if (!isSafeClipName(name)) fail(`Refusing clip name "${name}" — it is not a plain .webm filename.`);
    return { name, base64: asString(clip['base64'], `clips[${index}].base64`) };
  });

  // A file saved when a bout had a phase carries `boutPhase`. It is read past
  // rather than refused: the format is otherwise unchanged, and the field
  // described a control that never did anything.
  const version = state['version'];
  return {
    format,
    savedAt: asString(state['savedAt'], 'savedAt'),
    version: typeof version === 'string' ? version : 'unknown',
    cameras,
    bookmarks: bookmarks as Bookmark[],
    clips,
  };
}
