import { describe, expect, it } from 'vitest';
import { TILE_COUNT } from '../src/engine/tiles';
import { HAND_SLOTS, LabSetup, POND_SLOTS, applyDiscard, composeScene } from '../src/lab/scene';

const NAMES = ['甲', '乙', '丙', '丁'];

function allTiles(scene: ReturnType<typeof composeScene>): number[] {
  const g = scene.game;
  const w = g.wall;
  return [
    ...g.players.flatMap((p) => [...p.hand, ...p.discards.map((d) => d.tile), ...p.melds.flatMap((m) => m.tiles)]),
    ...w.live,
    ...w.rinshan,
    ...w.doraIndicators,
    ...w.uraIndicators,
    ...w.overflow,
  ];
}

describe('动作调试场景的牌面', () => {
  it('每张牌恰好出现一次，出牌的人多一张摸到的牌', () => {
    for (let seat = 0; seat < 4; seat++) {
      for (const pondSlot of [0, 5, POND_SLOTS - 1]) {
        const s: LabSetup = { seat, handSlot: 3, pondSlot, sideways: false };
        const scene = composeScene(NAMES, s);
        const tiles = allTiles(scene).sort((a, b) => a - b);
        expect(tiles).toEqual(Array.from({ length: TILE_COUNT }, (_, i) => i));
        scene.game.players.forEach((p, i) => {
          expect(p.hand.length).toBe(i === seat ? 14 : 13);
          expect(p.drawn === null).toBe(i !== seat);
          expect(p.discards.length).toBe(pondSlot);
        });
        expect(scene.game.players[seat].hand).toContain(scene.tile);
      }
    }
  });

  it('打出去的牌落在牌河指定的位置，横放跟着设置走', () => {
    const s: LabSetup = { seat: 2, handSlot: 6, pondSlot: 7, sideways: true };
    const scene = composeScene(NAMES, s);
    const p = scene.game.players[2];
    const sorted = p.hand.filter((t) => t !== p.drawn).sort((a, b) => a - b);
    expect(scene.tile).toBe(sorted[6]);
    applyDiscard(scene, s);
    expect(p.hand.length).toBe(13);
    expect(p.drawn).toBeNull();
    expect(p.discards.length).toBe(8);
    expect(p.discards[7]).toEqual({ tile: scene.tile, riichi: true, tsumogiri: false, called: false });
  });

  it('选"摸到的牌"就是摸切', () => {
    const s: LabSetup = { seat: 1, handSlot: HAND_SLOTS, pondSlot: 0, sideways: false };
    const scene = composeScene(NAMES, s);
    expect(scene.tile).toBe(scene.game.players[1].drawn);
    applyDiscard(scene, s);
    expect(scene.game.players[1].discards[0].tsumogiri).toBe(true);
  });

  it('同样的设置每次摆出一样的牌', () => {
    const s: LabSetup = { seat: 3, handSlot: 0, pondSlot: 4, sideways: false };
    const a = composeScene(NAMES, s);
    const b = composeScene(NAMES, s);
    expect(allTiles(a)).toEqual(allTiles(b));
    expect(a.tile).toBe(b.tile);
  });
});
