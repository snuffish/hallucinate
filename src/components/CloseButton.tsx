// The × in an overlay's header: closes it, and Esc does the same (its key badge says so).

import { useApp } from '../app/AppContext';
import { Kbd } from '../hotkeys/Kbd';
import { HOTKEYS } from '../hotkeys/registry';

// `onClose`: what closing does; by default it closes whichever overlay is open.
export function CloseButton({ id, className = '', onClose }: { id?: string; className?: string; onClose?: () => void }) {
  const app = useApp();
  return <button id={id} className={`${className} icon`.trim()} title="Close (Esc)" onClick={onClose ?? (() => app.setOverlay(null))}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>;
}
