import type { Character } from '../abilities/characters';
import { POSITIONS, TIERS, TeamRun, isSub } from '../team/team';
import { cutinArt, portraitUrl } from '../ui3d/looks';

// 团体赛拟真的几个画面（选人、布阵、队伍点数板、最终结果）。牌局本身还是 App 来打：
// 点“开始”时调 play(run, auto)，App 打完一场再调 afterMatch 回到点数板。

const LINEUP_SECS = 60;
const AI_PICK_MS = 900; // 电脑选人前停一下，看得清谁拿了谁

export interface TeamHooks {
  play(run: TeamRun, seats: number[], auto: boolean): void;
  exit(): void;
}

export class TeamFlow {
  run: TeamRun;
  private timer: number | null = null;
  private deadline = 0;
  private sel: number | null = null; // 布阵时点了哪个位置
  private focus: string | null = null; // 选人时大立绘放的是谁
  private screen: 'draft' | 'lineup' | 'board' | 'final' = 'draft';

  constructor(
    private root: HTMLElement,
    private hooks: TeamHooks,
    seed = Math.floor(Math.random() * 2 ** 31),
  ) {
    this.run = new TeamRun(seed, 0);
    root.addEventListener('click', this.onClick);
    this.draft();
  }

  private get me() {
    return this.run.teams[this.run.human];
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private close(): void {
    this.clearTimer();
    this.root.removeEventListener('click', this.onClick);
  }

  // ---------- 选人 ----------

  private draft(): void {
    this.screen = 'draft';
    this.clearTimer();
    const run = this.run;
    if (!run.drafting) {
      this.startLineup();
      return;
    }
    this.renderDraft();
    const team = run.picker()!;
    if (!run.teams[team].human) {
      this.timer = window.setTimeout(() => {
        // 电脑选了谁，大立绘就换成谁，看得清被拿走的是哪位
        const c = run.aiPick();
        if (c) this.focus = c.id;
        this.draft();
      }, AI_PICK_MS);
    }
  }

  private mini(c: Character): string {
    return `<span class="tm-mini" style="--c:${c.color}">${c.name.slice(-1)}${isSub(c) ? '' : `<img src="${portraitUrl(c.id, 'neutral')}" alt="" onerror="this.remove()" />`}</span>`;
  }

  // 大立绘那里放谁：点过的那位；轮到玩家时她要是被拿走了，换成这一档还没被选的第一个（真人优先于替补）
  private focused(): Character {
    const run = this.run;
    const pool = run.pool.get(run.tier) ?? [];
    const free = pool.filter((c) => run.takenBy(c) === null);
    const f = pool.find((c) => c.id === this.focus);
    const mine = run.teams[run.picker()!].human;
    const c = f && !(mine && run.takenBy(f) !== null) ? f : (free.find((x) => !isSub(x)) ?? free[0] ?? pool[0]);
    this.focus = c.id;
    return c;
  }

  // 格斗游戏式：左边大立绘和能力说明，底下一排这一档的候选，右边自己队的五个位置和别的队
  private renderDraft(): void {
    const run = this.run;
    const team = run.picker()!;
    const mine = run.teams[team].human;
    const me = this.me;
    const f = this.focused();
    const fBy = run.takenBy(f);
    const desc = (c: Character) => c.ability?.description ?? (isSub(c) ? '替补选手：没有能力，牌效一般。' : '不靠能力，只靠扎实的牌效和防守。');
    const abil = (c: Character) => c.ability?.name ?? (isSub(c) ? '替补' : '无能力');
    const order = run
      .order()
      .map((t, k) => `<span class="tm-order-item${k === run.turn ? ' on' : k < run.turn ? ' done' : ''}" style="--t:${run.teams[t].color}">${run.teams[t].name}</span>`)
      .join('<span class="tm-arrow">→</span>');
    const art = isSub(f) ? '' : `<img class="tmd-art" src="${cutinArt(f.id, 'ability').url}" alt="" onerror="this.remove()" />`;
    const stamp = fBy !== null ? `<div class="tmd-stamp" style="--t:${run.teams[fBy].color}">${run.teams[fBy].name}<small>已选</small></div>` : '';
    const thumbs = (run.pool.get(run.tier) ?? [])
      .map((c) => {
        const by = run.takenBy(c);
        const tag = by !== null ? `<span class="tm-tag" style="--t:${run.teams[by].color}">${run.teams[by].name}</span>` : '';
        return `<button class="tmd-thumb${c.id === f.id ? ' sel' : ''}${by !== null ? ' taken' : ''}" data-team-focus="${c.id}" style="--c:${c.color}">${this.mini(c)}<span>${c.name}</span>${tag}</button>`;
      })
      .join('');
    const go = mine
      ? `<button class="primary tmd-go" data-team="pick"${fBy !== null ? ' disabled' : ''}>${fBy !== null ? '已被选走' : '就选她'}</button>`
      : `<button class="primary tmd-go" disabled>${run.teams[team].name}在选……</button>`;
    const roster = TIERS.map((tier, k) => {
      const c = me.picks[k];
      const open = tier === run.tier && !c;
      const body = c
        ? `${this.mini(c)}<span class="tmd-who"><b>${c.name}</b><small>${abil(c)}</small></span>`
        : open && mine && fBy === null
          ? `${this.mini(f).replace('tm-mini', 'tm-mini ghost')}<span class="tmd-who"><b>${f.name}？</b><small>正在选</small></span>`
          : `<span class="tmd-who"><small>${open ? '这一档' : '待选'}</small></span>`;
      return `<div class="tmd-slot${open ? ' open' : ''}" style="--c:${c?.color ?? 'transparent'}"><span class="tmd-cost">${tier}</span>${body}</div>`;
    }).join('');
    const others = run.teams
      .map((t, i) => (t.human ? '' : `<div class="tmd-other${i === team ? ' on' : ''}" style="--t:${t.color}"><span class="tmd-tname">${t.name}</span>${TIERS.map((_, k) => (t.picks[k] ? this.mini(t.picks[k]) : '<span class="tm-mini empty"></span>')).join('')}</div>`))
      .join('');
    this.root.innerHTML = `
      <div class="select-screen team-screen tm-draft">
        <div class="tm-head tmd-head"><button class="lab-entry" data-team="exit">← 退出</button><h1>团体赛 · 选人</h1><div class="tm-order"><b>${run.tier} 费</b>${order}</div></div>
        <section class="tmd-stage" style="--c:${f.color}">
          ${art}<span class="tmd-letter">${f.name.slice(-1)}</span>${stamp}
          <div class="tmd-plate"><div class="tmd-badge">${f.cost}<small>费</small></div><div><div class="tmd-name">${f.name}</div><div class="tmd-school">${f.school}</div></div></div>
          <div class="tmd-desc"><div class="tmd-abil">${abil(f)}</div><p>${desc(f)}</p></div>
        </section>
        <div class="tmd-pick"><div class="tmd-thumbs">${thumbs}</div>${go}</div>
        <aside class="tmd-side">
          <h3 style="--t:${me.color}">${me.name}（你）</h3>
          <div class="tmd-roster">${roster}</div>
          <h3>其他队</h3>${others}
          <p class="tmd-rule">每队每档选一人，正好 15 费。顺序是蛇形的：这一档先选的，下一档最后选。</p>
        </aside>
      </div>`;
  }

  // ---------- 布阵 ----------

  private startLineup(): void {
    this.screen = 'lineup';
    this.sel = null;
    this.deadline = Date.now() + LINEUP_SECS * 1000;
    this.renderLineup();
    this.tick();
  }

  private tick(): void {
    this.clearTimer();
    const left = Math.ceil((this.deadline - Date.now()) / 1000);
    const el = this.root.querySelector('.tm-clock');
    if (el) el.textContent = String(Math.max(0, left));
    if (left <= 0) {
      this.board();
      return;
    }
    this.timer = window.setTimeout(() => this.tick(), 250);
  }

  private renderLineup(): void {
    const t = this.me;
    const rows = POSITIONS.map((name, i) => {
      const c = t.lineup[i];
      return `<button class="tm-pos${this.sel === i ? ' sel' : ''}" data-team-pos="${i}" style="--c:${c.color}">
          <span class="tm-pos-name">${name}</span>
          <span class="tm-mini" style="--c:${c.color}">${c.name.slice(-1)}${isSub(c) ? '' : `<img src="${portraitUrl(c.id, 'neutral')}" alt="" onerror="this.remove()" />`}</span>
          <span class="tm-pos-char"><b>${c.name}</b><small>${c.cost} 费 · ${c.ability?.name ?? (isSub(c) ? '替补' : '无能力')}</small></span>
        </button>`;
    }).join('');
    this.root.innerHTML = `
      <div class="select-screen team-screen">
        <div class="tm-head"><button class="lab-entry" data-team="exit">← 退出</button><h1>团体赛 · 布阵</h1></div>
        <p class="subtitle">点一个位置、再点另一个位置，两个人互换。时间到了就按现在的排法上场；别的队的布阵开打才公布。</p>
        <div class="tm-clock-wrap" style="--t:${t.color}"><span class="tm-clock">${LINEUP_SECS}</span><small>秒</small></div>
        <div class="tm-lineup">${rows}</div>
        <button class="primary" data-team="lineup-done">排好了</button>
      </div>`;
  }

  // ---------- 点数板 ----------

  private board(): void {
    this.clearTimer();
    if (this.run.over) {
      this.final();
      return;
    }
    this.screen = 'board';
    const run = this.run;
    const pos = run.pos;
    const rows = run
      .ranking()
      .map((i, k) => {
        const t = run.teams[i];
        const last = run.history.at(-1);
        const d = last ? last.end[i] - last.start[i] : 0;
        const next = t.lineup[pos];
        return `<div class="tm-row${t.human ? ' mine' : ''}" style="--t:${t.color}">
            <span class="rank">${k + 1}</span><span class="tm-row-name">${t.name}</span>
            <span class="tm-points">${t.points}</span>
            <span class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${last ? (d > 0 ? '+' : d < 0 ? '' : '±') + d : ''}</span>
            <span class="tm-next"><span class="tm-mini" style="--c:${next.color}">${next.name.slice(-1)}${isSub(next) ? '' : `<img src="${portraitUrl(next.id, 'neutral')}" alt="" onerror="this.remove()" />`}</span>${next.name}</span>
          </div>`;
      })
      .join('');
    const sticks = run.riichiSticks ? `<p class="subtitle">上一场留下立直棒 ${run.riichiSticks} 根，这一场谁先和了归谁。</p>` : '';
    this.root.innerHTML = `
      <div class="select-screen team-screen">
        <div class="tm-head"><button class="lab-entry" data-team="exit">← 退出</button><h1>${POSITIONS[pos]}战</h1></div>
        <p class="subtitle">${pos === 0 ? '各队开局 100000 点。' : ''}${POSITIONS[pos]}上场打一个半庄（东南战），点数算到队伍里。有队伍点数小于 0，整场立刻结束。</p>
        ${sticks}
        <div class="tm-board">${rows}</div>
        <div class="tm-go">
          <button class="primary" data-team="play">上场</button>
          <button class="lab-entry" data-team="auto">托管，看电脑打</button>
        </div>
      </div>`;
  }

  // App 打完一场：每个座位的点数、剩下的立直棒
  afterMatch(seats: number[], scores: number[], riichiSticks: number): void {
    this.run.finish(seats, scores, riichiSticks);
    this.board();
  }

  // ---------- 最终结果 ----------

  private final(): void {
    this.screen = 'final';
    const run = this.run;
    const rows = run
      .ranking()
      .map((i, k) => {
        const t = run.teams[i];
        const d = t.points - 100000;
        const cells = run.history.map((h) => {
          const dd = h.end[i] - h.start[i];
          return `<span class="${dd > 0 ? 'plus' : dd < 0 ? 'minus' : ''}">${dd > 0 ? '+' : ''}${dd}</span>`;
        });
        return `<div class="tm-row final${t.human ? ' mine' : ''}" style="--t:${t.color}">
            <span class="rank">${k + 1}</span><span class="tm-row-name">${t.name}</span><span class="tm-points">${t.points}</span>
            <span class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${d}</span>${cells.join('')}
          </div>`;
      })
      .join('');
    const head = `<div class="tm-row final tm-row-head"><span></span><span></span><span>点数</span><span>合计</span>${run.history.map((h) => `<span>${POSITIONS[h.pos]}</span>`).join('')}</div>`;
    const place = run.ranking().indexOf(run.human) + 1;
    const bust = run.teams.find((t) => t.points < 0);
    this.root.innerHTML = `
      <div class="select-screen team-screen">
        <h1>${place === 1 ? '优胜！' : `第 ${place} 名`}</h1>
        <p class="subtitle">${bust ? `${bust.name}被打飞，比赛在${POSITIONS[run.history.at(-1)!.pos]}战结束。` : '大将战结束，按队伍点数排名。'}</p>
        <div class="tm-board">${head}${rows}</div>
        <button class="primary" data-team="exit">回到主界面</button>
      </div>`;
  }

  // ---------- 点击 ----------

  private onClick = (e: Event): void => {
    if (!this.root.querySelector('.team-screen')) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-team],[data-team-focus],[data-team-pos]');
    if (!el) return;
    const run = this.run;
    if (el.dataset.teamFocus && this.screen === 'draft') {
      this.focus = el.dataset.teamFocus;
      this.renderDraft();
      return;
    }
    if (el.dataset.teamPos && this.screen === 'lineup') {
      const i = Number(el.dataset.teamPos);
      if (this.sel === null) this.sel = i;
      else {
        if (this.sel !== i) run.swap(run.human, this.sel, i);
        this.sel = null;
      }
      this.renderLineup();
      this.tick();
      return;
    }
    switch (el.dataset.team) {
      case 'exit':
        this.close();
        this.hooks.exit();
        return;
      case 'pick':
        if (this.screen === 'draft' && this.focus && run.pick(run.human, this.focus)) this.draft();
        return;
      case 'lineup-done':
        this.board();
        return;
      case 'play':
      case 'auto':
        this.hooks.play(run, run.seating(), el.dataset.team === 'auto');
        return;
    }
  };
}
