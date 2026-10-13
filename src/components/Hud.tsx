import { useUI } from '../app/AppContext';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';

// Beat Racer's score overlay. Only rendered while the game scene is on screen.
export function Hud() {
  const hud = useUI((ui) => ui.hud);
  if (!hud) return <div id="hud" className="hud" hidden />;
  return (
    <div id="hud" className="hud">
      <div id="hud-score" className="hud-score">{hud.score}</div>
      <div id="hud-combo">{hud.combo ? `combo ${hud.combo} · ×${hud.multiplier}` : ''}</div>
      <div id="hud-lives">{'♥'.repeat(Math.max(0, hud.lives)) + '♡'.repeat(3 - Math.max(0, hud.lives))}</div>
      <div id="hud-best">best {hud.best}</div>
      <div id="hud-over" className="hud-over" hidden={!hud.over}>GAME OVER<small>Press <Kbd hotkey={HOTKEYS.restartGame} /> to race again</small></div>
    </div>
  );
}
