import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { readOthers } from '../src/abilities/hiroe';
import { MOMO, momoStealthOn } from '../src/abilities/momo';
import { nodokaAngel } from '../src/abilities/nodoka';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], format: 'east' | 'south', on: (g: Game) => void, after?: (g: Game) => void) {
  const seats = ids.map(byId);
  const g = new Game({ seed, format, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  on(g);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
    after?.(g);
  }
  expect(g.phase).toBe('gameEnd');
  return g;
}

describe('东横桃子', () => {
  it('3 费；第 7 巡起整条牌河、手牌别人看不见，打的牌鸣不了也荣和不了，她立没立直别人也不知道', () => {
    expect(byId('momo').cost).toBe(3);
    const n = { hidden: 0, shown: 0, hiddenRiichi: 0, blocked: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const ids = ['momo', 'hiroe', 'mako', 'kuro'];
      play(seed, ids, 'east', (g) =>
        g.onEvent((e) => {
          if (e.type !== 'discard' || e.seat !== 0) return;
          const late = g.players[0].discards.length >= MOMO.from;
          for (const o of [1, 2, 3]) expect(g.stealthed(0, o)).toBe(late);
          expect(g.stealthed(0, 0)).toBe(false);
          if (late) n.hidden++;
          else n.shown++;
          expect(momoStealthOn(g, 0)).toBe(late);
          // 隐身了，之前立的直也看不见
          if (late && g.players[0].riichi) {
            n.hiddenRiichi++;
            for (const o of [1, 2, 3]) expect(g.seesRiichi(0, o)).toBe(false);
            expect(g.seesRiichi(0, 0)).toBe(true);
          }
        }),
        // 看不见的牌谁也鸣不了、荣和不了
        (g) => {
          if (g.phase !== 'calls' || g.callKind !== 'discard' || g.lastDiscard?.seat !== 0) return;
          if (g.players[0].discards.length >= MOMO.from) {
            n.blocked++;
            expect(g.waitingSeats()).toEqual([]);
          }
        },
      );
    }
    expect(n.hidden).toBeGreaterThan(50);
    expect(n.shown).toBeGreaterThan(50);
    expect(n.hiddenRiichi).toBeGreaterThan(0);
    expect(n.blocked).toBe(0);
  }, 120000);

  it('隐身以后的立直：别人眼里的点数、立直棒不算那 1000 点；读牌的洋榎读不出她；一局结束全部亮出来', () => {
    let checked = 0;
    let revealed = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, ['momo', 'hiroe', 'mako', 'kuro'], 'east', (g) =>
        g.onEvent((e) => {
          if (e.type === 'roundEnd') {
            if (g.players[0].discards.length >= MOMO.from) {
              revealed++;
              expect(g.stealthed(0, 1)).toBe(false);
            }
            return;
          }
          if (e.type !== 'draw' || e.seat === 0) return;
          if (momoStealthOn(g, 0)) expect(readOthers(g, 1).some((r) => r.seat === 0)).toBe(false);
          if (!g.players[0].riichi || g.seesRiichi(0, 1)) return;
          checked++;
          expect(g.shownScore(0, 1)).toBe(g.players[0].score + 1000);
          expect(g.shownScore(0, 0)).toBe(g.players[0].score);
          expect(g.shownSticks(1)).toBe(g.riichiSticks - 1);
        }),
      );
    }
    expect(checked).toBeGreaterThan(0);
    expect(revealed).toBeGreaterThan(0);
  }, 120000);

  it('电脑的桃子隐身之前不立直', () => {
    let riichi = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['momo', 'izumi', 'mako', 'kuro'], 'east', (g) =>
        g.onEvent((e) => {
          if (e.type !== 'discard' || e.seat !== 0 || !e.riichi) return;
          riichi++;
          expect(g.players[0].discards.length).toBeGreaterThanOrEqual(MOMO.from);
          expect(g.seesRiichi(0, 1)).toBe(false);
        }),
      );
    }
    expect(riichi).toBeGreaterThan(0);
  }, 120000);

  it('天使和的原村和看得见她：别人看不见的牌她看得见', () => {
    let angelSaw = 0;
    for (let seed = 1; seed <= 6; seed++) {
      // 桌上三个比和强的人（桃子 3 费），过完 3 局（本场也算）起和是天使和
      play(seed, ['momo', 'nodoka', 'teru', 'awai'], 'south', (g) =>
        g.onEvent((e) => {
          if (e.type !== 'discard' || e.seat !== 0) return;
          if (g.players[0].discards.length < MOMO.from) return;
          const angel = nodokaAngel(g, 1);
          expect(g.stealthed(0, 1)).toBe(!angel);
          expect(g.stealthed(0, 2)).toBe(true);
          if (angel) angelSaw++;
        }),
      );
    }
    expect(angelSaw).toBeGreaterThan(0);
  }, 120000);

  it('隐身封印不了：恭子打乱流向、爽的蛇神威都没用', () => {
    const n = { checked: 0, underSeal: 0 };
    for (let seed = 1; seed <= 10; seed++) {
      play(seed, ['momo', 'kyouko', 'sawaya', 'mako'], 'east', (g) =>
        g.onEvent((e) => {
          if (e.type !== 'discard' && e.type !== 'call' && e.type !== 'draw') return;
          if (g.phase === 'roundEnd' || g.phase === 'gameEnd') return;
          expect(g.isSealed(0)).toBe(false);
          if (g.players[0].discards.length < MOMO.from) return;
          n.checked++;
          for (const o of [1, 2, 3]) expect(g.stealthed(0, o)).toBe(true);
          if ([1, 2, 3].some((o) => g.abilities[o]?.seals?.(g, o, g.round))) n.underSeal++;
        }),
      );
    }
    expect(n.checked).toBeGreaterThan(50);
    expect(n.underSeal).toBeGreaterThan(0);
  }, 120000);

  it('隐身以后的副露别人也看不见：加杠抢不了', () => {
    let kakan = 0;
    let hiddenMelds = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        ['momo', 'mako', 'kuro', 'hiroe'],
        'east',
        (g) =>
          g.onEvent((e) => {
            if (e.type === 'call' && e.seat === 0 && momoStealthOn(g, 0)) hiddenMelds++;
          }),
        (g) => {
          if (g.phase !== 'calls' || g.callKind !== 'chankan' || g.kakanInfo?.seat !== 0) return;
          if (!momoStealthOn(g, 0)) return;
          kakan++;
          expect(g.waitingSeats()).toEqual([]);
        },
      );
    }
    expect(hiddenMelds).toBeGreaterThan(0);
    expect(kakan).toBe(0);
  }, 120000);
});
