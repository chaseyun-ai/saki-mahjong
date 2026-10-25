import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, isHonor, isWind, kindOf, numOf, suitOf, toCounts } from '../engine/tiles';
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

// 电脑的爽：每局先算这一局值不值得动手，动手就叠着用（云 + 增幅的神威），不动手就全留着。
// - 值不值得：坐庄、落后、配牌正合某朵云、到了最后两局、剩下的云和神威比剩下的局多，都加分；
//   同桌有攒着最后几局的人（涅莉）时前半场也加分，先把优势拿到手
// - 动手时：挑最合的云；万子多叫阿科罗、客风多叫胡里；配牌已经好、能做大牌就叫帕科罗对准领先的那家；
//   同桌能封的控场对手有两个以上才叫霍亚乌，而且一定和云或攻击的神威一起出
// - 最后两局把剩下的都用掉
export const SAWAYA_AI = {
  act: 3, // 「值不值得」到这个分就动手
  behindPer: 8000, // 落后多少点加 1 分
  pakoroShanten: 3, // 配牌几向听以内算好
};

// 能被霍亚乌封住、而且会控场的对手（只读牌的洋榎、美穗子不算；照、玄封不了）
const CONTROL_FREE = ['hiroe', 'mihoko'];
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
  const total = g.format === 'team' ? 8 : 4;
  const slot = g.roundWind * 4 + g.roundNumber;
  const roundsLeft = Math.max(1, total - slot);
  const late = g.isLastRounds(2);
  const dealer = seat === g.dealer;

  const hand = g.dealHand(seat).map(kindOf);
  const man = hand.filter((k) => k < 9).length;
  const guestWinds = hand.filter((k) => isWind(k) && k !== g.seatWind(seat)).length;
  // 配牌里合这朵云的牌数、合得上的门槛
  const fit: [SkillId, number, number][] = [
    ['red', hand.filter(isHonor).length, 4],
    ['white', hand.filter((k) => k < 27 && suitOf(k) === 2).length, 6],
    ['yellow', hand.filter((k) => k < 27 && numOf(k) <= 4).length, 8],
  ];
  const clouds = fit.filter(([id]) => ok(id)).sort((a, b) => b[1] / b[2] - a[1] / a[2]);
  const bestFit = clouds.length ? clouds[0][1] / clouds[0][2] : 0;
  const sh = shanten(toCounts(g.dealHand(seat)), 0);

  let worth = 0;
  if (dealer) worth += 1.5;
  worth += Math.max(0, (top - me) / SAWAYA_AI.behindPer);
  if (bestFit >= 1) worth += 1.5;
  if (sh <= SAWAYA_AI.pakoroShanten) worth += 0.5;
  if (lateHeavy(g, seat) && slot < total / 2) worth += 1;
  if (ready.length >= roundsLeft * 2) worth += 2;
  if (me > top + 16000 && !late) worth -= 1.5;
  if (!late && worth < SAWAYA_AI.act) return [];

  // 这一局放几样：剩下的平摊到剩下的局，至少两样（云 + 一个神威），坐庄多一样
  const budget = Math.max(2, Math.ceil(ready.length / roundsLeft)) + (dealer ? 1 : 0);
  const out: SkillId[] = [];
  // 云：最后两局合不合都放，平时要差不多合得上
  const cloud = clouds.find(([, n, need]) => late || n >= need * 0.75);
  if (cloud) out.push(cloud[0]);
  // 神威按合不合排：阿科罗和白云冲突（一个要万子一个要索子）；帕科罗要配牌好、能做大牌，对准领先的那家；
  // 霍亚乌不单独用，能封的控场对手越多越值
  const ctrl = controllers(g, seat).length;
  const kamuy: [SkillId, number][] = [];
  if (ok('akkoro') && out[0] !== 'white' && (man >= 3 || (late && man >= 2))) kamuy.push(['akkoro', man / 4]);
  if (ok('huri') && (guestWinds >= 2 || (out[0] === 'red' && guestWinds >= 1) || (late && guestWinds >= 1))) kamuy.push(['huri', guestWinds / 2 + (out[0] === 'red' ? 0.5 : 0)]);
  if (ok('pakoro') && leader(g, seat) !== undefined && (sh <= SAWAYA_AI.pakoroShanten || late)) kamuy.push(['pakoro', 1 + (dealer ? 0.5 : 0)]);
  if (ok('hoyau') && (ctrl >= 2 || (late && ctrl >= 1))) kamuy.push(['hoyau', ctrl / 2]);
  kamuy.sort((a, b) => b[1] - a[1]);
  for (const [id] of kamuy) {
    if (out.length >= budget) break;
    if (id === 'hoyau' && !out.length && kamuy.length < 2) continue;
    out.push(id);
  }
  // 霍亚乌不单独用
  if (out.length === 1 && out[0] === 'hoyau') out.pop();
  // 最后一局：剩下的全放（霍亚乌没人可封就算了）
  if (g.isLastRounds(1)) {
    for (const id of ready) {
      if (out.includes(id)) continue;
      if (id === 'white' && out.includes('akkoro')) continue;
      if (id === 'akkoro' && out.includes('white')) continue;
      if (id === 'hoyau' && !controllers(g, seat).length) continue;
      if (id === 'pakoro' && leader(g, seat) === undefined) continue;
      if (['red', 'white', 'yellow'].includes(id) && out.some((x) => ['red', 'white', 'yellow'].includes(x))) continue;
      out.push(id);
    }
  }
  return out;
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
    for (const want of wants(g, seat)) if (g.wall.bringToLive(0, want, g.rng)) return;
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

  badge(g, seat) {
    if (sawayaAbility.seals!(g, seat, g.round)) return '霍亚乌';
    const on = stateOf(g, seat).on ?? [];
    return on.length ? on.map(nameOf).join('') : null;
  },

  insight(g, seat) {
    const on = stateOf(g, seat).on ?? [];
    const ready = SAWAYA_SKILLS.filter((k) => blocked(g, seat, k.id) === null).map((k) => k.name);
    return [on.length ? `这一局：${on.map(nameOf).join('、')}` : '这一局没召唤', ready.length ? `还能用：${ready.join('、')}` : '云和神威都用完了'];
  },
};
