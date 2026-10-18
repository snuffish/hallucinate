// A recording: what the browser's analyser heard in one reference clip, frame by frame, saved by
// `npm run clips:record` into reference/recordings/<name>.bins and replayed through the Listener in vitest.
//
//   "HLRC"  magic
//   u32 LE  header length
//   header  JSON: the recorder version, the audio's sha256, sample rate, frame step, the analyser's FFT
//           size and dB range, bins per frame
//   frames  binCount bytes per frame, the analyser's getByteFrequencyData, one frame every frameStep seconds

export const RECORDING_VERSION = 1;   // bump when the recorder changes what it hears, so every clip is recorded again

export interface Recording {
  version: number;
  audio: string;        // sha256 of the clip's audio file it was recorded from
  sampleRate: number;
  frameStep: number;    // seconds between frames; frame i is what the analyser held at (i + 1) * frameStep
  fftSize: number;
  minDecibels: number;
  maxDecibels: number;
  binCount: number;
  frames: Uint8Array;   // binCount bytes per frame
}

const MAGIC = 'HLRC';

export const recordingFile = (name: string): string => `${name}.bins`;

export function encodeRecording(r: Recording): Uint8Array {
  const { frames, ...header } = r;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + json.length + frames.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(frames, 8 + json.length);
  return out;
}

export function decodeRecording(bytes: Uint8Array): Recording {
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (bytes.length < 8 || magic !== MAGIC) throw new Error('not a recording (made by npm run clips:record)');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as Omit<Recording, 'frames'>;
  return { ...header, frames: bytes.slice(8 + length) };
}

/** Whether a recording still stands for the clip's audio: made from the same file by this recorder. */
export const isUpToDate = (r: Pick<Recording, 'version' | 'audio'> | null, audio: string): boolean =>
  !!r && r.version === RECORDING_VERSION && r.audio === audio;
