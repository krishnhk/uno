import { ChangeDetectionStrategy, Component, ViewEncapsulation, effect, inject } from '@angular/core';
import { RoomStore } from './core/room.store';
import { FxService } from './fx/fx.service';
import { AvatarDialogComponent } from './dialogs/avatar-dialog';
import { ColorDialogComponent } from './dialogs/color-dialog';
import { HowtoDialogComponent } from './dialogs/howto-dialog';
import { ResultsDialogComponent } from './dialogs/results-dialog';
import { HomeComponent } from './home/home';
import { IntroComponent } from './intro/intro';
import { LobbyComponent } from './lobby/lobby';
import { SeatMenuComponent } from './lobby/seat-menu';
import { ToastComponent } from './shared/toast';
import { TooltipComponent } from './shared/tooltip';
import { StageComponent } from './stage/stage';
import { TopbarComponent } from './topbar/topbar';

/**
 * The page: the same structure as the plain-JS version's index.html, split into components.
 * (Keep the ids and classes: the shared CSS in styles/ is written against them.)
 */
@Component({
  selector: 'app-root',
  imports: [
    IntroComponent, TopbarComponent, HomeComponent, LobbyComponent, StageComponent,
    AvatarDialogComponent, ColorDialogComponent, ResultsDialogComponent, HowtoDialogComponent,
    SeatMenuComponent, ToastComponent, TooltipComponent,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class App {
  protected readonly store = inject(RoomStore);
  // Created up front so it is already listening for the first update.
  private readonly fx = inject(FxService);

  constructor() {
    // The page's overall state is a class on <body> (the CSS keys off it).
    effect(() => {
      const inRoom = this.store.inRoom();
      const playing = this.store.playing();
      const body = document.body.classList;
      body.toggle('on-home', !inRoom);
      body.toggle('on-lobby', inRoom && !playing);
      body.toggle('in-game', playing);
    });
  }
}
