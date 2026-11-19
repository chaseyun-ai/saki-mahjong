import { POSITIONS } from '../team/team';
import { advancers, type Bracket, type BracketTable, HALVES, ROUNDS, roundTables } from './bracket';

// 晋级表画面：东区在左、西区在右，总决赛在中间（像网球的签表）。
// 一桌一个框，玩家的学校那一行高亮，被淘汰的变灰；后台还在打的桌写「进行中 · 中坚战」。
// fresh 里的桌子刚出结果，名次一行一行亮起来。
// 只用 .story-screen 下的 class 和 data-story 属性，不和 App 的点击处理撞

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => n.toLocaleString('en-US');

function rowHtml(b: Bracket, t: BracketTable, i: number, fresh: boolean, place: number): string {
  const name = t.schools[i];
  const e = b.entrants[name];
  const res = t.result;
  const final = t.round === ROUNDS.length - 1;
  // 决赛只有第一名算赢
  const adv = res ? (final ? place === 0 : advancers(t).includes(name)) : false;
  const champ = !!res && final && place === 0;
  // 状态名加 is- 前缀：style.css 里牌局的 .wait 是竖排，撞名会把这一行排成竖的
  const state = !res ? 'is-wait' : adv ? 'is-adv' : 'is-out';
  const tag = !res ? '' : champ ? '冠军' : final ? `第 ${place + 1}` : adv ? '晋级' : '出局';
  const tip = e.lineup.map((n, p) => `${POSITIONS[p]} ${n}`).join('\n');
  const delay = fresh ? ` style="animation-delay:${0.25 + (3 - place) * 0.35}s"` : '';
  return `<div class="bk-row ${state}${e.mine ? ' mine' : ''}${champ ? ' champ' : ''}${fresh ? ' fresh' : ''}" title="${esc(tip)}"${delay}>
    <b class="bk-dot" style="background:${e.color}"></b>
    <span class="bk-name">${esc(e.short)}${e.minor ? '<i>虚拟</i>' : ''}</span>
    ${res ? `<span class="bk-pts">${fmt(res.points[i])}</span>` : ''}
    <em class="bk-tag">${tag}</em>
  </div>`;
}

function tableHtml(b: Bracket, t: BracketTable, fresh: boolean, live?: string): string {
  const order = t.result ? t.result.order : [0, 1, 2, 3];
  const place = (i: number) => order.indexOf(i);
  // 出了结果按名次排，没出按抽签顺序
  const rows = order.map((i) => rowHtml(b, t, i, fresh, place(i))).join('');
  const mine = t.schools.includes(b.mine);
  const note = live ? `<span class="bk-live">进行中 · ${live}</span>` : mine && !t.result ? '<span class="bk-here">你在这桌</span>' : '';
  return `<div class="bk-table${mine ? ' has-mine' : ''}${live ? ' live' : ''}" data-story-table="${esc(t.name)}">
    <div class="bk-head"><span>${esc(t.name)}</span>${note}</div>${rows}</div>`;
}

const emptyTable = (name: string) => `<div class="bk-table empty"><div class="bk-head"><span>${name}</span></div>${'<div class="bk-row tbd"><b class="bk-dot"></b><span class="bk-name">待定</span></div>'.repeat(4)}</div>`;

// live：还在后台打的桌（桌名 → 打到哪了）
export function bracketHtml(b: Bracket, fresh: Set<string> = new Set(), live: Map<string, string> = new Map()): string {
  const box = (t: BracketTable | undefined, name: string) => (t ? tableHtml(b, t, fresh.has(t.name), live.get(t.name)) : emptyTable(name));
  const col = (title: string, round: number, cls: string, inner: string) => `<div class="bk-col ${cls}${round === b.round ? ' now' : ''}"><h3>${title}</h3><div class="bk-col-in">${inner}</div></div>`;
  const half = (h: number) => {
    const first = roundTables(b, 0).filter((t) => t.half === h);
    const semi = roundTables(b, 1).find((t) => t.half === h);
    const r1 = col(`${HALVES[h]} · ${ROUNDS[0]}`, 0, 'r1', first.map((t) => box(t, '')).join(''));
    const r2 = col(`${HALVES[h]}决赛`, 1, 'r2', box(semi, `${HALVES[h]}决赛`));
    return `<section class="bk-half h${h}" aria-label="${HALVES[h]}">${h === 0 ? r1 + r2 : r2 + r1}</section>`;
  };
  const fin = col('总决赛', 2, 'r3', box(roundTables(b, 2)[0], '决赛'));
  return `<div class="bk-grid">${half(0)}<section class="bk-final" aria-label="总决赛">${fin}</section>${half(1)}</div>`;
}
