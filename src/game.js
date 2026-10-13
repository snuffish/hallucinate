// Beat Racer: walls spawn on the beat of whatever is playing. Steer between three
// lanes, dodge the walls, grab the orbs. Rendered by the "Beat Racer" shader.

const LANES = [-1, 0, 1];
const PLAYER_Z = 2;      // must match PZ in the shader
const SPAWN_Z = 40;
const MAX_OBJECTS = 12;  // must match uObs[] in the shader
const HIT_WIDTH = 0.55;
const FALLBACK_SPAWN = 0.9; // seconds; keeps the game going when no beats are detected

export class BeatRacer {
  constructor(hud) {
    this.hud = hud;
    this.best = Number(safeGet('hallucinate.best')) || 0;
    this.uniform = new Float32Array(MAX_OBJECTS * 4);
    this.reset();
  }

  reset() {
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
    this.renderHud();
  }

  steer(dir) {
    if (!this.over) this.lane = Math.max(-1, Math.min(1, this.lane + dir));
  }

  get multiplier() { return 1 + Math.floor(this.combo / 8); }

  onBeat() {
    if (this.over || this.sinceSpawn < 0.25) return;
    this.sinceSpawn = 0;
    const lanes = [...LANES].sort(() => Math.random() - 0.5);
    const walls = this.combo > 16 && Math.random() < 0.35 ? 2 : 1; // always leave a free lane
    for (let i = 0; i < walls; i++) this.objects.push({ x: lanes[i], z: SPAWN_Z, type: 0 });
    if (Math.random() < 0.5) this.objects.push({ x: lanes[walls], z: SPAWN_Z, type: 1 });
  }

  update(dt, level) {
    this.elapsed += dt;
    this.sinceSpawn += dt;
    this.flash *= Math.exp(-dt * 6);
    this.x += (this.lane - this.x) * (1 - Math.exp(-dt * 14));
    if (this.sinceSpawn > FALLBACK_SPAWN) this.onBeat();

    const speed = Math.min(22, 12 + this.elapsed * 0.1) + level * 6;
    this.distance += speed * dt;
    for (const o of this.objects) {
      const before = o.z;
      o.z -= speed * dt;
      if (o.done || before < PLAYER_Z || o.z >= PLAYER_Z) continue;
      o.done = true;
      const hit = Math.abs(o.x - this.x) < HIT_WIDTH;
      if (o.type === 1 && hit) { this.score += 10 * this.multiplier; this.combo++; o.collected = true; }
      if (o.type === 0 && !hit && !this.over) { this.score += this.multiplier; this.combo++; }
      if (o.type === 0 && hit && !this.over) this.crash();
    }
    this.objects = this.objects.filter((o) => o.z > 0.3 && !o.collected);
    this.renderHud();
  }

  crash() {
    this.lives--;
    this.combo = 0;
    this.flash = 1;
    if (this.lives > 0) return;
    this.over = true;
    if (this.score > this.best) {
      this.best = this.score;
      safeSet('hallucinate.best', String(this.best));
    }
  }

  uniforms() {
    const u = this.uniform.fill(0);
    [...this.objects].sort((a, b) => b.z - a.z).slice(0, MAX_OBJECTS).forEach((o, i) => {
      u.set([o.x, o.z, o.type, 1], i * 4);
    });
    return { uObs: u, uGame: [this.x, this.distance, this.flash] };
  }

  renderHud() {
    const { hud } = this;
    hud.score.textContent = this.score;
    hud.combo.textContent = this.combo ? `combo ${this.combo} · ×${this.multiplier}` : '';
    hud.lives.textContent = '♥'.repeat(Math.max(0, this.lives)) + '♡'.repeat(3 - Math.max(0, this.lives));
    hud.best.textContent = `best ${this.best}`;
    hud.over.hidden = !this.over;
  }
}

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }
