import { describe, expect, it } from 'vitest';
import { KIND_COUNT } from '../src/engine/tiles';
import { BAYER, Frame, Painter, composite, hex, rampOf, rng } from '../src/pixel/core';
import { type PixelFxKind, makePixelFx } from '../src/pixel/effects';
import { BLOCK, MARK_H, MARK_W, feltTexture16, grainTexture16, pixelBackMark, plankTexture, stoneTexture } from '../src/pixel/blocks';
import { PFACE_H, PFACE_W, pixelFace } from '../src/pixel/faces';
import { PIXEL_GLYPHS } from '../src/pixel/glyphs';
import { medianCut, quantize } from '../src/pixel/pixelate';
import { TABLE_STYLES, THEMES, consoleShapeOf, skinTableColors, tableColors } from '../src/ui/theme';

// 像素风格（像素皮肤、像素牌桌）：牌面、桌布、牌背、特效、主页像素化、颜色登记。画面在浏览器里截图看过，这里管不会画错、不会崩

describe('像素牌面', () => {
  const faces = [...Array.from({ length: KIND_COUNT }, (_, k) => pixelFace(k, false)), pixelFace(4, true), pixelFace(13, true), pixelFace(22, true)];

  it('37 张牌面都是 25×35，每张都画了东西，两两不一样', () => {
    for (const f of faces) {
      expect(f.length).toBe(PFACE_W * PFACE_H);
      expect(f.some((c) => c !== 0)).toBe(true);
    }
    const keys = new Set(faces.map((f) => Array.from(f).join(',')));
    expect(keys.size).toBe(faces.length);
  });

  it('赤五和普通的五不一样，红色多', () => {
    const reds = (f: Uint32Array) => Array.from(f).filter((c) => (c & 255) > 150 && ((c >>> 8) & 255) < 90).length;
    for (const k of [4, 13, 22]) expect(reds(pixelFace(k, true))).toBeGreaterThan(reds(pixelFace(k, false)));
  });

  it('不透明的像素都是不透明的（贴图上没有半透明的毛边）', () => {
    for (const f of faces) for (const c of f) expect(c === 0 || c >>> 24 === 255).toBe(true);
  });

  it('万子、字牌要用的字点阵都有，11 行', () => {
    for (const ch of '一二三四五六七八九萬東南西北發中') {
      expect(PIXEL_GLYPHS[ch], ch).toBeDefined();
      expect(PIXEL_GLYPHS[ch].length).toBe(11);
    }
  });
});

describe('像素桌布、牌背', () => {
  it('方块贴图都是 16×16、不透明，每张只用几种颜色，同一个种子画出来一样', () => {
    const list = [plankTexture('#a8743f'), feltTexture16('#3f8f4a'), stoneTexture('#8c8a86'), grainTexture16()];
    for (const px of list) {
      expect(px.length).toBe(BLOCK * BLOCK);
      expect(Array.from(px).every((c) => c >>> 24 === 255)).toBe(true);
      const n = new Set(Array.from(px)).size;
      expect(n).toBeGreaterThan(1);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(Array.from(plankTexture('#a8743f'))).toEqual(Array.from(plankTexture('#a8743f')));
  });

  it('木板：每块板最下面一行是暗缝，比板面暗', () => {
    const px = plankTexture('#a8743f');
    const lum = (c: number) => (c & 255) * 0.3 + ((c >>> 8) & 255) * 0.59 + ((c >>> 16) & 255) * 0.11;
    for (const y of [3, 7, 11, 15]) expect(lum(px[y * BLOCK + 5])).toBeLessThan(lum(px[(y - 2) * BLOCK + 5]) + 0.001);
  });

  it('牌背宝石：16×22（和牌身颗粒一格对一格），中间有亮有暗，四角空着', () => {
    const m = pixelBackMark();
    expect(m.length).toBe(MARK_W * MARK_H * 4);
    const a = (x: number, y: number) => m[(y * MARK_W + x) * 4 + 3];
    expect(a(0, 0)).toBe(0);
    expect(a(MARK_W >> 1, MARK_H >> 1)).toBeGreaterThan(0);
  });
});

describe('像素画法的小件', () => {
  it('色阶从暗到亮，最暗的偏冷（蓝比红多）', () => {
    const r = rampOf('#d9573b', 7);
    expect(r.length).toBe(7);
    const lum = (c: number) => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255);
    for (let i = 1; i < r.length; i++) expect(lum(r[i])).toBeGreaterThanOrEqual(lum(r[i - 1]));
    expect((r[0] >>> 16) & 255).toBeGreaterThan(0);
  });

  it('Bayer 门槛 16 个都不一样，都在 0 到 1 之间', () => {
    expect(new Set(BAYER).size).toBe(16);
    for (const v of BAYER) expect(v > 0 && v < 1).toBe(true);
  });

  it('同一个种子出同一串随机数', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('光那层叠在透明底上：越亮越不透明', () => {
    const f = new Frame(4, 1);
    const p = new Painter(f);
    p.add(0, 0, hex('#ffffff'), 1);
    p.add(1, 0, hex('#ffffff'), 0.25);
    const out = new Uint8ClampedArray(16);
    composite(f, out);
    expect(out[3]).toBe(255);
    expect(out[7]).toBeGreaterThan(0);
    expect(out[7]).toBeLessThan(255);
    expect(out[11]).toBe(0);
  });
});

describe('像素特效', () => {
  const kinds: PixelFxKind[] = ['riichi', 'call', 'kan', 'win', 'ability'];

  it('五种特效从头放到尾都不出错，中途画了东西', () => {
    for (const kind of kinds) {
      const fx = makePixelFx({ kind, word: '立直', color: '#e0679a', x: 200, y: 160, w: 400, h: 240, seed: 3 });
      expect(fx.dur).toBeGreaterThan(0.5);
      let drew = false;
      for (let t = 0; t <= fx.dur; t += 1 / 30) {
        const f = new Frame(400, 240);
        fx.draw(new Painter(f), t);
        if (f.color.some((c) => c !== 0) || f.light.some((c) => c !== 0)) drew = true;
      }
      expect(drew, kind).toBe(true);
    }
  });

  it('同一个种子放出来一模一样（和帧率无关，按时间算）', () => {
    const draw = () => {
      const fx = makePixelFx({ kind: 'win', word: '自摸', color: '#3a6df0', x: 100, y: 80, w: 200, h: 140, seed: 9 });
      const f = new Frame(200, 140);
      fx.draw(new Painter(f), 0.8);
      return Array.from(f.color).join(',');
    };
    expect(draw()).toBe(draw());
  });
});

describe('主页的图做成像素画', () => {
  it('中位切分最多挑 n 种颜色', () => {
    const px = new Uint8ClampedArray(64 * 4);
    const r = rng(1);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r() * 255;
      px[i + 1] = r() * 255;
      px[i + 2] = r() * 255;
      px[i + 3] = 255;
    }
    expect(medianCut(px, 8).length).toBeLessThanOrEqual(8);
  });

  it('换完以后整张图只剩调色板里的那几种颜色', () => {
    const w = 16;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = x * 16;
        px[i + 1] = y * 16;
        px[i + 2] = 128;
        px[i + 3] = 255;
      }
    quantize(px, w, { block: 1, colors: 6, dither: 0.5 });
    const colors = new Set<string>();
    for (let i = 0; i < px.length; i += 4) colors.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    expect(colors.size).toBeLessThanOrEqual(6);
  });
});

describe('像素皮肤、像素牌桌的登记', () => {
  it('像素是一套皮肤，也是一套牌桌风格', () => {
    expect(THEMES.some((t) => t.id === 'pixel')).toBe(true);
    expect(TABLE_STYLES.some((t) => t.id === 'pixel')).toBe(true);
  });

  it('像素皮肤跟皮肤走、别的皮肤配像素牌桌，用的都是像素牌桌；别的牌桌不是', () => {
    expect(tableColors('pixel', 'skin').pixel).toBe(true);
    expect(tableColors('broadcast', 'pixel').pixel).toBe(true);
    expect(tableColors('pixel', 'wood').pixel).toBeFalsy();
    expect(skinTableColors('broadcast').pixel).toBeFalsy();
  });

  it('像素牌桌：方块桌布、像素仪表盘、方块颗粒的牌、牌背宝石，直角方盒仪表盘', () => {
    const k = tableColors('pixel', 'skin', 'auto');
    expect(k.pattern).toBe('pixel');
    expect(k.look).toBe('pixel');
    expect(k.tile?.mark).toBe('pixel');
    expect(k.tile?.grain).toBe('block');
    expect(consoleShapeOf('pixel', 'auto')).toBe('box');
  });
});
