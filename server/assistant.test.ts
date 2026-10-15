import { describe, expect, it } from 'vitest';
import { chat, EventType, maxIterations, type AdapterYieldChunk, type DefaultMessageMetadataByModality, type TextOptions } from '@tanstack/ai';
import { BaseTextAdapter, type StructuredOutputOptions } from '@tanstack/ai/adapters';
import { DIRECTOR_TOOLS, TOOL_DEFINITIONS } from '../src/assistant/tools';
import { continuedOf, modeOf, runConfig } from './assistant';
import { cliArgs, cliUsage, sessionRetry, withTranscript } from './claude-cli-adapter';

describe('Claude CLI lockdown (ARCHITECTURE.md, invariant 8)', () => {
  const args = cliArgs({ mcpPath: '/tmp/x/mcp.json', tools: ['get_app_state', 'set_look'], system: 'SYS', resume: false, sessionId: 'sid', model: 'claude-code', effort: undefined });
  const valueOf = (flag: string) => args[args.indexOf(flag) + 1];

  it('gives the CLI no built-in tools, none of the user settings and only this app\'s MCP server', () => {
    expect(valueOf('--tools')).toBe('');
    expect(valueOf('--setting-sources')).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(valueOf('--mcp-config')).toBe('/tmp/x/mcp.json');
    expect(args).toContain('--disable-slash-commands');
    expect(valueOf('--allowedTools')).toBe('mcp__hallucinate__get_app_state,mcp__hallucinate__set_look');
  });

  it('never uses --safe-mode (it switches MCP servers, i.e. the tools, off)', () => {
    expect(args).not.toContain('--safe-mode');
  });

  it('starts or resumes the session by id', () => {
    expect(valueOf('--session-id')).toBe('sid');
    const resumed = cliArgs({ mcpPath: 'm', tools: [], system: '', resume: true, sessionId: 'sid', model: 'opus', effort: 'high' });
    expect(resumed[resumed.indexOf('--resume') + 1]).toBe('sid');
    expect(resumed[resumed.indexOf('--model') + 1]).toBe('opus');
    expect(resumed[resumed.indexOf('--effort') + 1]).toBe('high');
  });
});

// What does chat() hand a custom adapter when the tools are bare definitions (client-executed)?
class SpyAdapter extends BaseTextAdapter<string, Record<string, never>, readonly ['text'], DefaultMessageMetadataByModality> {
  readonly name = 'spy';
  seen: TextOptions<Record<string, never>> | null = null;
  constructor() { super({}, 'spy-model'); }
  structuredOutput(_o: StructuredOutputOptions<Record<string, never>>): Promise<never> { return Promise.reject(new Error('no')); }
  async *chatStream(options: TextOptions<Record<string, never>>): AsyncIterable<AdapterYieldChunk> {
    this.seen = options;
    const now = Date.now();
    yield { type: EventType.RUN_STARTED, runId: options.runId ?? 'r', threadId: options.threadId ?? 't', model: this.model, timestamp: now };
    yield { type: EventType.RUN_FINISHED, runId: options.runId ?? 'r', threadId: options.threadId ?? 't', model: this.model, timestamp: now, finishReason: 'stop' };
  }
}

describe('assistant route plumbing', () => {
  it('passes every tool definition and the system prompt to the adapter', async () => {
    const adapter = new SpyAdapter();
    const stream = chat({ adapter, messages: [{ role: 'user', content: 'hi' }], systemPrompts: ['SYS'], tools: [...TOOL_DEFINITIONS], agentLoopStrategy: maxIterations(2) });
    for await (const _chunk of stream) { /* drain */ }
    expect(adapter.seen).not.toBeNull();
    const names = (adapter.seen!.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_DEFINITIONS].map((t) => t.name).sort());
    const sys = adapter.seen!.systemPrompts ?? [];
    expect(sys.map((p) => (typeof p === 'string' ? p : p.content))).toEqual(['SYS']);
  });

  it('accepts promptCache on a run (the adapter sees the tools either way)', async () => {
    const adapter = new SpyAdapter();
    const stream = chat({ adapter, messages: [{ role: 'user', content: 'hi' }], tools: [...DIRECTOR_TOOLS], promptCache: 'short', agentLoopStrategy: maxIterations(1) });
    for await (const _chunk of stream) { /* drain */ }
    expect((adapter.seen!.tools ?? []).map((t) => t.name).sort()).toEqual([...DIRECTOR_TOOLS].map((t) => t.name).sort());
  });
});

describe('run modes', () => {
  it('the chat gets every tool and 30 turns; the director the show tools and 6', () => {
    const chatRun = runConfig('chat', 'api');
    const director = runConfig('director', 'api');
    expect(chatRun.tools.map((t) => t.name)).toEqual([...TOOL_DEFINITIONS].map((t) => t.name));
    expect(chatRun.maxTurns).toBe(30);
    expect(director.tools.map((t) => t.name)).toEqual(['get_show', 'set_autopilot_plan', 'update_show_scene']);
    expect(director.maxTurns).toBe(6);
    expect(director.tools.map((t) => t.name)).not.toContain('write_scene_code');
    expect(director.tools.map((t) => t.name)).not.toContain('take_show_scene');
  });

  it('caches the prompt on the API backend only', () => {
    expect(runConfig('chat', 'api').promptCache).toBe('short');
    expect(runConfig('director', 'api').promptCache).toBe('short');
    expect(runConfig('chat', 'claude-code').promptCache).toBeUndefined();
  });

  it('reads the mode from forwardedProps and defaults to chat', () => {
    expect(modeOf({ mode: 'director' })).toBe('director');
    expect(modeOf({ mode: 'anything' })).toBe('chat');
    expect(modeOf(undefined)).toBe('chat');
  });
});

describe('the subscription backend: usage and lost sessions', () => {
  it('reports the CLI result usage like the Anthropic adapter does, with the conversation size and the cost', () => {
    const u = cliUsage({ input_tokens: 40, output_tokens: 300, cache_read_input_tokens: 9000, cache_creation_input_tokens: 600 }, 0.031, 4200);
    expect(u).toEqual({ promptTokens: 9640, completionTokens: 300, totalTokens: 9940, promptTokensDetails: { cachedTokens: 9000, cacheWriteTokens: 600 }, cost: 0.031, providerUsageDetails: { contextTokens: 4200 } });
    expect(cliUsage(undefined, 1, 0)).toBeUndefined();
    expect(cliUsage({ input_tokens: 5, output_tokens: 1 }, undefined, 0)).toEqual({ promptTokens: 5, completionTokens: 1, totalTokens: 6, providerUsageDetails: { contextTokens: 5 } });
  });

  it('retries a session that already exists by resuming it, and a vanished one as a new session', () => {
    expect(sessionRetry(false, 'Error: Session ID 1234 is already in use.')).toBe('resume');
    expect(sessionRetry(true, 'No conversation found with session ID: 1234')).toBe('new');
    expect(sessionRetry(true, 'Invalid API key')).toBeNull();
    expect(sessionRetry(false, 'No conversation found')).toBeNull();
  });

  it('continues a lost session from the conversation as text, newest turns kept', () => {
    const messages = [
      { role: 'user' as const, content: 'make a jellyfish scene' },
      { role: 'assistant' as const, content: 'Created "Jelly".', toolCalls: [] },
      { role: 'tool' as const, content: '{"ok":true}', toolCallId: 'x' },
      { role: 'user' as const, content: 'now slower' },
    ];
    const prompt = withTranscript(messages, 'now slower');
    expect(prompt).toContain('User: make a jellyfish scene');
    expect(prompt).toContain('You: Created "Jelly".');
    expect(prompt).not.toContain('"ok":true');
    expect(prompt.endsWith("(The user's new message:)\nnow slower")).toBe(true);
    expect(withTranscript([{ role: 'user', content: 'hi' }], 'hi')).toBe('hi');
    const long = withTranscript([{ role: 'user', content: 'x'.repeat(20_000) }, { role: 'user', content: 'q' }], 'q');
    expect(long.length).toBeLessThan(8300);
  });

  it('reads `continued` from forwardedProps', () => {
    expect(continuedOf({ continued: true })).toBe(true);
    expect(continuedOf({ continued: 'yes' })).toBe(false);
    expect(continuedOf(undefined)).toBe(false);
  });
});
