import { describe, expect, it } from 'vitest';
import { latencyLabel, stateLabel, tempoLabel } from './HearingMonitor';

describe('the Hearing monitor at a glance', () => {
  it('reads the tempo to a tenth, with what the kicks gave when folding changed it', () => {
    expect(tempoLabel({ bpm: 124.04, heardBpm: 124.04 })).toBe('124.0 BPM');
    expect(tempoLabel({ bpm: 95.2, heardBpm: 190.4 })).toBe('95.2 BPM (heard 190)');
    expect(tempoLabel({ bpm: 144, heardBpm: 72 })).toBe('144.0 BPM (heard 72)');
    expect(tempoLabel({ bpm: null, heardBpm: null })).toBe('— BPM');
  });

  it('says whether the tempo is heard in the kicks, held through a breakdown, or not known', () => {
    expect(stateLabel('hearing')).toBe('hearing kicks');
    expect(stateLabel('holding')).toBe('holding');
    expect(stateLabel('none')).toBe('no tempo');
  });

  it('gives the delay to the speakers for music played here, and none for music heard outside the app', () => {
    expect(latencyLabel(11.6)).toBe('12 ms to the speakers');
    expect(latencyLabel('outside')).toBe('heard outside the app');
    expect(latencyLabel(null)).toBe('—');
  });
});
