import { describe, expect, it } from 'vitest';
import { akoDistance } from '../src/abilities/ako';
import { CHARACTERS } from '../src/abilities/characters';
import { readTenpai } from '../src/abilities/hiroe';
import { HIROKO_NOTES } from '../src/abilities/hiroko';
import { nellySensesTenpai } from '../src/abilities/nelly';
import { ryuukaSensesTenpai } from '../src/abilities/ryuuka';
import { SATOHA, satohaAbility, satohaBlade, satohaCanStrike, satohaCutsDealer, satohaDistance, satohaGap, satohaRenchanDealer, satohaScouts, satohaSheathed } from '../src/abilities/satoha';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten, waitingKinds } from '../src/engine/shanten';
import { kindOf, parseTiles, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 几种手牌（13 张）：听牌（听 3、6 饼，断幺九）、一向听、离听牌很远
const TENPAI = '234567m23455p66s';
const ONE_AWAY = '234567m2355p668s';
const FAR = '147m258p369s1234z';
// 她自己：门清听牌（听 4、7 索，平和）、没听牌
const MY_TENPAI = '123456m789p56s22z';
const MY_FAR = '1379m1379p1379s1z';
// 三组面子加四张孤张：有效进张不多，看得出加成
const MY_FAR2 = '123456m789p19s15z';

// 智叶坐 seat 号位（默认 1，不坐庄），另外三家没有能力。发完牌以后把四家的手牌换成指定的 13 张
function table(seed: number, hands: { me: string; others: string[] }, opts: { seat?: number; ids?: string[] } = {}) {
  const seat = opts.seat ?? 1;
  const ids = opts.ids ?? [0, 1, 2, 3].map((s) => (s === seat ? 'satoha' : 'izumi'));
  const g = new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
  let n = 0;
  for (let s = 0; s < 4; s++) {
    const p = g.players[s];
    p.hand = parseTiles(s === seat ? hands.me : hands.others[n++]);
    p.drawn = null;
    p.melds = [];
  }
  return { g, seat };
}

// 这一次摸牌前能力动完牌山以后，下一张是不是她的和了牌
function strikeRate(hands: { me: string; others: string[] }, setup: (g: Game, seat: number) => void = () => {}, games = 400) {
  let hits = 0;
  let events = 0;
  for (let seed = 1; seed <= games; seed++) {
    const { g, seat } = table(seed, hands);
    setup(g, seat);
    g.onEvent((e) => {
      if (e.type === 'ability' && e.ability === 'satoha' && e.text === '拔刀') events++;
    });
    const waits = waitingKinds(toCounts(g.players[seat].hand), 0);
    satohaAbility.beforeDraw!(g, seat, false);
    if (waits.includes(kindOf(g.wall.live[0]))) hits++;
  }
  return { rate: hits / games, events };
}

// 没听牌时，这一次摸牌前能力动完牌山以后，下一张是不是有效进张（让向听前进）
function usefulRate(others: string[], games = 1200) {
  let hits = 0;
  for (let seed = 1; seed <= games; seed++) {
    const { g, seat } = table(seed, { me: MY_FAR2, others });
    satohaAbility.beforeDraw!(g, seat, false);
    const c = toCounts(g.players[seat].hand);
    const sh = shanten(c, 0);
    c[kindOf(g.wall.live[0])]++;
    if (shanten(c, 0) < sh) hits++;
  }
  return hits / games;
}

describe('辻垣内智叶：登记', () => {
  it('4 费，临海女子，资料本里有她', () => {
    expect(byId('satoha').cost).toBe(4);
    expect(byId('satoha').school).toBe('临海女子');
    expect(byId('satoha').ability).toBe(satohaAbility);
    expect(HIROKO_NOTES.satoha).toBeTruthy();
  });
});

describe('辻垣内智叶：间合', () => {
  it('看得出每家离听牌几步，最快的一家定进张加成的三档', () => {
    const far = table(1, { me: MY_FAR, others: [FAR, FAR, FAR] });
    expect(satohaGap(far.g, far.seat)).toBeGreaterThanOrEqual(2);
    expect(satohaBlade(far.g, far.seat)).toMatchObject({ stage: 0, chance: SATOHA.fast, ready: false });

    const one = table(1, { me: MY_FAR, others: [FAR, ONE_AWAY, FAR] });
    expect(satohaDistance(one.g, one.seat, 2)).toBe(1);
    expect(satohaBlade(one.g, one.seat)).toMatchObject({ stage: 1, chance: SATOHA.near1 });

    const ten = table(1, { me: MY_FAR, others: [FAR, ONE_AWAY, TENPAI] });
    expect(satohaDistance(ten.g, ten.seat, 3)).toBe(0);
    expect(satohaBlade(ten.g, ten.seat)).toMatchObject({ stage: 2, chance: SATOHA.near0 });
  });

  it('别人越接近听牌，她进张越顺', () => {
    const slow = usefulRate([FAR, FAR, FAR]);
    const near = usefulRate([FAR, ONE_AWAY, FAR]);
    const hot = usefulRate([FAR, FAR, TENPAI]);
    expect(near).toBeGreaterThan(slow);
    expect(hot).toBeGreaterThan(near + (SATOHA.near0 - SATOHA.near1) * 0.4);
    expect(hot).toBeGreaterThan(slow + (SATOHA.near0 - SATOHA.fast) * 0.5);
  });

  it('别人连庄的局，庄家少算一步；自己连庄不算', () => {
    const { g, seat } = table(1, { me: MY_FAR, others: [ONE_AWAY, FAR, FAR] });
    expect(g.dealer).toBe(0);
    expect(satohaRenchanDealer(g, seat)).toBeNull();
    expect(satohaBlade(g, seat).stage).toBe(1);
    // 上一局也是 0 号位坐庄：这一局是他连庄
    g.abilityGameState[seat].last = { round: g.round - 1, dealer: 0 };
    expect(satohaRenchanDealer(g, seat)).toBe(0);
    expect(satohaGap(g, seat)).toBe(0);
    expect(satohaBlade(g, seat)).toMatchObject({ stage: 2, chance: SATOHA.near0 });
    // 她自己坐庄连庄：不算
    const mine = table(1, { me: MY_FAR, others: [ONE_AWAY, FAR, FAR] }, { seat: 0 });
    mine.g.abilityGameState[0].last = { round: mine.g.round - 1, dealer: 0 };
    expect(satohaRenchanDealer(mine.g, 0)).toBeNull();
  });

  it('碰了能跳过连庄的庄家摸牌：庄家坐在打牌的人和她之间', () => {
    const { g, seat } = table(1, { me: MY_FAR, others: [FAR, FAR, FAR] }, { seat: 2 });
    expect(satohaCutsDealer(g, seat, 3)).toBe(false);
    g.abilityGameState[seat].last = { round: g.round - 1, dealer: 0 };
    // 庄家是 0 号位，她在 2 号位：3 号位打的牌碰了，跳过 0、1 号位
    expect(satohaCutsDealer(g, seat, 3)).toBe(true);
    // 1 号位打的牌碰了，谁也没跳过；庄家自己打的牌碰了，他也已经摸过了
    expect(satohaCutsDealer(g, seat, 1)).toBe(false);
    expect(satohaCutsDealer(g, seat, 0)).toBe(false);
  });

  it('第 3 局起看破', () => {
    const { g, seat } = table(1, { me: MY_FAR, others: [FAR, FAR, FAR] });
    expect(satohaScouts(g, seat)).toBe(false);
    g.round = SATOHA.scoutRound;
    expect(satohaScouts(g, seat)).toBe(true);
    expect(satohaScouts(g, 0)).toBe(false);
  });
});

describe('辻垣内智叶：鞘与拔刀', () => {
  it('鞘里听着牌、有人听牌时更容易摸到和了牌；没人听牌时只多一点', () => {
    const calm = strikeRate({ me: MY_TENPAI, others: [FAR, FAR, FAR] });
    const hot = strikeRate({ me: MY_TENPAI, others: [FAR, TENPAI, FAR] });
    expect(hot.events).toBeGreaterThan(calm.events * 2);
    expect(hot.rate).toBeGreaterThan(calm.rate + (SATOHA.strike - SATOHA.sheath) * 0.5);
    expect(hot.rate).toBeGreaterThan(SATOHA.strike * 0.8);
    expect(calm.rate).toBeLessThan(SATOHA.sheath + 0.15);
  });

  it('立直以后刀已出鞘：没有拔刀，也不再藏', () => {
    const riichi = strikeRate({ me: MY_TENPAI, others: [FAR, TENPAI, FAR] }, (g, seat) => (g.players[seat].riichi = true));
    expect(riichi.events).toBe(0);
    const { g, seat } = table(1, { me: MY_TENPAI, others: [FAR, TENPAI, FAR] });
    expect(satohaBlade(g, seat)).toMatchObject({ stage: 2, ready: true, chance: SATOHA.strike });
    g.players[seat].riichi = true;
    expect(satohaBlade(g, seat)).toMatchObject({ stage: 3, ready: false, chance: 0 });
    expect(satohaSheathed(g, seat)).toBe(false);
  });

  it('副露没役的听牌拔不了刀', () => {
    // 碰了一万，剩下的听 4、7 索：没有役
    const { g, seat } = table(1, { me: '456m789p56s22z', others: [FAR, TENPAI, FAR] });
    const pon = parseTiles('111m');
    g.players[seat].melds = [{ type: 'pon', tiles: pon, calledTile: pon[0], from: 0 }];
    // 鸣过牌、打过牌了（不然第一巡自摸算地和）
    g.players[seat].discards.push({ tile: parseTiles('9s')[0], riichi: false, tsumogiri: false, called: false });
    expect(satohaSheathed(g, seat)).toBe(true);
    expect(satohaCanStrike(g, seat)).toBe(false);
    expect(satohaBlade(g, seat)).toMatchObject({ ready: false, chance: 0 });
  });

  it('没立直的听牌，涅莉、龙华、憧感知不到；洋榎照样读得出', () => {
    const { g, seat } = table(1, { me: MY_TENPAI, others: [FAR, FAR, FAR] }, { ids: ['nelly', 'satoha', 'ryuuka', 'ako'] });
    expect(satohaSheathed(g, seat)).toBe(true);
    expect(g.tenpaiHidden(seat, 0)).toBe(true);
    expect(g.tenpaiHidden(seat, seat)).toBe(false);
    expect(nellySensesTenpai(g, seat, 0)).toBe(false);
    expect(ryuukaSensesTenpai(g, seat, 2)).toBe(false);
    expect(akoDistance(g, seat, 3)).toBe(1);
    // 不写谁在看，就是真的向听数
    expect(akoDistance(g, seat)).toBe(0);
    expect(readTenpai(g, seat)).not.toBeNull();
    // 立直了就藏不住
    g.players[seat].riichi = true;
    expect(g.tenpaiHidden(seat, 0)).toBe(false);
    expect(nellySensesTenpai(g, seat, 0)).toBe(true);
    expect(ryuukaSensesTenpai(g, seat, 2)).toBe(true);
    expect(akoDistance(g, seat, 3)).toBe(0);
  });

  it('没听牌时不算藏', () => {
    const { g, seat } = table(1, { me: MY_FAR, others: [FAR, FAR, FAR] });
    expect(satohaSheathed(g, seat)).toBe(false);
    expect(g.tenpaiHidden(seat, 0)).toBe(false);
  });
});

describe('辻垣内智叶：亲番', () => {
  it('坐庄的局，后发先至、拔刀的概率换成亲番那一组；不坐庄照平时', () => {
    const hands = (me: string) => ({ me, others: [TENPAI, FAR, FAR] });
    const dealer = table(1, hands(MY_TENPAI), { seat: 0 });
    expect(dealer.g.dealer).toBe(0);
    expect(satohaBlade(dealer.g, 0)).toMatchObject({ stage: 2, ready: true, chance: SATOHA.dealer.strike });
    const child = table(1, hands(MY_TENPAI), { seat: 1 });
    expect(satohaBlade(child.g, 1)).toMatchObject({ stage: 2, ready: true, chance: SATOHA.strike });
    const far = table(1, hands(MY_FAR2), { seat: 0 });
    expect(satohaBlade(far.g, 0).chance).toBe(SATOHA.dealer.near0);
    expect(SATOHA.dealer.strike).toBeGreaterThan(SATOHA.strike);
    // 坐庄的局真的摸得到：有人听牌时拔刀的命中率接近亲番的概率
    let hits = 0;
    const games = 300;
    for (let seed = 1; seed <= games; seed++) {
      const { g } = table(seed, hands(MY_TENPAI), { seat: 0 });
      const waits = waitingKinds(toCounts(g.players[0].hand), 0);
      satohaAbility.beforeDraw!(g, 0, false);
      if (waits.includes(kindOf(g.wall.live[0]))) hits++;
    }
    expect(hits / games).toBeGreaterThan(SATOHA.dealer.strike - 0.1);
  });
});

describe('辻垣内智叶：整场', () => {
  it('电脑的智叶打得完整场；「斬」只出在她和牌结束别人连庄的局', async () => {
    let zan = 0;
    let dama = 0;
    let riichi = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const ids = seed % 2 ? ['izumi', 'satoha', 'izumi', 'izumi'] : ['yuuki', 'saki', 'satoha', 'kuro'];
      const seat = ids.indexOf('satoha');
      const g = new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
      let prevDealer = -1;
      let cut = false;
      g.onEvent((e) => {
        if (e.type === 'ability' && e.ability === 'satoha' && e.text === '斬') {
          zan++;
          cut = true;
        }
        if (e.type === 'discard' && e.seat === seat && e.riichi) riichi++;
        if (e.type !== 'roundEnd') return;
        const won = e.result.kind === 'win' && e.result.wins.some((w) => w.seat === seat);
        if (won && !g.players[seat].riichi) dama++;
        const renchan = prevDealer === g.dealer && g.dealer !== seat;
        const dealerWon = e.result.kind === 'win' && e.result.wins.some((w) => w.seat === g.dealer);
        expect(cut, `种子 ${seed} ${g.roundLabel()}`).toBe(renchan && won && !dealerWon);
        cut = false;
        prevDealer = g.dealer;
      });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 40000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, byId(ids[s]).ai));
      }
      expect(g.phase).toBe('gameEnd');
      await new Promise((r) => setTimeout(r, 0));
    }
    // 默听为主，小牌才立直：两样都有
    expect(dama).toBeGreaterThan(0);
    expect(riichi).toBeGreaterThan(0);
    expect(zan).toBeGreaterThan(0);
  }, 120000);
});
