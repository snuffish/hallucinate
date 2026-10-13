import { describe, expect, it } from 'vitest';
import { chat, EventType, maxIterations, type AdapterYieldChunk, type DefaultMessageMetadataByModality, type TextOptions } from '@tanstack/ai';
import { BaseTextAdapter, type StructuredOutputOptions } from '@tanstack/ai/adapters';
import { TOOL_DEFINITIONS } from '../src/assistant/tools';

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
});
