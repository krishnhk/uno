import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { RoomStore } from '../core/room.store';
import { UiService } from '../core/ui.service';

/** How to play and the connection status: shown in the top bar, and in the lobby header while you are in the lobby. */
@Component({
  selector: 'app-util-buttons',
  template: `
    <button id="howto-btn" type="button" class="chip-btn howto-btn" aria-haspopup="dialog" (click)="ui.howtoOpen.set(true)"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"></path><path d="M4 21V5M9 8h6"></path></svg>How to play</button>
    <span id="conn" class="conn" [class.online]="store.connected()">{{ store.connected() ? 'Connected' : 'Reconnecting…' }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class UtilButtonsComponent {
  protected readonly store = inject(RoomStore);
  protected readonly ui = inject(UiService);
}
