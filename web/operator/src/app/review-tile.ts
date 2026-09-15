import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { Hub, type Angle } from './hub';
import { mediaMsFor, stageMsFor, trimLabel } from './trim';
import { loosenessLabel } from './uncertainty';

/** One angle of one bookmark. Owns its video element; the stage drives it. */
@Component({
  selector: 'vr-review-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure [class.lead]="lead()" (click)="chosen.emit()">
      <figcaption>
        <span class="who">{{ name() }}</span>
        @if (lead()) {
          <span class="badge">lead</span>
        }
        @if (hidden(); as reason) {
          <span class="note" [class.gap]="beyondFootage()">{{ reason }}</span>
        }
        <!--
          How far out this angle could be, said only when it is further out than
          review.trustedWithinMs. Two angles disagreeing about *when* look
          exactly like two angles disagreeing about *what happened*, and this is
          the only thing on the screen that can tell a referee which it is.
        -->
        @if (looseness(); as bound) {
          <span
            class="loose"
            data-testid="uncertainty"
            [title]="'This angle could be out by ' + bound + '. The clock and recording-start estimates behind it are not settled.'"
          >{{ bound }}</span>
        }
        <!--
          A trim always shows, unlike the figure beside it. That one is a
          measurement and stays quiet until it matters; this one is a correction
          somebody made by hand, and looking at a moved angle without knowing it
          was moved is the thing to prevent.
        -->
        @if (trimShown(); as shown) {
          <span
            class="trimmed"
            data-testid="trim-badge"
            [title]="'Lined up by hand, by ' + shown + ' against the other angles.'"
          >⇄ {{ shown }}</span>
        }
      </figcaption>
      <div class="stage">
        <video #video playsinline preload="auto" [muted]="!lead()" (loadedmetadata)="onMetadata()" (durationchange)="measure()"></video>
        <!--
          Whenever this tile is not showing the instant that was asked for, cover
          it. The frame underneath is real footage from the right camera, just
          from the wrong moment — which is the most misleading thing it could be.
        -->
        @if (hidden(); as reason) {
          <div class="veil" data-testid="veil">{{ reason }}</div>
        }
      </div>

      <!--
        Under the footage it is about, because lining an angle up is done by
        watching this tile against the others while nudging. Only offered once
        the clip is here: there is nothing to line up against otherwise.
      -->
      @if (angle().status === 'received') {
        <div class="sync" (click)="$event.stopPropagation()">
          <button
            class="toggle"
            data-testid="sync"
            [class.on]="syncing()"
            [title]="'Line this angle up against the others by hand'"
            (click)="syncing.set(!syncing())"
          >⇄ Sync</button>

          @if (syncing()) {
            <button data-testid="trim-back-lots" title="a tenth of a second earlier" (click)="trimBy.emit(-100)">◀◀</button>
            <button data-testid="trim-back" title="one frame earlier" (click)="trimBy.emit(-frameMs())">◀</button>
            <span class="amount" data-testid="trim-amount">{{ trimShown() ?? '0.00s' }}</span>
            <button data-testid="trim-on" title="one frame later" (click)="trimBy.emit(frameMs())">▶</button>
            <button data-testid="trim-on-lots" title="a tenth of a second later" (click)="trimBy.emit(100)">▶▶</button>
            <button
              class="reset"
              data-testid="trim-reset"
              [disabled]="!trimMs()"
              title="Back to where the hub put it"
              (click)="trimCleared.emit()"
            >Reset</button>
          }
        </div>
      }
    </figure>
  `,
  styles: `
    figure {
      margin: 0;
      background: #000;
      border: 2px solid var(--rule);
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      /* Fills the share of the stage it was given, caption included. */
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    figure.lead { border-color: var(--accent); }
    figcaption {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: var(--panel);
      font-size: 13.5px;
    }
    .who { font-weight: 600; }
    .badge {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 9.5px;
      letter-spacing: 0.11em;
      text-transform: uppercase;
      color: #06232a;
      background: var(--accent);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .note { margin-left: auto; font-size: 12px; color: var(--faded); }
    .note.gap { color: var(--dead); }
    /* Amber, like a warming camera: usable, not yet to be trusted. */
    .loose {
      margin-left: auto;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
      color: var(--warm);
      border: 1px solid var(--warm);
      border-radius: 4px;
      padding: 1px 5px;
      cursor: help;
    }
    /*
      A correction, not a measurement: it reads in the accent rather than the
      amber warning beside it, because nothing is wrong — somebody decided this.
    */
    .trimmed {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
      color: var(--accent);
      border: 1px solid var(--accent);
      border-radius: 4px;
      padding: 1px 5px;
      cursor: help;
    }
    /* Whichever is showing takes the right-hand end; never both pushing. */
    .note + .loose,
    .note + .trimmed,
    .loose + .trimmed { margin-left: 8px; }
    .trimmed:first-of-type { margin-left: auto; }

    /* Under the footage, out of the way until it is wanted. */
    .sync {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: none;
      padding: 5px 8px;
      background: var(--panel);
      border-top: 1px solid var(--rule);
    }
    .sync button {
      font: inherit;
      font-size: 11.5px;
      background: var(--ground);
      color: var(--ink);
      border: 1px solid var(--rule);
      border-radius: 5px;
      padding: 2px 7px;
      cursor: pointer;
      min-width: 0;
    }
    .sync button:hover:not(:disabled) { border-color: var(--accent); }
    .sync button:disabled { opacity: 0.4; cursor: default; }
    .sync .toggle.on { border-color: var(--accent); color: var(--accent); }
    .sync .reset { margin-left: auto; }
    .amount {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
      min-width: 56px;
      text-align: center;
      color: var(--faded);
    }
    .stage { position: relative; flex: 1; min-height: 0; }
    /* Letterboxed rather than cropped: a referee needs the whole frame. */
    video { display: block; width: 100%; height: 100%; background: #000; object-fit: contain; }
    .veil {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      padding: 16px;
      text-align: center;
      font-size: 13px;
      color: var(--faded);
      background: #000;
    }
  `,
})
export class ReviewTile {
  readonly angle = input.required<Angle>();
  readonly name = input.required<string>();
  readonly lead = input(false);
  /** Someone is dragging the slider on another tile, so this one is stale. */
  readonly following = input(false);
  /**
   * How far the referee has moved this angle by hand. Owned by the stage, which
   * is the side that has to write it back to the hub.
   */
  readonly trimMs = input(0);

  readonly chosen = output<void>();
  /** How far either side of the bookmark this clip can actually go. */
  readonly spanKnown = output<{ backMs: number; forwardMs: number }>();
  /** A nudge, in milliseconds. The stage adds it up and holds the total. */
  readonly trimBy = output<number>();
  readonly trimCleared = output<void>();

  /** Whether this tile is showing its nudge controls. One tile at a time is fine. */
  protected readonly syncing = signal(false);

  protected readonly beyondFootage = signal(false);

  // `inject` has to run here, in the injection context, not inside a computed
  // whose callback runs later.
  readonly #hub = inject(Hub);

  /** Said only when this angle is looser than the settings call trustworthy. */
  protected readonly looseness = computed(() =>
    loosenessLabel(this.angle().uncertaintyMs, this.#hub.config().review.trustedWithinMs)
  );

  /** The trim as the referee reads it, or null when there is nothing to say. */
  protected readonly trimShown = computed(() => trimLabel(this.trimMs()));

  /** A nudge of one frame, the same frame the step buttons move by. */
  protected readonly frameMs = computed(() => this.#hub.config().review.frameMs);

  /**
   * Why this tile is not worth looking at right now, or null if it is.
   *
   * All three cases share one failure: the tile would otherwise show a real
   * frame from the right camera at the wrong moment, and nothing on screen
   * would say so. Two angles that appear to disagree because one of them is
   * simply stale is exactly the confusion this is here to prevent.
   */
  protected readonly hidden = computed<string | null>(() => {
    // The hub says why when it knows why, and that beats "still arriving…" on a
    // clip that stopped being on its way some time ago.
    if (this.angle().status === 'pending') return this.angle().note ?? 'still arriving…';
    if (this.following()) return 'release the slider to bring this angle here';
    if (this.beyondFootage()) return 'no footage this far';
    return null;
  });

  private readonly videoRef = viewChild.required<ElementRef<HTMLVideoElement>>("video");
  readonly #destroyRef = inject(DestroyRef);
  #objectUrl: string | null = null;
  /** Unknown until the browser has scanned the blob; see `measure`. */
  #durationMs = Number.POSITIVE_INFINITY;

  constructor() {
    effect(() => {
      const url = this.angle().url;
      const video = this.videoRef().nativeElement;
      if (!url || video.dataset['loaded'] === url) return;
      video.dataset['loaded'] = url;

      // Fetch the whole clip and play it from a blob. These clips are cut out of
      // a live stream, so they carry no Cues index and no Duration — seeking
      // over HTTP is unreliable, and seeking is the entire interaction here.
      void fetch(url)
        .then((response) => response.blob())
        .then((blob) => {
          this.#revoke();
          this.#objectUrl = URL.createObjectURL(blob);
          video.src = this.#objectUrl;
        });
    });

    this.#destroyRef.onDestroy(() => this.#revoke());
  }

  #revoke(): void {
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
  }

  /**
   * Make the browser work out how long this clip is.
   *
   * Clips cut from a live stream carry no Duration element, so `duration` is
   * Infinity until the blob has been scanned — and Chrome only scans when asked
   * to seek past the end. Waiting for a duration before seeking deadlocks:
   * nothing moves, so nothing is ever measured, and the scrubber stays at zero
   * width. Asking for an impossible position resolves it in milliseconds, and
   * `durationchange` then settles the clip on the bookmarked instant.
   */
  onMetadata(): void {
    if (Number.isFinite(this.element.duration)) {
      this.measure();
      return;
    }
    this.element.currentTime = 1e6;
  }

  /**
   * Work out how far this clip reaches, once the browser knows.
   *
   * These clips carry no Duration element, so `duration` is Infinity at
   * `loadedmetadata` and only becomes real once the blob has been scanned —
   * which is why this listens for `durationchange` too. Reporting a span before
   * then would put Infinity on the slider.
   */
  measure(): void {
    const video = this.videoRef().nativeElement;
    const seekable = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
    const seconds = Number.isFinite(video.duration) ? video.duration : seekable;
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    this.#durationMs = seconds * 1000;
    // Where the clip reaches, before any trim. A trim shifts that by its own
    // size, but the slider spans what *some* angle can reach rather than what
    // each one can, and a tile asked for a position it cannot reach already
    // says so and veils itself. Better than a scrubber whose ends move while
    // the referee is lining an angle up.
    const offset = this.angle().bookmarkOffsetMs ?? 0;
    this.spanKnown.emit({ backMs: offset, forwardMs: Math.max(0, this.#durationMs - offset) });
    this.seekTo(0);
  }

  get element(): HTMLVideoElement {
    return this.videoRef().nativeElement;
  }

  /**
   * Position this angle at `relativeMs` from the bookmarked instant.
   *
   * The trim can be given rather than read, because the stage changes it and
   * seeks in the same breath — and at that moment the input carrying it still
   * holds the value from before the nudge. Seeking with that would leave the
   * frame exactly where it was, which is the one thing a nudge must not do.
   */
  seekTo(relativeMs: number, trimMs: number = this.trimMs()): void {
    const localMs = mediaMsFor(this.angle(), trimMs, relativeMs);
    const upper = Number.isFinite(this.#durationMs) ? this.#durationMs : localMs;
    const clamped = Math.max(0, Math.min(localMs, upper));
    this.beyondFootage.set(Math.abs(clamped - localMs) > 1);
    this.element.currentTime = clamped / 1000;
  }

  /** Where this angle currently sits, relative to the bookmarked instant. */
  relativeMs(): number {
    return stageMsFor(this.angle(), this.trimMs(), this.element.currentTime * 1000);
  }
}
