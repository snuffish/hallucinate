// Live GLSL editor. It always shows the scene that's on screen and edits it in place: recompiles
// while you type, keeps the last working version running when there's an error, and hands every
// successful compile to onCompiled (which saves it). "My Shader" is stored here; built-in and library
// scenes are saved by main.js. Visual-maker scenes are generated, so they open read-only.

import { COMMON, TEMPLATE } from './scenes.js';
import { parseParams } from './params.js';

const STORAGE_KEY = 'hallucinate.customShader';
const HEADER_LINES = COMMON.split('\n').length - 1;

export class ShaderEditor {
  // customIndex: the "My Shader" slot. A target is { index, name, kind: 'custom' | 'builtin' | 'user' | 'nodes', body, original? }.
  constructor({ renderer, customIndex, templates, onOpen, onCompiled, onCopyGenerated, onRevert }) {
    Object.assign(this, { renderer, customIndex, onOpen, onCompiled });
    const $ = (id) => document.getElementById(id);
    this.el = $('editor');
    this.code = $('ed-code');
    this.status = $('ed-status');
    this.title = $('ed-title');
    this.picker = $('ed-template');
    this.revertButton = $('ed-revert');
    this.copyButton = $('ed-copy');
    this.timer = null;
    this.target = null;

    for (const [i, t] of templates.entries()) this.picker.add(new Option(t.name, i));
    this.templates = templates;

    // My Shader runs from the start, whether or not the editor has been opened.
    this.customCode = load() ?? TEMPLATE;
    this.compileInto(this.customTarget(), this.customCode);

    this.code.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.compile(), 350);
    });
    this.code.addEventListener('keydown', (e) => this.handleKeys(e));
    this.picker.addEventListener('change', () => this.loadTemplate());
    $('ed-close').onclick = () => this.toggle(false);
    this.revertButton.onclick = () => onRevert(this.target);
    this.copyButton.onclick = () => onCopyGenerated(this.code.value);
  }

  get isOpen() { return !this.el.hidden; }

  customTarget() {
    return { index: this.customIndex, name: 'My Shader', kind: 'custom', body: this.customCode };
  }

  // `target` is the scene on screen (main.js decides; see editorTarget()).
  toggle(open = !this.isOpen, target) {
    this.el.hidden = !open;
    if (!open && this.el.contains(document.activeElement)) document.activeElement.blur();   // hand the keyboard back to the shortcuts
    if (open) {
      this.onOpen();
      if (target) this.retarget(target);
      this.code.focus();
    }
  }

  // Switch to another scene (it follows the scene on screen). Unsaved typing is compiled into the
  // scene it belongs to first.
  retarget(target) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; this.compile(); }
    this.target = target;
    const readOnly = target.kind === 'nodes';
    this.code.value = target.kind === 'custom' ? this.customCode : target.body;
    this.code.readOnly = readOnly;
    this.el.classList.toggle('read-only', readOnly);
    this.title.textContent = target.name;
    this.title.title = { custom: 'Your own scene', builtin: 'Built-in scene — your edits are kept, and can be reverted', user: 'Your library scene', nodes: 'Made in the visual maker' }[target.kind];
    this.picker.disabled = readOnly;
    this.copyButton.hidden = !readOnly;
    this.showEdited();
    this.setStatus(readOnly ? 'Made in the visual maker — the code is generated from the graph, so it\'s read-only here.' : 'Editing live — changes apply as you type.', 'ok');
  }

  // Load code into "My Shader" (Send to code, Edit a copy), whether or not it's the scene on screen.
  setCustomCode(code) {
    if (this.target?.kind === 'custom') { this.code.value = code; return this.compile(); }
    this.compileInto(this.customTarget(), code);
  }

  compile() {
    this.timer = null;
    if (!this.target || this.target.kind === 'nodes') return;
    this.compileInto(this.target, this.code.value);
  }

  // Returns null on success, or the compile errors with line numbers relative to `source`.
  compileInto(target, source) {
    const { code, params } = parseParams(source);
    const error = this.renderer.replaceScene(target.index, COMMON + code);
    if (error) {
      if (target === this.target) this.setStatus(formatError(error), 'error');
      return formatError(error);
    }
    if (target.kind === 'custom') {
      this.customCode = source;
      save(source);
    } else {
      target.body = source;
    }
    this.onCompiled(target, source, params);
    if (target === this.target) {
      this.showEdited();
      this.setStatus(`Compiled ✓ — saved${params.length ? ` · ${params.length} live parameter${params.length > 1 ? 's' : ''}` : ''}`, 'ok');
    }
    return null;
  }

  showEdited() {
    const t = this.target;
    this.revertButton.hidden = !(t?.kind === 'builtin' && t.original && t.body.trim() !== t.original.trim());
  }

  setStatus(text, kind) {
    this.status.className = `ed-status ${kind}`;
    this.status.textContent = text;
  }

  loadTemplate() {
    const t = this.templates[this.picker.value];
    this.picker.value = '';
    if (!t || this.code.readOnly) return;
    if (this.code.value !== t.body && !confirm(`Replace the code of "${this.target.name}" with "${t.name}"?`)) return;
    this.code.value = t.body;
    this.compile();
  }

  handleKeys(e) {
    e.stopPropagation(); // don't trigger the app's keyboard shortcuts while typing
    if (e.key === 'Escape') return this.toggle(false);
    if (e.key !== 'Tab' || this.code.readOnly) return;
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end, value } = this.code;
    this.code.value = value.slice(0, start) + '  ' + value.slice(end);
    this.code.selectionStart = this.code.selectionEnd = start + 2;
    this.code.dispatchEvent(new Event('input'));
  }
}

// "ERROR: 0:57: 'foo' : undeclared identifier" -> "Line 3: 'foo' : undeclared identifier"
export function formatError(message) {
  return message
    .split('\n')
    .filter((l) => l.startsWith('ERROR'))
    .map((l) => l.replace(/^ERROR: \d+:(\d+): /, (_, n) => `Line ${n - HEADER_LINES}: `))
    .join('\n') || message;
}

function load() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } }
function save(code) { try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage unavailable */ } }
