import { describe, expect, it } from 'vitest';
import { frameRateLabel, latencyLabel, stateLabel, tempoLabel, tickLagLabel } from './HearingMonitor';

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

  it('gives the frames a second it hears, warning when too few come to hear every kick', () => {
    expect(frameRateLabel(59.8)).toEqual({ text: 'hears 60 fps', slow: false });
    expect(frameRateLabel(30)).toEqual({ text: 'hears 30 fps', slow: false });
    expect(frameRateLabel(11.2)).toEqual({ text: 'hears 11 fps: too few to hear every kick', slow: true });
    expect(frameRateLabel(0)).toEqual({ text: 'hears no frames', slow: false });
  });

  it('gives how late the ticks land after their kicks', () => {
    expect(tickLagLabel(16.7)).toBe('ticks 17 ms after the kicks');
    expect(tickLagLabel(-4.2)).toBe('ticks 4 ms before the kicks');
    expect(tickLagLabel(null)).toBe('—');
  });
});
