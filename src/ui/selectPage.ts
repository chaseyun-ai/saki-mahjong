import './selectPage.css';
import { CHARACTERS, type Character } from '../abilities/characters';
import type { MatchSettings } from './matchSetup';
import { SCHOOLS, membersOf } from './schools';

// 个人对局页：部室白板上的「白板报名表」（用户 2026-11-19 选的方案 A）。
// 左边一大张名册纸：上沿一排胶带写着学校，一校一页、每人一张拍立得（没立绘的写名字最后一个字），
// 右边一张报名表：本人（照片、名字、费用、能力）、三个对手（上排家位、下排下拉，空着是随机）、
//   规则（点「规则」两个字改，下面只写选好的）、红印章「出场」、随机出场。
// 电脑上整页按屏幕高度摆，不用滚轮（用户 2026-11-19：速查不要、改规则并到「规则」上）。
// 点照片 = 红笔圈她当本人；再点一下圈着的那张、或者盖章，就出场。手机上报名表贴在屏幕底下。
// 这里只拼 HTML，点了以后做什么在 app.ts。

const ROT = [-2, 1.5, -1, 2, -1.5];
const SEATS = ['下家', '对家', '上家'];

const PICK_KEY = 'saki.selPick';

// 上次圈的是谁
export function savedPick(): string | null {
  try {
    const v = localStorage.getItem(PICK_KEY);
    if (v && CHARACTERS.some((c) => c.id === v)) return v;
  } catch {
    // 读不到就从这一页第一位开始
  }
  return null;
}

export function savePick(id: string): void {
  try {
    localStorage.setItem(PICK_KEY, id);
  } catch {
    // 存不了就只管这一次
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 红笔圈（画在被圈的那张照片外面；pathLength 1 方便一笔画出来）
const RING = `<svg class="sr-ring" viewBox="0 0 100 130" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M20 12 C 60 -2, 98 18, 98 64 C 98 112, 70 130, 44 127 C 12 124, 2 96, 4 64 C 6 32, 20 14, 54 8"/></svg>`;

const GEAR = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></g></svg>`;
const PEN = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 20l4.2-1 10.6-10.6a2 2 0 0 0-3.2-3.2L5 15.8 4 20zM14 7l3 3"/></svg>`;
const DICE = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/></svg>`;

export interface SelectParts {
  school: string;
  picked: Character;
  settings: MatchSettings;
  // 卡片、报名表上的照片（透华治水时换图）；没有就只写字
  photo: (id: string) => string;
  // 卡片角上的小字：透华「治水」、咲「加强」
  badge: (id: string) => string;
  // 报名表上本人底下的切换（透华常态 / 治水、咲标准 / 加强）、白水哩的番缚设置
  extras: (id: string) => string;
  // 右上角「…」调试菜单（app 往里加按钮）
  more: string;
}

export function selectBoardHtml(p: SelectParts): string {
  return `
    <div class="sel-board">
      <header class="sb-top">
        <button class="sb-note sb-back" data-ui="home">← 回部室</button>
        <h1 class="sb-title">个人对局</h1>
        <p class="sb-sub">挑一位上场，再定三个对手</p>
        <span class="sb-gap"></span>
        ${p.more}
        <button class="sb-note sb-set" data-ui="open-settings" aria-haspopup="dialog">${GEAR}<span>设置</span></button>
      </header>
      <main class="sr" aria-label="选手名册">
        <span class="sb-magnet m1" aria-hidden="true"></span><span class="sb-magnet m2" aria-hidden="true"></span>
        <nav class="sr-tabs" role="tablist" aria-label="学校">${rosterTabsHtml(p.school)}</nav>
        <div class="sr-page">${rosterPageHtml(p)}</div>
        <p class="sb-foot">原型 · 角色与能力参考《天才麻将少女》，同人非商业作品 · 3D 人物由 VRoid 官方 CC0 示例模型改色</p>
      </main>
      <aside class="sf" aria-label="个人对局报名表">${entryFormHtml(p)}</aside>
      <div class="sb-tray" aria-hidden="true"><i></i><i></i></div>
    </div>`;
}

// 名册上沿的胶带：一个学校一条
export function rosterTabsHtml(current: string): string {
  return SCHOOLS.map((s) => {
    const on = s.name === current;
    return `<button class="${on ? 'on' : ''}" role="tab" aria-selected="${on}" data-ui="school" data-school="${s.name}" style="--s:${s.color}">${s.short}</button>`;
  }).join('');
}

// 一个学校一页：校名、前后翻、五张拍立得
export function rosterPageHtml(p: Pick<SelectParts, 'school' | 'picked' | 'photo' | 'badge'>): string {
  const s = SCHOOLS.find((x) => x.name === p.school) ?? SCHOOLS[0];
  const i = SCHOOLS.indexOf(s);
  const near = (d: number) => SCHOOLS[(i + d + SCHOOLS.length) % SCHOOLS.length].short;
  const cards = membersOf(s.name)
    .map((c, k) => {
      const on = c.id === p.picked.id;
      const url = p.photo(c.id);
      const badge = p.badge(c.id);
      const ability = c.ability?.name ?? '无能力';
      return `<button class="sr-card${on ? ' on' : ''}" data-pick="${c.id}" aria-pressed="${on}" aria-label="${c.name}，${c.cost} 费：${ability}${on ? '（已选，再点一下出场）' : ''}" style="--c:${c.color};--r:${ROT[k % ROT.length]}deg">
        <span class="sr-photo"><span class="sr-glyph">${c.name.slice(-1)}</span>${url ? `<img src="${url}" alt="" onerror="this.remove()" />` : ''}</span>
        <span class="sr-name${c.name.length >= 6 ? ' xlong' : c.name.length >= 5 ? ' long' : ''}">${c.name}</span>
        <span class="sr-ab">${ability}</span>
        <span class="sr-cost" aria-hidden="true">${c.cost}<small>费</small></span>
        ${badge ? `<span class="sr-badge" aria-hidden="true">${badge}</span>` : ''}
        ${on ? RING : ''}
      </button>`;
    })
    .join('');
  return `<div class="sr-head" style="--s:${s.color}">
      <h2>${s.name}</h2><span class="sr-region">${s.region ? `${s.region}代表 · ` : ''}先锋到大将</span>
      <span class="sr-pager"><button data-ui="school-step" data-d="-1" aria-label="前一所学校">← ${near(-1)}</button><button data-ui="school-step" data-d="1" aria-label="后一所学校">${near(1)} →</button></span>
    </div>
    <div class="sr-grid">${cards}</div>
    <p class="sr-hint">点照片选人，再点一下圈着的那张（或者盖章）就出场。手机上左右滑换学校。</p>`;
}

// 规则一行
export function rulesText(s: MatchSettings): string {
  const parts = [{ one: '一局', east: '东风', south: '半庄' }[s.length], `起始 ${s.start}`, `一位 ${s.target}`, s.red === 0 ? '无赤' : s.red === 3 ? '三赤' : '四赤', s.kuitan ? '食断' : '无食断'];
  if (s.minHan > 1) parts.push(s.minHan === 2 ? '二番缚' : '四番缚');
  if (!s.tobi) parts.push('不击飞');
  if (s.open) parts.push('公开手牌');
  return parts.join(' · ');
}

function opponentSelect(s: MatchSettings, i: number): string {
  const cur = s.opponents[i] ?? '';
  const groups = SCHOOLS.map(
    (sc) => `<optgroup label="${sc.name}">${membersOf(sc.name)
      .map((c) => `<option value="${c.id}"${c.id === cur ? ' selected' : ''}>${c.name}</option>`)
      .join('')}</optgroup>`,
  ).join('');
  return `<label class="sf-opp${cur ? '' : ' rand'}"><span>${SEATS[i]}</span><select class="sf-opp-sel" data-seat="${i}" aria-label="${SEATS[i]}"><option value=""${cur ? '' : ' selected'}>随机</option>${groups}</select></label>`;
}

// 报名表
export function entryFormHtml(p: Pick<SelectParts, 'picked' | 'settings' | 'photo' | 'extras'>): string {
  const c = p.picked;
  const url = p.photo(c.id);
  const region = SCHOOLS.find((s) => s.name === c.school)?.region;
  const desc = c.ability ? c.ability.description : c.note ?? '不靠能力，只靠扎实的牌效和防守。';
  return `
    <span class="sf-clip" aria-hidden="true"></span>
    <h2 class="sf-title">个人对局 报名表</h2>
    <div class="sf-sec sf-sec-me">本人</div>
    <div class="sf-me">
      <span class="sf-photo" style="--c:${c.color}"><span>${c.name.slice(-1)}</span>${url ? `<img src="${url}" alt="" onerror="this.remove()" />` : ''}</span>
      <div class="sf-who">
        <div class="sf-name"><b class="${c.name.length >= 5 ? 'long' : ''}">${c.name}</b><span class="sf-cost">${c.cost} 费</span></div>
        <div class="sf-school">${c.school}${region ? ` · ${region}代表` : ''}</div>
        <div class="sf-ability">${c.ability?.name ?? '无能力'}</div>
        ${p.extras(c.id)}
      </div>
    </div>
    <div class="sf-desc-wrap"><p class="sf-desc">${esc(desc)}</p><button class="sf-more" data-ui="desc-more" hidden>全文</button></div>
    <div class="sf-sec">对手<small>空着的随机抽</small></div>
    <div class="sf-opps">${[0, 1, 2].map((i) => opponentSelect(p.settings, i)).join('')}</div>
    <div class="sf-rulebox">
      <button class="sf-sec sf-sec-btn" data-ui="open-match" title="改规则（打开对局设置）">规则${PEN}</button>
      <div class="sf-rules">${rulesText(p.settings)}</div>
    </div>
    <div class="sf-acts">
      <button class="sf-dice" data-ui="random" aria-label="随机出场" title="随便抽一位，照这张表直接开局"><span class="sf-magnet">${DICE}</span><span class="sf-dice-t">随机出场</span></button>
      <button class="sf-stamp" data-ui="go" data-id="${c.id}">出场</button>
    </div>`;
}
