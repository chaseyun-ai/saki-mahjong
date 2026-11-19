import './codex.css';
import { CHARACTERS, type Character } from '../abilities/characters';
import { POSITIONS } from '../team/team';
import { portraitUrl } from '../ui3d/looks';
import { type HomeTod, timeOfDay } from './home';
import { SCHOOLS, membersOf } from './schools';
import { playFlip } from './sound';

// 角色图鉴（主页的收音机进来）：部室里摊开一本笔记本。左页按学校翻，一页贴着这个学校五个人的小照片；
// 右页是点开的那个人：大照片、名字、学校和位置、团体赛费用、能力名和整段说明。
// 只看不改；点击在这里自己接（data-codex），不经过 App。

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function todNow(): HomeTod {
  try {
    const v = sessionStorage.getItem('saki-home-tod') as HomeTod | null;
    if (v === 'day' || v === 'dusk' || v === 'night') return v;
  } catch {
    // 照时间
  }
  return timeOfDay();
}

function photo(c: Character): string {
  const src = portraitUrl(c.id, 'neutral');
  const img = src ? `<img src="${src}" alt="" loading="lazy" onerror="this.remove()" />` : '';
  return `<span class="cx-photo" style="--c:${c.color}"><span class="cx-initial">${esc(c.name.slice(-1))}</span>${img}</span>`;
}

function positionOf(c: Character): string {
  const lineup = SCHOOLS.find((s) => s.name === c.school)?.lineup ?? [];
  const i = lineup.indexOf(c.id);
  return i >= 0 ? POSITIONS[i] : '';
}

function detailHtml(c: Character): string {
  const school = SCHOOLS.find((s) => s.name === c.school);
  const pos = positionOf(c);
  const desc = c.ability ? c.ability.description : (c.note ?? '不靠能力，只靠扎实的牌效和防守。');
  return `<article class="cx-detail" style="--c:${c.color}" aria-live="polite">
    <div class="cx-polaroid">${photo(c)}<i class="cx-tape" aria-hidden="true"></i><span class="cx-cost" title="团体赛选人的费用档位">${c.cost}<small>费</small></span></div>
    <div class="cx-info">
      <p class="cx-school">${esc(c.school)}${school?.region ? ` · ${esc(school.region)}代表` : ''}${pos ? ` · ${pos}` : ''}</p>
      <h2 class="cx-name${c.name.length >= 5 ? ' long' : ''}">${esc(c.name)}</h2>
    </div>
    <h3 class="cx-ability">${c.ability ? esc(c.ability.name) : '无能力'}</h3>
    <p class="cx-desc">${esc(desc)}</p>
  </article>`;
}

function gridHtml(school: string, picked: string): string {
  return membersOf(school)
    .map(
      (c, i) => `<button class="cx-card${c.id === picked ? ' on' : ''}" data-codex="pick" data-id="${c.id}" style="--c:${c.color};--r:${((i * 37) % 7) - 3}deg" aria-pressed="${c.id === picked}">
        ${photo(c)}<b>${esc(c.name)}</b><small>${c.ability ? esc(c.ability.name) : '无能力'}</small></button>`,
    )
    .join('');
}

function tabsHtml(school: string): string {
  return SCHOOLS.map((s) => `<button class="${s.name === school ? 'on' : ''}" role="tab" aria-selected="${s.name === school}" data-codex="school" data-school="${esc(s.name)}" style="--s:${s.color}">${esc(s.short)}</button>`).join('');
}

export function mountCodex(root: HTMLElement, exit: () => void): void {
  const tod = todNow();
  let school = SCHOOLS[0]?.name ?? '';
  let picked = membersOf(school)[0]?.id ?? CHARACTERS[0].id;
  root.innerHTML = `<div class="codex" data-tod="${tod}" style="--bg:url('home/${tod}.webp')">
    <div class="cx-backdrop" aria-hidden="true"></div>
    <header class="cx-top">
      <button class="cx-back" data-codex="back">← 回部室</button>
      <h1>角色图鉴</h1>
      <span class="cx-count">${SCHOOLS.length} 所学校 · ${CHARACTERS.length} 人</span>
    </header>
    <div class="cx-book">
      <section class="cx-page cx-left" aria-label="学校和角色">
        <nav class="cx-tabs" role="tablist">${tabsHtml(school)}</nav>
        <h2 class="cx-school-name"></h2>
        <div class="cx-grid"></div>
      </section>
      <section class="cx-page cx-right" aria-label="角色介绍"></section>
    </div>
  </div>`;
  const el = root.querySelector<HTMLElement>('.codex')!;
  const tabs = el.querySelector<HTMLElement>('.cx-tabs')!;
  const grid = el.querySelector<HTMLElement>('.cx-grid')!;
  const head = el.querySelector<HTMLElement>('.cx-school-name')!;
  const right = el.querySelector<HTMLElement>('.cx-right')!;

  const drawLeft = (): void => {
    const s = SCHOOLS.find((x) => x.name === school);
    tabs.innerHTML = tabsHtml(school);
    head.innerHTML = `${esc(school)}<small>${s?.region ? `${esc(s.region)}代表 · ` : ''}${membersOf(school).length} 人</small>`;
    head.style.setProperty('--s', s?.color ?? '#999');
    grid.innerHTML = gridHtml(school, picked);
  };
  const drawRight = (): void => {
    const c = CHARACTERS.find((x) => x.id === picked);
    right.innerHTML = c ? detailHtml(c) : '';
    right.classList.remove('flip');
    void right.offsetWidth;
    right.classList.add('flip');
  };
  drawLeft();
  drawRight();

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-codex]');
    if (!b) return;
    const act = b.dataset.codex;
    if (act === 'back') {
      exit();
      return;
    }
    if (act === 'school' && b.dataset.school && b.dataset.school !== school) {
      school = b.dataset.school;
      picked = membersOf(school)[0]?.id ?? picked;
      playFlip('riffle', 0.2);
      drawLeft();
      drawRight();
      return;
    }
    if (act === 'pick' && b.dataset.id && b.dataset.id !== picked) {
      picked = b.dataset.id;
      for (const card of grid.querySelectorAll<HTMLElement>('.cx-card')) {
        const on = card.dataset.id === picked;
        card.classList.toggle('on', on);
        card.setAttribute('aria-pressed', String(on));
      }
      drawRight();
      // 手机上两页上下排：点了往下滚到介绍
      if (window.matchMedia?.('(max-width: 760px)').matches) right.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') exit();
  });
  el.querySelector<HTMLElement>('.cx-back')?.focus({ preventScroll: true });
}
