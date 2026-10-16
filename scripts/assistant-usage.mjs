// What the assistant's subscription-backend conversations cost, turn by turn, from Claude Code's own
// session logs (the CLI keeps one JSONL per conversation, filed under the adapter's working directory).
//   node scripts/assistant-usage.mjs              the newest conversation
//   node scripts/assistant-usage.mjs <id|path>    one conversation (its threadId, or a .jsonl path)
//   node scripts/assistant-usage.mjs --list       the conversations on disk, newest first
// "Weighted" prices every token as a multiple of one uncached input token, with Anthropic's standard
// multipliers: cache read 0.1×, 5-minute cache write 1.25×, 1-hour cache write 2×, output 5×. The "in"
// figure the panel used to show counts all of them at 1×, which mostly measures cache reads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WEIGHT = { read: 0.1, write5m: 1.25, write1h: 2, fresh: 1, out: 5 };
const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

function sessions() {
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => d.includes('hallucinate-assistant')) : [];
  return dirs.flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(root, d, f)))
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

const userText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : '');

// One turn per message the user sent; one call per model response (a response spans several lines, one per content block).
function turnsOf(lines) {
  const turns = [];
  const seen = new Set();
  for (const e of lines) {
    if (e.type === 'user') {
      const text = userText(e.message?.content);
      if (text) turns.push({ text, at: e.timestamp, calls: [] });
      continue;
    }
    if (e.type !== 'assistant' || !turns.length) continue;
    const m = e.message ?? {};
    if (seen.has(m.id) || m.model === '<synthetic>') continue;
    seen.add(m.id);
    const u = m.usage ?? {};
    const write = u.cache_creation_input_tokens ?? 0;
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write;
    turns.at(-1).calls.push({ model: m.model, read: u.cache_read_input_tokens ?? 0, write5m, write1h, fresh: u.input_tokens ?? 0, out: u.output_tokens ?? 0 });
  }
  return turns;
}

const KEYS = ['read', 'write5m', 'write1h', 'fresh', 'out'];
const sum = (calls) => Object.fromEntries(KEYS.map((k) => [k, calls.reduce((n, c) => n + c[k], 0)]));
const weighted = (t) => KEYS.reduce((n, k) => n + t[k] * WEIGHT[k], 0);
const inOf = (t) => t.read + t.write5m + t.write1h + t.fresh;
const k = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '-');

function report(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const turns = turnsOf(lines);
  const rows = turns.map((t, i) => ({ i: i + 1, text: t.text.replace(/\s+/g, ' '), calls: t.calls.length, context: t.calls.at(-1) ? inOf(t.calls.at(-1)) : 0, ...sum(t.calls) }));
  const total = sum(turns.flatMap((t) => t.calls));
  const models = [...new Set(turns.flatMap((t) => t.calls.map((c) => c.model)))].join(', ');
  console.log(`${file}\nmodel: ${models || '-'}\n`);
  const head = ['#', 'calls', 'in (1×)', 'context', 'reads', 'writes', 'out', 'weighted', 'message'];
  const body = rows.map((r) => [r.i, r.calls, k(inOf(r)), k(r.context), k(r.read), k(r.write5m + r.write1h), k(r.out), k(weighted(r)), r.text.slice(0, 48)]);
  const table = [head, ...body].map((r) => r.map(String));
  const width = head.map((_, c) => Math.max(...table.map((r) => (c === head.length - 1 ? 0 : r[c].length))));
  for (const r of table) console.log(r.map((v, c) => (c === head.length - 1 ? v : v.padStart(width[c]))).join('  '));
  const w = weighted(total);
  console.log(`\ntotal: ${k(inOf(total))} in at 1×, ${k(total.out)} out → ${k(w)} weighted`);
  console.log(`share of the weighted cost: cache reads ${pct(total.read * WEIGHT.read, w)}, cache writes ${pct(total.write5m * WEIGHT.write5m + total.write1h * WEIGHT.write1h, w)}, uncached input ${pct(total.fresh, w)}, output ${pct(total.out * WEIGHT.out, w)}`);
}

const arg = process.argv[2];
const all = sessions();
if (arg === '--list') {
  for (const s of all) console.log(`${new Date(s.mtime).toLocaleString()}  ${path.basename(s.file, '.jsonl')}`);
} else {
  const file = !arg ? all[0]?.file : fs.existsSync(arg) ? arg : all.find((s) => path.basename(s.file, '.jsonl') === arg)?.file;
  if (!file) { console.error(arg ? `No conversation "${arg}" (try --list).` : `No assistant conversations under ${root}.`); process.exit(1); }
  report(file);
}
