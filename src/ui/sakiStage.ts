import { sakiReleaseLine } from '../abilities/saki';
import type { Game, Stage } from '../engine/game';
import { EAST, Kind, TileId, doraFromIndicator, isRed, kindOf } from '../engine/tiles';
import { panelHtml, rowHtml, section } from './matchSetup';
import { spare, swap } from './riiStage';

// 「宫永咲 · 岭上开花测试」（右上角「更多」里）：她开局坐庄（一直和就一直连庄），配牌是听牌的门清手，里面有一个暗刻；
// 第一张摸到暗刻的第四张，暗杠以后岭上牌就是和了牌（岭上开花自摸）。和多大挑一档，
// 或者一局一档从小到大轮着来，用来看自摸砸牌和百合花瓣（和得越大花瓣越多）。
// 牌是在所有能力动完以后才摆的（Game 的 stage）；测试局里对手不用能力（优希抢庄、煌挡击飞、涅莉封听牌都会挡住这一下）。
// 配牌不放赤宝牌，开局宝牌和暗杠翻开的杠宝牌指示牌也挪开，不让宝牌把番数抬上去。

export type RinshanTier = 'small' | 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'yakuman' | 'double';

export const RINSHAN_TIERS: { id: RinshanTier; label: string; note: string }[] = [
  { id: 'small', label: '2 番', note: '岭上开花、门前清自摸和' },
  { id: 'mangan', label: '满贯', note: '混一色' },
  { id: 'haneman', label: '跳满', note: '混一色、一气通贯' },
  { id: 'baiman', label: '倍满', note: '清一色' },
  { id: 'sanbaiman', label: '三倍满', note: '清一色、断幺九、三暗刻' },
  { id: 'yakuman', label: '役满', note: '四暗刻' },
  { id: 'double', label: '两倍役满', note: '四暗刻、字一色' },
];

interface RinshanHand {
  hand: Kind[]; // 配牌的 13 张（含暗刻的三张）
  kan: Kind; // 第一张摸到的：暗刻的第四张
  win: Kind; // 岭上牌：和了牌
}

// 东 27 南 28 西 29 北 30 白 31 发 32 中 33；万子 0–8，筒子 9–17，索子 18–26
const m = (n: number) => n - 1;
const p = (n: number) => 8 + n;
const s = (n: number) => 17 + n;

// 一档的牌型。guest：不是她自家风、也不是场风的风牌（做成暗杠也不算役牌，跳满不会多出一番）
export function rinshanHand(tier: RinshanTier, guest: Kind): RinshanHand {
  switch (tier) {
    case 'small':
      // 234m 678p 99p 34s + 888s：岭上开花、门前清自摸和 2 番 40 符
      return { hand: [m(2), m(3), m(4), p(6), p(7), p(8), p(9), p(9), s(3), s(4), s(8), s(8), s(8)], kan: s(8), win: s(2) };
    case 'mangan':
      // 123m 678m 23m 北北 + 999m：混一色 3、岭上、自摸 = 5 番
      return { hand: [m(1), m(2), m(3), m(6), m(7), m(8), m(2), m(3), 30, 30, m(9), m(9), m(9)], kan: m(9), win: m(4) };
    case 'haneman':
      // 123m 456m 78m 白白 + 客风暗杠：混一色 3、一气通贯 2、岭上、自摸 = 7 番（和 9m）
      return { hand: [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), 31, 31, guest, guest, guest], kan: guest, win: m(9) };
    case 'baiman':
      // 234s 678s 99s 56s + 1111s：清一色 6、岭上、自摸 = 8 番（和 7s）
      return { hand: [s(2), s(3), s(4), s(6), s(7), s(8), s(9), s(9), s(5), s(6), s(1), s(1), s(1)], kan: s(1), win: s(7) };
    case 'sanbaiman':
      // 2222s 444s 666s 678s 88s：清一色 6、断幺九 1、三暗刻 2、岭上、自摸 = 11 番（和 8s）
      return { hand: [s(4), s(4), s(4), s(6), s(6), s(6), s(6), s(7), s(8), s(8), s(2), s(2), s(2)], kan: s(2), win: s(8) };
    case 'yakuman':
      // 1111m 333p 999s 77p 东东：岭上摸到 7p，四暗刻
      return { hand: [p(3), p(3), p(3), s(9), s(9), s(9), p(7), p(7), EAST, EAST, m(1), m(1), m(1)], kan: m(1), win: p(7) };
    case 'double':
      // 东东东东 南南南 西西西 白白 发发：岭上摸到白，四暗刻 + 字一色
      return { hand: [28, 28, 28, 29, 29, 29, 31, 31, 32, 32, EAST, EAST, EAST], kan: EAST, win: 31 };
  }
}

// list 里 at 这些位置换成 want 里的牌（赤牌、锁住的不要），多出来的和牌山里缺的对换
function arrange(g: Game, list: TileId[], at: number[], want: Kind[], ok: (j: number) => boolean): void {
  const need = [...want];
  const extra: number[] = [];
  for (const i of at) {
    const j = need.indexOf(kindOf(list[i]));
    if (j >= 0 && !isRed(list[i])) need.splice(j, 1);
    else extra.push(i);
  }
  for (const i of extra) {
    const k = need.shift();
    if (k === undefined) return;
    // 配牌前开局宝牌指示牌还没亮出来：要的牌正好是它也能换（换完 clearDora 再把指示牌挪开）
    const w = g.wall;
    const dora = w.live.length > 70 && kindOf(w.doraIndicators[0]) === k && !isRed(w.doraIndicators[0]) && !w.locked.has(w.doraIndicators[0]);
    const from = spare(g, k, ok) ?? (dora ? ([w.doraIndicators, 0] as [TileId[], number]) : null);
    if (from) swap(list, i, from[0], from[1]);
  }
}

// 一张 k 放到 list[i]：先从牌山里没人拿的地方找（配牌以外的 live、岭上牌、还没亮出来的宝牌指示牌、里宝牌指示牌），
// 都没有再从别人的配牌里换（mine 是她自己配牌的位置，不动）。赤牌不要，锁住的不动
function put(g: Game, k: Kind, list: TileId[], i: number, mine: Set<number>): void {
  const w = g.wall;
  const fit = (t: TileId) => kindOf(t) === k && !isRed(t) && !w.locked.has(t);
  // 已经是这种牌了（她看见、锁住的也算）：不动
  if (i < list.length && kindOf(list[i]) === k && !isRed(list[i])) return;
  // 配牌前（live 还是满的）：开局宝牌指示牌还没亮出来，也能换（换完 clearDora 再挪开）
  const dealing = w.live.length > 70;
  const sources: [TileId[], (j: number) => boolean][] = [
    [w.live, (j) => (dealing ? j >= 52 : true) && !(list === w.live && j === i)],
    [w.rinshan, (j) => !(list === w.rinshan && j === i)],
    [w.doraIndicators, (j) => j >= (dealing ? 0 : w.doraRevealed)],
    [w.uraIndicators, () => true],
    [w.live, (j) => !mine.has(j) && !(list === w.live && j === i)],
  ];
  for (const [src, ok] of sources) {
    const j = src.findIndex((t, j) => ok(j) && fit(t));
    if (j >= 0) {
      swap(list, i, src, j);
      return;
    }
  }
}

// 开局宝牌指示牌、暗杠时翻开的第一张杠宝牌指示牌指到她的牌上（算上岭上摸到的和了牌）：换成指向别的牌的
// （从配牌以外的 live 里找，她要的牌不拿）。杠宝牌在暗杠那一刻、岭上牌还没摸就翻开，她自己的能力只看得到手里的牌
function clearDora(g: Game, mine: Set<Kind>): void {
  const w = g.wall;
  const hits = (t: TileId) => mine.has(doraFromIndicator(kindOf(t)));
  for (let i = 0; i < 2 && i < w.doraIndicators.length; i++) {
    if (!hits(w.doraIndicators[i])) continue;
    // live[52] 是她第一张要摸的（暗刻的第四张），不动
    const j = w.live.findIndex((t, k) => k > 52 && !hits(t) && !mine.has(kindOf(t)) && !isRed(t) && !w.locked.has(t));
    if (j >= 0) swap(w.doraIndicators, i, w.live, j);
  }
}

// 自己坐 me。tier：固定一档；'cycle'：一局一档从 2 番轮到两倍役满，再从头来
export function rinshanStage(me: number, tier: RinshanTier | 'cycle'): Stage {
  let n = -1;
  let cur: RinshanHand | null = null;
  return {
    deal: (g) => {
      n++;
      const t = tier === 'cycle' ? RINSHAN_TIERS[n % RINSHAN_TIERS.length].id : tier;
      const winds = [EAST, EAST + 1, EAST + 2, EAST + 3];
      const guest = winds.find((k) => k !== g.seatWind(me) && k !== EAST + g.roundWind) ?? 30;
      cur = rinshanHand(t, guest);
      const mine = new Set(g.dealIndices(me));
      // 岭上牌由测试局来摆：她配牌时定好、锁住的先松开（开局时她照摆好的重新看见、锁上）
      sakiReleaseLine(g, me);
      arrange(g, g.wall.live, [...mine], cur.hand, (j) => !mine.has(j));
      // 她坐庄，配完牌第一张摸的是 live[52]：暗刻的第四张（没坐庄时放深一点，别人先摸不走，轮到她再挪到最前面）；岭上牌放和了牌
      put(g, cur.kan, g.wall.live, g.dealer === me ? 52 : 64, mine);
      put(g, cur.win, g.wall.rinshan, 0, new Set([...mine, 52]));
      clearDora(g, new Set([...cur.hand, cur.kan, cur.win]));
    },
    draw: (g, seat, rinshan) => {
      const h = cur;
      if (!h || seat !== me) return;
      const p = g.players[me];
      // 暗杠以后的岭上牌：和了牌
      if (rinshan) {
        put(g, h.win, g.wall.rinshan, 0, new Set());
        return;
      }
      // 第一张：暗刻的第四张（配牌以后有能力换过她的手牌就再摆回去）
      if (p.discards.length || p.melds.length) return;
      arrange(g, p.hand, [...p.hand.keys()], h.hand, (j) => j > 0);
      // 第四张她成刻时就看见、锁住了（咲的杠材）：不在最前面就直接挪过来
      const at = g.wall.live.findIndex((t) => kindOf(t) === h.kan && !isRed(t));
      if (at > 0) swap(g.wall.live, 0, g.wall.live, at);
      else put(g, h.kan, g.wall.live, 0, new Set());
    },
  };
}

// 测试窗口：挑一档开局
export function rinshanTestPanelHtml(): string {
  const go = (v: string, label: string) => `<button class="rii-go" data-ui="saki-test-go" data-v="${v}">${label}</button>`;
  const body =
    section('自己打宫永咲，每局第一张摸到杠材，暗杠以后岭上自摸') +
    rowHtml('和多大', RINSHAN_TIERS.map((t) => go(t.id, t.label)).join(''), RINSHAN_TIERS.map((t) => `${t.label}：${t.note}`).join('；')) +
    rowHtml('轮着来', go('cycle', '从 2 番到两倍役满'), '一局一档，越往后花瓣越多（不会击飞，一直连庄）') +
    rowHtml('怎么打', '', '摸到第四张时点「杠」，岭上牌摸进来点「自摸」（牌桌右边开着「和」会自己和）');
  return panelHtml('saki-test', '宫永咲 · 岭上开花测试', '牌桌视角照「视觉设置」，2.5D 改良布局里看得到砸牌和百合；对手照「对局设置」坐，不用能力', body, '');
}
