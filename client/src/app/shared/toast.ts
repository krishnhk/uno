import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { UiService } from '../core/ui.service';

@Component({
  selector: 'app-toast',
  template: `<div id="toast" class="toast" role="status" [hidden]="ui.toastMessage() === null">{{ ui.toastMessage() }}</div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ToastComponent {
  protected readonly ui = inject(UiService);
}
