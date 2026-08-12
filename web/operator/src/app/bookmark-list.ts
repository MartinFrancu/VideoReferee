import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { swatchFor, type Bookmark, type Camera } from './hub';

@Component({
  selector: 'vr-bookmark-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <ul data-testid="bookmarks">
        @for (row of rows(); track row.id) {
          <li
            data-testid="bookmark"
            [attr.data-swatch]="row.swatch"
            (click)="chosen.emit(row.id)"
            [class.active]="row.id === selected()"
          >
            <span class="dot" [style.background]="'var(--state-' + row.swatch + ')'" [title]="row.swatch"></span>
            <span class="when">{{ row.when }}</span>
            <span class="angles" data-testid="bookmark-angles">{{ row.angles }}</span>
            <span class="who">from {{ row.triggeredBy }}</span>
          </li>
        }
      </ul>
    } @else {
      <p class="empty">No bookmarks yet. Tap BOOKMARK on any camera.</p>
    }
  `,
  styles: `
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    /*
      Two lines in a narrow panel: when it happened and what arrived on the
      first, who marked it underneath. Everything stays on one line each, which
      a single row of four could not do at this width.
    */
    li {
      background: var(--panel);
      border: 1px solid var(--rule);
      border-radius: 10px;
      padding: 10px 12px;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: baseline;
      column-gap: 9px;
      cursor: pointer;
    }
    li.active { border-color: var(--accent); }
    /* The state, readable at a glance down the list rather than per row. */
    .dot { width: 10px; height: 10px; border-radius: 50%; align-self: center; }
    li[data-swatch='loading'] .dot { animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.35; } }
    .when { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    .who {
      grid-column: 2 / -1;
      font-size: 12.5px;
      color: var(--faded);
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .angles {
      text-align: right;
      font-size: 12px;
      color: var(--faded);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .empty { color: var(--faded); font-size: 14px; }
  `,
})
export class BookmarkList {
  readonly bookmarks = input.required<Bookmark[]>();
  readonly cameras = input.required<Camera[]>();
  readonly selected = input<string | null>(null);
  readonly chosen = output<string>();

  protected readonly rows = computed(() =>
    this.bookmarks().map((bookmark) => {
      const received = bookmark.angles.filter((angle) => angle.status === 'received').length;
      return {
        id: bookmark.id,
        swatch: swatchFor(bookmark),
        when: new Date(bookmark.sessionMs).toLocaleTimeString(),
        triggeredBy: bookmark.triggeredBy,
        // Say what is still in flight rather than hiding an incomplete set.
        angles:
          received === bookmark.angles.length
            ? `${received} angle${received === 1 ? '' : 's'}`
            : `${received} of ${bookmark.angles.length} angles`,
      };
    })
  );
}
