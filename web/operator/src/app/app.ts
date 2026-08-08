import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import { BookmarkList } from './bookmark-list';
import { CameraCard } from './camera-card';
import { ReviewStage } from './review-stage';
import { Hub, type NewCamera } from './hub';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BookmarkList, CameraCard, FormField, ReviewStage],
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

  protected readonly selectedBookmark = signal<string | null>(null);
  protected readonly reviewing = computed(() =>
    this.hub.bookmarks().find((bookmark) => bookmark.id === this.selectedBookmark()) ?? null
  );
  protected readonly invited = signal<NewCamera | null>(null);
  protected readonly qr = signal<SafeHtml | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('qrDialog');
  private readonly resetDialog = viewChild<ElementRef<HTMLDialogElement>>('resetDialog');
  private readonly stateFile = viewChild<ElementRef<HTMLInputElement>>('stateFile');

  /** The session menu: saving, loading, and clearing out after a bout. */
  protected readonly menuOpen = signal(false);
  protected readonly notice = signal<{ text: string; bad: boolean } | null>(null);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected pickStateFile(): void {
    this.menuOpen.set(false);
    this.stateFile()?.nativeElement.click();
  }

  protected async onStateFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear it first, so picking the same file twice still fires a change.
    input.value = '';
    if (!file) return;

    this.notice.set({ text: `Loading ${file.name}…`, bad: false });
    try {
      await this.hub.loadState(file);
      this.selectedBookmark.set(null);
      this.notice.set({ text: `Loaded ${file.name}`, bad: false });
    } catch (error: unknown) {
      // The hub says what is wrong with the file; it is more use than "failed".
      const reason =
        (error as { error?: string })?.error ||
        (error as { message?: string })?.message ||
        'could not load that file';
      this.notice.set({ text: reason, bad: true });
    }
  }

  protected askReset(): void {
    this.menuOpen.set(false);
    this.resetDialog()?.nativeElement.showModal();
  }

  protected async confirmReset(): Promise<void> {
    this.resetDialog()?.nativeElement.close();
    this.selectedBookmark.set(null);
    await this.hub.resetBookmarks();
    this.notice.set({ text: 'Bookmarks cleared', bad: false });
  }

  protected cancelReset(): void {
    this.resetDialog()?.nativeElement.close();
  }

  protected dismissNotice(): void {
    this.notice.set(null);
  }

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
