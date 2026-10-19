// PROTOTYPE, throwaway (branch prototype/hearing-monitor-variants): a floating bar that flips between UI variants.
// The variant lives in ?variant= so it survives a reload and can be shared. Alt+←/→ cycle (plain arrows change the
// scene). Dev builds only: a production build always shows the first variant and no bar.

import { useEffect, useState } from 'react';
import './PrototypeSwitcher.css';

export interface PrototypeVariant { key: string; name: string }

function readVariant(variants: readonly PrototypeVariant[]): string {
  const asked = new URLSearchParams(location.search).get('variant');
  return variants.some((v) => v.key === asked) ? asked! : variants[0]!.key;
}

export function usePrototypeVariant(variants: readonly PrototypeVariant[]): [string, (key: string) => void] {
  const [current, setCurrent] = useState(() => (import.meta.env.DEV ? readVariant(variants) : variants[0]!.key));
  const set = (key: string) => {
    const url = new URL(location.href);
    url.searchParams.set('variant', key);
    history.replaceState(history.state, '', url);
    setCurrent(key);
  };
  return [current, set];
}

// The view shown inside a variant, kept in ?view= like the variant. Alt+↑/↓ step through them.
export function usePrototypeView<V extends string>(views: readonly V[]): [V, (view: V) => void] {
  const [asked, setAsked] = useState(() => new URLSearchParams(location.search).get('view'));
  const current = views.find((v) => v === asked) ?? views[0]!;
  const set = (view: V) => {
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    history.replaceState(history.state, '', url);
    setAsked(view);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      e.stopPropagation();
      const i = views.indexOf(current), by = e.key === 'ArrowUp' ? -1 : 1;
      set(views[(i + by + views.length) % views.length]!);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return [current, set];
}

export function PrototypeSwitcher({ variants, current, onChange }: { variants: readonly PrototypeVariant[]; current: string; onChange: (key: string) => void }) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current));
  const step = (by: number) => onChange(variants[(i + by + variants.length) % variants.length]!.key);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      e.stopPropagation();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[i]!;
  return (
    <div className="proto-switcher" role="toolbar" aria-label="Prototype variants">
      <button type="button" onClick={() => step(-1)} title="Previous variant (Alt+←)">←</button>
      <span><b>{v.key}</b> {v.name} <small>{i + 1}/{variants.length}</small></span>
      <button type="button" onClick={() => step(1)} title="Next variant (Alt+→)">→</button>
    </div>
  );
}
