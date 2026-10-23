import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCARD, RIICHI_DISCARD } from '../src/ui3d/discardMotion';
import { BUILTIN_PRESETS, PARAM_KEYS, PARAM_SPECS, exportPreset, parsePresets, sameParams, sanitizeParams } from '../src/lab/presets';

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
