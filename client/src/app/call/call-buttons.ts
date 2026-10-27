import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { RoomStore } from '../core/room.store';
import { CallService } from './call.service';

/** Line icons for the call buttons (24×24, drawn with the button's text colour). A slash marks "off". */
const CALL_ICONS = {
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3', 'M8.5 21h7'],
  cam: ['M3 7.5A1.5 1.5 0 0 1 4.5 6h9A1.5 1.5 0 0 1 15 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 16.5Z', 'M15 10.5l6-3.5v10l-6-3.5'],
  hangup: ['M3.5 14.5c4.6-4.4 12.4-4.4 17 0l-1.9 2.4a1 1 0 0 1-1.3.2l-2.5-1.6a1 1 0 0 1-.4-1v-1.6a12 12 0 0 0-5.8 0v1.6a1 1 0 0 1-.4 1l-2.5 1.6a1 1 0 0 1-1.3-.2Z'],
  muteAll: ['M9 3.5a2.5 2.5 0 0 0-2.5 2.5v4.5a2.5 2.5 0 0 0 5 0V6A2.5 2.5 0 0 0 9 3.5Z', 'M14.5 10a5.5 5.5 0 0 1-11 0', 'M9 16v3', 'M17 6.5a2 2 0 1 1 0 4', 'M18.5 13.5c1.4.5 2.5 1.6 2.5 3'],
};

type IconName = keyof typeof CALL_ICONS;

/** Join / mic / camera / mute-all / leave buttons, in the lobby bar and the game's top bar. */
@Component({
  selector: 'app-call-buttons',
  template: `
    <ng-template #icon let-name let-off="off">
      <svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        @for (d of paths(name); track d) {
          <path [attr.d]="d"></path>
        }
        @if (off) {
          <path d="M4 4l16 16" class="slash"></path>
        }
      </svg>
    </ng-template>

    @if (!call.active()) {
      <button type="button" class="call-btn join" [disabled]="call.joining()" [attr.data-tip]="joinTip()"
              aria-label="Join video" (click)="call.join()">
        <ng-container *ngTemplateOutlet="icon; context: { $implicit: 'cam', off: false }" />
        <span class="call-label">{{ call.joining() ? 'Connecting…' : 'Join video' + (others() ? ' (' + others() + ')' : '') }}</span>
      </button>
    } @else {
      <button type="button" class="call-btn round" [class.off]="!call.mic()" [attr.aria-pressed]="!call.mic()"
              [attr.data-tip]="call.mic() ? 'Mute your microphone' : 'Unmute your microphone'"
              [attr.aria-label]="call.mic() ? 'Mute microphone' : 'Unmute microphone'" (click)="call.toggle('audio')">
        <ng-container *ngTemplateOutlet="icon; context: { $implicit: 'mic', off: !call.mic() }" />
      </button>
      <button type="button" class="call-btn round" [class.off]="!call.cam()" [attr.aria-pressed]="!call.cam()"
              [attr.data-tip]="call.cam() ? 'Turn your camera off' : 'Turn your camera on'"
              [attr.aria-label]="call.cam() ? 'Turn camera off' : 'Turn camera on'" (click)="call.toggle('video')">
        <ng-container *ngTemplateOutlet="icon; context: { $implicit: 'cam', off: !call.cam() }" />
      </button>
      @if (store.isHost() && others()) {
        <button type="button" class="call-btn mute-all" [disabled]="!anyoneToMute()"
                [attr.data-tip]="anyoneToMute() ? 'Mute everyone else in the call (they can unmute themselves)' : 'Everyone else is already muted'"
                aria-label="Mute everyone" (click)="call.muteAll()">
          <ng-container *ngTemplateOutlet="icon; context: { $implicit: 'muteAll', off: true }" />
          <span class="call-label">Mute all</span>
        </button>
      }
      <button type="button" class="call-btn round leave" data-tip="Leave the video call (you stay in the game)"
              aria-label="Leave video" (click)="call.leave()">
        <ng-container *ngTemplateOutlet="icon; context: { $implicit: 'hangup', off: false }" />
      </button>
    }
  `,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class CallButtonsComponent {
  protected readonly call = inject(CallService);
  protected readonly store = inject(RoomStore);

  /** How many other players are in the call. */
  protected readonly others = computed(() => this.store.players().filter((p) => p.id !== this.store.youId() && p.media?.joined).length);
  protected readonly anyoneToMute = computed(() => this.store.players().some((p) => p.id !== this.store.youId() && p.connected && p.media?.joined && p.media.mic));
  protected readonly joinTip = computed(() => {
    const n = this.others();
    return n ? `${n} other player${n === 1 ? ' is' : 's are'} on video` : 'Turn on your camera and microphone';
  });

  protected paths(name: IconName): string[] {
    return CALL_ICONS[name];
  }
}
