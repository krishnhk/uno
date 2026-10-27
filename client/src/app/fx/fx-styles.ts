/**
 * Styles of the effects overlay (#fx-canvas, #fx-layer and the .fx-* elements). The shared stylesheet of the old client has no rules for
 * them, so the service injects these once. Everything is pointer-events: none so clicks reach the game underneath.
 */
export const FX_STYLES = `
#fx-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 900; }
#fx-layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 901; --fx-s: 1; }
#fx-layer * { pointer-events: none; }
#fx-layer .fx-ring { position: absolute; width: 200px; height: 200px; border-radius: 50%; }
#fx-layer .fx-disc { position: absolute; border-radius: 50%; opacity: 0; background: radial-gradient(circle closest-side, var(--c), transparent); }
#fx-layer .fx-float { position: absolute; transform: translate(-50%, -50%); opacity: 0; white-space: nowrap; font-weight: 900; font-size: var(--fs); color: var(--c); text-shadow: 0 3px 0 rgba(0, 0, 0, 0.55), 0 0 18px var(--c); }
#fx-layer .fx-flash { position: absolute; inset: 0; opacity: 0; background: radial-gradient(circle at 50% 45%, #fff 0%, rgba(255, 255, 255, 0.85) 45%, rgba(255, 255, 255, 0.5) 100%); }
#fx-layer .fx-vignette { position: absolute; inset: 0; opacity: 0; box-shadow: inset 0 0 160px 50px rgba(255, 60, 40, 0.55); }
#fx-layer .fx-chipglow { position: absolute; opacity: 0; border-radius: 18px; border: 2px solid var(--c); box-shadow: 0 0 22px 6px var(--c), inset 0 0 18px var(--c); }
#fx-layer .fx-word { position: absolute; opacity: 0; white-space: nowrap; font-weight: 900; font-size: var(--fs); line-height: 1; letter-spacing: 0.03em; color: var(--c); -webkit-text-stroke: 0.06em #1a0b3a; paint-order: stroke fill; text-shadow: 0 0.06em 0 rgba(0, 0, 0, 0.5), 0 0 0.4em var(--c); }
#fx-layer .fx-uno { color: #fff; -webkit-text-stroke: 0.07em var(--c); }
#fx-layer .fx-stamp { position: absolute; opacity: 0; transform: translate(-50%, -50%); display: grid; place-items: center; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.5)); }
#fx-layer .fx-stamp svg { position: absolute; inset: 0; }
#fx-layer .fx-skip-word { position: relative; font-weight: 900; letter-spacing: 0.06em; color: #fff; text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6); }
#fx-layer .fx-rays { position: absolute; opacity: 0; transform: translate(-50%, -50%); border-radius: 50%; background: repeating-conic-gradient(from 0deg, var(--c) 0deg 7deg, transparent 7deg 22deg); -webkit-mask-image: radial-gradient(circle closest-side, #000 8%, transparent 72%); mask-image: radial-gradient(circle closest-side, #000 8%, transparent 72%); }
#fx-layer .fx-gotcha { position: absolute; opacity: 0; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 0.08em; filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.55)); }
#fx-layer .fx-gotcha .fx-word { position: static; opacity: 1; }
#fx-layer .fx-busted { padding: 0.15em 0.9em; border-radius: 6px; font-weight: 900; letter-spacing: 0.3em; color: #fff; background: #ff3b52; box-shadow: 0 0 14px #ff3b52; }
#fx-layer .fx-place { position: absolute; opacity: 0; transform: translate(-50%, -90%); white-space: nowrap; font-weight: 900; font-size: var(--fs); line-height: 1; letter-spacing: 0.04em; color: transparent; background: linear-gradient(180deg, var(--g)); -webkit-background-clip: text; background-clip: text; filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.55)) drop-shadow(0 0 10px rgba(255, 210, 63, 0.6)); }
#fx-layer .fx-card { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: calc(var(--cw) * 0.12); background: radial-gradient(ellipse at 50% 50%, #e11d48 0 28%, #111 30%); border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5); will-change: transform; }
#fx-layer .fx-shadow { position: absolute; left: 0; top: 0; border-radius: 6px; background: #000; filter: blur(5px); will-change: transform; }
#fx-layer .fx-win { position: absolute; inset: 0; }
#fx-layer .fx-stack { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: calc(14px * var(--fx-s)); }
#fx-layer .fx-banner { display: flex; flex-direction: column; align-items: center; font-size: var(--bs); font-weight: 900; line-height: 1; letter-spacing: 0.03em; white-space: nowrap; color: #fff; -webkit-text-stroke: 0.05em #3b1a78; paint-order: stroke fill; text-shadow: 0 0.05em 0 #5b21b6, 0 0.1em 0 rgba(0, 0, 0, 0.5), 0 0 0.45em rgba(255, 210, 63, 0.8); }
#fx-layer .fx-banner.fx-other { font-size: calc(var(--bs) * 0.8); }
#fx-layer .fx-banner .fx-who { font-size: 0.7em; color: #ffe27a; }
#fx-layer .fx-tag { font-size: var(--ts); font-weight: 900; letter-spacing: 0.14em; color: transparent; background: linear-gradient(180deg, #fff3b0, #ffb81c 60%, #ff7a1c); -webkit-background-clip: text; background-clip: text; filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.55)) drop-shadow(0 0 14px rgba(255, 190, 40, 0.8)); }
#fx-layer .fx-trophy { filter: drop-shadow(0 12px 14px rgba(0, 0, 0, 0.5)) drop-shadow(0 0 24px rgba(255, 210, 63, 0.7)); }
#fx-layer .fx-trophy-svg { display: block; width: 100%; height: 100%; }
#fx-layer .fx-score { font-size: var(--ss); font-weight: 800; color: #ffe27a; text-shadow: 0 3px 0 rgba(0, 0, 0, 0.55), 0 0 16px rgba(255, 210, 63, 0.8); }
#fx-layer .fx-crown { position: absolute; transform: translate(-50%, -100%); font-size: var(--fs); line-height: 1; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6)); }
#fx-layer .fx-dim { position: absolute; inset: 0; opacity: 0; background: radial-gradient(circle at 50% 45%, rgba(10, 4, 30, 0.35), rgba(5, 2, 18, 0.85)); }
#fx-layer .fx-beam { position: absolute; top: 0; opacity: 0; transform-origin: 50% 0; mix-blend-mode: screen; background: linear-gradient(180deg, color-mix(in srgb, var(--c) 55%, transparent), transparent 85%); clip-path: polygon(46% 0, 54% 0, 100% 100%, 0 100%); }
`;
