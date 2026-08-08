import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { WARM_UP_MS, isWarmingUp, type Camera } from './hub';

@Component({
  selector: 'vr-camera-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="card"
      data-testid="camera"
      [class.live]="camera().live"
      [class.warming]="warming()"
    >
      <div class="name" data-testid="camera-name-label"><span class="pip"></span>{{ camera().name }}</div>
      <div class="detail" data-testid="camera-detail">{{ detail() }}</div>
      @if (warming()) {
        <div class="bar" data-testid="camera-warmup"><div class="fill" [style.width.%]="percent()"></div></div>
      }
    </div>
  `,
  styles: `
    .card {
      background: var(--panel);
      border: 1px solid var(--rule);
      border-radius: 10px;
      padding: 14px 16px;
    }
    .name { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 9px; }
    .pip { width: 9px; height: 9px; border-radius: 50%; background: var(--dead); flex: none; }
    .card.live .pip { background: var(--live); }
    .card.warming .pip { background: var(--warm); }
    .detail { font-size: 12.5px; color: var(--faded); margin-top: 6px; font-variant-numeric: tabular-nums; }
    .bar { height: 4px; border-radius: 2px; background: var(--rule); overflow: hidden; margin-top: 9px; }
    .fill { height: 100%; background: var(--warm); transition: width 0.4s linear; }
  `,
})
export class CameraCard {
  readonly camera = input.required<Camera>();

  /**
   * Filming, but not yet holding enough footage to answer a bookmark well. A
   * green light here would invite exactly the tap that produces a bad clip.
   */
  protected readonly warming = computed(() => isWarmingUp(this.camera()));

  protected readonly percent = computed(() =>
    Math.min(100, Math.round(((this.camera().heldMs ?? 0) / WARM_UP_MS) * 100))
  );

  /**
   * A camera that has gone quiet and one whose QR was never scanned are both
   * "not live", but they are different problems: one phone has died, the other
   * has not been picked up yet.
   */
  protected readonly detail = computed(() => {
    const camera = this.camera();
    if (!camera.live) return camera.everJoined ? 'not responding' : 'waiting for its QR to be scanned';

    if (this.warming()) {
      const remaining = Math.ceil((WARM_UP_MS - (camera.heldMs ?? 0)) / 1000);
      return `warming up — ready in ${remaining}s`;
    }

    const buffered =
      camera.heldMs === null ? 'no footage yet' : `${Math.round(camera.heldMs / 1000)}s buffered`;
    const clock =
      camera.syncUncertaintyMs === null
        ? 'measuring clock'
        : `clock ±${Math.round(camera.syncUncertaintyMs)}ms`;
    return `${buffered} — ${clock}`;
  });
}
