// JPEG encoding off the main thread: library thumbnails and the assistant's screenshots are encoded
// in a worker, so the visuals never stall while forty previews are made.

interface Pending { resolve: (blob: Blob) => void; reject: (err: Error) => void }

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    worker = new Worker(new URL('./jpeg.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.blob) p.resolve(e.data.blob); else p.reject(new Error(e.data.error ?? 'encode failed'));
  };
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new Error('JPEG worker failed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

// Encodes the pixels (they are transferred, so don't reuse `img` afterwards).
export function encodeJpeg(img: ImageData, quality = 0.85): Promise<Blob> {
  const w = getWorker();
  if (!w) return encodeOnMainThread(img, quality);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, width: img.width, height: img.height, data: img.data.buffer, quality }, [img.data.buffer]);
  });
}

async function encodeOnMainThread(img: ImageData, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
  return btoa(bin);
}
