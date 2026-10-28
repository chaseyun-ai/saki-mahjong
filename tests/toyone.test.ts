import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { toyoneCanUse, toyoneMode, toyoneRedHidden, type RokuyouId } from '../src/abilities/toyone';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { RED_FIVES, kindOf } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function newGame(seed: number, ids: string[], manual = false) {
  return new Game({ seed, format: 'south', players: ids.map((id, s) => ({ name: id, ability: byId(id).ability, manual: manual && s === 0 })) });
}

// 发牌（爽在场时配牌后还要再按一次）
function dealAll(g: Game) {
  g.deal();
  if ((g.phase as string) === 'postdeal') g.deal();
}

// 打完整场。pick：玩家操作 0 号位的丰音时，发牌前选哪一种（不选给 null）；电脑替玩家打牌
function run(g: Game, ids: string[], pick?: (g: Game) => RokuyouId | null, onStep?: (g: Game) => void) {
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      const id = pick?.(g) ?? null;
      g.abilities[0]!.setPreDeal!(g, 0, id ? [id] : []);
      g.deal();
      continue;
    }
    if (g.phase === 'postdeal') {
      g.abilities[g.manual.indexOf(true)]?.setPostDeal?.(g, 0, []);
      g.deal();
      continue;
    }
    onStep?.(g);
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
  return g;
}

describe('姊带丰音', () => {
  it('4 费；主动的四种发牌前可选，大安、佛灭一场一次', () => {
    expect(byId('toyone').cost).toBe(4);
    const ids = ['toyone', 'mako', 'ako', 'izumi'];
    const g = newGame(1, ids, true);
    expect(g.phase).toBe('predeal');
    const ab = g.abilities[0]!;
    const opts = ab.preDeal!(g, 0);
    expect(opts.map((o) => o.id)).toEqual(['sensho', 'shakku', 'taian', 'butsumetsu']);
    expect(opts.every((o) => o.group === 'rokuyou' && o.enabled)).toBe(true);
    ab.setPreDeal!(g, 0, ['taian']);
    g.deal();
    expect(toyoneMode(g, 0)).toBe('taian');
    // 这一局已经有技能起作用：别的都开不了
    expect((['sensho', 'shakku', 'butsumetsu'] as RokuyouId[]).some((id) => toyoneCanUse(g, 0, id))).toBe(false);
    run(g, ids, () => null);
    // 大安用过了：后面的局发牌前不能再选
    const again = newGame(1, ids, true);
    again.abilities[0]!.setPreDeal!(again, 0, ['taian']);
    again.deal();
    while (again.phase !== 'roundEnd') again.act(again.waitingSeats()[0], chooseAction(again, again.waitingSeats()[0], byId(ids[again.waitingSeats()[0]]).ai));
    again.nextRound();
    expect(again.abilities[0]!.preDeal!(again, 0).find((o) => o.id === 'taian')!.enabled).toBe(false);
  });

  it('每一局只有一种起作用：先开了先胜，别人立直也不发动先负', () => {
    const ids = ['toyone', 'hisa', 'yuuki', 'sera'];
    let senshoRounds = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed, ids, true);
      run(g, ids, () => 'sensho', (g) => {
        if (g.phase !== 'turn' || g.players[0].melds.length) return;
        expect(toyoneMode(g, 0)).toBe('sensho');
        senshoRounds++;
      });
    }
    expect(senshoRounds).toBeGreaterThan(0);
  });

  it('先负：先默听，有人立直后发动；追立以后先立直的人摸到的都是她的铳牌', () => {
    const ids = ['toyone', 'hisa', 'yuuki', 'sera'];
    let chased = 0;
    let fed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = newGame(seed, ids);
      g.onEvent((e) => {
        if (e.type === 'discard' && e.seat === 0 && e.riichi) {
          // 电脑的丰音在先负还能发动时不立直（默听）
          expect(toyoneMode(g, 0)).not.toBeNull();
          if (toyoneMode(g, 0) === 'senbu') chased++;
        }
        if (e.type === 'draw' && e.seat !== 0) {
          const st = g.abilityState[0] as { mode?: string; chase?: number[] };
          if (st.mode === 'senbu' && st.chase?.includes(e.seat) && g.players[0].riichi && !g.isFuriten(0) && !g.isSealed(0) && !g.fieldVoid() && !g.active(e.seat)?.resist?.(g, e.seat)) {
            // 优希东场坐庄时挡掉一半，不算
            const drawn = g.players[e.seat].drawn!;
            const waits = g.waits(0);
            // 牌山里还有她的和了牌就一定摸到它
            if (waits.includes(kindOf(drawn))) fed++;
            else expect(g.wall.live.filter((t) => waits.includes(kindOf(t)))).toEqual([]);
          }
        }
      });
      run(g, ids);
    }
    expect(chased).toBeGreaterThan(0);
    expect(fed).toBeGreaterThan(0);
  }, 60000);

  it('友引：四副露单骑，下一次摸牌必定自摸', () => {
    const ids = ['toyone', 'mako', 'ako', 'izumi'];
    const g = newGame(4, ids, true);
    g.abilities[0]!.setPreDeal!(g, 0, []);
    dealAll(g);
    // 拼一手四副露（白、发、中、东的碰）单骑：牌山里挑一张数牌当和了牌
    const ofKind = (k: number) => [0, 1, 2, 3].map((i) => k * 4 + i);
    const target = kindOf(g.wall.live.find((t) => kindOf(t) < 27 && kindOf(t) % 9 > 0 && kindOf(t) % 9 < 8)!);
    const p = g.players[0];
    p.melds = [31, 32, 33, 27].map((k) => ({ type: 'pon' as const, tiles: ofKind(k).slice(0, 3) }));
    p.hand = [ofKind(target).find((t) => !g.wall.live.includes(t))!];
    const w = g.wall;
    if (kindOf(w.live[0]) === target) w.bringToLive(0, (t) => kindOf(t) !== target, g.rng);
    expect(kindOf(w.live[0])).not.toBe(target);
    g.abilities[0]!.beforeDraw!(g, 0, false);
    expect(toyoneMode(g, 0)).toBe('tomobiki');
    expect(kindOf(w.live[0])).toBe(target);
    expect(g.events.some((e) => e.type === 'ability' && e.text === '友引')).toBe(true);
  });

  it('大安：别人的规矩管不到她的摸牌', () => {
    const ids = ['toyone', 'kasumi', 'awai', 'koromo'];
    for (let seed = 1; seed <= 4; seed++) {
      const g = newGame(seed, ids, true);
      let firstRound = true;
      g.onEvent((e) => {
        if (e.type === 'roundEnd') firstRound = false;
        if (firstRound && e.type === 'ability' && e.target === 0 && e.seat !== 0) throw new Error(`大安的局里 ${e.seat} 管到了她：${e.text}`);
      });
      run(g, ids, (g) => (g.round === 0 ? 'taian' : null));
    }
  }, 60000);

  it('佛灭：这一局控场的能力全部无效（封印、不许和牌、别人的规矩），玄的宝牌照样算', () => {
    const ids = ['toyone', 'nelly', 'sawaya', 'kuro'];
    const g = newGame(3, ids, true);
    g.abilities[0]!.setPreDeal!(g, 0, ['butsumetsu']);
    dealAll(g);
    expect(toyoneMode(g, 0)).toBe('butsumetsu');
    expect(g.fieldVoid()).toBe(true);
    for (let s = 1; s < 4; s++) expect(g.isSealed(s)).toBe(false);
    expect(g.binds(1, 0)).toBe(false);
    expect(g.binds(2, 1)).toBe(false);
    expect(g.binds(3, 0)).toBe(true); // 玄的宝牌是作者钦定的
    for (let s = 0; s < 4; s++) expect(g.canWin(s)).toBe(true);
    // 下一局恢复
    while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd') g.act(g.waitingSeats()[0], chooseAction(g, g.waitingSeats()[0], byId(ids[g.waitingSeats()[0]]).ai));
    g.nextRound();
    g.abilities[0]!.setPreDeal!(g, 0, []);
    dealAll(g);
    expect(g.fieldVoid()).toBe(false);
    expect(g.abilities[0]!.preDeal!(g, 0).find((o) => o.id === 'butsumetsu')!.enabled).toBe(false);
  });

  it('赤口：看得见没公开的赤宝牌在哪', () => {
    const ids = ['toyone', 'mako', 'ako', 'izumi'];
    const g = newGame(5, ids, true);
    g.abilities[0]!.setPreDeal!(g, 0, ['shakku']);
    g.deal();
    const hidden = toyoneRedHidden(g, 0);
    for (const t of RED_FIVES) expect(hidden.has(t)).toBe(!g.players[0].hand.includes(t));
    expect(g.abilities[0]!.skill!(g, 0)!.note).toContain('赤宝牌');
  });

  it('玩家这一局里随时按：没有别的技能起作用时能开，开了就占住这一局', () => {
    const ids = ['toyone', 'mako', 'ako', 'izumi'];
    const g = newGame(2, ids, true);
    g.abilities[0]!.setPreDeal!(g, 0, []);
    g.deal();
    const ab = g.abilities[0]!;
    const b = ab.skill!(g, 0)!;
    expect(b.choices!.map((c) => c.id)).toEqual(['sensho', 'shakku', 'taian', 'butsumetsu']);
    ab.pressSkill!(g, 0, 'butsumetsu');
    expect(toyoneMode(g, 0)).toBe('butsumetsu');
    ab.pressSkill!(g, 0, 'shakku');
    expect(toyoneMode(g, 0)).toBe('butsumetsu');
    expect(ab.skill!(g, 0)!.choices).toBeUndefined();
  });

  it('和强的控场角色整场打下来不出错', () => {
    const tables = [
      ['toyone', 'teru', 'koromo', 'awai'],
      ['toyone', 'sawaya', 'nelly', 'kasumi'],
      ['toyone', 'komaki', 'saki', 'kuro'],
    ];
    for (const ids of tables) {
      for (let seed = 1; seed <= 3; seed++) {
        const g = run(newGame(seed, ids), ids);
        expect(g.phase).toBe('gameEnd');
        expect(g.players.reduce((a, p) => a + p.score, 0) + g.riichiSticks * 1000).toBe(100000);
      }
    }
  }, 60000);
});
