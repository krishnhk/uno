import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { avatarImageUrl, avatarLook } from '../core/avatars';
import { RoomStore } from '../core/room.store';
import { UiService } from '../core/ui.service';

/** The home screen: your name and avatar, create a room, join a room. */
@Component({
  selector: 'app-home',
  template: `
    <section id="home" class="home" [hidden]="store.inRoom()">
      <div class="hero">
        <h2 class="hero-title">The classic card game, online with 2 to 6 friends.</h2>
      </div>
      <ol class="steps">
        <li class="step"><span class="step-no">1</span><span class="step-text"><b>Create a room</b><small>Pick a name and get a code</small></span></li>
        <li class="step"><span class="step-no">2</span><span class="step-text"><b>Share the code</b><small>Send the 6 letters to your friends</small></span></li>
        <li class="step"><span class="step-no">3</span><span class="step-text"><b>Shout UNO!</b><small>Down to one card? Say it first</small></span></li>
      </ol>

      <div class="name-card">
        <label class="name-field" for="name">Your name</label>
        <input id="name" maxlength="16" autocomplete="nickname" placeholder="Type your name to play"
          [value]="store.name()" (input)="store.setName($any($event.target).value)">
        <button id="name-avatar" type="button" class="name-avatar avatar-button" aria-label="Pick your avatar" data-tip="Pick your avatar"
          [class.has-image]="!!look().image" [style.background]="chosen() ? look().background : null" (click)="ui.avatarPickerOpen.set(true)">
          <span id="name-avatar-face" [class.has-image]="!!look().image">
            @if (look().image; as image) {
              <img class="avatar-img" [src]="imageUrl(image)" alt="" draggable="false" />
            } @else {
              {{ chosen() ? look().text : '?' }}
            }
          </span>
          <span class="pick-label">Pick avatar</span>
        </button>
      </div>

      <div class="home-grid">
        <form id="create-form" class="home-panel create" (submit)="$event.preventDefault(); store.createRoom()">
          <h2><span class="dot" aria-hidden="true"></span>Create a room</h2>
          <p>Be the host: get a fresh code, invite your friends, and start when everyone is in.</p>
          <div class="panel-row">
            <button type="submit" class="btn-chunky yellow"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Create room</button>
          </div>
        </form>

        <form id="join-form" class="home-panel join" (submit)="join($event, codeInput.value)">
          <h2><span class="dot" aria-hidden="true"></span>Join a room</h2>
          <p>Got a code from a friend? Type the 6 letters and jump right in.</p>
          <div class="panel-row">
            <input #codeInput name="code" class="code-input" aria-label="Room code" maxlength="6" autocapitalize="characters" autocomplete="off"
              spellcheck="false" required placeholder="ABC123" (input)="codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')">
            <button type="submit" class="btn-chunky blue"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>Join</button>
          </div>
        </form>
      </div>
    </section>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class HomeComponent {
  protected readonly store = inject(RoomStore);
  protected readonly ui = inject(UiService);
  protected readonly imageUrl = avatarImageUrl;

  private readonly trimmed = computed(() => this.store.name().trim());
  protected readonly look = computed(() => avatarLook(this.trimmed() || '?', this.store.avatar()));
  /** Something to show instead of the question mark: a name or a picked picture. */
  protected readonly chosen = computed(() => Boolean(this.trimmed() || this.store.avatar().image));

  protected join(event: Event, code: string): void {
    event.preventDefault();
    void this.store.joinRoom(code);
  }
}
