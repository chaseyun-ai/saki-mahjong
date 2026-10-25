import type { Character } from '../abilities/characters';
import { POSITIONS, TIERS, TeamRun, isSub } from '../team/team';
import { portraitUrl } from '../ui3d/looks';

// 团体赛拟真的几个画面（选人、布阵、队伍点数板、最终结果）。牌局本身还是 App 来打：
// 点“开始”时调 play(run, auto)，App 打完一场再调 afterMatch 回到点数板。

const LINEUP_SECS = 60;
const AI_PICK_MS = 900; // 电脑选人前停一下，看得清谁拿了谁

export interface TeamHooks {
  play(run: TeamRun, seats: number[], auto: boolean): void;
  exit(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class TeamFlow {
  run: TeamRun;
  private timer: number | null = null;
  private deadline = 0;
  private sel: number | null = null; // 布阵时点了哪个位置
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
        run.aiPick();
        this.draft();
      }, AI_PICK_MS);
    }
  }

  private card(c: Character, opts: { pick?: boolean; taken?: number | null; small?: boolean } = {}): string {
    const t = opts.taken != null ? this.run.teams[opts.taken] : null;
    const tip = c.ability ? `${c.ability.name}：${c.ability.description}` : isSub(c) ? '替补选手：没有能力，牌效一般' : '没有能力，只靠扎实的牌效和防守';
    const tag = t ? `<span class="tm-tag" style="--t:${t.color}">${t.name}</span>` : '';
    const attrs = opts.pick ? `data-team-pick="${c.id}"` : 'disabled';
    return `<button class="char-card tm-card${t ? ' taken' : ''}${opts.small ? ' small' : ''}" style="--c:${c.color}" ${attrs} title="${esc(tip)}">
        <div class="char-portrait">${c.name.slice(-1)}${isSub(c) ? '' : `<img src="${portraitUrl(c.id, 'neutral')}" alt="" onerror="this.remove()" />`}</div>
        <div class="char-name">${c.name}</div>
        <div class="tm-ability">${c.ability?.name ?? (isSub(c) ? '替补' : '无能力')}</div>${tag}
      </button>`;
  }

  // 四队的选人进度：每队一列，选到的人按档位排
  private teamsHtml(highlight: number | null): string {
    return `<div class="tm-teams">${this.run.teams
      .map((t, i) => {
        const slots = TIERS.map((tier, k) => {
          const c = t.picks[k];
          return `<div class="tm-slot">${c ? `<span class="tm-mini" style="--c:${c.color}">${c.name.slice(-1)}${isSub(c) ? '' : `<img src="${portraitUrl(c.id, 'neutral')}" alt="" onerror="this.remove()" />`}</span><span>${c.name}</span>` : `<span class="tm-cost">${tier} 费</span>`}</div>`;
        }).join('');
        return `<div class="tm-team${i === highlight ? ' on' : ''}${t.human ? ' mine' : ''}" style="--t:${t.color}"><div class="tm-team-name">${t.name}${t.human ? '（你）' : ''}</div>${slots}</div>`;
      })
      .join('')}</div>`;
  }

  private renderDraft(): void {
    const run = this.run;
    const team = run.picker()!;
    const mine = run.teams[team].human;
    const order = run
      .order()
      .map((t, k) => `<span class="tm-order-item${k === run.turn ? ' on' : k < run.turn ? ' done' : ''}" style="--t:${run.teams[t].color}">${run.teams[t].name}</span>`)
      .join('<span class="tm-arrow">→</span>');
    const cards = (run.pool.get(run.tier) ?? []).map((c) => this.card(c, { pick: mine && run.takenBy(c) === null, taken: run.takenBy(c) })).join('');
    this.root.innerHTML = `
      <div class="select-screen team-screen">
        <div class="tm-head"><button class="lab-entry" data-team="exit">← 退出</button><h1>团体赛 · 选人</h1></div>
        <p class="subtitle">每队每档选一人，正好 15 费。顺序是蛇形的：这一档先选的，下一档最后选。</p>
        <div class="tm-order"><b>${run.tier} 费</b>${order}</div>
        <p class="tm-turn" style="--t:${run.teams[team].color}">${mine ? '轮到你选了（鼠标停在头像上看能力）' : `${run.teams[team].name}在选……`}</p>
        <div class="char-grid tm-pool">${cards}</div>
        ${this.teamsHtml(team)}
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
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-team],[data-team-pick],[data-team-pos]');
    if (!el) return;
    const run = this.run;
    if (el.dataset.teamPick && this.screen === 'draft') {
      if (run.pick(run.human, el.dataset.teamPick)) this.draft();
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
