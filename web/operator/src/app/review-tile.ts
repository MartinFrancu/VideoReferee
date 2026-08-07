import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import type { Angle } from './hub';

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
        @if (angle().status === 'pending') {
          <span class="note">still arriving…</span>
        } @else if (beyondFootage()) {
          <span class="note gap">no footage this far</span>
        }
      </figcaption>
      <video #video playsinline preload="auto" [muted]="!lead()" (loadedmetadata)="onMetadata()" (durationchange)="measure()"></video>
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
    video { display: block; width: 100%; background: #000; aspect-ratio: 4 / 3; }
  `,
})
export class ReviewTile {
  readonly angle = input.required<Angle>();
  readonly name = input.required<string>();
  readonly lead = input(false);

  readonly chosen = output<void>();
  /** How far either side of the bookmark this clip can actually go. */
  readonly spanKnown = output<{ backMs: number; forwardMs: number }>();

  protected readonly beyondFootage = signal(false);

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
    const offset = this.angle().bookmarkOffsetMs ?? 0;
    this.spanKnown.emit({ backMs: offset, forwardMs: Math.max(0, this.#durationMs - offset) });
    this.seekTo(0);
  }

  get element(): HTMLVideoElement {
    return this.videoRef().nativeElement;
  }

  /** Position this angle at `relativeMs` from the bookmarked instant. */
  seekTo(relativeMs: number): void {
    const localMs = (this.angle().bookmarkOffsetMs ?? 0) + relativeMs;
    const upper = Number.isFinite(this.#durationMs) ? this.#durationMs : localMs;
    const clamped = Math.max(0, Math.min(localMs, upper));
    this.beyondFootage.set(Math.abs(clamped - localMs) > 1);
    this.element.currentTime = clamped / 1000;
  }

  /** Where this angle currently sits, relative to the bookmarked instant. */
  relativeMs(): number {
    return this.element.currentTime * 1000 - (this.angle().bookmarkOffsetMs ?? 0);
  }
}
