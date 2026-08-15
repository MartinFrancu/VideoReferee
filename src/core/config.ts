// The numbers worth changing without editing code.
//
// Grouped by what you are thinking about when you change one: what a bookmark
// captures, what a phone holds, how the review screen moves, and how the hub
// and the phones keep in touch. Grouped rather than listed flat, because a flat
// list gives no clue which setting belongs to which part of the system.
//
// Read from `config.json` at startup. Nothing in here can stop the hub
// starting: a setting it dislikes is reported and replaced by its default,
// because a tournament is a bad time to debug a config file.

/** The defaults, and the shape. Sections and their settings are defined once, here. */
const SECTION_DEFAULTS = {
  /** What a bookmark captures. */
  bookmark: {
    /** How much footage before the bookmarked instant a clip carries. */
    preRollMs: 1500,
    /** …and after it. */
    postRollMs: 1000,
    /** How long a phone waits before uploading, so the post-roll has been recorded. */
    postRollWaitMs: 1500,
    /**
     * How often the hub asks a camera again for footage it has not sent, for as
     * long as that footage could still be in the phone's ring. Long enough that
     * an upload in flight is not asked for twice.
     */
    askAgainEveryMs: 5000,
  },
  /** What a phone does while filming. */
  camera: {
    /** How much footage a phone keeps in its rolling buffer. */
    ringWindowMs: 25_000,
    /** Footage a camera must hold before it is treated as ready to bookmark. */
    warmUpMs: 20_000,
  },
  /** How the review screen moves through a clip. */
  review: {
    /** One frame, for stepping. Clips are not frame-rate tagged, so this is told, not measured. */
    frameMs: 33,
    /** While a frame button is held down, step again this often. */
    holdRepeatMs: 200,
    /** How long a frame button must be held before it starts repeating. */
    holdDelayMs: 400,
    /**
     * How far out an angle may be before the review screen says so.
     *
     * Both estimates behind a clip are bounded measurements, and this is what
     * that bound is compared against. Expect to move it after an event with real
     * phones: nobody has ever looked at these figures, so what is normal is not
     * known, and a threshold that flags everything teaches as little as one that
     * flags nothing.
     */
    trustedWithinMs: 100,
  },
  /** What the hub keeps about how it answered a bookmark, for looking at later. */
  capture: {
    /**
     * How many raw uploads to keep beside the records, newest first. The records
     * themselves are small and always kept; an upload is megabytes, and only the
     * recent ones are ever wanted. The smallest this can be set to is 1, like
     * every other setting here — to keep none, delete the folder.
     */
    keepUploads: 20,
  },
  /** How the hub and the phones keep in touch. */
  network: {
    /** How often the hub pings each camera. Doubles as the heartbeat. */
    pingIntervalMs: 1000,
    /** Silence for longer than this and a camera is no longer believed to be filming. */
    staleAfterMs: 3000,
  },
} as const;

export type Config = {
  readonly [S in keyof typeof SECTION_DEFAULTS]: {
    readonly [K in keyof (typeof SECTION_DEFAULTS)[S]]: number;
  };
};

export const DEFAULT_CONFIG: Config = SECTION_DEFAULTS;

type SectionName = keyof typeof SECTION_DEFAULTS;

const SECTION_NAMES = Object.keys(SECTION_DEFAULTS) as SectionName[];

/** Which section each setting belongs to, so a misplaced one can be pointed home. */
const HOME_SECTION = new Map<string, SectionName>(
  SECTION_NAMES.flatMap((section) =>
    Object.keys(SECTION_DEFAULTS[section]).map((setting) => [setting, section] as const)
  )
);

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

type Draft = Record<SectionName, Record<string, number>>;

function blankDraft(): Draft {
  return Object.fromEntries(
    SECTION_NAMES.map((section) => [section, { ...SECTION_DEFAULTS[section] }])
  ) as unknown as Draft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a config file's contents. Never throws; complains instead. */
export function readConfig(input: unknown): ConfigResult {
  const problems: string[] = [];
  const draft = blankDraft();

  /** Put one value in its place, or say why it stayed as it was. */
  function apply(section: SectionName, setting: string, value: unknown): void {
    const home = HOME_SECTION.get(setting);
    if (home === undefined) {
      problems.push(
        `"${section}.${setting}" is not a setting — ignored. ` +
          `${section} takes: ${Object.keys(SECTION_DEFAULTS[section]).join(', ')}.`
      );
      return;
    }
    if (home !== section) {
      problems.push(`"${setting}" belongs in "${home}", not "${section}" — ignored where it is.`);
      return;
    }
    // `Number.isFinite` already rejects a string; the `typeof` test is what
    // narrows `unknown` to `number` for the assignment, and removing it does
    // not compile.
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      problems.push(
        `${section}.${setting} must be a number greater than zero, not ${JSON.stringify(value)} — ` +
          `using ${SECTION_DEFAULTS[section][setting as never]}.`
      );
      return;
    }
    draft[section][setting] = value;
  }

  // `undefined` is "there is no file", which is normal. Anything else came out
  // of a file someone wrote, so a shape we cannot use is worth saying aloud.
  if (input !== undefined) {
    if (!isRecord(input)) {
      problems.push('config.json is not a set of settings — using defaults throughout.');
    } else {
      for (const [key, value] of Object.entries(input)) {
        if (!SECTION_NAMES.includes(key as SectionName)) {
          problems.push(`"${key}" is not a section — ignored. Expected one of: ${SECTION_NAMES.join(', ')}.`);
          continue;
        }
        const section = key as SectionName;
        if (!isRecord(value)) {
          problems.push(`"${section}" should be a group of settings, not ${JSON.stringify(value)} — ignored.`);
          continue;
        }
        for (const [setting, given] of Object.entries(value)) apply(section, setting, given);
      }
    }
  }

  const { bookmark, camera } = draft;

  // A warm-up the ring can never reach leaves every camera stuck at "getting
  // ready" with BOOKMARK disabled, which looks like a broken tool rather than a
  // bad number. Pull it inside the window instead of obeying it.
  const reachable = camera['ringWindowMs']! - WARM_UP_HEADROOM_MS;
  if (camera['warmUpMs']! > reachable) {
    problems.push(
      `camera.warmUpMs ${camera['warmUpMs']} is more than a ring of ${camera['ringWindowMs']} can hold — using ${reachable}.`
    );
    camera['warmUpMs'] = reachable;
  }

  // These two only make clips quietly short, so say so and let them stand.
  const roll = bookmark['preRollMs']! + bookmark['postRollMs']!;
  if (roll > camera['ringWindowMs']!) {
    problems.push(
      `bookmark.preRollMs + bookmark.postRollMs (${roll}) is more than the ring holds ` +
        `(camera.ringWindowMs ${camera['ringWindowMs']}), so clips will be cut short.`
    );
  }

  if (bookmark['postRollWaitMs']! < bookmark['postRollMs']!) {
    problems.push(
      `bookmark.postRollWaitMs (${bookmark['postRollWaitMs']}) is less than ` +
        `bookmark.postRollMs (${bookmark['postRollMs']}), so a phone will upload before it has ` +
        `recorded the footage after the bookmark.`
    );
  }

  return { config: draft as Config, problems };
}
