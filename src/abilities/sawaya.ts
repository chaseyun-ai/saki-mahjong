import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { Kind, TileId, isHonor, isWind, kindOf, numOf, suitOf, toCounts } from '../engine/tiles';
import { PRIORITY, type Ability, type DealRule, type PreDealOption } from './types';

// 狮子原爽（有珠山）：发牌前召唤五色云和阿伊努的神威（kamuy），可以叠着用。
// 每朵云、每个神威一场只能用一次。她最先动（PRIORITY.sawaya），定下的规矩别人不能违反。
// - 红云：这一局字牌只有她摸得到：别人的配牌里没有字牌，摸牌也摸不到；她自己摸牌容易摸到字牌
// - 白云：她的配牌和摸牌偏向索子
// - 黄云：她配牌里的数牌都换成 1–4
// - 黑云、第五朵：原作没写，占位
// - 帕科罗神威：她听牌以后，点数最高的那家对手摸到的全是她的和了牌（对手可以拆牌防守）
// - 阿科罗神威：她摸牌大多是万子，赤五万一定在她配牌里
// - 霍亚乌神威：封印别人的能力，持续 SAWAYA.hoyauRounds 局（包括这一局）
// - 胡里神威：不是她自风的风牌偏向她的摸牌
// 帕吾契神威作用在人身上、不影响牌，不放进游戏。
export const SAWAYA = {
  hoyauRounds: 2,
  drawChance: 0.5, // 云、神威让她摸到想要的牌的概率
  akkoroChance: 0.7,
};

type SkillId = 'red' | 'white' | 'yellow' | 'black' | 'fifth' | 'pakoro' | 'akkoro' | 'hoyau' | 'huri';

export const SAWAYA_SKILLS: { id: SkillId; name: string; desc: string; kamuy: boolean; ready: boolean }[] = [
  { id: 'red', name: '红云', desc: '这一局字牌只有她摸得到：别人配牌里没有字牌，也摸不到；她自己容易摸到字牌', kamuy: false, ready: true },
  { id: 'white', name: '白云', desc: '她的配牌和摸牌偏向索子，方便做清一色', kamuy: false, ready: true },
  { id: 'yellow', name: '黄云', desc: '她配牌里的数牌都换成 1–4', kamuy: false, ready: true },
  { id: 'black', name: '黑云', desc: '原作没写效果，待定', kamuy: false, ready: false },
  { id: 'fifth', name: '第五朵云', desc: '原作没写效果，待定', kamuy: false, ready: false },
  { id: 'pakoro', name: '帕科罗神威', desc: '她听牌以后，点数最高的对手摸到的全是她的和了牌（对手可以拆牌防守）', kamuy: true, ready: true },
  { id: 'akkoro', name: '阿科罗神威', desc: '她摸牌大多是万子，赤五万一定在她配牌里', kamuy: true, ready: true },
  { id: 'hoyau', name: '霍亚乌神威', desc: `封印别人的能力，持续 ${SAWAYA.hoyauRounds} 局`, kamuy: true, ready: true },
  { id: 'huri', name: '胡里神威', desc: '不是她自风的风牌偏向她的摸牌', kamuy: true, ready: true },
];
const nameOf = (id: string) => SAWAYA_SKILLS.find((k) => k.id === id)!.name;

interface SawayaGameState {
  used?: SkillId[]; // 这一场用过的云和神威
  sealFrom?: number; // 霍亚乌封印的局（g.round）从哪局到哪局
  sealTo?: number;
  picks?: SkillId[]; // 玩家这一局选的
}
interface SawayaState {
  on?: SkillId[]; // 这一局发动的
  pakoroTarget?: number;
}

const gameStateOf = (g: Game, seat: number) => {
  const gs = g.abilityGameState[seat] as SawayaGameState;
  gs.used ??= [];
  return gs;
};
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as SawayaState;

// 这一局发动了没有
export function sawayaOn(g: Game, seat: number, id: SkillId): boolean {
  return !!stateOf(g, seat).on?.includes(id);
}

// 还能不能用。不能用时给原因
function blocked(g: Game, seat: number, id: SkillId): string | null {
  if (!SAWAYA_SKILLS.find((x) => x.id === id)!.ready) return '还没做';
  return gameStateOf(g, seat).used!.includes(id) ? '这一场用过了' : null;
}

// 点数最高的对手（管不到的人不算）
const leader = (g: Game, seat: number) =>
  [0, 1, 2, 3].filter((s) => s !== seat && g.binds(seat, s)).sort((a, b) => g.players[b].score - g.players[a].score)[0];

// 电脑的爽：每局先算这一局值不值得动手，动手就叠着用（一局最多两样：云 + 一个神威，或者一样 + 霍亚乌），不动手就全留着。
// - 值不值得：坐庄、落后、配牌正合某朵云、到了最后两局、剩下的云和神威比剩下的局多，都加分；
//   同桌有攒着最后几局的人（涅莉）时前半场也加分，先把优势拿到手
// - 动手时只叫配牌真用得上的，不为了用掉而硬叠：云要配牌已经合得上；万子多（往万子混一色走）叫阿科罗；
//   手里有客风对子叫胡里；配牌好、能做大牌叫帕科罗对准领先的那家；
//   同桌能封的控场对手有两个以上才叫霍亚乌，而且一定和合得上的云或神威一起出
// - 最后两局门槛放低一点，但合不上的照样不叫
// - 打牌：留住云、神威送来的牌（sawayaFocus），红云、白云、阿科罗往混一色做，能鸣就鸣
export const SAWAYA_AI = {
  act: 3, // 「值不值得」到这个分就动手
  behindPer: 8000, // 落后多少点加 1 分
  pakoroShanten: 3, // 配牌几向听以内算好
  maxPerRound: 2, // 一局最多叫几样（霍亚乌也算一样）
};

// 能被霍亚乌封住、而且会控场的对手（只读牌的洋榎、美穗子，只挡别人影响的天使和不算；照、玄封不了）
const CONTROL_FREE = ['hiroe', 'mihoko', 'nodoka'];
const controllers = (g: Game, seat: number) =>
  [0, 1, 2, 3].filter((s) => s !== seat && g.abilities[s] && !CONTROL_FREE.includes(g.abilities[s]!.id) && g.binds(seat, s) && !g.abilities[s]!.immune && !g.abilities[s]!.absolute);

// 同桌有没有把运势攒到最后几局的人
const lateHeavy = (g: Game, seat: number) => [0, 1, 2, 3].some((s) => s !== seat && g.abilities[s]?.id === 'nelly');

function aiPicks(g: Game, seat: number): SkillId[] {
  const ok = (id: SkillId) => blocked(g, seat, id) === null;
  const ready = SAWAYA_SKILLS.filter((k) => ok(k.id)).map((k) => k.id);
  if (!ready.length) return [];
  const me = g.players[seat].score;
  const top = Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score));
  const total = g.fullHanchan ? 8 : 4;
  const slot = g.roundWind * 4 + g.roundNumber;
  const roundsLeft = Math.max(1, total - slot);
  const late = g.isLastRounds(2);
  const dealer = seat === g.dealer;

  const hand = g.dealHand(seat).map(kindOf);
  const man = hand.filter((k) => k < 9).length;
  // 配牌里合这朵云的牌数、门槛（到门槛的 3/4 就算合得上，最后两局再放低一些）
  const honorPair = hand.some((k) => isHonor(k) && hand.filter((x) => x === k).length >= 2);
  const fit: [SkillId, number, number][] = [
    ['red', honorPair ? hand.filter(isHonor).length : 0, 4],
    ['white', hand.filter((k) => k < 27 && suitOf(k) === 2).length, 6],
    ['yellow', hand.filter((k) => k < 27 && numOf(k) <= 4).length, 9],
  ];
  const loose = (need: number) => Math.ceil(need * 0.75 * (late ? 0.75 : 1));
  const clouds = fit.filter(([id, n, need]) => ok(id) && n >= loose(need)).sort((a, b) => b[1] / b[2] - a[1] / a[2]);
  const sh = shanten(toCounts(g.dealHand(seat)), 0);
  const guestPair = hand.some((k) => isWind(k) && k !== g.seatWind(seat) && hand.filter((x) => x === k).length >= 2);

  let worth = 0;
  if (dealer) worth += 1.5;
  worth += Math.max(0, (top - me) / SAWAYA_AI.behindPer);
  if (clouds.length) worth += 1.5;
  if (sh <= SAWAYA_AI.pakoroShanten) worth += 0.5;
  if (lateHeavy(g, seat) && slot < total / 2) worth += 1;
  if (ready.length >= roundsLeft * 2) worth += 2;
  if (me > top + 16000 && !late) worth -= 1.5;
  if (!late && worth < SAWAYA_AI.act) return [];

  // 合得上的才放：云一朵；神威按合不合排。阿科罗和白云冲突（一个要万子一个要索子）
  const out: SkillId[] = [];
  if (clouds.length) out.push(clouds[0][0]);
  const ctrl = controllers(g, seat).length;
  const kamuy: [SkillId, number][] = [];
  if (ok('akkoro') && out[0] !== 'white' && man >= loose(5)) kamuy.push(['akkoro', man / 5]);
  if (ok('huri') && guestPair) kamuy.push(['huri', 1 + (out[0] === 'red' ? 0.5 : 0)]);
  if (ok('pakoro') && leader(g, seat) !== undefined && sh <= SAWAYA_AI.pakoroShanten) kamuy.push(['pakoro', 1 + (dealer ? 0.5 : 0)]);
  kamuy.sort((a, b) => b[1] - a[1]);
  // 一局最多两样：云配一个神威；叫霍亚乌时只配一样（最合的云或神威）
  for (const [id] of kamuy) if (out.length < SAWAYA_AI.maxPerRound) out.push(id);
  // 霍亚乌不单独用：一定配着合得上的云或神威
  if (ok('hoyau') && out.length && (ctrl >= 2 || (late && ctrl >= 1))) out.splice(SAWAYA_AI.maxPerRound - 1, out.length, 'hoyau');
  return out;
}

// 这一局发动了能帮她和牌的云或神威（霍亚乌只封人，不算）
export function sawayaActive(g: Game, seat: number): boolean {
  return (stateOf(g, seat).on ?? []).some((id) => id !== 'hoyau');
}

// 电脑打牌时要留的牌（云、神威送来的）和往混一色做的那门花色。没发动是 null
export function sawayaFocus(g: Game, seat: number): { keep: (k: Kind) => boolean; suit: number | null } | null {
  const on = stateOf(g, seat).on ?? [];
  if (!sawayaActive(g, seat)) return null;
  const nums = g.players[seat].hand.map(kindOf).filter((k) => k < 27);
  const per = [0, 1, 2].map((s) => nums.filter((k) => suitOf(k) === s).length);
  // 阿科罗做万子、白云做索子；只开红云就做手里最多的那门
  const suit = on.includes('akkoro') ? 0 : on.includes('white') ? 2 : on.includes('red') ? per.indexOf(Math.max(...per)) : null;
  const guest = (k: Kind) => isWind(k) && k !== g.seatWind(seat);
  const keep = (k: Kind) =>
    (suit !== null && (isHonor(k) || suitOf(k) === suit)) ||
    (on.includes('red') && isHonor(k)) ||
    (on.includes('huri') && guest(k)) ||
    (on.includes('yellow') && k < 27 && numOf(k) <= 4);
  return { keep, suit };
}

// 她自己的摸牌：按发动的云、神威，有时换成想要的牌
function wants(g: Game, seat: number): ((t: TileId) => boolean)[] {
  const on = stateOf(g, seat).on ?? [];
  const out: ((t: TileId) => boolean)[] = [];
  if (on.includes('akkoro') && g.rng.chance(SAWAYA.akkoroChance)) out.push((t) => kindOf(t) < 9);
  if (on.includes('red') && g.rng.chance(SAWAYA.drawChance)) out.push((t) => isHonor(kindOf(t)));
  if (on.includes('white') && g.rng.chance(SAWAYA.drawChance)) out.push((t) => kindOf(t) >= 18 && kindOf(t) < 27);
  if (on.includes('huri') && g.rng.chance(SAWAYA.drawChance)) out.push((t) => isWind(kindOf(t)) && kindOf(t) !== g.seatWind(seat));
  return out;
}

// 对她有用的牌：进张，或者和手里的牌凑得成对子、搭子。云和神威只送这种牌，不送用不上的
function helps(g: Game, seat: number): (t: TileId) => boolean {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t) => {
    const k = kindOf(t);
    if (counts[k] > 0) return true;
    if (k < 27 && [-2, -1, 1, 2].some((d) => numOf(k) + d >= 1 && numOf(k) + d <= 9 && counts[k + d] > 0)) return true;
    counts[k]++;
    const after = shanten(counts, p.melds.length);
    counts[k]--;
    return after < sh;
  };
}

// 她自己的配牌调整好以后定规矩：后动的人换牌时不能让它变差
function sawayaKeep(g: Game, seat: number): void {
  const hand = g.dealHand(seat);
  const keep = (text: string, count: (hand: TileId[]) => number) => {
    const done = count(hand);
    g.addDealRule({ seat, ability: 'sawaya', text, target: seat, bad: (h) => Math.max(0, count(h) - done) });
  };
  if (sawayaOn(g, seat, 'yellow')) keep('黄云', (h) => h.filter((t) => kindOf(t) < 27 && numOf(kindOf(t)) > 4).length);
  if (sawayaOn(g, seat, 'white')) keep('白云', (h) => h.filter((t) => kindOf(t) < 18 || kindOf(t) >= 27).length);
  if (sawayaOn(g, seat, 'akkoro')) keep('阿科罗神威', (h) => (h.includes(16) ? 0 : 1));
}

export const sawayaAbility: Ability = {
  id: 'sawaya',
  name: '五色云·神威',
  description: `发牌前召唤五色云和神威，可以叠着用，每朵云、每个神威一场只能用一次。红云：字牌只有她摸得到；白云：偏向索子；黄云：配牌的数牌都是 1–4；帕科罗：对手摸到的全是她的和了牌；阿科罗：她摸牌大多是万子；霍亚乌：封印别人的能力 ${SAWAYA.hoyauRounds} 局；胡里：客风牌偏向她。`,
  priority: PRIORITY.sawaya,

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const picked = (g.manual[seat] ? gs.picks ?? [] : aiPicks(g, seat)).filter((id) => blocked(g, seat, id) === null);
    const st = stateOf(g, seat);
    st.on = picked;
    gs.used!.push(...picked);
    if (picked.includes('hoyau')) {
      gs.sealFrom = g.round;
      gs.sealTo = g.round + SAWAYA.hoyauRounds - 1;
    }
    if (picked.includes('pakoro')) st.pakoroTarget = leader(g, seat);
    const rules: DealRule[] = [];
    const rule = (text: string, target: number, bad: (hand: TileId[]) => number) => rules.push({ seat, ability: 'sawaya', text, target, bad });
    // 红云：别人的配牌里不能有字牌
    if (picked.includes('red')) for (let s = 0; s < 4; s++) if (s !== seat) rule('红云', s, (hand) => hand.filter((t) => isHonor(kindOf(t))).length);
    return rules;
  },

  // 配牌：换不过来时降级（她最先动，只顾不了比她后动的人的规矩）
  beforeDeal(g, seat) {
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const later = (j: number) => j >= 52;
    const bring = (i: number, pred: (t: TileId) => boolean, from?: (j: number) => boolean) => {
      const swap = () => w.bringToLive(i, pred, g.rng, from);
      return swap() || g.dealFallback(seat, swap);
    };
    if (sawayaOn(g, seat, 'red')) {
      for (let s = 0; s < 4; s++) {
        if (s === seat) continue;
        for (const i of g.dealIndices(s)) if (isHonor(kindOf(w.live[i]))) bring(i, (t) => !isHonor(kindOf(t)), later);
      }
    }
    if (sawayaOn(g, seat, 'yellow')) {
      for (const i of mine) {
        const k = kindOf(w.live[i]);
        if (k < 27 && numOf(k) > 4) bring(i, (t) => kindOf(t) < 27 && numOf(kindOf(t)) <= 4, later);
      }
    }
    if (sawayaOn(g, seat, 'white')) {
      // 不是索子的牌换掉一半
      for (const i of mine) {
        const k = kindOf(w.live[i]);
        if ((k < 18 || k >= 27) && g.rng.chance(0.5)) bring(i, (t) => kindOf(t) >= 18 && kindOf(t) < 27, later);
      }
    }
    if (sawayaOn(g, seat, 'akkoro')) {
      const red5m = 16;
      const at = w.live.indexOf(red5m);
      if (at >= 0 && !mine.includes(at)) {
        const slot = mine.find((i) => kindOf(w.live[i]) >= 9);
        if (slot !== undefined) bring(slot, (t) => t === red5m);
      }
    }
    sawayaKeep(g, seat);
  },

  onRoundStart(g, seat) {
    for (const id of stateOf(g, seat).on ?? []) g.emit({ type: 'ability', seat, ability: 'sawaya', text: nameOf(id) });
  },

  seals(g, seat, round) {
    const gs = g.abilityGameState[seat] as SawayaGameState;
    return gs.sealFrom !== undefined && round >= gs.sealFrom && round <= gs.sealTo!;
  },

  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan) return;
    const st = stateOf(g, seat);
    // 帕科罗：她听牌了，目标对手摸到的就是她的和了牌
    if (st.pakoroTarget === drawer) {
      const waits = g.waits(seat);
      if (waits.length) g.wall.bringToLive(0, (t) => waits.includes(kindOf(t)), g.rng);
    }
    if (sawayaOn(g, seat, 'red')) return { seat, ability: 'sawaya', text: '红云', deny: (t) => isHonor(kindOf(t)) };
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan) return;
    const good = helps(g, seat);
    for (const want of wants(g, seat)) if (g.wall.bringToLive(0, (t) => want(t) && good(t), g.rng)) return;
  },

  preDeal(g, seat): PreDealOption[] {
    return SAWAYA_SKILLS.map((k) => {
      const why = blocked(g, seat, k.id);
      return { id: k.id, name: k.name, desc: k.desc, enabled: why === null, picked: false, note: why ?? '一场一次' };
    });
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).picks = picked.filter((id) => SAWAYA_SKILLS.some((k) => k.id === id)) as SkillId[];
  },

  skill(g, seat) {
    const on = stateOf(g, seat).on ?? [];
    const gs = gameStateOf(g, seat);
    const seal = gs.sealFrom !== undefined && g.round <= gs.sealTo! && g.round >= gs.sealFrom ? `（封印还剩 ${gs.sealTo! - g.round + 1} 局）` : '';
    return { label: '', note: on.length ? `这一局：${on.map(nameOf).join('、')}${seal}` : `这一局没召唤${seal}`, enabled: false, active: on.length > 0 || !!seal };
  },

  // 这一局叫的全列出来；上一局叫的霍亚乌还在封印时补一句
  badge(g, seat) {
    const on = stateOf(g, seat).on ?? [];
    const names = on.map(nameOf).join('·');
    if (!on.includes('hoyau') && sawayaAbility.seals!(g, seat, g.round)) return names ? `${names}·封印中` : '霍亚乌封印中';
    return names || null;
  },

  insight(g, seat) {
    const on = stateOf(g, seat).on ?? [];
    const ready = SAWAYA_SKILLS.filter((k) => blocked(g, seat, k.id) === null).map((k) => k.name);
    return [on.length ? `这一局：${on.map(nameOf).join('、')}` : '这一局没召唤', ready.length ? `还能用：${ready.join('、')}` : '云和神威都用完了'];
  },
};
