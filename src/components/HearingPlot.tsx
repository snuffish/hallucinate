import { useEffect, useRef } from 'react';

export type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

// The Hearing monitor's plots: a canvas drawn at the device's pixel ratio whenever `draw` changes.
export function Plot({ draw, label, height = 56 }: { draw: Draw; label: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const c = canvas?.getContext('2d');
    if (!canvas || !c) return;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = height;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    draw(c, w, h);
  }, [draw, height]);
  return <canvas ref={ref} className="hearing-plot" style={{ height }} role="img" aria-label={label} />;
}
