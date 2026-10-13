// Main-window side of the projector output. Projector windows (output.html) render the show
// themselves at their own resolution; this sends them the scene shaders once (and whenever one
// changes) and the render state every frame, over a BroadcastChannel.

export const CHANNEL = 'hallucinate-output';
const STALE_MS = 3000;

export class OutputLink {
  constructor({ scenes, onStatus }) {
    this.scenes = scenes;
    this.onStatus = onStatus;
    this.outputs = new Map();   // id -> { w, h, fullscreen, fps, seen }
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = ({ data: m }) => {
      if (m.type === 'hello') { this.sendScenes(); this.sendMedia(this.mediaSource); }
      if (m.type === 'status') this.outputs.set(m.id, { ...m, seen: performance.now() });
      if (m.type === 'bye') this.outputs.delete(m.id);
      this.onStatus(this.status());
    };
    setInterval(() => this.onStatus(this.status()), 1000);   // notice projectors that went away
  }

  status() {
    const now = performance.now();
    for (const [id, o] of this.outputs) if (now - o.seen > STALE_MS) this.outputs.delete(id);
    return [...this.outputs.values()];
  }

  get connected() { return this.outputs.size > 0; }

  sendScenes() {
    this.channel.postMessage({ type: 'scenes', scenes: this.scenes.map(({ name, frag }) => ({ name, frag })) });
  }

  // A dropped File is shared as is (Blobs aren't copied between windows); a server file goes as its URL.
  // Either way projectors load the original, at full quality.
  sendMedia(source) {
    this.mediaSource = source;
    this.channel.postMessage({ type: 'media', source });
  }

  sendScene(index) {
    if (!this.connected) return;
    const { name, frag } = this.scenes[index];
    this.channel.postMessage({ type: 'scene', index, scene: { name, frag } });
  }

  // `params` holds the @param uniforms of the scenes on screen: { [sceneIndex]: uniforms }.
  sendFrame(state, params, resolution) {
    if (this.connected) this.channel.postMessage({ type: 'frame', state, params, resolution });
  }

  identify() {
    this.channel.postMessage({ type: 'identify' });
  }

  // Displays from the Window Management API (Chrome / Edge). Asks for permission the first time.
  async screens() {
    if (!('getScreenDetails' in window)) throw new Error('This browser can\'t list displays — open the projector window and drag it to the projector.');
    const details = await window.getScreenDetails();
    return details.screens;
  }

  open(screen) {
    const size = screen
      ? `left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`
      : 'width=1280,height=720';
    const win = window.open('output.html', 'hallucinate-output', `popup,${size}`);
    if (!win) throw new Error('The projector window was blocked. Allow pop-ups for this site and try again.');
    if (screen) { win.moveTo(screen.availLeft, screen.availTop); win.resizeTo(screen.availWidth, screen.availHeight); }
    win.focus();
    return win;
  }
}
