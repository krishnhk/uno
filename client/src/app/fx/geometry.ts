import { RoomView } from '../core/models';
import { FxStage, Spot } from './fx-stage';

/** Where a player's chip is on screen (falls back to the upper middle when it is not found). */
export function spot(st: FxStage, id: string | null | undefined, view: RoomView): Spot {
  const esc = String(id ?? '').replace(/["\\]/g, '');
  const selectors = id && id === view.youId
    ? ['#my-badge .pbadge', '#my-badge']
    : [
      `.opp-tile[data-player="${esc}"]`,
      `.opp-badge[data-player="${esc}"] .pbadge`,
      `.opp-compact[data-player="${esc}"] .pbadge`,
      `#opponents [data-player="${esc}"] .pb-avatar`,
      `.vtile[data-player="${esc}"]`,
    ];
  for (const s of selectors) {
    let r: Spot | null = null;
    try {
      r = st.rectOf(document.querySelector(s));
    } catch {
      // Bad selector.
    }
    if (r) return r;
  }
  return { x: st.W / 2, y: st.H * 0.4, w: 90, h: 60, el: null };
}

export function pileRect(st: FxStage): Spot {
  return st.rectOf(document.querySelector('#stage-center .discard')) ?? { x: st.W / 2, y: st.H / 2, w: 70, h: 105, el: null };
}

export function deckRect(st: FxStage): Spot {
  return st.rectOf(document.querySelector('#stage-center .deck')) ?? pileRect(st);
}

export function nameOf(id: string | null | undefined, view: RoomView): string {
  return view.players.find((p) => p.id === id)?.name ?? 'Someone';
}
