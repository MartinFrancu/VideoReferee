// The numbers worth changing without editing code.
//
// These were constants scattered across the hub, the camera page and the
// operator screen, three of them duplicated by hand. Gathering them here means
// one place to change a value and one place to check what a running hub is
// actually using — the phone and the operator screen both read this over the
// wire rather than carrying their own copy.
//
// Read from `config.json` at startup. Nothing in here can stop the hub
// starting: a setting it dislikes is reported and replaced by its default,
// because a tournament is a bad time to debug a config file.

export interface Config {
  /** How much footage before a bookmarked instant a referee gets to see. */
  readonly preRollMs: number;
  /** …and after it. */
  readonly postRollMs: number;
  /** How long a phone waits after a bookmark before uploading, so the post-roll exists. */
  readonly postRollWaitMs: number;
  /** Footage a camera must hold before it is treated as ready to bookmark. */
  readonly warmUpMs: number;
  /** How much footage a phone keeps in its rolling buffer. */
  readonly ringWindowMs: number;
  /** One frame, for stepping. Clips are not frame-rate tagged, so this is told, not measured. */
  readonly frameMs: number;
  /** While a frame button is held down, step again this often. */
  readonly holdRepeatMs: number;
  /** How long a frame button must be held before it starts repeating. */
  readonly holdDelayMs: number;
  /** How often the hub pings each camera. Doubles as the heartbeat. */
  readonly pingIntervalMs: number;
  /** Silence for longer than this and a camera is no longer believed to be filming. */
  readonly staleAfterMs: number;
}

export const DEFAULT_CONFIG: Config = {
  preRollMs: 1500,
  postRollMs: 1000,
  postRollWaitMs: 1500,
  warmUpMs: 20_000,
  ringWindowMs: 25_000,
  frameMs: 33,
  holdRepeatMs: 200,
  holdDelayMs: 400,
  pingIntervalMs: 1000,
  staleAfterMs: 3000,
};

const SETTINGS = Object.keys(DEFAULT_CONFIG) as (keyof Config)[];

/**
 * How far below the ring window a warm-up target has to sit.
 *
 * A ring holding a 25 s window never reports 25 s: `heldMs` measures oldest to
 * newest arrival, so it tops out a chunk short of the window.
 */
const WARM_UP_HEADROOM_MS = 1000;

export interface ConfigResult {
  readonly config: Config;
  /** Everything ignored or adjusted, in words worth printing at startup. */
  readonly problems: readonly string[];
}

/** Read a config file's contents. Never throws; complains instead. */
export function readConfig(input: unknown): ConfigResult {
  const problems: string[] = [];
  const values = { ...DEFAULT_CONFIG } as Record<keyof Config, number>;

  // `undefined` is "there is no file", which is normal. Anything else came out
  // of a file someone wrote, so a shape we cannot use is worth saying aloud.
  if (input !== undefined) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      problems.push('config.json is not a set of settings — using defaults throughout.');
    } else {
      const given = input as Record<string, unknown>;

      for (const key of Object.keys(given)) {
        if (!SETTINGS.includes(key as keyof Config)) {
          problems.push(`"${key}" is not a setting — ignored. Expected one of: ${SETTINGS.join(', ')}.`);
        }
      }

      for (const key of SETTINGS) {
        if (!(key in given)) continue;
        const value = given[key];
        // `Number.isFinite` already rejects a string, so the `typeof` test looks
        // redundant — it is here to narrow `unknown` to `number` for the
        // assignment below, and removing it does not compile.
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          problems.push(
            `${key} must be a number greater than zero, not ${JSON.stringify(value)} — using ${DEFAULT_CONFIG[key]}.`
          );
          continue;
        }
        values[key] = value;
      }
    }
  }

  // A warm-up the ring can never reach leaves every camera stuck at "getting
  // ready" with BOOKMARK disabled, which looks like a broken tool rather than a
  // bad number. Pull it inside the window instead of obeying it.
  const reachable = values.ringWindowMs - WARM_UP_HEADROOM_MS;
  if (values.warmUpMs > reachable) {
    problems.push(
      `warmUpMs ${values.warmUpMs} is more than a ring of ${values.ringWindowMs} can hold — using ${reachable}.`
    );
    values.warmUpMs = reachable;
  }

  // These two only make clips quietly short, so say so and let them stand.
  if (values.preRollMs + values.postRollMs > values.ringWindowMs) {
    problems.push(
      `preRollMs + postRollMs (${values.preRollMs + values.postRollMs}) is more than the ring holds ` +
        `(${values.ringWindowMs}), so clips will be cut short.`
    );
  }

  if (values.postRollWaitMs < values.postRollMs) {
    problems.push(
      `postRollWaitMs (${values.postRollWaitMs}) is less than postRollMs (${values.postRollMs}), ` +
        `so a phone will upload before it has recorded the footage after the bookmark.`
    );
  }

  return { config: values as Config, problems };
}
