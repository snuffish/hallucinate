// Worker side of jpeg.ts: pixels in, a JPEG blob out.

interface Job { id: number; width: number; height: number; data: ArrayBuffer; quality: number }

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, width, height, data, quality } = e.data;
  try {
    const img = new ImageData(new Uint8ClampedArray(data), width, height);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
