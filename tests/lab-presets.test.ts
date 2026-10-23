import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCARD, RIICHI_DISCARD } from '../src/ui3d/discardMotion';
import { DEFAULT_LAYOUT, LAYOUT_LIMITS } from '../src/ui3d/tableLayout';
import { DISCARD_KIT, TABLE_KIT } from '../src/lab/presets';

const { builtins: BUILTIN_PRESETS, keys: PARAM_KEYS, specs: PARAM_SPECS, exportOne: exportPreset, parse: parsePresets, same: sameParams, sanitize: sanitizeParams } = DISCARD_KIT;

describe('出牌动作预设', () => {
  it('内置预设就是牌局里用的两套参数', () => {
    expect(BUILTIN_PRESETS.map((p) => p.name)).toEqual(['默认出牌', '立直出牌']);
    expect(sameParams(BUILTIN_PRESETS[0].params, DEFAULT_DISCARD)).toBe(true);
    expect(sameParams(BUILTIN_PRESETS[1].params, RIICHI_DISCARD)).toBe(true);
  });

  it('每个参数都有滑块设置，默认值落在滑块范围里', () => {
    for (const k of PARAM_KEYS) {
      const spec = PARAM_SPECS[k];
      for (const p of BUILTIN_PRESETS) {
        const shown = p.params[k] * spec.scale;
        expect(shown).toBeGreaterThanOrEqual(spec.min);
        expect(shown).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('导出再导入，参数不变', () => {
    const p = { name: '试试', params: { ...DEFAULT_DISCARD, lift: 2.75, leanMax: 0.5 } };
    const back = parsePresets(exportPreset(p));
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe('试试');
    expect(sameParams(back[0].params, p.params)).toBe(true);
  });

  it('导入时接受一组预设，也接受只有参数的对象；缺的参数用默认值补', () => {
    const list = parsePresets(JSON.stringify([{ name: 'a', params: { reach: 0.2 } }, { lift: 3 }]));
    expect(list.map((p) => p.name)).toEqual(['a', '导入的预设 2']);
    expect(list[0].params.reach).toBe(0.2);
    expect(list[0].params.carry).toBe(DEFAULT_DISCARD.carry);
    expect(list[1].params.lift).toBe(3);
  });

  it('坏的输入给出说明，不会带着坏参数进来', () => {
    expect(() => parsePresets('{')).toThrow('不是有效的 JSON');
    expect(() => parsePresets(JSON.stringify({ name: 'x', params: { reach: 'fast' } }))).toThrow('参数不对');
    expect(() => parsePresets(JSON.stringify({ name: 'x', params: {} }))).toThrow('参数不对');
    expect(sanitizeParams({ reach: Infinity })).toBeNull();
    expect(sanitizeParams(null)).toBeNull();
  });
});

describe('牌桌尺寸预设', () => {
  it('内置的默认牌桌就是牌局里用的尺寸', () => {
    expect(TABLE_KIT.builtins.map((p) => p.name)).toEqual(['默认牌桌']);
    expect(TABLE_KIT.same(TABLE_KIT.builtins[0].params, DEFAULT_LAYOUT)).toBe(true);
  });

  it('滑块范围不超出可调范围，默认值在滑块范围里', () => {
    for (const k of TABLE_KIT.keys) {
      const s = TABLE_KIT.specs[k];
      expect(s.min / s.scale).toBeGreaterThanOrEqual(LAYOUT_LIMITS[k][0] - 1e-9);
      expect(s.max / s.scale).toBeLessThanOrEqual(LAYOUT_LIMITS[k][1] + 1e-9);
      expect(s.min).toBeLessThan(s.max);
      const shown = DEFAULT_LAYOUT[k] * s.scale;
      expect(shown).toBeGreaterThanOrEqual(s.min - s.step);
      expect(shown).toBeLessThanOrEqual(s.max + s.step);
    }
  });

  it('导入超出范围的尺寸会被拉回范围里', () => {
    const [p] = TABLE_KIT.parse(JSON.stringify({ name: '大人物', params: { size: 5, wallToPond: 0 } }));
    expect(p.params.size).toBe(LAYOUT_LIMITS.size[1]);
    expect(p.params.wallToPond).toBe(LAYOUT_LIMITS.wallToPond[0]);
    expect(p.params.frame).toBe(DEFAULT_LAYOUT.frame);
  });
});
