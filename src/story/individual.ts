import './bracket.css';
import './solo.css';
import { CHARACTERS, type Character } from '../abilities/characters';
import { portraitUrl } from '../ui3d/looks';
import { SCHOOLS, membersOf } from '../ui/schools';
import { BgRunner, type BgJob } from './bgRunner';
import type { HanchanSim } from './hanchanSim';
import {
  advance,
  charOf,
  createLeague,
  FINAL_TABLE,
  FINALISTS,
  inFinal,
  isSeed,
  type League,
  loadLeague,
  myPlace,
  myTable,
  netOf,
  pendingOthers,
  PLAYERS,
  PRELIM_ROUNDS,
  reportMine,
  retryMine,
  roundDone,
  roundName,
  roundTables,
  saveLeague,
  setResult,
  tableSim,
  TOTAL_ROUNDS,
} from './league';
import { fmtPts, soloHtml } from './soloView';
import type { HandEvent } from './hands';
import { bubbleHint, isFocus, latestNews, tableTags } from './news';
import { tabsHtml } from './tabs';

// 全国大赛个人赛（全国大赛里的第二个页签）：
// 1. 报名：从全部角色里挑一位（上一届没打完的话直接接着打）
// 2. 预赛 6 轮：每轮一个半庄，玩家那桌自己打（App 的牌桌，规则固定）或者交给电脑，别桌在后台真打（BgRunner）
// 3. 预赛前 4 名进决赛桌，积分清零再打两个半庄定冠军；没进决赛就接着看
// 4. 每一场都能重打（只换自己那桌）；打完或者放弃以后可以重新报名
// 点击用 data-solo，只在自己的画面（.solo-screen）上才管

export interface SoloHooks {
  // 打玩家那一场：chars 是这一桌四个人（按 seats 的顺序），me 是玩家坐第几个；
  // info.label 是「第 3 轮 · A 桌」之类，info.finale：焦点桌、决赛桌（放决战的音乐），info.final：决赛桌（牌桌四周换成决赛舞台）。
  // App 打完后调 done(四个人按同样顺序的终局点数, 这一场的和牌)；中途离开就不调
  playHanchan?(chars: Character[], me: number, info: { label: string; finale: boolean; final?: boolean }, done: (scores: number[], hands: HandEvent[]) => void): void;
  // 切到团体赛页签
  switchTab?(): void;
  exit(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class IndividualFlow {
  private l: League | null = loadLeague();
  private screen: 'pick' | 'board' = 'pick';
  private picked: string | null = null;
  private fresh = new Set<string>();
  private restartArmed = 0; // 点过一次「重新报名」的时间：3 秒内再点一下才真的放弃这一届
  private runner = new BgRunner<HanchanSim>((j) => this.jobDone(j));
  private liveTimer: number | null = null;
  private newsSeen = ''; // 上次画的快报：一样就不再一条条亮起来

  constructor(
    private root: HTMLElement,
    private hooks: SoloHooks,
  ) {
    root.addEventListener('click', this.onClick);
    this.picked = this.l?.players[this.l.mine].id ?? null;
    if (this.l && !this.l.podium) this.showBoard();
    else this.showPick();
  }

  // 离开个人赛：后台不再算，点击不再管
  dispose(): void {
    this.runner.stop();
    if (this.liveTimer !== null) clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.root.removeEventListener('click', this.onClick);
  }

  // 从牌桌回来
  show(): void {
    if (this.l) this.showBoard();
    else this.showPick();
  }

  private top(title: string, sub: string, buttons: string): string {
    return `${tabsHtml('solo', 'data-solo')}<header class="bk-top">
        <div><h1>${title}</h1><p>${sub}</p></div>
        <div class="bk-top-btns">${buttons}<button class="bk-btn ghost" data-solo="exit">返回</button></div>
      </header>`;
  }

  // ---------- 报名 ----------

  private showPick(): void {
    this.screen = 'pick';
    this.runner.hurry(false);
    const schools = SCHOOLS.map((s) => {
      const who = membersOf(s.name)
        .map((c) => {
          const on = this.picked === c.id;
          const rep = isSeed(c.id) ? '<b class="ip-rep">种子</b>' : '';
          return `<button class="ip-who${on ? ' on' : ''}" data-solo="pick" data-id="${c.id}" aria-pressed="${on}" title="${esc(c.name)}（${c.cost} 费）">${rep}<span class="ip-face" style="--c:${c.color}"><span>${c.name.slice(-1)}</span><img src="${portraitUrl(c.id, 'neutral')}" alt="" onerror="this.remove()" /></span><small>${esc(c.name)}</small></button>`;
        })
        .join('');
      return `<div class="ip-school" style="--s:${s.color}"><h4>${esc(s.short)}<small>${s.region ? `${s.region}代表` : ''}</small></h4><div class="ip-who-row">${who}</div></div>`;
    }).join('');
    const l = this.l;
    const last = l?.podium ? `<p class="np-last">上一届冠军：${esc(l.players[l.podium[0]].name)}${l.podium[0] === l.mine ? '（就是你！）' : `；${esc(l.players[l.mine].name)}第 ${myPlace(l)} 名`}</p>` : '';
    const who = CHARACTERS.find((c) => c.id === this.picked);
    const note = who ? `以<b>${esc(who.name)}</b>报名${isSeed(who.id) ? '（种子选手）' : ''}。其余选手抽签决定，每届都不一样。` : '点一位选手。';
    this.root.innerHTML = `<div class="story-screen solo-screen ip-screen">
      ${this.top('全国高中麻将大赛 · 个人赛报名', `${PLAYERS} 人参赛：标了「种子」的 8 人每届必定参赛，其余位子每届从别的角色里抽签。你挑的人一定参赛。`, '')}${last}
      <p class="ip-rules">预赛打 <b>6 轮</b>半庄，第 1 轮抽签，之后每轮按积分重新分桌（1–4 名一桌、5–8 名一桌……）。每场积分 =（终局点数 − 25000）÷ 1000，加起来排名。预赛前 <b>${FINALISTS} 名</b>进决赛桌，积分清零再打 <b>2 个半庄</b>定冠军。每场规则固定：半庄、25000 点起、击飞、赤宝牌 3 张、食断、一番缚，剩下的立直棒归第一。</p>
      <div class="ip-pick-grid">${schools}</div>
      <footer class="bk-bar"><span>${note}</span><div><button class="bk-btn" data-solo="enter"${this.picked ? '' : ' disabled'}>报名，抽签</button></div></footer>
    </div>`;
  }

  // ---------- 积分榜 ----------

  private showBoard(): void {
    const l = this.l!;
    this.screen = 'board';
    this.queueOthers();
    const s = this.status();
    this.runner.hurry(s.wait);
    const btns = s.buttons.map(([k, label, ghost]) => `<button class="bk-btn${ghost ? ' ghost' : ''}" data-solo="${k}">${label}</button>`).join('');
    const me = l.players[l.mine];
    const where = l.podium ? `最终第 ${myPlace(l)} 名` : l.round >= PRELIM_ROUNDS ? (inFinal(l) ? '决赛桌' : `预赛第 ${myPlace(l)} 名`) : l.round > 0 ? `现在第 ${myPlace(l)} 名` : roundName(0);
    this.watchLive();
    const news = JSON.stringify(latestNews(l));
    this.root.innerHTML = `<div class="story-screen solo-screen board-screen">
      ${this.top('全国高中麻将大赛 · 个人赛', `<b class="bk-dot" style="background:${me.color}"></b> ${esc(me.name)} · ${esc(me.short)} · ${where} · 重打 ${l.retries} 次`, '<button class="bk-btn ghost" data-solo="restart">重新报名</button>')}
      ${soloHtml(l, this.fresh, this.live(), news === this.newsSeen)}
      <footer class="bk-bar"><span>${s.text}</span><div>${btns}</div></footer>
    </div>`;
    // 刚出结果的桌只亮这一次：后面别桌出结果重画时不再从头播
    this.fresh.clear();
    this.newsSeen = news;
  }

  // 「进行中 · 南 2 局」跟着后台的进度走：每半秒换一下字（不重画整页，免得按钮在手底下换掉）
  private watchLive(): void {
    if (this.liveTimer !== null) return;
    this.liveTimer = window.setInterval(() => {
      const screen = this.root.querySelector('.solo-screen.board-screen');
      if (!screen || !this.runner.busy) {
        if (this.liveTimer !== null) clearInterval(this.liveTimer);
        this.liveTimer = null;
        return;
      }
      for (const [name, label] of this.live()) {
        const el = [...screen.querySelectorAll<HTMLElement>('[data-solo-table]')].find((x) => x.dataset.soloTable === name)?.querySelector('.bk-live');
        if (el) el.textContent = `进行中 · ${label}`;
      }
      const l = this.l;
      const mine = l && myTable(l);
      const auto = mine && this.runner.progress().get(this.key(mine.round, mine.name));
      const bar = screen.querySelector('.bk-bar span');
      if (auto && bar) bar.textContent = `电脑在替${l!.players[l!.mine].name}打 · ${auto}…`;
    }, 500);
  }

  // 后台在打的桌：桌名 → 打到哪了
  private live(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, v] of this.runner.progress()) m.set(k.split('|')[1], v);
    return m;
  }

  private key(round: number, name: string): string {
    return `${this.l!.seed}:${round}|${name}`;
  }

  private queueOthers(): void {
    const l = this.l!;
    if (l.podium) return;
    this.runner.add(pendingOthers(l).map((t) => ({ key: this.key(t.round, t.name), sim: tableSim(l, t) })));
  }

  private jobDone(j: BgJob<HanchanSim>): void {
    const l = this.l;
    if (!l) return;
    const [head, name] = j.key.split('|');
    const t = roundTables(l).find((x) => x.name === name);
    // 已经换了一届、或者这一场已经过去了：丢掉
    if (!t || head !== `${l.seed}:${t.round}` || t.scores || !j.sim.scores) return;
    setResult(t, j.sim.scores, j.sim.hands);
    this.fresh.add(t.name);
    saveLeague(l);
    if (this.screen === 'board' && this.root.querySelector('.solo-screen')) this.showBoard();
  }

  private status(): { text: string; buttons: [string, string, boolean?][]; wait: boolean } {
    const l = this.l!;
    const me = esc(l.players[l.mine].name);
    const name = (p: number) => esc(l.players[p].name);
    if (l.podium) {
      const won = l.podium[0] === l.mine;
      const podium = l.podium.slice(0, 3).map((p, i) => `${['冠军', '亚军', '季军'][i]} ${name(p)}`).join('，');
      return { text: won ? `${me}拿下全国个人赛冠军！${podium}。` : `${podium}。${me}最终第 ${myPlace(l)} 名。`, buttons: [['restart', '再报名一届']], wait: false };
    }
    const left = pendingOthers(l).length;
    const waiting = left ? `别桌还在打，剩 ${left} 桌…` : '';
    const round = roundName(l.round);
    const nextLabel = l.round < PRELIM_ROUNDS - 1 ? `进入${roundName(l.round + 1)}` : l.round === PRELIM_ROUNDS - 1 ? '公布决赛名单' : l.round < TOTAL_ROUNDS - 1 ? `决赛第 ${l.round - PRELIM_ROUNDS + 2} 场` : '颁奖';
    const next: [string, string] = ['next', nextLabel];
    const t = myTable(l);
    if (!t) {
      // 没进决赛：接着看
      return { text: `${me}预赛第 ${myPlace(l)} 名，没进决赛桌。${round}：${waiting || '这一场打完了。'}`, buttons: roundDone(l) ? [next] : [], wait: !!left };
    }
    if (!t.scores) {
      const auto = this.runner.progress().get(this.key(t.round, t.name));
      if (auto) return { text: `电脑在替${me}打 · ${auto}…`, buttons: [], wait: true };
      const rivals = t.seats.filter((p) => p !== l.mine).map(name).join('、');
      const play: [string, string][] = this.hooks.playHanchan ? [['play', '上场']] : [];
      const tags = tableTags(l, t).map((x) => `<b class="ip-tag">${x.label}</b>${esc(x.note)}。`).join('');
      const focus = isFocus(t) && t.name !== '决赛桌' ? '<b class="ip-live">LIVE</b>焦点桌。' : '';
      const bubble = bubbleHint(l);
      return { text: `${round}${l.round < PRELIM_ROUNDS ? ` · ${esc(t.name)}` : ''}：${me}对${rivals}。${focus}${tags}${bubble ? `<br><b class="ip-tag bubble">卡线</b>${esc(bubble)}` : ''}`, buttons: [['auto', '交给电脑打', true], ...play], wait: false };
    }
    const net = netOf(t, l.mine)!;
    const place = [...t.scores].sort((a, b) => b - a).indexOf(t.scores[t.seats.indexOf(l.mine)]) + 1;
    const head = `${round}${me}第 ${place} 位，${fmtPts(net)}。`;
    const retry: [string, string, boolean] = ['retry', '重打这一场', true];
    if (!roundDone(l)) return { text: `${head}${waiting}`, buttons: [retry], wait: true };
    const rank = l.round < PRELIM_ROUNDS ? `现在第 ${myPlace(l)} 名。` : '';
    return { text: `${head}${rank}`, buttons: [retry, next], wait: false };
  }

  // ---------- 打玩家那一场 ----------

  private playMine(): void {
    const l = this.l!;
    const t = myTable(l);
    if (!t || t.scores) return;
    const round = l.round;
    const label = round < PRELIM_ROUNDS ? `${roundName(round)} · ${t.name}${isFocus(t) ? '（焦点桌）' : ''}` : roundName(round);
    this.hooks.playHanchan?.(
      t.seats.map((p) => charOf(l, p)),
      t.seats.indexOf(l.mine),
      { label, finale: isFocus(t), final: t.name === FINAL_TABLE },
      (scores, hands) => {
        // 打完回来时已经不是这一届、这一场（中途重新报名之类）：不算
        if (this.l !== l || l.round !== round || t.scores) return;
        reportMine(l, scores, hands);
        this.fresh.add(t.name);
        saveLeague(l);
      },
    );
  }

  // 交给电脑打：玩家那桌也在后台真打（重打过的换个种子）
  private autoMine(): void {
    const l = this.l!;
    const t = myTable(l);
    if (!t || t.scores) return;
    this.runner.add([{ key: this.key(t.round, t.name), sim: tableSim(l, t, l.retries) }]);
    this.runner.hurry(true);
  }

  // ---------- 点击 ----------

  private onClick = (e: Event): void => {
    if (!this.root.querySelector('.solo-screen')) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-solo]');
    if (!el) return;
    const a = el.dataset.solo;
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
    if (a === 'pick' && el.dataset.id) {
      this.picked = el.dataset.id;
      this.showPick();
      return;
    }
    if (a === 'enter' && this.picked) {
      this.runner.stop();
      this.fresh.clear();
      this.l = createLeague((Math.random() * 2 ** 32) >>> 0, this.picked);
      saveLeague(this.l);
      this.showBoard();
      return;
    }
    if (a === 'restart') {
      if (this.l && !this.l.podium && Date.now() - this.restartArmed > 3000) {
        this.restartArmed = Date.now();
        el.textContent = '再点一下，放弃这一届';
        return;
      }
      this.restartArmed = 0;
      this.runner.stop();
      this.fresh.clear();
      this.picked = this.l ? this.l.players[this.l.mine].id : this.picked;
      if (this.l && !this.l.podium) {
        this.l = null;
        saveLeague(null);
      }
      this.showPick();
      return;
    }
    const l = this.l;
    if (!l) return;
    this.fresh.clear();
    if (a === 'play') return this.playMine();
    if (a === 'auto') this.autoMine();
    if (a === 'retry') retryMine(l);
    if (a === 'next') {
      advance(l);
      // 预赛刚打完：决赛桌亮一下
      if (l.round === PRELIM_ROUNDS || l.podium) this.fresh.add('决赛桌');
    }
    saveLeague(l);
    this.showBoard();
  };
}
