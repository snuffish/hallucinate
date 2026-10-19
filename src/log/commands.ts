// What a line typed into the System log's command field means: one of the log's own commands, or one of
// the assistant's tools by name (tools.ts), run against the app exactly as the assistant runs it. Pure:
// the panel runs what this parses.
//
//   switch_scene scene="Ring Run"        a tool, its input as key=value pairs
//   set_look {"hue": 0.3, "speed": 1.5}  or as JSON
//   level warn · source server · filter kick · clear · copy · export · undo · help [name]

import { TOOL_DEFINITIONS } from '../assistant/tools';
import { LEVELS, SOURCES, type LogLevel, type LogSource, type SourcePick } from './system-log';

export const BUILTINS = {
  help: 'help [command or tool]: what you can type, or what one command or tool takes',
  clear: 'clear: empty the log',
  copy: 'copy: copy the lines shown to the clipboard',
  export: 'export: save the lines shown as a .log file',
  undo: 'undo: undo the last change a tool made (the assistant\'s too)',
  level: `level <${LEVELS.join('|')}>: show that level and the ones above it`,
  source: `source <${SOURCES.join('|')}|all>: show the lines from one place`,
  filter: 'filter [text]: show only lines containing the text (no text: all)',
  state: 'state: what is on screen now (the get_app_state tool)',
} as const;
export type Builtin = keyof typeof BUILTINS;

export type Command =
  | { kind: 'builtin'; name: 'help'; topic: string | null }
  | { kind: 'builtin'; name: 'clear' | 'copy' | 'export' | 'undo' }
  | { kind: 'builtin'; name: 'level'; levels: LogLevel[] }
  | { kind: 'builtin'; name: 'source'; source: SourcePick }
  | { kind: 'builtin'; name: 'filter'; query: string }
  | { kind: 'tool'; name: string; input: Record<string, unknown> }
  | { kind: 'error'; message: string };

const TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.map((d) => d.name);
export const COMMAND_NAMES: readonly string[] = [...Object.keys(BUILTINS), ...TOOL_NAMES];

// Words, keeping "quoted strings" (with \" inside) and {…} / […] JSON together.
export function words(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (i >= line.length) break;
    let word = '';
    let depth = 0;
    let quote = false;
    for (; i < line.length; i++) {
      const ch = line[i]!;
      if (quote) {
        word += ch;
        if (ch === '\\' && i + 1 < line.length) word += line[++i];
        else if (ch === '"') quote = false;
        continue;
      }
      if (ch === '"') quote = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
      else if ((ch === ' ' || ch === '\t') && depth === 0) break;
      word += ch;
    }
    out.push(word);
  }
  return out;
}

// A typed value: JSON where it reads as JSON (numbers, true/false/null, "strings", {…}, […]), else the text.
export function value(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

function toolInput(rest: string): Record<string, unknown> | string {
  const t = rest.trim();
  if (!t) return {};
  if (t.startsWith('{')) {
    try {
      const v: unknown = JSON.parse(t);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : 'The input must be a JSON object.';
    } catch (err) {
      return `That isn't valid JSON: ${(err as Error).message}`;
    }
  }
  const input: Record<string, unknown> = {};
  for (const w of words(t)) {
    const eq = w.indexOf('=');
    if (eq <= 0) return `Expected key=value, got "${w}". Type help <tool> for what it takes.`;
    input[w.slice(0, eq)] = value(w.slice(eq + 1));
  }
  return input;
}

export function parseCommand(line: string): Command | null {
  const t = line.trim();
  if (!t) return null;
  const space = t.search(/\s/);
  const head = (space < 0 ? t : t.slice(0, space)).toLowerCase();
  const rest = space < 0 ? '' : t.slice(space + 1).trim();
  const arg = rest.toLowerCase();
  switch (head) {
    case 'help': case '?': return { kind: 'builtin', name: 'help', topic: rest || null };
    case 'clear': case 'copy': case 'export': case 'undo': return { kind: 'builtin', name: head };
    case 'level': {
      const at = LEVELS.indexOf(arg as LogLevel);
      if (at < 0) return { kind: 'error', message: `level takes ${LEVELS.join(', ')}.` };
      return { kind: 'builtin', name: 'level', levels: LEVELS.slice(0, at + 1) };
    }
    case 'source': {
      if (arg === 'all' || !arg) return { kind: 'builtin', name: 'source', source: 'all' };
      if (!SOURCES.includes(arg as LogSource)) return { kind: 'error', message: `source takes ${SOURCES.join(', ')} or all.` };
      return { kind: 'builtin', name: 'source', source: arg as LogSource };
    }
    case 'filter': return { kind: 'builtin', name: 'filter', query: rest };
    case 'state': return { kind: 'tool', name: 'get_app_state', input: {} };
  }
  if (!TOOL_NAMES.includes(head)) {
    const near = COMMAND_NAMES.filter((n) => n.startsWith(head.slice(0, 3)));
    return { kind: 'error', message: `Unknown command "${head}".${near.length ? ` Did you mean ${near.join(', ')}?` : ''} Type help for the list.` };
  }
  const input = toolInput(rest);
  return typeof input === 'string' ? { kind: 'error', message: input } : { kind: 'tool', name: head, input };
}

// Tab: the one name the prefix leads to, or the longest prefix the candidates share (and the candidates).
export function complete(prefix: string, names: readonly string[] = COMMAND_NAMES): { text: string; options: string[] } {
  const p = prefix.toLowerCase();
  const options = names.filter((n) => n.startsWith(p));
  if (!options.length) return { text: prefix, options };
  if (options.length === 1) return { text: `${options[0]} `, options };
  let common = options[0]!;
  for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
  return { text: common.length > prefix.length ? common : prefix, options };
}

interface Describable { description?: string; isOptional?: () => boolean }

// What `help` says: the list, one command, or a tool's description and its inputs.
export function helpText(topic: string | null): string {
  if (!topic) {
    return [
      'Commands:', ...Object.values(BUILTINS).map((s) => `  ${s}`),
      'Tools (as the assistant has them; help <tool> for its inputs):',
      `  ${TOOL_NAMES.join(', ')}`,
      'Give a tool its input as key=value pairs (switch_scene scene="Ring Run") or JSON (set_look {"hue": 0.3}).',
    ].join('\n');
  }
  const name = topic.toLowerCase();
  if (name in BUILTINS) return BUILTINS[name as Builtin];
  const def = TOOL_DEFINITIONS.find((d) => d.name === name);
  if (!def) return `There's no command or tool "${topic}". Type help for the list.`;
  const shape = (def.inputSchema as unknown as { shape?: Record<string, Describable> } | undefined)?.shape ?? {};
  const params = Object.entries(shape).map(([key, s]) => `  ${key}${s.isOptional?.() ? ' (optional)' : ''}${s.description ? `: ${s.description}` : ''}`);
  return [def.description, params.length ? 'Input:' : 'No input.', ...params].join('\n');
}
