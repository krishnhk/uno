import { Injectable, signal } from '@angular/core';

/**
 * How the game stage is laid out right now. The stage component measures the screen and writes these;
 * the video, throw and effects code reads them.
 */
@Injectable({ providedIn: 'root' })
export class StageLayoutService {
  /** Wide screens: the other players are name chips round a (virtual) table, with their cards fanned above. */
  readonly columns = signal(false);
  /** The video call has a column of boxes on each side of the table. */
  readonly rails = signal(false);
  /** Width of each video column in px (0 when there are none). */
  readonly railWidth = signal(0);
  /** Width of the docked log/chat panel in px (0 when closed or not docked). */
  readonly panelWidth = signal(0);
  readonly width = signal(0);
  readonly height = signal(0);
}
