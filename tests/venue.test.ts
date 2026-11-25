import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chooseVenue, Venue, type VenueSpec } from '../src/ui3d/venue';
import { DEFAULT_SETTINGS, setOption, visualPanelHtml } from '../src/ui/matchSetup';

// 牌桌四周的场地（venue.ts）：哪一场摆哪种、牌子上写什么；每种场地只画几次、三角形有数

describe('哪一场摆哪种场地', () => {
  it('自动：单局在部室（跟主页同一个时间），自己组的团体赛在比赛会场', () => {
    expect(chooseVenue('auto', { kind: 'single' }, 'dusk')).toEqual({ kind: 'club', tod: 'dusk' });
    expect(chooseVenue('auto', { kind: 'team', pos: '中坚战' }, 'day')).toEqual({ kind: 'match', title: '全国高中麻将大赛', round: '团体赛', table: '中坚战' });
  });

  it('全国大赛团体赛：前两轮在比赛会场，牌子上写轮次、桌、位置；总决赛上决赛舞台', () => {
    expect(chooseVenue('auto', { kind: 'national', round: '第一轮', table: '东区 A 桌', final: false, pos: '先锋战' }, 'day')).toEqual({
      kind: 'match',
      title: '全国高中麻将大赛',
      round: '团体赛 · 第一轮',
      table: '东区 A 桌 · 先锋战',
    });
    expect(chooseVenue('auto', { kind: 'national', round: '半区决赛', table: '东区决赛', final: false, pos: '中坚战' }, 'day')?.table).toBe('东区决赛 · 中坚战');
    // 总决赛那一桌就叫「决赛」，不写两遍
    expect(chooseVenue('auto', { kind: 'national', round: '决赛', table: '决赛', final: true, pos: '大将战' }, 'day')).toEqual({
      kind: 'final',
      title: '全国高中麻将大赛',
      round: '团体赛 · 决赛',
      table: '大将战',
    });
  });

  it('个人赛：预赛在比赛会场，决赛桌上决赛舞台', () => {
    expect(chooseVenue('auto', { kind: 'solo', label: '第 3 轮 · A 桌（焦点桌）', final: false }, 'day')).toEqual({ kind: 'match', title: '全国高中麻将大赛', round: '个人赛', table: '第 3 轮 · A 桌（焦点桌）' });
    expect(chooseVenue('auto', { kind: 'solo', label: '决赛第 1 场', final: true }, 'day')?.kind).toBe('final');
  });

  it('设置里指定了哪种就一直摆哪种，关闭是原来的纯色背景', () => {
    const semi = { kind: 'national', round: '半区决赛', table: '西区决赛', final: false, pos: '副将战' } as const;
    expect(chooseVenue('off', semi, 'day')).toBeNull();
    expect(chooseVenue('club', semi, 'night')).toEqual({ kind: 'club', tod: 'night' });
    expect(chooseVenue('final', semi, 'day')).toEqual({ kind: 'final', title: '全国高中麻将大赛', round: '团体赛 · 半区决赛', table: '西区决赛 · 副将战' });
    // 单局没有轮次：只写大赛名
    expect(chooseVenue('match', { kind: 'single' }, 'day')).toEqual({ kind: 'match', title: '全国高中麻将大赛' });
  });
});

describe('视觉设置里的牌桌环境', () => {
  it('3D、2.5D、俯视 2D 有这一项，2D 没有；默认自动，乱填的值不收', () => {
    const has = (mode: '3d' | '25d' | 'top' | '2d') => visualPanelHtml({ ...DEFAULT_SETTINGS }, 'classic', mode, true, 'wood').includes('<span class="setup-name">牌桌环境');
    expect([has('3d'), has('25d'), has('top'), has('2d')]).toEqual([true, true, true, false]);
    expect(DEFAULT_SETTINGS.venue).toBe('auto');
    const s = { ...DEFAULT_SETTINGS };
    setOption(s, 'venue', 'final');
    expect(s.venue).toBe('final');
    setOption(s, 'venue', 'stadium');
    expect(s.venue).toBe('final');
  });
});

// 建场地要 canvas 画贴图：测试里没有浏览器，给一块什么都不画的假画布（量字按字数算宽）
function fakeCanvas() {
  const gradient = { addColorStop() {} };
  const g = new Proxy({} as Record<string | symbol, unknown>, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (text: string) => ({ width: String(text).length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  return { width: 0, height: 0, getContext: () => g };
}

describe('场地的开销', () => {
  beforeAll(() => vi.stubGlobal('document', { createElement: () => fakeCanvas() }));
  afterAll(() => vi.unstubAllGlobals());

  const specs: VenueSpec[] = [
    { kind: 'club', tod: 'day' },
    { kind: 'club', tod: 'night' },
    { kind: 'match', title: '全国高中麻将大赛', round: '团体赛 · 半区决赛', table: '东区决赛 · 中坚战' },
    { kind: 'final', title: '全国高中麻将大赛', round: '团体赛 · 决赛', table: '大将战' },
  ];
  for (const spec of specs) {
    it(`${spec.kind}${spec.tod ? `（${spec.tod}）` : ''}：最多 5 个网格，三角形有上限，坐标都是数`, () => {
      const v = new Venue(spec, { scale: 27.6, floorY: -21 }, 4);
      const meshes = v.group.children as THREE.Mesh[];
      expect(meshes.length).toBeLessThanOrEqual(5);
      let tris = 0;
      for (const m of meshes) {
        const geo = m.geometry;
        tris += (geo.index?.count ?? 0) / 3;
        const pos = geo.getAttribute('position').array;
        expect(Array.from(pos).every(Number.isFinite)).toBe(true);
        expect(m.matrixAutoUpdate).toBe(false);
      }
      // 现在部室一千二、会场三百多、决赛四千左右（观众一人两个三角形）
      expect(tris).toBeLessThan(6000);
      const parent = new THREE.Group();
      parent.add(v.group);
      v.dispose();
      expect(v.group.parent).toBeNull();
    });
  }

  it('决赛：观众是抠图的一层，字幕贴图横着循环', () => {
    const v = new Venue(specs[3], { scale: 27.6, floorY: -21 }, 4);
    const mats = (v.group.children as THREE.Mesh[]).map((m) => m.material as THREE.MeshBasicMaterial);
    expect(mats.some((m) => m.alphaTest > 0)).toBe(true);
    expect(mats.some((m) => m.map?.wrapS === THREE.RepeatWrapping)).toBe(true);
    v.dispose();
  });
});
