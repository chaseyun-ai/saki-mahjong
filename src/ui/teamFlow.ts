import type { Character } from '../abilities/characters';
import type { BindKey } from '../abilities/types';
import { POSITIONS, TEAMS, TIERS, TeamRun, isSub } from '../team/team';
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
  private focus: string | null = null; // 选人时大卡放的是谁
  private armed: string | null = null; // 玩家点过一次的候选，再点一下就选她
  private descOpen = false; // 大卡的能力说明展开了没有
  private pop = false; // 刚有人选完：这次画面里上一手的气泡和牌要弹一下
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
        // 电脑选了谁，大卡就换成谁，看得清被拿走的是哪位
        const c = run.aiPick();
        if (c) this.focus = c.id;
        this.armed = null; // 点过的不算数了：轮到自己时要重新点两下才选
        this.descOpen = false;
        this.pop = true;
        this.draft();
      }, AI_PICK_MS);
    }
  }

  // 麻将牌样子的角色卡：牌面上是头像（没有就是名字最后一个字），左上角写费用
  private tile(c: Character, cls = '', attrs = '', extra = ''): string {
    const img = isSub(c) ? '' : `<img src="${portraitUrl(c.id, 'neutral')}" alt="" onerror="this.remove()" />`;
    return `<${attrs ? 'button' : 'div'} class="tmd-tile${cls}" style="--c:${c.color}"${attrs}><span class="tmd-cn">${c.cost}</span><span class="tmd-pic"><b>${c.name.slice(-1)}</b>${img}</span><span class="tmd-nm">${c.name}</span>${extra}</${attrs ? 'button' : 'div'}>`;
  }

  // 大卡放谁：点过的那位；轮到玩家时她要是被电脑拿走了，换成这一档还没被选的第一个（真人优先于替补）。
  // 玩家自己去点被选走的牌，就照样放她（看能力，按钮是「已被选走」）
  private focused(): Character {
    const run = this.run;
    const pool = run.pool.get(run.tier) ?? [];
    const free = pool.filter((c) => run.takenBy(c) === null);
    const f = pool.find((c) => c.id === this.focus);
    const mine = run.teams[run.picker()!].human;
    const keep = f && (!(mine && run.takenBy(f) !== null) || this.armed === f.id);
    const c = keep ? f : (free.find((x) => !isSub(x)) ?? free[0] ?? pool[0]);
    this.focus = c.id;
    return c;
  }

  // 上一手：哪一队选了谁（还没人选过是 null）
  private lastPick(): { team: number; c: Character } | null {
    const run = this.run;
    const k = run.tierIdx * TEAMS.length + run.turn - 1;
    if (k < 0) return null;
    const tierIdx = Math.floor(k / TEAMS.length);
    const team = run.order(TIERS[tierIdx])[k % TEAMS.length];
    return { team, c: run.teams[team].picks[tierIdx] };
  }

  // 座位：玩家坐下面，按 5 费档的选人顺序逆时针往下排（下家在右，对家在上，上家在左）。
  // 这样蛇形就是“这一档逆时针，下一档顺时针”
  private seatOf(team: number): 's' | 'e' | 'n' | 'w' {
    const first = this.run.first;
    const k = (first.indexOf(team) - first.indexOf(this.run.human) + 4) % 4;
    return (['s', 'e', 'n', 'w'] as const)[k];
  }

  // 四队围一桌：上、左、右三队和下面的自己各坐一边，桌子中间是起家指示器和这一档的候选（麻将牌），
  // 右下角是点中的那位的切入图、能力和「就选她」
  private renderDraft(): void {
    const run = this.run;
    const team = run.picker()!;
    const mine = run.teams[team].human;
    const me = this.me;
    const f = this.focused();
    const fBy = run.takenBy(f);
    const order = run.order();
    const ccw = (5 - run.tier) % 2 === 0;
    const no = run.tierIdx * TEAMS.length + run.turn + 1;
    const last = this.lastPick();
    const pop = this.pop;
    this.pop = false;
    const desc = (c: Character) => c.ability?.description ?? (isSub(c) ? '替补选手：没有能力，牌效一般。' : '不靠能力，只靠扎实的牌效和防守。');
    const abil = (c: Character) => c.ability?.name ?? (isSub(c) ? '替补' : '无能力');
    const cost = (t: number) => run.teams[t].picks.reduce((s, c) => s + c.cost, 0);

    const seat = (t: number): string => {
      const T = run.teams[t];
      const tiles = TIERS.map((tier, k) => {
        const c = T.picks[k];
        if (c) return this.tile(c, last && pop && last.c.id === c.id ? ' fresh' : '');
        if (T.human && tier === run.tier && mine && fBy === null) return this.tile(f, ' ghost');
        return `<div class="tmd-tile blank${tier === run.tier ? ' now' : ''}">${tier}<small>费</small></div>`;
      }).join('');
      const bubble = last && last.team === t ? `<div class="tmd-bubble${pop ? ' pop' : ''}"><b>${T.name}</b>选了${last.c.name}</div>` : '';
      const turn = t === team ? (T.human ? '<em>轮到你</em>' : '<em>在选……</em>') : '';
      return `<div class="tmd-seat ${this.seatOf(t)}${t === team ? ' on' : ''}${T.human ? ' mine' : ''}" style="--t:${T.color}">
          <div class="tmd-lab"><span class="tmd-ord">${order.indexOf(t) + 1}</span><b>${T.name}${T.human ? '<small>（你）</small>' : ''}</b><span class="tmd-sum">${cost(t)} 费</span>${turn}</div>
          <div class="tmd-tiles">${tiles}</div>${bubble}
        </div>`;
    };

    const pool = run.pool.get(run.tier) ?? [];
    const free = pool.filter((c) => run.takenBy(c) === null).length;
    // 候选排一行；多了排两行、三行，每行差不多一样多
    const rows = pool.length <= 7 ? 1 : pool.length <= 16 ? 2 : 3;
    const tiles = pool
      .map((c) => {
        const by = run.takenBy(c);
        const tag = by !== null ? `<span class="tmd-tag" style="--t:${run.teams[by].color}">${run.teams[by].name}</span>` : '';
        const label = `${c.name}，${abil(c)}${by !== null ? `，${run.teams[by].name}已选` : ''}`;
        return this.tile(c, `${by !== null ? ' back' : ''}${c.id === f.id ? ' sel' : ''}`, ` data-team-focus="${c.id}" aria-label="${label}"`, tag);
      })
      .join('');
    const sides = (['n', 'w', 's', 'e'] as const)
      .map((d) => {
        const t = [0, 1, 2, 3].find((i) => this.seatOf(i) === d)!;
        const k = order.indexOf(t);
        return `<i class="${d}${k === run.turn ? ' on' : k < run.turn ? ' done' : ''}" style="--t:${run.teams[t].color}"></i>`;
      })
      .join('');

    const art = isSub(f) ? '' : `<img src="${cutinArt(f.id, 'ability').url}" alt="" onerror="this.remove()" />`;
    const stamp = fBy !== null ? `<div class="tmd-stamp" style="--t:${run.teams[fBy].color}">${run.teams[fBy].name}<small>已选</small></div>` : '';
    const go = mine
      ? `<button class="primary tmd-go" data-team="pick"${fBy !== null ? ' disabled' : ''}>${fBy !== null ? '已被选走' : '就选她'}</button>`
      : `<button class="primary tmd-go" disabled>${run.teams[team].name}在选……</button>`;
    const hint = mine ? (fBy !== null ? '换一位还没被选的' : `放进${me.name}的 ${run.tier} 费`) : '先看看，轮到你再选';

    this.root.innerHTML = `
      <div class="select-screen team-screen tm-draft">
        <div class="tmd-bar"><button class="lab-entry" data-team="exit">← 退出</button><h1>团体赛 · 选人</h1><span class="tmd-rule">每档每队选一人，正好 15 费 · 这一档${ccw ? '逆' : '顺'}时针轮，下一档反过来</span></div>
        ${[0, 1, 2, 3].filter((t) => !run.teams[t].human).map(seat).join('')}
        <div class="tmd-felt">
          <div class="tmd-compass">${sides}<div><div class="tmd-tier">${run.tier}<small>费</small></div><div class="tmd-no">第 <b>${no}</b> / ${TIERS.length * TEAMS.length} 手</div><div class="tmd-dir">${ccw ? '↺ 逆时针' : '↻ 顺时针'}</div></div></div>
          <div class="tmd-pool">
            <div class="tmd-pool-head"><b>${run.tier} 费档</b><span>${pool.length} 人 · 还剩 ${free} 人 · 点一下看能力${mine ? '，再点一下就选她' : ''}</span></div>
            <div class="tmd-grid" style="--cols:${Math.ceil(pool.length / rows)}">${tiles}</div>
          </div>
        </div>
        <div class="tmd-me">
          ${seat(run.human)}
          <div class="tmd-card${this.descOpen ? ' open' : ''}" style="--c:${f.color}"><div class="tmd-card-in">
            <div class="tmd-art"><span class="tmd-letter">${f.name.slice(-1)}</span>${art}${stamp}</div>
            <div class="tmd-info">
              <div class="tmd-nmr"><b class="tmd-name">${f.name}</b><span class="tmd-badge">${f.cost}<small>费</small></span><span class="tmd-school">${f.school}</span></div>
              <div class="tmd-abil">${abil(f)}</div>
              <p class="tmd-desc">${desc(f)}</p>
              <div class="tmd-acts">${go}<span class="tmd-hint">${hint}</span><button class="tmd-more" data-team="desc-more" hidden>${this.descOpen ? '收起' : '展开全文'}</button></div>
            </div>
          </div></div>
        </div>
      </div>`;
    this.fitDesc();
  }

  // 说明太长：先截住、淡出，给一个「展开全文」，展开时卡片往上长，盖住桌面
  private fitDesc(): void {
    const card = this.root.querySelector<HTMLElement>('.tmd-card');
    const desc = card?.querySelector<HTMLElement>('.tmd-desc');
    const more = card?.querySelector<HTMLElement>('.tmd-more');
    if (!card || !desc || !more) return;
    const clipped = this.descOpen || desc.scrollHeight > desc.clientHeight + 2;
    card.classList.toggle('clipped', clipped);
    more.hidden = !clipped;
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

  // App 打完一场：每个座位的点数、剩下的立直棒、白水哩拿到的钥匙
  afterMatch(seats: number[], scores: number[], riichiSticks: number, keys: BindKey[][]): void {
    this.run.finish(seats, scores, riichiSticks, keys);
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

  // 玩家选大卡上的那位。选上了返回 true
  private pickFocus(): boolean {
    const run = this.run;
    if (!this.focus || !run.pick(run.human, this.focus)) return false;
    this.armed = null;
    this.descOpen = false;
    this.pop = true;
    this.draft();
    return true;
  }

  private onClick = (e: Event): void => {
    if (!this.root.querySelector('.team-screen')) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-team],[data-team-focus],[data-team-pos]');
    if (!el) return;
    const run = this.run;
    if (el.dataset.teamFocus && this.screen === 'draft') {
      const id = el.dataset.teamFocus;
      // 像打麻将点牌：点一下抬起来看能力，再点一下就选她
      if (this.armed === id && this.focus === id && this.pickFocus()) return;
      if (this.focus !== id) this.descOpen = false;
      this.focus = id;
      this.armed = id;
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
        if (this.screen === 'draft') this.pickFocus();
        return;
      case 'desc-more':
        if (this.screen !== 'draft') return;
        this.descOpen = !this.descOpen;
        this.root.querySelector('.tmd-card')?.classList.toggle('open', this.descOpen);
        el.textContent = this.descOpen ? '收起' : '展开全文';
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
