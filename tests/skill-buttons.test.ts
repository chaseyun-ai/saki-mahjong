import { afterEach, describe, expect, it } from 'vitest';
import { AWAI, awaiEnergy } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { kasumiSuit } from '../src/abilities/kasumi';
import { kuroLost, isDoraTile } from '../src/abilities/kuro';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const saved = { ...AWAI };
afterEach(() => Object.assign(AWAI, saved));

function newGame(ids: string[], manual: number | null, seed = 7) {
  return new Game({ seed, players: ids.map((id, i) => ({ name: id, ability: byId(id).ability, manual: i === manual })) });
}
const st = (g: Game, seat: number) => g.abilityState[seat] as { circle?: boolean; tenpai?: boolean };
const restart = (g: Game) => (g as unknown as { startRound(): void }).startRound();
// 玩家发牌前选好技能再发牌
const pick = (g: Game, seat: number, ids: string[]) => {
  expect(g.phase).toBe('predeal');
  g.abilities[seat]!.setPreDeal!(g, seat, ids);
  g.deal();
};

describe('大星淡：发牌前选技能', () => {
  it('玩家操作时：发牌前停下来等选；安全圈 -10、天听 -15，不选不扣', () => {
    const g = newGame(['awai', 'saki', 'nodoka', 'kuro'], 0);
    const opts = g.abilities[0]!.preDeal!(g, 0);
    expect(opts).toHaveLength(10);
    expect(opts.filter((o) => o.enabled).map((o) => o.id)).toEqual(['circle', 'tenpai']);
    pick(g, 0, []);
    expect(st(g, 0).circle).toBeFalsy();
    expect(awaiEnergy(g, 0)).toBe(100);
    restart(g);
    // startRound 直接发牌（测试里绕过 predeal），用上一次选的
    g.abilities[0]!.setPreDeal!(g, 0, ['circle']);
    restart(g);
    expect(st(g, 0).circle).toBe(true);
    expect(st(g, 0).tenpai).toBeFalsy();
    expect(awaiEnergy(g, 0)).toBe(90);
    g.abilities[0]!.setPreDeal!(g, 0, ['circle', 'tenpai']);
    restart(g);
    expect(st(g, 0).tenpai).toBe(true);
    expect(awaiEnergy(g, 0)).toBe(65);
    // 天听：配牌就听牌（庄家第一张已经摸了，不算它）
    const p = g.players[0];
    expect(shanten(toCounts(p.hand.filter((t) => t !== p.drawn)))).toBe(0);
  });

  it('能量不够就发动不了', () => {
    const g = newGame(['awai', 'saki', 'nodoka', 'kuro'], 0);
    (g.abilityGameState[0] as { energy?: number }).energy = 12;
    expect(g.abilities[0]!.preDeal!(g, 0).filter((o) => o.enabled).map((o) => o.id)).toEqual(['circle']);
    g.abilities[0]!.setPreDeal!(g, 0, ['circle', 'tenpai']);
    restart(g);
    expect(st(g, 0).circle).toBe(true);
    expect(st(g, 0).tenpai).toBeFalsy();
    expect(awaiEnergy(g, 0)).toBe(2);
  });

  it('电脑：领先时不发动，落后时两个都发动，不会停在发牌前', () => {
    Object.assign(AWAI, { aiLeadChance: 0 });
    const g = newGame(['awai', 'saki', 'nodoka', 'kuro'], null);
    expect(g.phase).not.toBe('predeal');
    expect(st(g, 0).circle && st(g, 0).tenpai).toBe(true);
    g.players[0].score = 40000;
    restart(g);
    expect(st(g, 0).circle).toBeFalsy();
    g.players[0].score = 10000;
    restart(g);
    expect(st(g, 0).circle && st(g, 0).tenpai).toBe(true);
  });
});

describe('石户霞：发牌前请神', () => {
  it('玩家操作时：没落后不弹选项；落后了发牌前选请神，之后整场都在', () => {
    const g = newGame(['kasumi', 'saki', 'nodoka', 'kuro'], 0);
    // 开局同分：选项不可用，不停下来
    expect(g.phase).not.toBe('predeal');
    g.players[0].score = 10000;
    restart(g);
    // 没选就不请神
    expect(kasumiSuit(g, 0)).toBeNull();
    expect(g.abilities[0]!.preDeal!(g, 0)[0].enabled).toBe(true);
    g.abilities[0]!.setPreDeal!(g, 0, ['summon']);
    restart(g);
    expect(kasumiSuit(g, 0)).not.toBeNull();
    g.players[0].score = 40000;
    restart(g);
    expect(kasumiSuit(g, 0)).not.toBeNull();
    expect(g.abilities[0]!.preDeal!(g, 0)).toEqual([]);
  });

  it('电脑的霞照旧一落后就请神', () => {
    const g = newGame(['kasumi', 'saki', 'nodoka', 'kuro'], null);
    g.players[0].score = 10000;
    restart(g);
    expect(kasumiSuit(g, 0)).not.toBeNull();
  });
});

describe('松实玄：打出宝牌以后整场失效', () => {
  it('打出宝牌以后，之后每一局都摸不到宝牌（牌山里还有别的牌时）', () => {
    let lostGames = 0;
    let checked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const seats = ['kuro', 'saki', 'nodoka', 'toki'].map(byId);
      const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      let lostAt: number | null = null;
      g.onEvent((e) => {
        if (e.type === 'ability' && e.seat === 0 && e.text.startsWith('打出了宝牌')) lostAt = g.roundNumber + 4 * g.roundWind;
        if (e.type !== 'draw' || e.seat !== 0 || g.rinshanDraw || !kuroLost(g, 0)) return;
        checked++;
        expect(isDoraTile(g, g.players[0].drawn!)).toBe(false);
      });
      let steps = 0;
      let rounds = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          rounds++;
          continue;
        }
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
      if (lostAt !== null && rounds > 0) lostGames++;
    }
    expect(lostGames).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(20);
  }, 120000);
});
