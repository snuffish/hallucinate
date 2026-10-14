import { describe, expect, it } from 'vitest';
import { chat, EventType, maxIterations, type AdapterYieldChunk, type DefaultMessageMetadataByModality, type TextOptions } from '@tanstack/ai';
import { BaseTextAdapter, type StructuredOutputOptions } from '@tanstack/ai/adapters';
import { DIRECTOR_TOOLS, TOOL_DEFINITIONS } from '../src/assistant/tools';
import { modeOf, runConfig } from './assistant';

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
