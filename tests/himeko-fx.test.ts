import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { himekoKeySeat } from '../src/abilities/himeko';
import type { BindKey } from '../src/abilities/types';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function game(keys: BindKey[][], ids = ['teru', 'himeko', 'kuro', 'koromo']) {
  const seats = ids.map(byId);
  const g = new Game({ seed: 3, format: 'east', keys, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  g.deal();
  return g;
}

// 配牌时的光柱和火（himekoFx.ts、himeko2d.ts）只在姬子拿着钥匙的那一局放
describe('姬子配牌特效的触发', () => {
  it('拿着这一局的钥匙：找得到她的座位', () => {
    expect(himekoKeySeat(game([[], [{ label: '东1局 0本场', round: 1, bind: 3, broken: false }], [], []]))).toBe(1);
  });
  it('破碎的钥匙、别的局的钥匙、没有姬子：都不放', () => {
    expect(himekoKeySeat(game([[], [{ label: '东1局 0本场', round: 1, bind: 3, broken: true }], [], []]))).toBeNull();
    expect(himekoKeySeat(game([[], [{ label: '东2局 0本场', round: 2, bind: 3, broken: false }], [], []]))).toBeNull();
    expect(himekoKeySeat(game([[], [], [], []], ['teru', 'kuro', 'koromo', 'saki']))).toBeNull();
  });
});
