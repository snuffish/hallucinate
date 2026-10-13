// In-app assistant: POST /api/assistant streams one Claude turn back to the browser.
//
// The browser owns the conversation and runs the tools (they act on the renderer, the editors and
// the scene library), so each request is one model turn: text and thinking stream as `delta` events,
// tool calls are announced as they start, and the complete message arrives as `message` (echo its
// content back unchanged next turn). The API key stays here, on the server.
//
// Credentials: ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile).
// Optional: ASSISTANT_MODEL (default claude-opus-5-5), ASSISTANT_EFFORT (default high).

import Anthropic from '@anthropic-ai/sdk';
import { COMMON } from '../src/scenes.js';
import { TOOLS } from '../src/assistant-tools.js';

const MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ASSISTANT_EFFORT || 'high';
const MAX_BODY = 30 * 1024 * 1024;   // screenshots travel back as base64 images
const SETUP = 'The assistant needs an Anthropic API key. Stop the dev server, run  export ANTHROPIC_API_KEY=sk-ant-…  (or `ant auth login`), then start it again with  npm run dev.';

// Stable, so it's cached across turns (prompt caching works on the exact prefix).
const SYSTEM = `You are the assistant built into Hallucinate, a music visualizer that renders psychedelic, audio-reactive WebGL2 shader scenes in the browser. You help the user create and edit scenes, tweak their live parameters and the global look, and explain how things work. You act through your tools; the user watches the result live behind the chat panel.

# How scenes work
A scene is the body of a GLSL ES 3.00 fragment shader. The app prepends this header, so never redeclare anything in it:

\`\`\`glsl
${COMMON.trim()}
\`\`\`

The body declares whatever it needs at the top level, then \`void main()\` writes \`fragColor\`. \`centered()\` gives the pixel position with (0,0) in the middle and y from -0.5 to 0.5. Colour output around 0-1.5 is right: the display tonemaps, adds motion trails and colour grading afterwards. Use rainbow()/neon() with + uHue so the user's colour slider and colour cycling keep working.

# Live parameters
A top-level uniform or const followed by \`// @param\` gets a control in the Parameters overlay, adjustable while the scene runs:
  uniform float uGlow;                 // @param min=0 max=3 default=1 label="Glow"
  const float RINGS = 30.;             // @param min=5 max=80 int
  const vec3 TINT = vec3(1., .3, .8);  // @param color
  uniform bool uMirror;                // @param default=true
  uniform vec2 uCentre;                // @param min=-.5 max=.5
Types: float, bool, vec2, vec3, vec4. Options: min max step default label int color. Constants become uniforms, so give every new scene a handful of meaningful parameters (counts, speeds, sizes, colours, on/off layers) whose defaults are the look you intend.

# GLSL ES 3.00 rules that commonly break compiles
- No implicit int-to-float conversion: write 1. or 1.0, never 1, in float expressions; float(i) for loop counters.
- Loops need a constant bound. For a parameter-controlled count write: for (int i = 0; i < 16; i++) { if (float(i) >= COUNT) break; ... }
- Index arrays only within their size; @param lines must be at the top level, never inside a function.
- Keep it fast: it runs every frame at full screen. Raymarch at most ~100 steps, nested loops modestly.

# Making it feel musical
- uBass, uMid, uHigh, uLevel and uBeat jump with every hit. Drive brightness, glow, colour and size with them, never position, phase, rotation or zoom: those make the picture jerk on every kick.
- uTime already speeds up with the music, so motion driven by uTime stays smooth and still feels the beat.
- spec(x) is the live spectrum (0 bass … 1 treble), wave(x) the waveform; uBright (dark … bright timbre) and uMood (calm … energetic) change slowly over seconds.
- media(p) is an image or video the user dropped in (a test pattern otherwise); wrap a final colour built from it in untone() for true colours.

# Working style
- Before changing a scene, read its code. When unsure what is on screen or what scenes exist, call get_app_state.
- write_scene_code and create_scene compile immediately and return errors with line numbers; fix and retry until it compiles. After a real change, use look_at_scene to check the result (it renders with stand-in audio), and adjust if it doesn't match the intent.
- For a new idea, create a new scene rather than overwriting one the user didn't ask you to change. When asked to modify a scene, edit that scene; the user can undo your change from the panel and revert built-in scenes to their original.
- To change values the scene already exposes, prefer set_parameters over rewriting code.
- Replies appear in a narrow chat panel: keep them short. Say what you made or changed and how to tweak it; don't paste whole shaders into the chat unless asked, the code is in the editor (E).`;

let client;

export function createAssistant() {
  return async function handle(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    let messages;
    try {
      ({ messages } = JSON.parse(await readBody(req)));
      if (!Array.isArray(messages) || !messages.length) throw new Error('no messages');
    } catch (err) {
      return json(res, 400, { error: `Bad request: ${err.message}` });
    }
    try {
      client ??= new Anthropic();
    } catch {
      return json(res, 503, { error: SETUP });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let closed = false, stream = null;
    res.on('close', () => { closed = true; stream?.abort(); });   // the user pressed Stop

    // A tool input that streamed in as unparseable JSON makes finalMessage() reject: re-run the turn
    // (it was never added to the history). API errors are not retried here.
    for (let attempt = 0; !closed; attempt++) {
      try {
        stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',   // if the model declines, the API retries on a fallback model in the same call
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: EFFORT },
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages,
        });
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            send('tool', { id: event.content_block.id, name: event.content_block.name });
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') send('delta', { kind: 'text', text: event.delta.text });
            else if (event.delta.type === 'thinking_delta') send('delta', { kind: 'thinking', text: event.delta.thinking });
          }
        }
        const message = await stream.finalMessage();
        send('message', { content: message.content, stop_reason: message.stop_reason, stop_details: message.stop_details ?? null, model: message.model, usage: message.usage });
        break;
      } catch (err) {
        if (closed) break;
        const badToolJson = !(err instanceof Anthropic.APIError) && /Unable to parse tool parameter JSON/.test(err?.message ?? '');
        if (badToolJson && attempt < 2) { send('retry', {}); continue; }
        send('failed', { error: describe(err) });
        break;
      }
    }
    res.end();
  };
}

// Specific to general, so the user learns what to do about it.
function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check ANTHROPIC_API_KEY and restart the dev server.';
  if (err instanceof Anthropic.PermissionDeniedError) return `This API key can't use ${MODEL}. Set ASSISTANT_MODEL to a model you have access to.`;
  if (err instanceof Anthropic.NotFoundError) return `Model "${MODEL}" wasn't found. Check ASSISTANT_MODEL.`;
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API — wait a moment and try again.';
  if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn\'t reach the Anthropic API. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ''}: ${err.message}`;
  if (/api[_ ]?key|auth/i.test(err?.message ?? '')) return SETUP;
  return err?.message ?? String(err);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('conversation too large — start a new chat')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
