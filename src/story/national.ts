import './bracket.css';
import { POSITIONS, TeamRun } from '../team/team';
import { portraitUrl } from '../ui3d/looks';
import { SCHOOLS, membersOf } from '../ui/schools';
import { BgRunner, type BgJob } from './bgRunner';
import {
  advance,
  type Bracket,
  createBracket,
  HALVES,
  halfOf,
  lineupOf,
  loadBracket,
  myOut,
  myTable,
  pendingOthers,
  PLAYABLE_SCHOOLS,
  reportMine,
  ROUNDS,
  retryMine,
  roundDone,
  roundTables,
  saveBracket,
  setResult,
  tableSim,
} from './bracket';
import { bracketHtml } from './bracketView';
import { tabsHtml } from './tabs';

// 全国大赛团体赛（主页白板纸上的第三行进来，顶上的页签可以切到个人赛 individual.ts）：
// 1. 报名：从 13 所原作学校里挑一所（上一届没打完的话直接接着打）
// 2. 抽签：16 校分东西两区（bracket.ts）
// 3. 每一轮：玩家那桌自己打（App 的团体赛画面：布阵、上场、托管），别桌在后台真打（BgRunner）
// 4. 输了可以重打这一场；夺冠或者出局后可以重新报名
// 点击用 data-story，只在自己的画面（.national-screen）上才管

export interface NationalHooks {
  // 打玩家那一桌：App 用团体赛画面打完后调 done(四所学校按桌上顺序的点数)；中途退出就不调。
  // where：第几轮（ROUNDS 里的名字）、哪一桌、是不是总决赛（牌桌四周摆哪种场地、牌子上写什么）
  playTable?(run: TeamRun, done: (points: number[]) => void, where?: { round: string; table: string; final: boolean }): void;
  // 切到个人赛页签
  switchTab?(): void;
  exit(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class NationalFlow {
  private b: Bracket | null = loadBracket();
  private screen: 'pick' | 'bracket' = 'pick';
  private picked: string | null = null;
  private fresh = new Set<string>();
  private restartArmed = 0; // 点过一次「重新报名」的时间：3 秒内再点一下才真的放弃这一届
  private runner = new BgRunner((j) => this.jobDone(j));

  constructor(
    private root: HTMLElement,
    private hooks: NationalHooks,
  ) {
    root.addEventListener('click', this.onClick);
    if (this.b && !this.b.champion) this.showBracket();
    else this.showPick();
  }

  // 离开全国大赛：后台不再算，点击不再管
  dispose(): void {
    this.runner.stop();
    if (this.liveTimer !== null) clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.root.removeEventListener('click', this.onClick);
  }

  // 从团体赛画面回来
  show(): void {
    if (this.b) this.showBracket();
    else this.showPick();
  }

  // ---------- 报名 ----------

  private showPick(): void {
    this.screen = 'pick';
    this.runner.hurry(false);
    const cards = PLAYABLE_SCHOOLS.map((name) => {
      const s = SCHOOLS.find((x) => x.name === name)!;
      const members = membersOf(name).slice(0, POSITIONS.length);
      const cost = members.reduce((a, c) => a + c.cost, 0);
      const minis = members
        .map(
          (c, p) =>
            `<span class="np-mini" style="--c:${c.color}" title="${POSITIONS[p]} ${esc(c.name)}"><span>${c.name.slice(-1)}</span><img src="${portraitUrl(c.id, 'neutral')}" alt="" onerror="this.remove()" /></span>`,
        )
        .join('');
      const names = members.map((c, p) => `<li><small>${POSITIONS[p]}</small>${esc(c.name)}</li>`).join('');
      const on = this.picked === name;
      return `<button class="np-card${on ? ' on' : ''}" data-story="pick" data-school="${esc(name)}" aria-pressed="${on}" style="--s:${s.color}">
        <span class="np-name">${esc(name)}</span>
        <span class="np-region">${s.region ? `${s.region}代表 · ` : ''}合计 ${cost} 费</span>
        <span class="np-minis">${minis}</span>
        <ol class="np-list">${names}</ol>
      </button>`;
    }).join('');
    const last = this.b?.champion ? `<p class="np-last">上一届冠军：${esc(this.b.entrants[this.b.champion].name)}${this.b.champion === this.b.mine ? '（就是你们！）' : ''}</p>` : '';
    this.root.innerHTML = `<div class="story-screen national-screen np-screen">
      ${tabsHtml('team', 'data-story')}<header class="bk-top">
        <div><h1>全国高中麻将大赛 · 报名</h1><p>选一所学校出战。十六校抽签分进东西两区，每桌四校，前两名晋级，一路打到总决赛。</p>${last}</div>
        <button class="bk-btn ghost" data-story="exit">返回</button>
      </header>
      <div class="np-grid">${cards}</div>
      <footer class="bk-bar"><span>${this.picked ? `以<b>${esc(this.picked)}</b>报名。另外三所虚拟学校没有能力，抽签时一起进签筒。` : '点一所学校。'}</span>
        <div><button class="bk-btn" data-story="enter"${this.picked ? '' : ' disabled'}>报名，抽签</button></div></footer>
    </div>`;
  }

  // ---------- 晋级表 ----------

  private showBracket(): void {
    const b = this.b!;
    this.screen = 'bracket';
    // 这一轮还没出结果的别桌：交给后台
    this.queueOthers();
    const s = this.status();
    this.runner.hurry(s.wait);
    const btns = s.buttons.map(([k, label, ghost]) => `<button class="bk-btn${ghost ? ' ghost' : ''}" data-story="${k}">${label}</button>`).join('');
    const mine = b.entrants[b.mine];
    this.watchLive();
    this.root.innerHTML = `<div class="story-screen national-screen bracket-screen">
      ${tabsHtml('team', 'data-story')}<header class="bk-top">
        <div><h1>全国高中麻将大赛 · 团体赛</h1><p><b class="bk-dot" style="background:${mine.color}"></b> ${esc(mine.name)} · ${HALVES[halfOf(b, b.mine)]} · 重打 ${b.retries} 次</p></div>
        <div class="bk-top-btns"><button class="bk-btn ghost" data-story="restart">重新报名</button><button class="bk-btn ghost" data-story="exit">返回</button></div>
      </header>
      ${bracketHtml(b, this.fresh, this.live())}
      <footer class="bk-bar"><span>${s.text}</span><div>${btns}</div></footer>
    </div>`;
  }

  // 晋级表上「进行中 · 中坚战」跟着后台的进度走：每半秒换一下字（不重画整页，免得按钮在手底下换掉）
  private liveTimer: number | null = null;
  private watchLive(): void {
    if (this.liveTimer !== null) return;
    this.liveTimer = window.setInterval(() => {
      const screen = this.root.querySelector('.national-screen.bracket-screen');
      if (!screen || !this.runner.busy) {
        if (this.liveTimer !== null) clearInterval(this.liveTimer);
        this.liveTimer = null;
        return;
      }
      for (const [name, label] of this.live()) {
        const el = [...screen.querySelectorAll<HTMLElement>('[data-story-table]')].find((x) => x.dataset.storyTable === name)?.querySelector('.bk-live');
        if (el) el.textContent = `进行中 · ${label}`;
      }
      const mine = this.b && myTable(this.b);
      const auto = mine && this.runner.progress().get(this.key(mine.round, mine.name));
      const bar = screen.querySelector('.bk-bar span');
      if (auto && bar) bar.textContent = `电脑在替${this.b!.entrants[this.b!.mine].short}打 · ${auto}…`;
    }, 500);
  }

  // 后台在打的桌：桌名 → 打到哪了
  private live(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, v] of this.runner.progress()) m.set(k.split('|')[1], v);
    return m;
  }

  private key(round: number, name: string): string {
    return `${this.b!.seed}:${round}|${name}`;
  }

  private queueOthers(): void {
    const b = this.b!;
    if (b.champion) return;
    this.runner.add(pendingOthers(b).map((t) => ({ key: this.key(t.round, t.name), sim: tableSim(b, t) })));
  }

  private jobDone(j: BgJob): void {
    const b = this.b;
    if (!b) return;
    const [head, name] = j.key.split('|');
    const t = roundTables(b).find((x) => x.name === name);
    // 已经换了一届、或者这一轮已经过去了：丢掉
    if (!t || head !== `${b.seed}:${t.round}` || t.result) return;
    setResult(b, t, j.sim.points);
    this.fresh.add(t.name);
    saveBracket(b);
    if (this.screen === 'bracket' && this.root.querySelector('.national-screen')) this.showBracket();
  }

  private status(): { text: string; buttons: [string, string, boolean?][]; wait: boolean } {
    const b = this.b!;
    const short = (s: string) => esc(b.entrants[s].short);
    const me = short(b.mine);
    if (b.champion) {
      const won = b.champion === b.mine;
      return { text: won ? `${me}拿下全国冠军！` : `冠军是${short(b.champion)}。`, buttons: [['restart', '再报名一届']], wait: false };
    }
    const left = pendingOthers(b).length;
    const waiting = left ? `别桌还在打，剩 ${left} 桌…` : '';
    const round = ROUNDS[b.round];
    const t = myTable(b);
    const next: [string, string] = ['next', b.round === ROUNDS.length - 1 ? '颁奖' : `进入${ROUNDS[b.round + 1]}`];
    if (!t) {
      // 已经出局：接着看别人打
      return { text: `${me}已经出局，接着看这一届打完。${waiting}`, buttons: roundDone(b) ? [next] : [], wait: !!left };
    }
    if (!t.result) {
      const auto = this.runner.progress().get(this.key(t.round, t.name));
      if (auto) return { text: `电脑在替${me}打 · ${auto}…`, buttons: [], wait: true };
      const rivals = t.schools.filter((s) => s !== b.mine).map(short).join('、');
      const play: [string, string][] = this.hooks.playTable ? [['play', '上场']] : [];
      return { text: `${round} · ${esc(t.name)}：${me}对${rivals}。`, buttons: [['auto', '交给电脑打', true], ...play], wait: false };
    }
    if (myOut(b)) {
      const place = t.result.order.indexOf(t.schools.indexOf(b.mine)) + 1;
      const end = b.round === ROUNDS.length - 1 ? '没能夺冠' : '没能晋级';
      return { text: `${round}${me}第 ${place} 名，${end}。可以重打这一场，也可以接受结果看下去。${waiting}`, buttons: [['retry', '重打这一场'], ...(roundDone(b) ? [next] : [])], wait: !!left };
    }
    if (!roundDone(b)) return { text: `${me}晋级了！${waiting}`, buttons: [], wait: true };
    return { text: b.round === ROUNDS.length - 1 ? `${me}赢下总决赛！` : `${round}${me}晋级！`, buttons: [next], wait: false };
  }

  // ---------- 打玩家那桌 ----------

  private playMine(): void {
    const b = this.b!;
    const t = myTable(b);
    if (!t || t.result) return;
    const teams = t.schools.map((s) => ({ name: b.entrants[s].short, color: b.entrants[s].color, lineup: lineupOf(b, s) }));
    const run = TeamRun.preset(Math.floor(Math.random() * 2 ** 31), teams, t.schools.indexOf(b.mine));
    const round = b.round;
    this.hooks.playTable?.(
      run,
      (points) => {
        // 打完回来时已经不是这一届、这一轮（中途重新报名之类）：不算
        if (this.b !== b || b.round !== round || t.result) return;
        reportMine(b, points);
        this.fresh.add(t.name);
        saveBracket(b);
      },
      { round: ROUNDS[round], table: t.name, final: round === ROUNDS.length - 1 },
    );
  }

  // 交给电脑打：玩家那桌也在后台真打
  private autoMine(): void {
    const b = this.b!;
    const t = myTable(b);
    if (!t || t.result) return;
    this.runner.add([{ key: this.key(t.round, t.name), sim: tableSim(b, t, b.retries) }]);
    this.runner.hurry(true);
  }

  // ---------- 点击 ----------

  private onClick = (e: Event): void => {
    if (!this.root.querySelector('.national-screen')) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-story]');
    if (!el) return;
    const a = el.dataset.story;
    if (a === 'exit') {
      this.runner.hurry(false);
      this.hooks.exit();
      return;
    }
    if (a === 'tab') {
      this.runner.hurry(false);
      this.hooks.switchTab?.();
      return;
    }
    if (a === 'pick' && el.dataset.school) {
      this.picked = el.dataset.school;
      this.showPick();
      return;
    }
    if (a === 'enter' && this.picked) {
      this.runner.stop();
      this.fresh.clear();
      this.b = createBracket((Math.random() * 2 ** 32) >>> 0, this.picked);
      saveBracket(this.b);
      this.showBracket();
      return;
    }
    if (a === 'restart') {
      if (this.b && !this.b.champion && Date.now() - this.restartArmed > 3000) {
        this.restartArmed = Date.now();
        el.textContent = '再点一下，放弃这一届';
        return;
      }
      this.restartArmed = 0;
      this.runner.stop();
      this.fresh.clear();
      this.picked = this.b?.mine ?? null;
      if (this.b && !this.b.champion) {
        this.b = null;
        saveBracket(null);
      }
      this.showPick();
      return;
    }
    const b = this.b;
    if (!b) return;
    this.fresh.clear();
    if (a === 'play') return this.playMine();
    if (a === 'auto') this.autoMine();
    if (a === 'retry') retryMine(b);
    if (a === 'next') advance(b);
    saveBracket(b);
    this.showBracket();
  };
}
