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
import { Hub, type Camera, type NewCamera } from './hub';
import { saveBlobAs } from './save-file';
import { savedStateFilename } from './state-filename';

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

  /**
   * Which screen is showing. Cameras first: at the start of an event there is
   * nothing to review, and every phone has to be set up before there can be.
   */
  protected readonly tab = signal<'cameras' | 'bookmarks'>('cameras');

  protected readonly selectedBookmark = signal<string | null>(null);
  protected readonly reviewing = computed(() =>
    this.hub.bookmarks().find((bookmark) => bookmark.id === this.selectedBookmark()) ?? null
  );
  /** How many the sweep would take: every undecided one, footage or not. */
  protected readonly unresolvedCount = computed(
    () => this.hub.bookmarks().filter((bookmark) => bookmark.resolution === 'unresolved').length
  );

  /** Nothing is filming, so a bookmark would have no angles and never will. */
  protected readonly liveCameras = computed(
    () => this.hub.cameras().filter((camera) => camera.live).length
  );

  protected readonly invited = signal<NewCamera | null>(null);
  protected readonly qr = signal<SafeHtml | null>(null);

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('qrDialog');
  private readonly resetDialog = viewChild<ElementRef<HTMLDialogElement>>('resetDialog');
  private readonly removeDialog = viewChild<ElementRef<HTMLDialogElement>>('removeDialog');
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
      const { warning } = await this.hub.loadState(file);
      this.selectedBookmark.set(null);
      // The build that wrote the file is worth saying while the file is being
      // opened, not left to be discovered by behaviour that changed since.
      const loaded = `Loaded ${file.name}`;
      this.notice.set({ text: warning ? `${loaded} — ${warning}` : loaded, bad: false });
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

  /**
   * Save the session, letting the operator choose where it goes.
   *
   * A session worth saving is one being sent to somebody, so knowing where it
   * landed matters more here than for an ordinary download. Where the browser
   * offers a picker it is used; where it does not, the file still downloads.
   */
  protected async saveState(): Promise<void> {
    this.menuOpen.set(false);
    this.notice.set({ text: 'Saving…', bad: false });

    let blob: Blob;
    try {
      blob = await this.hub.fetchState();
    } catch {
      this.notice.set({ text: 'Could not save the session', bad: true });
      return;
    }

    const suggestedName = savedStateFilename(new Date());
    try {
      const saved = await saveBlobAs(blob, suggestedName);
      // Cancelling the picker is a decision, not a failure — say nothing.
      this.notice.set(saved ? { text: `Saved ${saved}`, bad: false } : null);
    } catch {
      this.notice.set({ text: 'Could not write that file', bad: true });
    }
  }

  /**
   * Everything about this session, in one file, in the same place every time.
   *
   * Separate from saving a session: that file is one this hub can read back,
   * and this one is for sending to somebody who cannot see the machine.
   */
  protected async writeDebugDump(): Promise<void> {
    this.menuOpen.set(false);
    this.notice.set({ text: 'Collecting everything…', bad: false });
    try {
      const { name, folder, bytes } = await this.hub.debugDump();
      const size = bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
      this.notice.set({ text: `Wrote ${folder}/${name} (${size}) on this laptop`, bad: false });
    } catch {
      this.notice.set({ text: 'Could not write the debug dump', bad: true });
    }
  }

  protected async mark(): Promise<void> {
    try {
      await this.hub.bookmark();
    } catch {
      this.notice.set({ text: 'Could not mark — no camera is filming', bad: true });
    }
  }

  protected async sweep(): Promise<void> {
    const swept = await this.hub.resolveAllUnresolved('done');
    this.notice.set({ text: `Marked ${swept} bookmark${swept === 1 ? '' : 's'} done`, bad: false });
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

  /**
   * Removing a camera is asked about first: it cannot be undone from here, and
   * the phone has to be added again to come back.
   */
  protected readonly removing = signal<Camera | null>(null);

  protected askRemove(camera: Camera): void {
    this.removing.set(camera);
    this.removeDialog()?.nativeElement.showModal();
  }

  protected cancelRemove(): void {
    this.removeDialog()?.nativeElement.close();
    this.removing.set(null);
  }

  protected async confirmRemove(): Promise<void> {
    const camera = this.removing();
    this.removeDialog()?.nativeElement.close();
    this.removing.set(null);
    if (!camera) return;

    try {
      await this.hub.removeCamera(camera.id);
      this.notice.set({ text: `${camera.name} removed from the session`, bad: false });
    } catch {
      this.notice.set({ text: `Could not remove ${camera.name}`, bad: true });
    }
  }

  /**
   * Show a camera's join code again, in the dialog its first one appeared in.
   *
   * The same code as before — the token has not changed — so a phone already
   * filming is unaffected by the operator asking for it.
   */
  protected async showQr(id: string): Promise<void> {
    try {
      const camera = await this.hub.showQrFor(id);
      this.invited.set(camera);
      this.qr.set(this.#sanitizer.bypassSecurityTrustHtml(camera.qr));
      this.dialog()?.nativeElement.showModal();
    } catch (error: unknown) {
      const reason = (error as { error?: string })?.error || 'could not show that code';
      this.notice.set({ text: reason, bad: true });
    }
  }

  protected closeDialog(): void {
    this.dialog()?.nativeElement.close();
  }
}
