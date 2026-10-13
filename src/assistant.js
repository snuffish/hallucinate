// The in-app AI assistant panel. It holds the conversation, streams each Claude turn from
// /api/assistant (see server/assistant.js), runs the tools Claude asks for against the app, and
// sends the results back until Claude is done. Changes it makes can be undone from the panel.

import { validateInput } from './assistant-tools.js';

const MAX_TURNS = 30;   // tool round-trips per request, so a confused loop can't run forever
const VERBS = {
  get_app_state: () => 'Looking around',
  read_scene_code: (i) => `Reading ${i.scene ?? 'the scene'}`,
  write_scene_code: (i) => `Editing ${i.scene ?? 'the scene'}`,
  create_scene: (i) => `Creating "${i.name ?? 'a scene'}"`,
  set_parameters: () => 'Setting parameters',
  set_look: () => 'Adjusting the look',
  switch_scene: (i) => `Switching to ${i.scene ?? 'a scene'}`,
  look_at_scene: (i) => `Looking at ${i.scene ?? 'the scene'}`,
};

export class Assistant {
  // app: the tool implementations (see main.js), each returning { result, error, images, undo, label }.
  constructor({ app }) {
    this.app = app;
    this.messages = [];      // the conversation, exactly as the API returned it (thinking blocks included)
    this.undoStack = [];
    this.busy = false;
    this.controller = null;
    const $ = (id) => document.getElementById(id);
    this.root = $('ai');
    this.log = $('ai-log');
    this.input = $('ai-input');
    this.sendButton = $('ai-send');
    this.undoButton = $('ai-undo');
    this.status = $('ai-status');

    $('ai-close').onclick = () => this.toggle(false);
    $('ai-new').onclick = () => this.reset();
    this.undoButton.onclick = () => this.undo();
    this.sendButton.onclick = () => (this.busy ? this.stop() : this.submit());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();   // typing here shouldn't trigger the app's shortcuts
      if (e.key === 'Escape') return this.toggle(false);
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!this.busy) this.submit(); }
    });
    this.root.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-prompt]');
      if (chip && !this.busy) { this.input.value = chip.dataset.prompt; this.submit(); }
    });
    this.updateButtons();
  }

  get isOpen() { return !this.root.hidden; }

  toggle(open = !this.isOpen) {
    this.root.hidden = !open;
    if (open) this.input.focus();
    else if (this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  reset() {
    if (this.busy) this.stop();
    this.messages = [];
    this.log.querySelectorAll('.ai-msg, .ai-note').forEach((n) => n.remove());
    this.log.querySelector('.ai-welcome').hidden = false;
    this.setStatus('');
  }

  submit() {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.run(text);
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
  }

  // ---------- The loop ----------

  async run(text) {
    this.log.querySelector('.ai-welcome').hidden = true;
    this.addBubble('user').body.textContent = text;
    this.messages.push({ role: 'user', content: text });
    this.busy = true;
    this.stopped = false;
    this.updateButtons();
    try {
      for (let turn = 1; turn <= MAX_TURNS; turn++) {
        this.setStatus(turn === 1 ? 'Thinking…' : 'Continuing…');
        const message = await this.requestTurn();
        if (!message) return;   // stopped or failed; the unfinished turn was never added
        this.messages.push({ role: 'assistant', content: message.content });

        if (message.stop_reason === 'refusal') return this.note(`Claude declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`, 'error');
        const uses = message.content.filter((b) => b.type === 'tool_use');
        if (!uses.length) {
          if (message.stop_reason === 'max_tokens') this.note('The reply was cut off (too long).', 'error');
          return;
        }
        // Every tool call gets exactly one result, in a single message.
        const results = [];
        for (const use of uses) {
          if (this.stopped) results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Stopped by the user.', is_error: true });
          else if (message.stop_reason === 'max_tokens') results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Your tool input was cut off because the reply got too long. Send it again, shorter.', is_error: true });
          else results.push(await this.execute(use));
        }
        this.messages.push({ role: 'user', content: results });
        if (this.stopped) return this.note('Stopped.');
      }
      this.note(`Stopped after ${MAX_TURNS} steps — ask again to continue.`);
    } finally {
      this.busy = false;
      this.controller = null;
      this.setStatus('');
      this.updateButtons();
    }
  }

  // Streams one turn into a new reply bubble; resolves with the complete message, or null.
  async requestTurn() {
    this.controller = new AbortController();
    const view = this.addBubble('assistant');
    let text = '', thinking = '';
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.messages }),
        signal: this.controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `The assistant server answered ${res.status}.`);
      }
      let message = null;
      for await (const { event, data } of readEvents(res.body)) {
        if (event === 'delta' && data.kind === 'text') { text += data.text; view.setText(text); }
        else if (event === 'delta' && data.kind === 'thinking') { thinking += data.text; view.setThinking(thinking); }
        else if (event === 'tool') view.addTool(data.id, data.name);
        else if (event === 'retry') { text = ''; thinking = ''; view.clear(); }
        else if (event === 'message') message = data;
        else if (event === 'failed') throw new Error(data.error);
      }
      if (!message) throw new Error('The reply ended unexpectedly.');
      if (message.model) this.model = message.model;
      view.finish(message);
      return message;
    } catch (err) {
      view.dropIfEmpty();
      if (err.name === 'AbortError') this.note('Stopped.');
      else this.note(err.message, 'error');
      return null;
    }
  }

  async execute(use) {
    const chip = this.log.querySelector(`[data-tool="${use.id}"]`);
    const input = use.input ?? {};
    const label = (VERBS[use.name] ?? (() => use.name))(input);
    chip?.setLabel(`${label}…`);
    const invalid = validateInput(use.name, input);
    if (invalid) {
      chip?.done(`${label} — invalid input`, 'error');
      return { type: 'tool_result', tool_use_id: use.id, content: `Invalid input: ${invalid}`, is_error: true };
    }
    let out;
    try {
      out = await this.app[use.name](input);
    } catch (err) {
      out = { error: `The app hit an error: ${err.message}` };
    }
    if (out.undo) {
      this.undoStack.push({ label: out.label ?? label, undo: out.undo });
      this.updateButtons();
    }
    chip?.done(out.label ?? label, out.error ? 'error' : 'ok', out.images);
    if (out.error) return { type: 'tool_result', tool_use_id: use.id, content: out.error, is_error: true };
    const text = typeof out.result === 'string' ? out.result : JSON.stringify(out.result ?? { ok: true });
    if (!out.images?.length) return { type: 'tool_result', tool_use_id: use.id, content: text };
    return {
      type: 'tool_result', tool_use_id: use.id,
      content: [...out.images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })), { type: 'text', text }],
    };
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return;
    step.undo();
    this.note(`Undid: ${step.label}`);
    // Tell Claude, so it doesn't build on a change that's gone.
    this.messages.push({ role: 'user', content: `(The user pressed Undo and reverted your change: ${step.label}.)` });
    this.updateButtons();
  }

  // ---------- View ----------

  updateButtons() {
    this.sendButton.textContent = this.busy ? 'Stop' : 'Send';
    this.sendButton.classList.toggle('stop', this.busy);
    this.undoButton.disabled = !this.undoStack.length || this.busy;
    this.undoButton.title = this.undoStack.length ? `Undo: ${this.undoStack.at(-1).label}` : 'Nothing to undo';
  }

  setStatus(text) { this.status.textContent = text; }

  note(text, kind = '') {
    const p = document.createElement('p');
    p.className = `ai-note ${kind}`;
    p.textContent = text;
    this.log.append(p);
    this.scroll();
  }

  scroll() { this.log.scrollTop = this.log.scrollHeight; }

  // A chat bubble. Assistant bubbles fill in as the turn streams: thinking, text, tool chips.
  addBubble(role) {
    const el = document.createElement('div');
    el.className = `ai-msg ${role}`;
    const body = document.createElement('div');
    body.className = 'ai-body';
    el.append(body);
    this.log.append(el);
    this.scroll();
    let thinkingEl = null, textEl = null;
    return {
      body,
      setThinking: (t) => {
        if (!thinkingEl) {
          thinkingEl = document.createElement('details');
          thinkingEl.className = 'ai-thinking';
          thinkingEl.innerHTML = '<summary>Thinking</summary><p></p>';
          body.prepend(thinkingEl);
        }
        thinkingEl.querySelector('p').textContent = t;
        this.scroll();
      },
      setText: (t) => {
        if (!textEl) { textEl = document.createElement('div'); textEl.className = 'ai-text'; body.append(textEl); }
        textEl.innerHTML = renderMarkdown(t);
        this.scroll();
      },
      addTool: (id, name) => {
        const chip = document.createElement('div');
        chip.className = 'ai-tool running';
        chip.dataset.tool = id;
        chip.innerHTML = '<span></span>';
        chip.setLabel = (t) => { chip.querySelector('span').textContent = t; };
        chip.setLabel(`${(VERBS[name] ?? (() => name))({})}…`);
        chip.done = (t, kind, images = []) => {
          chip.className = `ai-tool ${kind}`;
          chip.setLabel(`${kind === 'error' ? '✗' : '✓'} ${t}`);
          for (const data of images) {
            const img = new Image();
            img.src = `data:image/jpeg;base64,${data}`;
            img.alt = 'What the assistant saw';
            chip.append(img);
          }
          this.scroll();
        };
        textEl = null;   // text after a tool call starts a new paragraph below it
        body.append(chip);
        this.scroll();
      },
      clear: () => { body.replaceChildren(); thinkingEl = textEl = null; },
      finish: () => { if (thinkingEl) thinkingEl.querySelector('summary').textContent = 'Thought about it'; },
      dropIfEmpty: () => { if (!body.childElementCount) el.remove(); },
    };
  }
}

// Server-sent events from a fetch() body: yields { event, data }.
async function* readEvents(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

// A small, safe subset of Markdown: everything is escaped first, then code blocks, inline code,
// bold, italics, bullet lists and line breaks are added back.
function renderMarkdown(src) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blocks = [];
  let text = esc(src).replace(/```[\w-]*\n?([\s\S]*?)(```|$)/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  text = text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m.replace(/\n/g, '')}</ul>`)
    .replace(/\n/g, '<br>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}
