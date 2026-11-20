import {
  champion,
  FINAL_TABLE,
  FINALISTS,
  type League,
  myTable,
  netOf,
  PRELIM_ROUNDS,
  prelimStandings,
  roundName,
  roundShort,
  roundTables,
  type SoloTable,
  standingOf,
  TOTAL_ROUNDS,
} from './league';
import { portraitUrl } from '../ui3d/looks';

// 个人赛的积分榜画面（方案文档里的样图）：上面一排便签是赛程，左边是这一场的 8 桌（决赛是一桌），
// 右边是 32 人的预赛积分榜，前 4 名下面画决赛线，自己那一行用黄色荧光笔。
// 后台还在打的桌写「进行中 · 南 2 局」；fresh 里的桌子刚出结果，一行一行亮起来。
// 只用 .story-screen 下的 class，点击属性是 data-solo，不和团体赛、App 的点击处理撞

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => n.toLocaleString('en-US');

// 积分（按点数存的）写成 +23.3 / −9.0 / ±0.0
export function fmtPts(n: number): string {
  const v = (Math.abs(n) / 1000).toFixed(1);
  return n > 0 ? `+${v}` : n < 0 ? `−${v}` : `±${v}`;
}
const cls = (n: number) => (n > 0 ? 'plus' : n < 0 ? 'minus' : '');
const ptsHtml = (n: number | null, extra = '') => (n === null ? `<span class="${extra}"></span>` : `<span class="${extra} ${cls(n)}">${fmtPts(n)}</span>`);

const nameHtml = (l: League, p: number) => {
  const e = l.players[p];
  return `${esc(e.name)}<small>${esc(e.short)}</small>${e.minor ? '<i>虚拟</i>' : ''}`;
};

// 赛程：第 1–6 轮、决赛两场
export function stepsHtml(l: League): string {
  const notes = Array.from({ length: TOTAL_ROUNDS }, (_, r) => {
    const state = r < l.round ? 'done' : r === l.round ? 'now' : '';
    const fin = r >= PRELIM_ROUNDS ? ' fin' : '';
    return `<span class="${state}${fin}">${roundName(r)}</span>`;
  }).join('');
  const podium = l.podium ? '<span class="now fin">颁奖</span>' : '';
  return `<div class="ip-steps">${notes}${podium}</div>`;
}

// 预赛的一桌
function prelimTableHtml(l: League, t: SoloTable, fresh: boolean, live?: string): string {
  const order = t.scores ? [0, 1, 2, 3].sort((a, b) => t.scores![b] - t.scores![a] || a - b) : [0, 1, 2, 3];
  const rows = order
    .map((k, place) => {
      const p = t.seats[k];
      const e = l.players[p];
      const net = netOf(t, p);
      // 这一场之前的合计（还没出结果时给个参考）
      const before = standingOf(l, p).total - (net ?? 0);
      // 第 1 轮还没出结果时大家都是 0，不写
      const right = net !== null ? `<span class="ip-tot">${fmt(t.scores![k])}</span>${ptsHtml(net, 'ip-d')}` : t.round > 0 ? `<span class="ip-tot">合计 ${fmtPts(before)}</span>` : '';
      const delay = fresh ? ` style="animation-delay:${0.25 + (3 - place) * 0.3}s"` : '';
      return `<div class="bk-row${p === l.mine ? ' mine' : ''}${fresh ? ' fresh' : ''}"${delay}><b class="bk-dot" style="background:${e.color}"></b><span class="bk-name">${nameHtml(l, p)}</span>${right}</div>`;
    })
    .join('');
  const mine = t.seats.includes(l.mine);
  const note = live ? `<span class="bk-live">进行中 · ${live}</span>` : mine && !t.scores ? '<span class="bk-here">你在这桌</span>' : '';
  return `<div class="bk-table${mine ? ' has-mine' : ''}${live ? ' live' : ''}" data-solo-table="${esc(t.name)}"><div class="bk-head"><span>${esc(t.name)}</span>${note}</div>${rows}</div>`;
}

// 决赛桌：两场的积分和合计，打完写名次
function finalTableHtml(l: League, fresh: boolean, live?: string): string {
  const fin = l.finalists!;
  const tables = [PRELIM_ROUNDS, PRELIM_ROUNDS + 1].map((r) => roundTables(l, r)[0] ?? null);
  const pre = prelimStandings(l).map((s) => s.p);
  const order = l.podium ?? [...fin].sort((a, b) => (standingOf(l, b).final ?? 0) - (standingOf(l, a).final ?? 0) || pre.indexOf(a) - pre.indexOf(b));
  const anyDone = tables.some((t) => t?.scores);
  const rows = (anyDone ? order : fin)
    .map((p, place) => {
      const e = l.players[p];
      const games = tables.map((t) => (t ? netOf(t, p) : null));
      const total = standingOf(l, p).final;
      const tag = l.podium ? (place === 0 ? '冠军' : `第 ${place + 1}`) : `预赛 ${pre.indexOf(p) + 1}`;
      const delay = fresh ? ` style="animation-delay:${0.25 + (3 - place) * 0.3}s"` : '';
      return `<div class="bk-row${p === l.mine ? ' mine' : ''}${l.podium && place === 0 ? ' champ' : ''}${fresh ? ' fresh' : ''}"${delay}>
        <b class="bk-dot" style="background:${e.color}"></b><span class="bk-name">${nameHtml(l, p)}</span>
        ${games.map((g) => ptsHtml(g, 'ip-fg')).join('')}${ptsHtml(total, 'ip-d')}<em class="bk-tag">${tag}</em></div>`;
    })
    .join('');
  const now = roundTables(l)[0];
  const mine = fin.includes(l.mine);
  const note = live ? `<span class="bk-live">进行中 · ${live}</span>` : mine && now && !now.scores ? '<span class="bk-here">你在这桌</span>' : l.podium ? '<span class="bk-here">打完了</span>' : '';
  const head = `<div class="bk-row ip-fhead"><b class="bk-dot"></b><span class="bk-name">积分清零</span><span class="ip-fg">第 1 场</span><span class="ip-fg">第 2 场</span><span class="ip-d">合计</span><em class="bk-tag"></em></div>`;
  return `<div class="bk-table ip-final${mine ? ' has-mine' : ''}${live ? ' live' : ''}" data-solo-table="${FINAL_TABLE}"><div class="bk-head"><span>${FINAL_TABLE}</span>${note}</div>${head}${rows}</div>`;
}

// 颁奖台：亚军、冠军、季军（冠军站中间、最高）
function podiumHtml(l: League): string {
  const step = (k: number) => {
    const p = l.podium![k];
    const e = l.players[p];
    // 冠军用笑脸，没有笑脸的立绘就用平常那张，都没有就只留名字的最后一个字
    const plain = portraitUrl(e.id, 'neutral');
    const url = (k === 0 && portraitUrl(e.id, 'happy')) || plain;
    const img = e.minor || !url ? '' : `<img src="${url}" alt="" onerror="${url !== plain && plain ? `this.onerror=()=>this.remove();this.src='${plain}'` : 'this.remove()'}" />`;
    return `<div class="ip-step p${k + 1}${p === l.mine ? ' mine' : ''}"><span class="ip-face" style="--c:${e.color}"><span>${esc(e.name.slice(-1))}</span>${img}</span><b>${esc(e.name)}</b><small>${esc(e.short)}</small><em>${['冠军', '亚军', '季军'][k]}</em></div>`;
  };
  return `<div class="ip-podium" aria-label="前三名">${step(1)}${step(0)}${step(2)}</div>`;
}

// 预赛积分榜：每轮一列（手机上只留最近三轮），合计，前 4 名下面画决赛线
export function boardHtml(l: League): string {
  const cols = Math.min(l.round + 1, PRELIM_ROUNDS);
  const old = (r: number) => (r < cols - 3 ? ' old' : '');
  const head = `<div class="hd"><span class="rk">名次</span><span></span><span>选手</span>${Array.from({ length: cols }, (_, r) => `<span class="c${old(r)}">${roundShort(r)}</span>`).join('')}<span class="t">合计</span></div>`;
  const rows = prelimStandings(l)
    .map((s, i) => {
      const e = l.players[s.p];
      const fin = l.finalists?.includes(s.p) ? '<b class="ip-fin">决赛</b>' : '';
      const cells = Array.from({ length: cols }, (_, r) => ptsHtml(s.games[r], `c${old(r)}`)).join('');
      const row = `<div class="r${s.p === l.mine ? ' mine' : ''}"><span class="rk">${i + 1}</span><b class="bk-dot" style="background:${e.color}"></b><span class="nm">${nameHtml(l, s.p)}${fin}</span>${cells}<span class="t ${cls(s.total)}">${fmtPts(s.total)}</span></div>`;
      return i === FINALISTS - 1 ? `${row}<div class="ip-cut">决赛线 · 前 ${FINALISTS} 名进决赛桌</div>` : row;
    })
    .join('');
  return `<div class="ip-board" style="--n:${cols};--nm:${Math.min(cols, 3)}">${head}${rows}</div>`;
}

// 整个积分榜画面的中间部分。live：后台在打的桌（桌名 → 打到哪了）
export function soloHtml(l: League, fresh: Set<string> = new Set(), live: Map<string, string> = new Map()): string {
  const r = Math.min(l.round, TOTAL_ROUNDS - 1);
  const inFinal = r >= PRELIM_ROUNDS;
  const tables = inFinal ? finalTableHtml(l, fresh.has(FINAL_TABLE), live.get(FINAL_TABLE)) : roundTables(l, r).map((t) => prelimTableHtml(l, t, fresh.has(t.name), live.get(t.name))).join('');
  const champ = champion(l);
  const title = l.podium ? `颁奖 <small>冠军 ${esc(l.players[champ!].name)}</small>` : `${roundName(r)} <small>${inFinal ? '前 4 名，两个半庄定冠军' : r === 0 ? '抽签分桌，同校不同桌' : '按积分分桌'}</small>`;
  const mineHere = myTable(l, r);
  return `${stepsHtml(l)}<div class="ip-grid${mineHere ? '' : ' no-mine'}">
    <section class="ip-col" aria-label="这一场"><h3>${title}</h3>${l.podium ? podiumHtml(l) : ''}<div class="ip-tables${inFinal ? ' one' : ''}">${tables}</div></section>
    <section class="ip-col" aria-label="积分榜"><h3>预赛积分榜 <small>每场（终局点数 − 25000）÷ 1000</small></h3>${boardHtml(l)}</section>
  </div>`;
}
