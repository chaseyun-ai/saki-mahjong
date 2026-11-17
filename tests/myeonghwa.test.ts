import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { HIROKO_NOTES } from '../src/abilities/hiroko';
import { MYEONGHWA, myeonghwaAbility, myeonghwaCut, myeonghwaSinging, myeonghwaSong, myeonghwaWinds } from '../src/abilities/myeonghwa';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { EAST, NORTH, kindOf } from '../src/engine/tiles';
import { SCHOOLS } from '../src/ui/schools';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const isWind = (t: number) => kindOf(t) >= EAST && kindOf(t) <= NORTH;
const newGame = (seed: number, ids: string[]) => new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });

// 电脑把一场打完。each：每一步之前调（停在发牌前时返回 true 表示自己处理了）
function play(g: Game, ids: string[], onPreDeal?: () => void): void {
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 60000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      onPreDeal?.();
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
  expect(g.phase).toBe('gameEnd');
}

describe('雀明华：登记', () => {
  it('4 费，在临海女子的名单里，浩子的资料本里有她', () => {
    const c = byId('myeonghwa');
    expect(c.cost).toBe(4);
    expect(c.school).toBe('临海女子');
    expect(c.ability).toBe(myeonghwaAbility);
    expect(SCHOOLS.find((s) => s.name === '临海女子')!.lineup).toContain('myeonghwa');
    expect(HIROKO_NOTES.myeonghwa).toBeTruthy();
  });
});

describe('雀明华：风', () => {
  it('每一局配牌都有自风暗刻和一张场风；场风的第二张开局几巡之内摸到', async () => {
    let rounds = 0;
    let long = 0;
    let paired = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ids = ['izumi', 'izumi', 'izumi', 'izumi'];
      const seat = seed % 4;
      ids[seat] = 'myeonghwa';
      const g = newGame(seed, ids);
      let draws = 0;
      const check = () => {
        const { seat: sw, round } = myeonghwaWinds(g, seat);
        const hand = g.players[seat].hand;
        expect(hand.filter((t) => kindOf(t) === sw).length, `种子 ${seed} ${g.roundLabel()} 自风`).toBeGreaterThanOrEqual(3);
        if (round !== null) expect(hand.filter((t) => kindOf(t) === round).length, `种子 ${seed} ${g.roundLabel()} 场风`).toBeGreaterThanOrEqual(1);
        rounds++;
        draws = 0;
      };
      g.onEvent((e) => {
        if (e.type === 'roundStart') check();
        if (e.type === 'draw' && e.seat === seat) draws++;
        if (e.type !== 'roundEnd') return;
        const { round } = myeonghwaWinds(g, seat);
        if (round === null || draws < MYEONGHWA.roundWithin) return;
        long++;
        const p = g.players[seat];
        const seen = [...p.hand, ...p.melds.flatMap((m) => m.tiles), ...p.discards.map((d) => d.tile)].filter((t) => kindOf(t) === round).length;
        if (seen >= 2) paired++;
      });
      // 第一局在构造时就发了牌
      check();
      play(g, ids);
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(rounds).toBeGreaterThan(80);
    expect(long).toBeGreaterThan(20);
    // 别人先拿走三张的局凑不成，极少
    expect(paired / long).toBeGreaterThan(0.9);
  }, 120000);

  it('自风就是场风的局只要那一副暗刻', () => {
    const g = newGame(3, ['myeonghwa', 'izumi', 'izumi', 'izumi']);
    // 东一局坐庄：自风、场风都是东
    expect(g.dealer).toBe(0);
    expect(myeonghwaWinds(g, 0)).toEqual({ seat: EAST, round: null });
    expect(myeonghwaWinds(g, 1).round).toBe(EAST);
  });
});

describe('雀明华：歌', () => {
  it('电脑一场只开一次嗓；她和牌升一段，别人和牌就停，停了不再唱', async () => {
    let opened = 0;
    let stopped = 0;
    let rose = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ids = seed % 2 ? ['izumi', 'myeonghwa', 'izumi', 'izumi'] : ['yuuki', 'saki', 'myeonghwa', 'kuro'];
      const seat = ids.indexOf('myeonghwa');
      const g = newGame(seed, ids);
      let mine = 0;
      let before = myeonghwaSong(g, seat);
      g.onEvent((e) => {
        if (e.type === 'ability' && e.ability === 'myeonghwa' && e.text === '开嗓') mine++;
        if (e.type === 'ability' && e.ability === 'myeonghwa' && e.text === '歌停了') stopped++;
        if (e.type === 'roundStart') before = myeonghwaSong(g, seat);
        if (e.type !== 'roundEnd') return;
        const now = myeonghwaSong(g, seat);
        const won = e.result.kind === 'win' && e.result.wins.some((w) => w.seat === seat);
        const lost = e.result.kind === 'win' && !won;
        const label = `种子 ${seed} ${g.roundLabel()}`;
        if (before === 0) expect(now, label).toBe(0);
        else if (won) {
          expect(now, label).toBe(Math.min(MYEONGHWA.songMax, before + 1));
          if (now > before) rose++;
        } else if (lost) expect(now, label).toBe(0);
        else expect(now, label).toBe(before);
      });
      if (myeonghwaSong(g, seat) > 0) mine++;
      play(g, ids);
      expect(mine, `种子 ${seed}`).toBeLessThanOrEqual(1);
      opened += mine;
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(opened).toBeGreaterThan(6);
    expect(stopped).toBeGreaterThan(3);
    expect(rose).toBeGreaterThan(0);
  }, 120000);

  it('玩家发牌前选了才唱；一场一次', () => {
    const ids = ['izumi', 'myeonghwa', 'izumi', 'izumi'];
    const g = newGame(5, ids);
    g.manual[1] = true;
    let asked = 0;
    let sangAt = -1;
    play(g, ids, () => {
      asked++;
      const opts = myeonghwaAbility.preDeal!(g, 1);
      const song = opts.find((o) => o.id === 'song')!;
      if (asked === 2) {
        expect(song.enabled).toBe(true);
        myeonghwaAbility.setPreDeal!(g, 1, ['song']);
        sangAt = g.round + 1;
      } else {
        if (asked > 2) expect(song.enabled).toBe(false);
        myeonghwaAbility.setPreDeal!(g, 1, []);
      }
    });
    expect(asked).toBeGreaterThan(2);
    expect(sangAt).toBeGreaterThan(0);
    const texts = g.events.filter((e) => e.type === 'ability' && e.ability === 'myeonghwa').map((e) => (e as { text: string }).text);
    expect(texts.filter((t) => t === '开嗓').length).toBe(1);
  }, 60000);
});

describe('雀明华：断风', () => {
  it('选了一家：那一家这一局配牌里没有风牌、也摸不到；她自己这一局没有风牌的加护，歌不起作用；一场一次', () => {
    let cuts = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const ids = ['izumi', 'myeonghwa', 'izumi', 'izumi'];
      const g = newGame(seed, ids);
      g.manual[1] = true;
      let asked = 0;
      let cutRound = -1;
      g.onEvent((e) => {
        if (e.type === 'roundStart' && g.round === cutRound) {
          expect(myeonghwaCut(g, 1)).toBe(3);
          expect(myeonghwaSinging(g, 1)).toBe(0);
          expect(g.players[3].hand.filter(isWind).length, `种子 ${seed} 配牌`).toBe(0);
          cuts++;
        }
        if (e.type === 'draw' && e.seat === 3 && g.round === cutRound && g.players[3].melds.every((m) => !m.type.includes('kan'))) expect(isWind(g.players[3].drawn!), `种子 ${seed} 摸牌`).toBe(false);
      });
      play(g, ids, () => {
        asked++;
        const opts = myeonghwaAbility.preDeal!(g, 1);
        if (asked === 1) {
          expect(opts.find((o) => o.id === 'cut@2')!.enabled).toBe(true);
          // 上家是 seat 0，对家是 seat 3
          myeonghwaAbility.setPreDeal!(g, 1, ['cut@2']);
          cutRound = g.round + 1;
        } else {
          expect(opts.filter((o) => o.id.startsWith('cut@')).every((o) => !o.enabled)).toBe(true);
          myeonghwaAbility.setPreDeal!(g, 1, []);
        }
      });
      expect(myeonghwaCut(g, 1) === null || g.round === cutRound).toBe(true);
    }
    expect(cuts).toBe(6);
  }, 60000);

  it('电脑：初美坐北家的局对她断风，那一局初美配牌里没有风牌', async () => {
    let cuts = 0;
    let norths = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const ids = ['myeonghwa', 'izumi', 'hatsumi', 'izumi'];
      const g = newGame(seed, ids);
      let sat = false;
      const check = () => {
        const north = g.seatWind(2) === NORTH;
        // 一场一次：初美坐北家的第一局就用
        expect(myeonghwaCut(g, 0), `种子 ${seed} ${g.roundLabel()}`).toBe(north && !sat ? 2 : null);
        if (north && !sat) {
          expect(g.players[2].hand.filter(isWind).length, `种子 ${seed} ${g.roundLabel()}`).toBe(0);
          cuts++;
          norths++;
        }
        sat ||= north;
      };
      g.onEvent((e) => e.type === 'roundStart' && check());
      check();
      play(g, ids);
      await new Promise((r) => setTimeout(r, 0));
    }
    // 有几场她坐庄连和把人击飞了，初美没轮到北家
    expect(norths).toBeGreaterThan(3);
    expect(cuts).toBe(norths);
  }, 120000);
});

describe('雀明华：整场', () => {
  it('和各种能力同桌打得完', async () => {
    const tables = [
      ['hatsumi', 'myeonghwa', 'kuro', 'awai'],
      ['teru', 'koromo', 'myeonghwa', 'kasumi'],
      ['myeonghwa', 'sawaya', 'nelly', 'shizuno'],
      ['toyone', 'satoha', 'huiyu', 'myeonghwa'],
    ];
    for (let seed = 1; seed <= 8; seed++) {
      const ids = tables[seed % tables.length];
      play(newGame(seed * 31, ids), ids);
      await new Promise((r) => setTimeout(r, 0));
    }
  }, 180000);
});
