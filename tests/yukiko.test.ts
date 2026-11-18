import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { HIROKO_NOTES } from '../src/abilities/hiroko';
import { isDoraTile } from '../src/abilities/kuro';
import { YUKIKO, yukikoAbility, yukikoCanLeft, yukikoLeft, yukikoLeftUses } from '../src/abilities/yukiko';
import { chooseAction } from '../src/ai/ai';
import { Game, type RoundResult } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';
import { SCHOOLS, membersOf } from '../src/ui/schools';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const newGame = (seed: number, ids: string[]) => new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });

// 电脑把一场打完。beforeAct：每一步之前调（玩家操作的座位在这里按技能）
function play(g: Game, ids: string[], beforeAct?: () => void): void {
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 60000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      g.deal();
      continue;
    }
    beforeAct?.();
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
}

// 听着牌：13 张时听牌，14 张（刚摸完）时打一张就听牌
const tenpaiNow = (g: Game, seat: number) => {
  const p = g.players[seat];
  const c = toCounts(p.hand);
  if (p.hand.length % 3 === 1) return shanten(c, p.melds.length) === 0;
  return c.some((n, k) => {
    if (n === 0) return false;
    c[k]--;
    const ok = shanten(c, p.melds.length) === 0;
    c[k]++;
    return ok;
  });
};

// 左手的局：按的时候的样子、那一局怎么结束的
interface LeftRound {
  label: string;
  dealer: boolean;
  last2: boolean;
  last1: boolean;
  atStart: boolean; // 开局就按（谁都还没出牌）
  tenpai: boolean; // 按的时候听着牌（14 张时是打一张就听牌）
  result?: RoundResult;
  riichi?: boolean;
  tenpaiDraws: number; // 听着牌摸了几次（不算和牌的那一次以后）
  missedThird: boolean; // 听着牌摸到第三次还没摸到和了牌，牌山、王牌里又明明还有
  doraWanted: number; // 没听牌、手里宝牌不到 YUKIKO.dora 张时摸的牌
  doraOk: number; // 其中摸来的是有效进张或者宝牌的
}

function watch(g: Game, seat: number): LeftRound[] {
  const out: LeftRound[] = [];
  let cur: LeftRound | null = null;
  let tenpaiBefore = false;
  let wantDora = false;
  let shBefore = 0;
  g.onEvent((e) => {
    if (e.type === 'ability' && e.seat === seat && e.ability === 'yukiko' && e.text === '左手') {
      const p = g.players[seat];
      const thirteen = p.hand.length % 3 === 1;
      cur = {
        label: g.roundLabel(),
        dealer: g.dealer === seat && g.roundWind >= 1,
        last2: g.isLastRounds(2),
        last1: g.isLastRounds(1),
        atStart: g.players.every((q) => q.discards.length === 0),
        tenpai: tenpaiNow(g, seat),
        tenpaiDraws: 0,
        missedThird: false,
        doraWanted: 0,
        doraOk: 0,
      };
      out.push(cur);
      tenpaiBefore = thirteen && cur.tenpai;
      shBefore = thirteen ? shanten(toCounts(p.hand), p.melds.length) : 99;
      wantDora = thirteen && !cur.tenpai && p.hand.filter((t) => isDoraTile(g, t)).length < YUKIKO.dora;
    }
    if (!cur) return;
    if (e.type === 'draw' && e.seat === seat) {
      const p = g.players[seat];
      const drawn = p.drawn!;
      // 牌山、王牌里还有宝牌时才算（宝牌都在别人手里、牌河里就换不来）
      const doraLeft = isDoraTile(g, drawn) || [...g.wall.live, ...g.wall.rinshan, ...g.wall.uraIndicators].some((t) => isDoraTile(g, t));
      if (wantDora && doraLeft) {
        cur.doraWanted++;
        if (isDoraTile(g, drawn) || shanten(toCounts(p.hand), p.melds.length) < shBefore) cur.doraOk++;
      }
      if (tenpaiBefore) {
        cur.tenpaiDraws++;
        const won = shanten(toCounts(p.hand), p.melds.length) === -1;
        // 第三次一定来：除非四张都已经看得见（牌河、副露、自己手里）
        if (cur.tenpaiDraws === 3 && !won) {
          const c = toCounts(p.hand.filter((t) => t !== drawn));
          const live = [...g.wall.live, ...g.wall.rinshan, ...g.wall.uraIndicators].some((t) => {
            c[kindOf(t)]++;
            const ok = shanten(c, p.melds.length) === -1;
            c[kindOf(t)]--;
            return ok;
          });
          if (live) cur.missedThird = true;
        }
      }
    }
    if (e.type === 'discard' && e.seat === seat) {
      const p = g.players[seat];
      shBefore = shanten(toCounts(p.hand), p.melds.length);
      tenpaiBefore = shBefore === 0;
      wantDora = shBefore > 0 && p.hand.filter((t) => isDoraTile(g, t)).length < YUKIKO.dora;
    }
    if (e.type === 'roundEnd') {
      cur.result = e.result;
      cur.riichi = g.players[seat].riichi;
      cur = null;
      tenpaiBefore = false;
      wantDora = false;
    }
  });
  return out;
}

describe('真屋由晖子：登记', () => {
  it('有珠山的五个人按先锋到大将排好；由晖子有能力，另外三个没有能力、各有一段介绍；浩子的资料本里有她', () => {
    const usuzan = SCHOOLS.find((s) => s.name === '有珠山高中')!;
    expect(usuzan.lineup).toEqual(['naruka', 'chikako', 'yuan', 'yukiko', 'sawaya']);
    expect(membersOf('有珠山高中').map((c) => c.id)).toEqual(['naruka', 'chikako', 'yuan', 'yukiko', 'sawaya']);
    const yukiko = byId('yukiko');
    expect(yukiko.ability).toBe(yukikoAbility);
    expect(yukiko.cost).toBe(3);
    expect(yukiko.ai.leftHand).toBe(true);
    // 发牌前不问，对局中按技能按钮（按钮画成 𐤄）
    expect(yukikoAbility.preDeal).toBeUndefined();
    expect(HIROKO_NOTES.yukiko).toBeTruthy();
    for (const id of ['naruka', 'chikako', 'yuan']) {
      const c = byId(id);
      expect(c.ability, id).toBeNull();
      expect(c.cost, id).toBe(1);
      expect(c.note, id).toBeTruthy();
    }
    expect(byId('naruka').ai.pushTenpai).toBe(true);
    expect(byId('chikako').ai.formalTenpai).toBe(true);
    expect(byId('chikako').ai.defensive).toBe(true);
    expect(byId('yuan').ai.yakitori).toBe(true);
  });
});

describe('真屋由晖子：左手', () => {
  it('玩家：对局中随时按得了（别人的回合也行），按了这一局起作用，一场只能按一次；按之前电脑不会替她按', () => {
    let pressedOthersTurn = 0;
    let wanted = 0;
    let ok = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const ids = ['izumi', 'yukiko', 'izumi', 'izumi'];
      const g = newGame(seed, ids);
      g.manual[1] = true;
      const rounds = watch(g, 1);
      let pressed = false;
      play(g, ids, () => {
        const b = yukikoAbility.skill!(g, 1)!;
        expect(b.glyph).toBe('he');
        expect(b.enabled).toBe(yukikoCanLeft(g, 1));
        if (pressed) {
          expect(b.enabled).toBe(false);
          return;
        }
        // 第二局，她打过两张以后、轮到别人的时候按
        if (g.round >= 1 && g.players[1].discards.length >= 2 && g.phase === 'turn' && g.turn !== 1) {
          expect(b.enabled, `种子 ${seed}`).toBe(true);
          yukikoAbility.pressSkill!(g, 1);
          pressed = true;
          pressedOthersTurn++;
          expect(yukikoLeft(g, 1)).toBe(true);
          expect(yukikoLeftUses(g, 1)).toBe(0);
          expect(yukikoAbility.skill!(g, 1)!.active).toBe(true);
          // 再按也没用
          yukikoAbility.pressSkill!(g, 1);
          expect(yukikoLeftUses(g, 1)).toBe(0);
        }
      });
      expect(pressed, `种子 ${seed}`).toBe(true);
      expect(rounds.length, `种子 ${seed}`).toBe(1);
      expect(rounds[0].missedThird, `种子 ${seed}`).toBe(false);
      wanted += rounds[0].doraWanted;
      ok += rounds[0].doraOk;
      // 左手那一局以外不是左手
      expect(yukikoLeft(g, 1)).toBe(false);
    }
    expect(pressedOthersTurn).toBe(6);
    // 没听牌、宝牌不到两张时：摸来的不是有效进张就是宝牌（没用的牌换成宝牌）
    expect(wanted).toBeGreaterThan(5);
    expect(ok / wanted).toBeGreaterThan(0.9);
  }, 120000);

  it('一局打完、还没发牌的时候按不了', () => {
    const ids = ['izumi', 'yukiko', 'izumi', 'izumi'];
    const g = newGame(1, ids);
    g.manual[1] = true;
    let steps = 0;
    while (g.phase !== 'roundEnd' && ++steps < 2000) {
      const s = g.waitingSeats()[0];
      g.act(s, chooseAction(g, s, byId(ids[s]).ai));
    }
    expect(g.phase).toBe('roundEnd');
    expect(yukikoCanLeft(g, 1)).toBe(false);
    expect(yukikoAbility.skill!(g, 1)!.enabled).toBe(false);
  });

  it('电脑：南场坐庄、最后两局或者点数见底时听了牌才按，最后一局开局就按，一场最多一次；左手的局多半是她和，立直、荣和都至少满贯；听着牌第三次摸牌一定是和了牌', () => {
    let used = 0;
    let won = 0;
    let atTenpai = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const ids = ['yukiko', 'izumi', 'izumi', 'izumi'];
      const g = newGame(seed, ids);
      const lows: boolean[] = [];
      g.onEvent((e) => {
        if (e.type === 'ability' && e.text === '左手') lows.push(g.players[0].score < 10000);
      });
      const rounds = watch(g, 0);
      play(g, ids);
      expect(rounds.length, `种子 ${seed}`).toBeLessThanOrEqual(1);
      for (const [i, r] of rounds.entries()) {
        const label = `种子 ${seed} ${r.label}`;
        used++;
        if (r.atStart) expect(r.last1, label).toBe(true);
        else {
          expect(r.dealer || r.last2 || lows[i], label).toBe(true);
          expect(r.tenpai, label).toBe(true);
          atTenpai++;
        }
        expect(r.missedThird, label).toBe(false);
        const w = r.result?.kind === 'win' ? r.result.wins.find((x) => x.seat === 0) : undefined;
        if (!w) continue;
        won++;
        if (r.riichi || w.from !== null) expect(w.result.base, `${label} ${w.result.han} 番 ${w.result.fu} 符`).toBeGreaterThanOrEqual(2000);
      }
    }
    expect(used).toBeGreaterThanOrEqual(12);
    expect(atTenpai).toBeGreaterThan(0);
    expect(won / used).toBeGreaterThan(0.7);
  }, 180000);
});

describe('真屋由晖子：整场', () => {
  it('和各种能力同桌打得完', () => {
    const others = CHARACTERS.filter((c) => c.ability && c.id !== 'yukiko').map((c) => c.id);
    for (let seed = 1; seed <= 6; seed++) {
      const pick = [0, 1, 2].map((i) => others[(seed * 7 + i * 11) % others.length]);
      const ids = ['yukiko', ...pick];
      const g = newGame(seed, ids);
      play(g, ids);
      expect(g.phase, `种子 ${seed} ${ids.join(',')}`).toBe('gameEnd');
    }
  }, 180000);
});
