import { describe, expect, it } from 'vitest';
import { NO_USAGE } from '../../assistant/usage';
import { usageLabel, usageTitle } from './Transcript';

// "Set dots per edge to 1" on the subscription backend: two calls that each reread a ~50k conversation.
const turn = { prompt: 100_292, completion: 234, cacheRead: 98_233, cacheWrite: 2_055, cost: 0.041, context: 50_958 };

describe('usage labels', () => {
  it('show the conversation size, the input the cache did not serve, the output and the cost, not the summed input', () => {
    expect(usageLabel(turn)).toBe('51k context · 2.1k new in · 234 out · ≈$0.041');
    expect(usageLabel(turn, { chat: true })).toBe('2.1k new in · 234 out · ≈$0.041');
    expect(usageLabel({ ...NO_USAGE, prompt: 1200, completion: 30 })).toBe('1.2k new in · 30 out');   // stored before the context was kept
  });

  it('spell out every part in the tooltip', () => {
    const title = usageTitle(turn, '≈ API-equivalent cost (not billed on a subscription)');
    expect(title).toContain('Context: 50,958 tokens');
    expect(title).toContain('100,292 tokens: 98,233 read from the cache (about a tenth of the price), 2,055 written to it, 4 uncached');
    expect(title).toContain('≈ API-equivalent cost (not billed on a subscription): $0.041');
    expect(usageTitle({ ...turn, cost: 0 }, 'Cost')).not.toContain('Cost');
  });
});
