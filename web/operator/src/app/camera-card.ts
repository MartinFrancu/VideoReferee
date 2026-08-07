import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { Camera } from './hub';

@Component({
  selector: 'vr-camera-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card" data-testid="camera" [class.live]="camera().live">
      <div class="name" data-testid="camera-name-label"><span class="pip"></span>{{ camera().name }}</div>
      <div class="detail" data-testid="camera-detail">{{ detail() }}</div>
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
    .detail { font-size: 12.5px; color: var(--faded); margin-top: 6px; font-variant-numeric: tabular-nums; }
  `,
})
export class CameraCard {
  readonly camera = input.required<Camera>();

  /**
   * A camera that has gone quiet and one whose QR was never scanned are both
   * "not live", but they are different problems: one phone has died, the other
   * has not been picked up yet.
   */
  protected readonly detail = computed(() => {
    const camera = this.camera();
    if (!camera.live) return camera.everJoined ? 'not responding' : 'waiting for its QR to be scanned';
    if (camera.syncUncertaintyMs === null) return 'live — measuring clock';

    const buffered =
      camera.heldMs === null ? 'no footage yet' : `${Math.round(camera.heldMs / 1000)}s buffered`;
    return `${buffered} — clock ±${Math.round(camera.syncUncertaintyMs)}ms`;
  });
}
