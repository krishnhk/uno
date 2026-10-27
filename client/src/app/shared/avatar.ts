import {
  ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, afterRenderEffect, computed, inject, input,
} from '@angular/core';
import { Avatar } from '../core/models';
import { AVATAR_BACKGROUND, avatarImageUrl, avatarLook } from '../core/avatars';
import { UiService } from '../core/ui.service';
import { CallService } from '../call/call.service';

/**
 * An avatar tile: the host element IS the tile (picture or initials on the shared red background).
 *   <div app-avatar class="avatar" [name]="p.name" [avatar]="p.avatar"></div>
 *   <button type="button" app-avatar class="avatar" [name]="..." [avatar]="..." [editable]="true"></button>
 * Give it a `playerId` and it shows that player's live video while they are in the call.
 */
@Component({
  selector: '[app-avatar]',
  template: `
    @if (look().image; as image) {
      <img class="avatar-img" [src]="imageUrl(image)" alt="" draggable="false" />
    } @else {
      {{ look().text }}
    }
    @if (editable()) {
      <span class="avatar-edit" aria-hidden="true">✎</span>
    }`,
  host: {
    '[class.avatar-button]': 'editable()',
    '[class.has-image]': '!!look().image',
    '[style.background]': 'background',
    '[attr.data-tip]': 'editable() ? "Change your avatar" : null',
    '[attr.aria-label]': 'editable() ? "Change your avatar" : null',
    '(click)': 'onClick()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AvatarComponent {
  readonly name = input('');
  readonly avatar = input<Avatar | null | undefined>(null);
  readonly editable = input(false);
  readonly playerId = input<string | null>(null);

  private readonly ui = inject(UiService);
  private readonly call = inject(CallService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly background = AVATAR_BACKGROUND;
  protected readonly look = computed(() => avatarLook(this.name(), this.avatar()));
  protected readonly imageUrl = avatarImageUrl;

  constructor() {
    // After the render, so the call code can put the video into the finished tile.
    afterRenderEffect(() => {
      const id = this.playerId();
      this.call.revision();
      this.look();
      if (id && this.call.active()) this.call.attachVideo(this.host.nativeElement, id);
    });
  }

  protected onClick(): void {
    if (this.editable()) this.ui.avatarPickerOpen.set(true);
  }
}
