import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import { CameraCard } from './camera-card';
import { Hub, type NewCamera } from './hub';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CameraCard, FormField],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly hub = inject(Hub);
  readonly #sanitizer = inject(DomSanitizer);

  protected readonly newCamera = signal({ name: '' });
  protected readonly cameraForm = form(this.newCamera, (path) => {
    // A camera has to be named after whoever is holding it, or the operator
    // cannot tell one tile from another mid-bout.
    required(path.name, { message: 'Name the camera after whoever is holding it' });
  });

  protected readonly invited = signal<NewCamera | null>(null);
  protected readonly qr = signal<SafeHtml | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('qrDialog');

  protected addCamera(): void {
    submit(this.cameraForm, async () => {
      const camera = await this.hub.addCamera(this.newCamera().name);
      this.newCamera.set({ name: '' });
      this.invited.set(camera);
      // The QR is markup our own hub rendered, not anything a user supplied.
      this.qr.set(this.#sanitizer.bypassSecurityTrustHtml(camera.qr));
      this.dialog()?.nativeElement.showModal();
    });
  }

  protected closeDialog(): void {
    this.dialog()?.nativeElement.close();
  }
}
