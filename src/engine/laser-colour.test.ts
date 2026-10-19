import { describe, expect, it } from 'vitest';
import { LASER_GRADIENT, laserCss, laserRgb } from './laser-colour';

// Each channel within floating-point error of the expected one.
const near = (t: number, rgb: number[]) => laserRgb(t).forEach((c, i) => expect(c).toBeCloseTo(rgb[i]!, 9));

describe('the laser palette in TypeScript', () => {
  it('walks the same wheel as GLSL laser(): the six pure colours at every sixth, repeating every 1.0', () => {
    near(0, [1, 0, 0]);
    near(1 / 6, [1, 1, 0]);
    near(1 / 3, [0, 1, 0]);
    near(1 / 2, [0, 1, 1]);
    near(2 / 3, [0, 0, 1]);
    near(5 / 6, [1, 0, 1]);
    near(1.25, laserRgb(0.25));
    near(-0.75, laserRgb(0.25));
  });

  it('keeps every colour at full strength: one channel always lit fully', () => {
    for (let t = 0; t < 1; t += 0.01) expect(Math.max(...laserRgb(t))).toBeCloseTo(1, 6);
  });

  it('writes CSS colours and a wheel gradient', () => {
    expect(laserCss(1 / 12)).toBe('rgb(255 128 0)');
    expect(LASER_GRADIENT('90deg')).toBe('linear-gradient(90deg, rgb(255 0 0), rgb(255 255 0), rgb(0 255 0), rgb(0 255 255), rgb(0 0 255), rgb(255 0 255), rgb(255 0 0))');
  });
});
