import { ChangeDetectionStrategy, Component, inject, signal, viewChild, ElementRef } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import { CameraCard } from './camera-card';
import { Hub, type NewCamera } from './hub';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CameraCard],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly hub = inject(Hub);
  readonly #sanitizer = inject(DomSanitizer);

  protected readonly newName = signal('');
  protected readonly invited = signal<NewCamera | null>(null);
  protected readonly qr = signal<SafeHtml | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('qrDialog');

  protected async addCamera(): Promise<void> {
    const camera = await this.hub.addCamera(this.newName());
    this.newName.set('');
    this.invited.set(camera);
    // The QR is an SVG the hub rendered; it is our own server's markup, not user input.
    this.qr.set(this.#sanitizer.bypassSecurityTrustHtml(camera.qr));
    this.dialog()?.nativeElement.showModal();
  }

  protected closeDialog(): void {
    this.dialog()?.nativeElement.close();
  }
}
