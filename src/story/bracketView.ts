import { POSITIONS } from '../team/team';
import { advancers, type Bracket, type BracketTable, MY_SCHOOL, ROUNDS, roundTables } from './bracket';

// 晋级表画面：一轮一列，每桌一个框。我校那一行高亮，被淘汰的学校变灰。
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
  const state = !res ? 'wait' : adv ? 'adv' : 'out';
  const tag = !res ? '' : champ ? '冠军' : final ? `第 ${place + 1}` : adv ? '晋级' : '出局';
  const tip = e.lineup.map((n, p) => `${POSITIONS[p]} ${n}`).join('\n');
  const delay = fresh ? ` style="animation-delay:${0.25 + (3 - place) * 0.35}s"` : '';
  return `<div class="bk-row ${state}${e.mine ? ' mine' : ''}${champ ? ' champ' : ''}${fresh ? ' fresh' : ''}" title="${esc(tip)}"${delay}>
    <b class="bk-dot" style="background:${e.color}"></b>
    <span class="bk-name">${esc(e.short)}${e.minor ? '<i>小校</i>' : ''}</span>
    ${res ? `<span class="bk-pts">${fmt(res.points[i])}</span>` : ''}
    <em class="bk-tag">${tag}</em>
  </div>`;
}

function tableHtml(b: Bracket, t: BracketTable, fresh: boolean): string {
  const order = t.result ? t.result.order : [0, 1, 2, 3];
  const place = (i: number) => order.indexOf(i);
  // 出了结果按名次排，没出按抽签顺序
  const rows = order.map((i) => rowHtml(b, t, i, fresh, place(i))).join('');
  const note = t.schools.includes(MY_SCHOOL) ? '<span class="bk-here">我校</span>' : '';
  return `<div class="bk-table${t.schools.includes(MY_SCHOOL) ? ' has-mine' : ''}" data-story-table="${esc(t.name)}">
    <div class="bk-head">${esc(t.name)}${note}</div>${rows}</div>`;
}

const emptyTable = (name: string) => `<div class="bk-table empty"><div class="bk-head">${name}</div>${'<div class="bk-row tbd"><b class="bk-dot"></b><span class="bk-name">待定</span></div>'.repeat(4)}</div>`;

export function bracketHtml(b: Bracket, fresh: Set<string> = new Set()): string {
  const cols = ROUNDS.map((title, r) => {
    const tables = roundTables(b, r);
    const boxes = tables.length
      ? tables.map((t) => tableHtml(b, t, fresh.has(t.name))).join('')
      : (r === 1 ? ['半决赛 1', '半决赛 2'] : ['决赛']).map(emptyTable).join('');
    const now = r === b.round ? ' now' : '';
    return `<div class="bk-col${now}"><h3>${title}</h3>${boxes}</div>`;
  }).join('<div class="bk-gap"></div>');
  return `<div class="bk-grid">${cols}</div>`;
}
