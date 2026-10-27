import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { AVATAR_CHARACTERS, avatarImageUrl } from '../core/avatars';
import { RoomStore } from '../core/room.store';
import { UiService } from '../core/ui.service';
import { AvatarComponent } from '../shared/avatar';

/** The avatar picker: your name on top, the characters grouped by series, Done. */
@Component({
  selector: 'app-avatar-dialog',
  imports: [AvatarComponent],
  template: `
    <div id="avatar-dialog" class="dialog" [hidden]="!ui.avatarPickerOpen()" (click)="onBackdrop($event)">
      <div class="dialog-box festive avatar-box" role="dialog" aria-labelledby="avatar-title">
        <div class="avatar-head">
          <div id="avatar-preview" app-avatar class="avatar-preview" aria-hidden="true" [name]="name()" [avatar]="store.avatar()"></div>
          <h2 id="avatar-title" class="avatar-title">{{ name() }}</h2>
        </div>
        <div class="avatar-choices">
          <div id="avatar-images" class="avatar-images" role="radiogroup" aria-label="Character">
            @for (group of series; track group[0]) {
              <h4 class="avatar-series">{{ group[0] }}</h4>
              <div class="avatar-grid">
                @for (c of group[1]; track c[0]) {
                  <button type="button" role="radio" class="avatar-option picture" [attr.data-image]="c[0]" [attr.aria-label]="c[1]"
                    [attr.data-tip]="c[1]" [attr.aria-checked]="store.avatar().image === c[0]" (click)="store.setAvatar({ image: c[0] })">
                    <img [src]="url(c[0])" alt="" loading="lazy" draggable="false" />
                  </button>
                }
              </div>
            }
          </div>
        </div>
        <button id="avatar-done" type="button" class="btn-chunky yellow" (click)="close()">Done</button>
      </div>
    </div>`,
  host: { '(window:keydown.escape)': 'close()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AvatarDialogComponent {
  protected readonly store = inject(RoomStore);
  protected readonly ui = inject(UiService);
  protected readonly series = AVATAR_CHARACTERS;
  protected readonly url = avatarImageUrl;

  protected name(): string {
    return this.store.currentName() || 'You';
  }

  protected onBackdrop(event: Event): void {
    if (event.target === event.currentTarget) this.close();
  }

  protected close(): void {
    if (!this.ui.avatarPickerOpen()) return;
    this.ui.avatarPickerOpen.set(false);
    // Already in a room: let everyone else see the new avatar.
    this.store.publishAvatar();
  }
}
