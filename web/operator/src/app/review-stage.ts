import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';

import { Hub, type Bookmark, type Camera } from './hub';
import { ReviewTile } from './review-tile';

/** Beyond this the angles are visibly apart, so correct rather than nudge. */
const HARD_RESYNC_MS = 200;
const NUDGE_MS = 15;

@Component({
  selector: 'vr-review-stage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReviewTile],
  template: `
    <div class="controls" data-testid="review-controls">
      <button
        data-testid="play-all"
        [disabled]="!everyAngleReady()"
        [title]="everyAngleReady() ? '' : 'Waiting for every angle to arrive'"
        (click)="togglePlay()"
      >
        {{ playing() ? 'Pause' : 'Play all' }}
      </button>

      <!--
        Press steps once; holding walks forward a frame at a time. Bound to
        pointerdown rather than click so the first frame lands on the press, with
        the keyboard handled explicitly since that skips click entirely.
      -->
      <button
        data-testid="step-back"
        (pointerdown)="startStepping(-1, $event)"
        (pointerup)="stopStepping()"
        (pointerleave)="stopStepping()"
        (pointercancel)="stopStepping()"
        (keydown.enter)="step(-1)"
        (keydown.space)="step(-1)"
      >◀ frame</button>
      <button
        data-testid="step-forward"
        (pointerdown)="startStepping(1, $event)"
        (pointerup)="stopStepping()"
        (pointerleave)="stopStepping()"
        (pointercancel)="stopStepping()"
        (keydown.enter)="step(1)"
        (keydown.space)="step(1)"
      >frame ▶</button>

      <label class="rate">
        speed
        <select [value]="rate()" (change)="setRate(+$any($event.target).value)" data-testid="rate">
          <option value="1">1×</option>
          <option value="0.5">½×</option>
          <option value="0.25">¼×</option>
        </select>
      </label>

      <input
        class="scrub"
        type="range"
        data-testid="scrub"
        [min]="minRelativeMs()"
        [max]="maxRelativeMs()"
        [step]="10"
        [value]="relativeMs()"
        (input)="scrubLead(+$any($event.target).value)"
        (change)="jumpEveryone(+$any($event.target).value)"
      />
      <span class="readout" data-testid="readout">{{ readout() }}</span>
    </div>

    <div class="tiles" data-testid="review-tiles">
      @for (angle of angles(); track angle.cameraId) {
        <vr-review-tile
          [angle]="angle"
          [name]="nameFor(angle.cameraId)"
          [lead]="angle.cameraId === leadId()"
          [following]="dragging() && angle.cameraId !== leadId()"
          (chosen)="leadId.set(angle.cameraId)"
          (spanKnown)="noteSpan(angle.cameraId, $event)"
        />
      }
    </div>
  `,
  styles: `
    .controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 12px 0 16px;
    }
    .scrub { flex: 1; min-width: 240px; accent-color: var(--accent); }
    .readout {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      min-width: 72px;
      text-align: right;
    }
    .rate { font-size: 13px; color: var(--faded); display: flex; align-items: center; gap: 6px; }
    select {
      font: inherit;
      font-size: 13px;
      background: var(--ground);
      color: var(--ink);
      border: 1px solid var(--rule);
      border-radius: 6px;
      padding: 5px 8px;
    }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
  `,
})
export class ReviewStage {
  readonly bookmark = input.required<Bookmark>();
  readonly cameras = input.required<Camera[]>();

  protected readonly relativeMs = signal(0);
  protected readonly leadId = signal<string | null>(null);
  protected readonly rate = signal(1);
  protected readonly playing = signal(false);
  /** True between the first drag of the slider and letting go of it. */
  protected readonly dragging = signal(false);

  private readonly tiles = viewChildren(ReviewTile);
  readonly #hub = inject(Hub);
  readonly #destroyRef = inject(DestroyRef);
  /** What each clip can reach, learned once its metadata is in. */
  readonly #spans = signal(new Map<string, { backMs: number; forwardMs: number }>());
  /** Holds the delay first, then the repeat. Null whenever nothing is held. */
  #holdTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // A pointer released off the button never reports back to it, and the
    // repeat would run on with nothing holding it down.
    const stop = () => this.stopStepping();
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    this.#destroyRef.onDestroy(() => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      this.stopStepping();
    });
  }

  protected readonly angles = computed(() => this.bookmark().angles);

  protected readonly everyAngleReady = computed(() =>
    this.angles().length > 0 && this.angles().every((angle) => angle.status === 'received')
  );

  /**
   * The slider spans what at least one angle holds, not what all of them do.
   * An angle that cannot reach a position says so rather than showing a
   * misleading nearest frame.
   */
  protected readonly minRelativeMs = computed(() => {
    const backs = [...this.#spans().values()].map((span) => span.backMs).filter(Number.isFinite);
    return backs.length ? -Math.round(Math.max(...backs)) : 0;
  });

  protected readonly maxRelativeMs = computed(() => {
    const forwards = [...this.#spans().values()].map((span) => span.forwardMs).filter(Number.isFinite);
    return forwards.length ? Math.round(Math.max(...forwards)) : 0;
  });

  protected readonly readout = computed(() => {
    const seconds = this.relativeMs() / 1000;
    return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(2)}s`;
  });

  protected nameFor(cameraId: string): string {
    return this.cameras().find((camera) => camera.id === cameraId)?.name ?? 'camera';
  }

  protected noteSpan(cameraId: string, span: { backMs: number; forwardMs: number }): void {
    this.#spans.update((spans) => new Map(spans).set(cameraId, span));
    if (this.leadId() === null) this.leadId.set(cameraId);
    // A tile that has just loaded should show the bookmarked instant, not frame zero.
    this.#tileFor(cameraId)?.seekTo(this.relativeMs());
  }

  #tileFor(cameraId: string): ReviewTile | undefined {
    return this.tiles().find((tile) => tile.angle().cameraId === cameraId);
  }

  #lead(): ReviewTile | undefined {
    const id = this.leadId();
    return id ? this.#tileFor(id) : this.tiles()[0];
  }

  /**
   * While dragging, move only the lead. Seeking every angle at once is exact but
   * janky — browsers queue seeks and the drag lags the finger. The others catch
   * up on release, which is a single exact operation each.
   */
  protected scrubLead(relativeMs: number): void {
    this.pause();
    this.dragging.set(true);
    this.relativeMs.set(relativeMs);
    this.#lead()?.seekTo(relativeMs);
  }

  protected jumpEveryone(relativeMs: number): void {
    this.dragging.set(false);
    this.relativeMs.set(relativeMs);
    for (const tile of this.tiles()) tile.seekTo(relativeMs);
  }

  protected step(frames: number): void {
    this.pause();
    const next = Math.round(this.relativeMs() + frames * this.#hub.config().review.frameMs);
    this.jumpEveryone(Math.max(this.minRelativeMs(), Math.min(next, this.maxRelativeMs())));
  }

  /**
   * Step once now, and keep stepping while the button is held.
   *
   * Every angle moves on every step, so this is a slow walk through the same
   * instant on all of them rather than playback — which is what a referee
   * actually does at the moment of a hit. The delay before repeating keeps an
   * ordinary click to a single frame.
   */
  protected startStepping(frames: number, event: Event): void {
    event.preventDefault();
    this.stopStepping();
    this.step(frames);

    const { holdDelayMs, holdRepeatMs } = this.#hub.config().review;
    this.#holdTimer = setTimeout(() => {
      this.#holdTimer = setInterval(() => this.step(frames), holdRepeatMs);
    }, holdDelayMs);
  }

  protected stopStepping(): void {
    if (this.#holdTimer === null) return;
    clearTimeout(this.#holdTimer);
    clearInterval(this.#holdTimer);
    this.#holdTimer = null;
  }

  protected setRate(rate: number): void {
    this.rate.set(rate);
    for (const tile of this.tiles()) tile.element.playbackRate = rate;
  }

  protected togglePlay(): void {
    if (this.playing()) {
      this.pause();
      return;
    }
    this.jumpEveryone(this.relativeMs());
    for (const tile of this.tiles()) {
      tile.element.playbackRate = this.rate();
      void tile.element.play().catch(() => {});
    }
    this.playing.set(true);
    requestAnimationFrame(() => this.#follow());
  }

  protected pause(): void {
    if (!this.playing()) return;
    for (const tile of this.tiles()) tile.element.pause();
    this.playing.set(false);
  }

  /**
   * Playing is where angles drift, because each video advances on its own decode
   * clock. The lead is the master; the others are nudged back toward it by a
   * couple of percent rather than re-seeked, which would stutter.
   */
  #follow(): void {
    if (!this.playing()) return;
    const lead = this.#lead();
    if (!lead) return;

    const position = lead.relativeMs();
    this.relativeMs.set(Math.round(position));

    for (const tile of this.tiles()) {
      if (tile === lead) continue;
      const drift = tile.relativeMs() - position;
      if (Math.abs(drift) > HARD_RESYNC_MS) {
        tile.seekTo(position);
        tile.element.playbackRate = this.rate();
      } else if (Math.abs(drift) > NUDGE_MS) {
        tile.element.playbackRate = this.rate() * (drift > 0 ? 0.98 : 1.02);
      } else {
        tile.element.playbackRate = this.rate();
      }
    }

    if (lead.element.ended) this.pause();
    requestAnimationFrame(() => this.#follow());
  }
}
