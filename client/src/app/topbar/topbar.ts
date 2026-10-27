import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { RoomStore } from '../core/room.store';
import { UtilButtonsComponent } from '../shared/util-buttons';

@Component({
  selector: 'app-topbar',
  imports: [UtilButtonsComponent],
  template: `
    <header class="topbar">
      <h1><span class="logo">UNO</span> Online</h1>
      <div class="topbar-right">
        <!-- In the lobby these two live in the lobby header instead -->
        @if (!store.inRoom() || store.playing()) {
          <app-util-buttons />
        }
      </div>
    </header>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class TopbarComponent {
  protected readonly store = inject(RoomStore);
}
