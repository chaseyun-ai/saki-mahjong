import type { Game, Stage } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, isRed, kindOf, toCounts } from '../engine/tiles';
import { panelHtml, rowHtml, section } from './matchSetup';
import { spare, swap } from './riiStage';

// 「自摸动作测试」（右上角「更多」里）：挑一个人、坐哪一家，看她自摸时砸牌的动作（2.5D 改良布局才有砸牌；
// 每个人用哪一套动作在 looks.ts 的 slam，没配的都是通用那一套）。
// 她每局坐庄（一直自摸就一直连庄），配牌是听牌的门清手 234m 567m 678p 22p 46s（坎张，只听 5s）：
// 第一张摸到一张别人手里都没有的字牌（打掉；第一张就和就成了天和），第二张摸到 5s 自摸（断幺九、门前清自摸和）。
// 她自摸之前别人手里没有 5s、也摸不到（她就荣和不了），别人也摸不到让自己和了的牌，配牌也凑不出九种九牌（流局）。
// 牌是在所有能力动完以后才摆的（Game 的 stage）；测试局里谁都不用能力，挂机看（点「挂机中」可以接管）。

// m：0–8，p：9–17，s：18–26
const HAND = [1, 2, 3, 4, 5, 6, 14, 15, 16, 10, 10, 21, 23];
const WIN = 22;
const HONORS = [27, 28, 29, 30, 31, 32, 33];
const yaochu = (k: number) => k >= 27 || k % 9 === 0 || k % 9 === 8;

export const SLAM_TEST_CHARS: { id: string; label: string; note: string }[] = [
  { id: 'hisa', label: '竹井久', note: '原作的摔牌：从牌山摸来，背朝上斜着拖到手牌右边，一下翻过来、弹上去，最高处牌面朝上，手扣住砸下去' },
  { id: 'nodoka', label: '其他人（通用）', note: '原村和来砸：照雀魂，扣下去、翻起来、炸开' },
];

const SEATS = ['自己', '下家', '对家', '上家'];

// list 里 at 这些位置是她的牌：多出来的和牌山里缺的对换，换成 HAND（赤牌不要）
function arrange(g: Game, list: TileId[], at: number[], ok: (j: number) => boolean): void {
  const want = [...HAND];
  const extra: number[] = [];
  for (const i of at) {
    const j = want.indexOf(kindOf(list[i]));
    if (j >= 0 && !isRed(list[i])) want.splice(j, 1);
    else extra.push(i);
  }
  for (const i of extra) {
    const k = want.shift();
    if (k === undefined) return;
    const from = spare(g, k, ok);
    if (from) swap(list, i, from[0], from[1]);
  }
}

// 下一张摸的牌（live[0]）换成 pick 挑中的那张
function bringToFront(g: Game, pick: (t: TileId) => boolean): boolean {
  const w = g.wall;
  if (w.live.length === 0 || pick(w.live[0])) return w.live.length > 0;
  const j = w.live.findIndex((t, i) => i > 0 && pick(t) && !w.locked.has(t));
  if (j < 0) return false;
  swap(w.live, 0, w.live, j);
  return true;
}

// seat 坐庄、每局都这样摆
export function slamStage(seat: number): Stage {
  return {
    deal: (g) => {
      const mine = new Set(g.dealIndices(seat));
      arrange(g, g.wall.live, [...mine], (j) => !mine.has(j));
      // 别人的配牌里不放 5s，幺九牌也不能多到摸一张就够九种九牌：换成配牌以外的中张
      const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => g.dealIndices(s));
      const dealt = new Set(others.flat());
      const live = g.wall.live;
      const fresh = (k: (t: TileId) => boolean) => live.findIndex((t, j) => j >= 52 && !dealt.has(j) && !mine.has(j) && k(t) && !g.wall.locked.has(t));
      for (const idx of others) {
        for (const i of idx) {
          if (kindOf(live[i]) !== WIN) continue;
          const j = fresh((t) => kindOf(t) !== WIN);
          if (j >= 0) swap(live, i, live, j);
        }
        for (;;) {
          const kinds = new Set(idx.map((i) => kindOf(live[i])).filter(yaochu));
          if (kinds.size < 8) break;
          const i = idx.find((i) => yaochu(kindOf(live[i])))!;
          const j = fresh((t) => !yaochu(kindOf(t)) && kindOf(t) !== WIN);
          if (j < 0) break;
          swap(live, i, live, j);
        }
      }
    },
    draw: (g, s, rinshan) => {
      if (rinshan) return;
      const p = g.players[seat];
      if (p.melds.length || p.discards.length > 1) return;
      if (s !== seat) {
        // 她自摸之前：别人摸不到 5s，也摸不到让自己和了的牌
        const q = g.players[s];
        const ok = (t: TileId) => kindOf(t) !== WIN && shanten(toCounts([...q.hand, t]), q.melds.length) >= 0;
        if (g.wall.live.length && !ok(g.wall.live[0])) bringToFront(g, ok);
        return;
      }
      if (p.discards.length === 1) {
        bringToFront(g, (t) => kindOf(t) === WIN && !isRed(t));
        return;
      }
      // 第一张：配牌以后有什么换过她的手牌就再摆回去，然后摸一张别人手里最少的字牌（打掉）
      arrange(g, p.hand, [...p.hand.keys()], (j) => j > 0);
      const held = (k: number) => g.players.reduce((n, q, i) => n + (i === seat ? 0 : q.hand.filter((t) => kindOf(t) === k).length), 0);
      const kinds = HONORS.filter((k) => g.wall.live.some((t) => kindOf(t) === k)).sort((a, b) => held(a) - held(b));
      if (kinds.length && bringToFront(g, (t) => kindOf(t) === kinds[0])) return;
      bringToFront(g, (t) => kindOf(t) !== WIN);
    },
  };
}

// 测试窗口：每个人一行，点坐哪一家就开局
export function slamTestPanelHtml(): string {
  const go = (id: string, rel: number) => `<button class="rii-go" data-ui="slam-test-go" data-v="${id}" data-seat="${rel}">${SEATS[rel]}</button>`;
  const body =
    section('她坐哪一家（每局第二张自摸，挂机看）') +
    SLAM_TEST_CHARS.map((c) => rowHtml(c.label, [0, 1, 2, 3].map((rel) => go(c.id, rel)).join(''), c.note)).join('') +
    rowHtml('看哪种', '', '视觉设置里「牌桌视角」选 2.5D、布局选改良才有砸牌；「自摸动作」选带手、不带手各看一遍');
  return panelHtml('slam-test', '自摸动作测试', '每个人自摸时砸牌的动作；对手不用能力', body, '');
}
