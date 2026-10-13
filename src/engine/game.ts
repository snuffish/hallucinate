// Beat Racer: walls spawn on the beat of whatever is playing. Steer between three
// lanes, dodge the walls, grab the orbs. Rendered by the "Beat Racer" shader; the HUD is a
// React component fed by hud().

import { KEYS, readString, writeString } from '../state/persistence';

const LANES = [-1, 0, 1];
const PLAYER_Z = 2;      // must match PZ in the shader
const SPAWN_Z = 40;
const MAX_OBJECTS = 12;  // must match uObs[] in the shader
const HIT_WIDTH = 0.55;
const FALLBACK_SPAWN = 0.9; // seconds; keeps the game going when no beats are detected

interface Obstacle { x: number; z: number; type: 0 | 1; done?: boolean; collected?: boolean }

export interface GameHud {
  score: number;
  combo: number;
  multiplier: number;
  lives: number;
  best: number;
  over: boolean;
}

export class BeatRacer {
  best = Number(readString(KEYS.best)) || 0;
  private readonly uniform = new Float32Array(MAX_OBJECTS * 4);
  private readonly gameUniform = [0, 0, 0];
  private objects: Obstacle[] = [];
  private lane = 0;
  private x = 0;
  private distance = 0;
  private elapsed = 0;
  private sinceSpawn = 0;
  score = 0;
  combo = 0;
  lives = 3;
  private flash = 0;
  over = false;
  version = 0;   // bumps whenever the HUD-visible state changes

  constructor() {
    this.reset();
  }

  reset(): void {
    this.objects = [];
    this.lane = 0;
    this.x = 0;
    this.distance = 0;
    this.elapsed = 0;
    this.sinceSpawn = 0;
    this.score = 0;
    this.combo = 0;
    this.lives = 3;
    this.flash = 0;
    this.over = false;
    this.version++;
  }

  steer(dir: number): void {
    if (!this.over) this.lane = Math.max(-1, Math.min(1, this.lane + dir));
  }

  get multiplier(): number { return 1 + Math.floor(this.combo / 8); }

  onBeat(): void {
    if (this.over || this.sinceSpawn < 0.25) return;
    this.sinceSpawn = 0;
    const lanes = [...LANES].sort(() => Math.random() - 0.5);
    const walls = this.combo > 16 && Math.random() < 0.35 ? 2 : 1; // always leave a free lane
    for (let i = 0; i < walls; i++) this.objects.push({ x: lanes[i]!, z: SPAWN_Z, type: 0 });
    if (Math.random() < 0.5) this.objects.push({ x: lanes[walls]!, z: SPAWN_Z, type: 1 });
  }

  update(dt: number, level: number): void {
    this.elapsed += dt;
    this.sinceSpawn += dt;
    this.flash *= Math.exp(-dt * 6);
    this.x += (this.lane - this.x) * (1 - Math.exp(-dt * 14));
    if (this.sinceSpawn > FALLBACK_SPAWN) this.onBeat();

    const speed = Math.min(22, 12 + this.elapsed * 0.1) + level * 6;
    this.distance += speed * dt;
    const before = { score: this.score, combo: this.combo, lives: this.lives, over: this.over };
    for (const o of this.objects) {
      const z0 = o.z;
      o.z -= speed * dt;
      if (o.done || z0 < PLAYER_Z || o.z >= PLAYER_Z) continue;
      o.done = true;
      const hit = Math.abs(o.x - this.x) < HIT_WIDTH;
      if (o.type === 1 && hit) { this.score += 10 * this.multiplier; this.combo++; o.collected = true; }
      if (o.type === 0 && !hit && !this.over) { this.score += this.multiplier; this.combo++; }
      if (o.type === 0 && hit && !this.over) this.crash();
    }
    this.objects = this.objects.filter((o) => o.z > 0.3 && !o.collected);
    if (before.score !== this.score || before.combo !== this.combo || before.lives !== this.lives || before.over !== this.over) this.version++;
  }

  private crash(): void {
    this.lives--;
    this.combo = 0;
    this.flash = 1;
    if (this.lives > 0) return;
    this.over = true;
    if (this.score > this.best) {
      this.best = this.score;
      writeString(KEYS.best, String(this.best));
    }
  }

  // Shader uniforms; the typed arrays are reused every frame.
  uniforms(): { uObs: Float32Array; uGame: number[] } {
    const u = this.uniform.fill(0);
    [...this.objects].sort((a, b) => b.z - a.z).slice(0, MAX_OBJECTS).forEach((o, i) => {
      u[i * 4] = o.x; u[i * 4 + 1] = o.z; u[i * 4 + 2] = o.type; u[i * 4 + 3] = 1;
    });
    this.gameUniform[0] = this.x; this.gameUniform[1] = this.distance; this.gameUniform[2] = this.flash;
    return { uObs: u, uGame: this.gameUniform };
  }

  hud(): GameHud {
    return { score: this.score, combo: this.combo, multiplier: this.multiplier, lives: this.lives, best: this.best, over: this.over };
  }
}
