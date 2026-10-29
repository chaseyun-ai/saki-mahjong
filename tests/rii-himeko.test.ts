import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { HIMEKO, himekoBroken, himekoKey, himekoPlan } from '../src/abilities/himeko';
import { isDoraTile } from '../src/abilities/kuro';
import { RII, riiBind, riiKeys } from '../src/abilities/rii';
import type { BindKey } from '../src/abilities/types';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';
import { TeamRun } from '../src/team/team';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function setup(seed: number, ids: string[], opts: { manual?: number; keys?: BindKey[][]; format?: 'east' | 'south' } = {}) {
  const seats = ids.map(byId);
  const g = new Game({ seed, format: opts.format ?? 'east', keys: opts.keys, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: i === opts.manual })) });
  return { g, seats };
}

function playRound(g: Game, seats: ReturnType<typeof byId>[], before?: (g: Game, s: number) => void) {
  let steps = 0;
  while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++steps < 5000) {
    const s = g.waitingSeats()[0];
    before?.(g, s);
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  expect(g.phase).toBe('roundEnd');
}

const keyAt = (label: string, bind: number): BindKey[][] => [[{ label, round: 1, bind, broken: false }], [], [], []];

describe('白水哩', () => {
  it('3 费、新道寺；别人对她的影响减半', () => {
    expect(byId('rii').cost).toBe(3);
    expect(byId('rii').school).toBe('新道寺女子');
    const { g } = setup(1, ['rii', 'teru', 'kuro', 'koromo']);
    expect(g.active(0)!.resist!(g, 0)).toBe(RII.resist);
  });

  it('番缚只在第一次出牌前能选；缚了也不出字、头像框不显示，只有照魔镜看得到', () => {
    let tried = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { g, seats } = setup(seed, ['rii', 'teru', 'hiroe', 'mako'], { manual: 0 });
      const ab = seats[0].ability!;
      const events = g.events.length;
      playRound(g, seats, (g, s) => {
        if (s !== 0 || g.phase !== 'turn') return;
        const b = ab.skill!(g, 0)!;
        const first = g.players[0].discards.length === 0;
        if (riiBind(g, 0) === null) expect(b.choices!.every((c) => c.enabled)).toBe(first);
        if (first && riiBind(g, 0) === null) {
          ab.pressSkill!(g, 0, '3');
          tried++;
          expect(riiBind(g, 0)).toBe(3);
          expect(ab.badge!(g, 0) ?? '').not.toContain('3');
          expect(ab.insight!(g, 0)[0]).toContain('3 番');
          // 再按不会改
          ab.pressSkill!(g, 0, '5');
          expect(riiBind(g, 0)).toBe(3);
        }
      });
      // 缚的时候没有出字：这一局哩的字只有结算时的钥匙
      const texts = g.events.slice(events).filter((e) => e.type === 'ability' && e.seat === 0).map((e) => (e.type === 'ability' ? e.text : ''));
      for (const t of texts) expect(['钥匙', '破碎的钥匙']).toContain(t);
    }
    expect(tried).toBeGreaterThan(0);
  }, 60000);

  it('和出的番数正好是番缚数得到钥匙，没和成是破碎的钥匙，番数不对什么也没有；钥匙记着场、局、本场', () => {
    const seen = { key: 0, broken: 0, none: 0 };
    for (let seed = 1; seed <= 40 && (seen.key === 0 || seen.none === 0); seed++) {
      const { g, seats } = setup(seed, ['rii', 'izumi', 'mako', 'kyouko'], { format: 'south' });
      for (let r = 0; r < 8 && g.phase !== 'gameEnd'; r++) {
        const label = g.roundLabel();
        const before = riiKeys(g, 0).length;
        playRound(g, seats);
        const bind = riiBind(g, 0);
        // 还没轮到她出牌这一局就结束了：没缚
        if (bind === null) {
          expect(riiKeys(g, 0).length).toBe(before);
          g.nextRound();
          continue;
        }
        expect(bind).toBeGreaterThanOrEqual(1);
        expect(bind).toBeLessThanOrEqual(RII.maxBind);
        const win = g.roundResult!.wins.find((w) => w.seat === 0);
        const keys = riiKeys(g, 0);
        if (!win) {
          expect(keys.length).toBe(before + 1);
          expect(keys.at(-1)).toMatchObject({ label, bind, broken: true });
          seen.broken++;
        } else if (win.result.han === bind) {
          expect(keys.length).toBe(before + 1);
          expect(keys.at(-1)).toMatchObject({ label, bind, broken: false });
          seen.key++;
        } else {
          expect(keys.length).toBe(before);
          seen.none++;
        }
        g.nextRound();
      }
    }
    expect(seen.key).toBeGreaterThan(0);
    expect(seen.broken).toBeGreaterThan(0);
    expect(seen.none).toBeGreaterThan(0);
  }, 60000);
});

describe('鹤田姬子', () => {
  it('1 费、新道寺；没有钥匙的局是普通人', () => {
    expect(byId('himeko').cost).toBe(1);
    const { g } = setup(1, ['himeko', 'teru', 'kuro', 'koromo']);
    expect(himekoKey(g, 0)).toBeNull();
    expect(g.isImmune(0) || g.isAbsolute(0)).toBe(false);
  });

  it('钥匙记的那一局：配牌三向听，四五巡自摸，正好两倍番缚（7 番缚算役满）', () => {
    for (let bind = 1; bind <= 7; bind++) {
      for (let seed = 1; seed <= 4; seed++) {
        const { g, seats } = setup(seed * 7 + bind, ['himeko', 'teru', 'kuro', 'komaki'], { keys: keyAt('东1局 0本场', bind) });
        expect(himekoKey(g, 0)?.bind).toBe(bind);
        expect(himekoPlan(g, 0)).not.toBeNull();
        const p = g.players[0];
        expect(shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), 0)).toBe(3);
        playRound(g, seats);
        const win = g.roundResult!.wins.find((w) => w.seat === 0)!;
        expect(win).toBeDefined();
        expect(win.from).toBeNull();
        if (bind * 2 >= 13) expect(win.result.yakuman).toBeGreaterThan(0);
        else expect(win.result.han).toBe(bind * 2);
        expect(p.discards.length).toBeLessThanOrEqual(6);
      }
    }
  }, 60000);

  it('钥匙的局谁也挡不住她：照、天照的神代、佛灭都一样；只有玄的宝牌照旧', () => {
    const { g } = setup(3, ['himeko', 'teru', 'kuro', 'komaki'], { keys: keyAt('东1局 0本场', 2) });
    expect(g.isAbsolute(0) && g.isImmune(0)).toBe(true);
    expect(g.isSealed(0)).toBe(false);
    for (const o of [1, 2, 3]) expect(g.binds(0, o)).toBe(true);
    expect(g.binds(1, 0)).toBe(false);
    expect(g.binds(3, 0)).toBe(false);
    expect(g.binds(2, 0)).toBe(true);
    // 她要的牌不碰宝牌
    expect(g.players[0].hand.some((t) => isDoraTile(g, t))).toBe(false);
  });

  it('钥匙的局压住所有人：配牌至少三向听，摸不到让向听前进的牌（玄摸宝牌不挡）', () => {
    let draws = 0;
    let better = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { g, seats } = setup(seed, ['himeko', 'teru', 'kuro', 'awai'], { keys: keyAt('东1局 0本场', 3) });
      for (const o of [1, 2, 3]) {
        const p = g.players[o];
        expect(shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), 0)).toBeGreaterThanOrEqual(3);
      }
      let before: number[] = [];
      g.onEvent((e) => {
        if (e.type !== 'draw' || e.seat === 0) return;
        const p = g.players[e.seat];
        const t = p.drawn!;
        if (e.seat === 2 && isDoraTile(g, t)) return;
        draws++;
        const sh = shanten(toCounts(p.hand), p.melds.length);
        if (sh < before[e.seat]) better++;
      });
      playRound(g, seats, (g) => {
        before = g.players.map((p) => shanten(toCounts(p.hand), p.melds.length));
      });
    }
    expect(draws).toBeGreaterThan(0);
    expect(better / draws).toBeLessThan(0.02);
  }, 60000);

  it('破碎的钥匙那一局：配牌烂、没有宝牌、几乎和不了，和了也只有一番', () => {
    let rounds = 0;
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { g, seats } = setup(seed, ['himeko', 'izumi', 'mako', 'ako'], { keys: [[{ label: '东1局 0本场', round: 1, bind: 3, broken: true }], [], [], []] });
      expect(himekoBroken(g, 0)).toBe(true);
      expect(himekoKey(g, 0)).toBeNull();
      expect(g.isImmune(0) || g.isAbsolute(0)).toBe(false);
      const p = g.players[0];
      expect(shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), 0)).toBeGreaterThanOrEqual(HIMEKO.broken.deal - 1);
      // 配牌、摸牌都没有宝牌（鸣来的、开杠翻出来的新宝牌不算）
      expect(p.hand.some((t) => isDoraTile(g, t))).toBe(false);
      g.onEvent((e) => {
        if (e.type === 'draw' && e.seat === 0) expect(isDoraTile(g, p.drawn!)).toBe(false);
      });
      playRound(g, seats);
      rounds++;
      const win = g.roundResult!.wins.find((w) => w.seat === 0);
      if (win) {
        wins++;
        expect(win.result.han).toBeLessThanOrEqual(HIMEKO.broken.maxHan);
      }
    }
    expect(wins / rounds).toBeLessThan(0.1);
  }, 60000);

  it('同桌时：哩拿到钥匙的下一局发动', () => {
    let fired = 0;
    for (let seed = 1; seed <= 30 && fired < 2; seed++) {
      const { g, seats } = setup(seed, ['rii', 'himeko', 'mako', 'izumi'], { format: 'south' });
      const over = () => g.phase === 'gameEnd';
      while (!over()) {
        playRound(g, seats);
        const got = riiKeys(g, 0).find((k) => k.round === g.round && !k.broken);
        g.nextRound();
        if (over()) break;
        expect(himekoKey(g, 1) !== null).toBe(!!got);
        if (got) {
          fired++;
          playRound(g, seats);
          const win = g.roundResult!.wins.find((w) => w.seat === 1)!;
          expect(win).toBeDefined();
          if (got.bind * 2 >= 13) expect(win.result.yakuman).toBeGreaterThan(0);
          else expect(win.result.han).toBe(got.bind * 2);
          g.nextRound();
        }
      }
    }
    expect(fired).toBeGreaterThan(0);
  }, 60000);

  it('团体赛：哩的钥匙带给同队后面的姬子；电脑队把姬子排在哩后面', () => {
    const run = new TeamRun(5, 0);
    const key: BindKey = { label: '南2局 1本场', round: 7, bind: 4, broken: false };
    run.finish([0, 1, 2, 3], [100000, 100000, 100000, 100000], 0, [[], [key], [], []]);
    expect(run.keys[1]).toEqual([key]);
    expect(run.keys[0]).toEqual([]);
    for (let seed = 1; seed <= 40; seed++) {
      const r = new TeamRun(seed, 0);
      while (r.drafting) {
        const team = r.picker()!;
        const want = r.available().find((c) => c.id === 'rii' || c.id === 'himeko');
        if (want && !r.teams[team].human) r.pick(team, want.id);
        else if (r.teams[team].human) r.pick(team, r.available()[0].id);
        else r.aiPick();
      }
      for (const t of r.teams) {
        if (t.human) continue;
        const a = t.lineup.findIndex((c) => c.id === 'rii');
        const b = t.lineup.findIndex((c) => c.id === 'himeko');
        if (a >= 0 && b >= 0) expect(b).toBeGreaterThan(a);
      }
    }
  });
});
