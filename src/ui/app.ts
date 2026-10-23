import { CHARACTERS, Character } from '../abilities/characters';
import { chooseAction } from '../ai/ai';
import { Action, Game, GameEvent, RoundResult, WinInfo } from '../engine/game';
import { Meld } from '../engine/score';
import { TileId, WIND_CN, kindOf } from '../engine/tiles';
import { playCall, playChime, playClick, playRiichi, playWin } from './sound';
import { Table3D } from '../ui3d/table3d';
import { backHtml, tileHtml } from './tile';
import { meldLayout } from './meldLayout';
import { WaitInfo, hanLabel, waitInfo, waitStatus } from './waitInfo';

// 座位在画面上的位置：0 是自己（下），1 下家（右），2 对家（上），3 上家（左）
const POS = ['bottom', 'right', 'top', 'left'];

const AI_TURN_DELAY = 550;
// 3D 牌桌上角色要先伸手摸牌，节奏放慢一点
const AI_TURN_DELAY_3D = 1000;
const AI_CALL_DELAY = 250;

interface Toast {
  id: number;
  seat: number;
  text: string;
  big: boolean;
  kind: string; // riichi / call / kan / win 时有特效样式
}

export class App {
  private root: HTMLElement;
  private game: Game | null = null;
  private chars: Character[] = [];
  private readonly me = 0;
  private riichiMode = false;
  private toasts: Toast[] = [];
  private toastSeq = 0;
  private timer: number | null = null;
  private showResult = false;
  // 刚打出的牌只在第一次画出来时播放落桌动画，之后重绘不再重播
  private freshDiscard: string | null = null;
  private mode: '2d' | '3d' = '3d';
  private table3d: Table3D | null = null;

  // openLab：选人页上点"动作调试"时调用
  constructor(
    root: HTMLElement,
    private openLab: () => void,
  ) {
    this.root = root;
    root.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('resize', () => this.fit());
    // 大字特效用的书法字体先下好，免得第一次立直时字还没出来
    document.fonts?.load('1em "Ma Shan Zheng"', '立直碰吃杠荣和自摸暗加').catch(() => {});
    this.renderSelect();
    // 调试用：?debug 时可以在控制台里直接触发牌局事件看特效
    if (location.search.includes('debug')) (window as unknown as { app: App }).app = this;
  }

  // ---------- 选角色 ----------

  private renderSelect(): void {
    this.game = null;
    this.table3d?.dispose();
    this.table3d = null;
    const cards = CHARACTERS.map(
      (c) => `
      <button class="char-card" data-pick="${c.id}" style="--c:${c.color}">
        <div class="char-portrait">${c.name.slice(-1)}</div>
        <div class="char-name">${c.name}</div>
        <div class="char-school">${c.school}</div>
        <div class="char-ability">${c.ability ? c.ability.name : '无能力'}</div>
        <div class="char-desc">${c.ability ? c.ability.description : '不靠能力，只靠扎实的牌效和防守。电脑操作这个角色时不会失误。'}</div>
      </button>`,
    ).join('');
    this.root.innerHTML = `
      <div class="select-screen">
        <h1>超能力麻将</h1>
        <p class="subtitle">选择你的角色，其余三位由电脑操作。东风战，赤宝牌 3 张。</p>
        <div class="mode-switch">
          <button class="${this.mode === '3d' ? 'on' : ''}" data-ui="mode-3d">3D 牌桌</button>
          <button class="${this.mode === '2d' ? 'on' : ''}" data-ui="mode-2d">2D 牌桌</button>
        </div>
        <button class="lab-entry" data-ui="lab">动作调试</button>
        <div class="char-grid">${cards}</div>
        <p class="footnote">原型 · 角色与能力参考《天才麻将少女》，同人非商业作品<br />3D 人物由 VRoid 官方 CC0 示例模型改色</p>
      </div>`;
  }

  private startGame(charId: string): void {
    const mine = CHARACTERS.find((c) => c.id === charId)!;
    const others = CHARACTERS.filter((c) => c.id !== charId);
    this.chars = [mine, ...others];
    const seed = Math.floor(Math.random() * 2 ** 31);
    this.game = new Game({ seed, players: this.chars.map((c) => ({ name: c.name, ability: c.ability })) });
    this.game.onEvent((e) => this.onGameEvent(e));
    this.toasts = [];
    this.showResult = false;
    if (this.mode === '3d') {
      this.root.innerHTML = '<div class="stage3d"><div class="three" id="three"></div><div class="hud" id="hud"></div><div class="hud" id="toasts"></div></div>';
      this.table3d = new Table3D(document.getElementById('three')!, (id) => this.onTileClick(id));
      // 3D 牌桌上牌真正落到牌河时才响
      this.table3d.onMarker = (_seat, _tile, name) => {
        if (name === 'land') playClick();
      };
      // 第一局在牌桌建好之前就开始了，补一次开局动画
      this.table3d.onEvent({ type: 'roundStart', label: this.game.roundLabel() }, this.game);
    } else {
      this.root.innerHTML =
        '<div class="stage"><div class="table"><div id="table" style="display: contents"></div><div id="toasts"></div></div></div><div class="rotate-tip">手机横过来玩，牌会更大</div>';
      this.fit();
    }
    this.step();
  }

  private fit(): void {
    const table = document.querySelector<HTMLElement>('.stage .table');
    if (!table) return;
    const scale = Math.min(window.innerWidth / 1040, window.innerHeight / 800, 1.4);
    table.style.transform = `scale(${scale})`;
  }

  // ---------- 推进对局 ----------

  private step(): void {
    const g = this.game;
    if (!g) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (g.phase === 'roundEnd' || g.phase === 'gameEnd') {
      // 3D 牌桌先让大家看清倒牌和特效，再弹结算
      this.render();
      const wins = g.roundResult?.wins.length ?? 0;
      this.timer = window.setTimeout(
        () => {
          this.showResult = true;
          this.render();
        },
        this.mode === '3d' ? (wins ? 2400 : 1400) + this.busyMs() : 0,
      );
      return;
    }
    const waiting = g.waitingSeats();
    const ai = waiting.filter((s) => s !== this.me);
    // 先让电脑把自己的回应都做完，再等玩家
    if (g.phase === 'calls' && ai.length > 0) {
      this.render();
      // 荣和在牌落下的那一刻就喊出来，吃碰杠稍微想一下
      const ron = ai.some((s) => g.legalActions(s).some((a) => a.type === 'ron'));
      this.timer = window.setTimeout(() => {
        for (const s of ai) g.act(s, chooseAction(g, s, this.chars[s].ai));
        this.step();
      }, (ron ? 0 : AI_CALL_DELAY) + this.busyMs());
      return;
    }
    this.render();
    if (g.phase === 'turn' && g.turn !== this.me) {
      this.timer = window.setTimeout(() => {
        g.act(g.turn, chooseAction(g, g.turn, this.chars[g.turn].ai));
        this.step();
      }, (this.mode === '3d' ? AI_TURN_DELAY_3D : AI_TURN_DELAY) + this.busyMs());
      return;
    }
    if (g.phase === 'turn' && g.turn === this.me) {
      // 立直后没有别的选择时自动摸切
      const legal = g.legalActions(this.me);
      if (g.players[this.me].riichi && legal.length === 1) {
        this.timer = window.setTimeout(() => this.playerAct(legal[0]), 600);
      }
    }
  }

  private playerAct(a: Action): void {
    const g = this.game!;
    this.riichiMode = false;
    g.act(this.me, a);
    this.step();
  }

  private onGameEvent(e: GameEvent): void {
    this.table3d?.onEvent(e, this.game!);
    if (e.type === 'discard') {
      this.freshDiscard = `${e.seat}-${this.game!.players[e.seat].discards.length - 1}`;
      if (!this.table3d) playClick();
      if (e.riichi) {
        playRiichi();
        this.toast(e.seat, '立直', true, 'riichi');
      }
    } else if (e.type === 'call') {
      playCall();
      this.toast(e.seat, e.call, true, e.call.includes('杠') ? 'kan' : 'call');
    } else if (e.type === 'ability') {
      playChime();
      this.toast(e.seat, e.text, false);
    } else if (e.type === 'roundEnd') {
      if (e.result.wins.length) playWin();
      for (const w of e.result.wins) this.toast(w.seat, w.from === null ? '自摸' : '荣和', true, 'win');
    }
  }

  private toast(seat: number, text: string, big: boolean, kind = ''): void {
    const id = ++this.toastSeq;
    this.toasts.push({ id, seat, text, big, kind });
    this.renderToasts();
    window.setTimeout(
      () => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
        this.renderToasts();
      },
      kind === 'win' ? 2400 : big ? 1400 : 1800,
    );
  }

  // ---------- 点击 ----------

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pick],[data-tile],[data-act],[data-ui]');
    if (!el) return;
    if (el.dataset.pick) {
      this.startGame(el.dataset.pick);
      return;
    }
    if (el.dataset.ui === 'lab') {
      this.openLab();
      return;
    }
    if (el.dataset.ui === 'mode-3d' || el.dataset.ui === 'mode-2d') {
      this.mode = el.dataset.ui === 'mode-3d' ? '3d' : '2d';
      this.renderSelect();
      return;
    }
    const g = this.game;
    if (!g) return;
    if (el.dataset.ui === 'next') {
      this.showResult = false;
      g.nextRound();
      this.step();
      return;
    }
    if (el.dataset.ui === 'restart') {
      this.renderSelect();
      return;
    }
    if (el.dataset.ui === 'riichi') {
      this.riichiMode = !this.riichiMode;
      this.render();
      return;
    }
    if (el.dataset.tile !== undefined) {
      this.onTileClick(Number(el.dataset.tile));
      return;
    }
    const legal = g.legalActions(this.me);
    if (el.dataset.act !== undefined) {
      const a = legal[Number(el.dataset.act)];
      if (a) this.playerAct(a);
    }
  }

  // 3D 牌桌在掷骰子、发牌时，先等动画放完
  private busyMs(): number {
    return this.table3d?.busyMs() ?? 0;
  }

  private onTileClick(tile: TileId): void {
    const g = this.game;
    if (!g || this.busyMs() > 0) return;
    const a = g
      .legalActions(this.me)
      .find((x) => x.type === 'discard' && x.tile === tile && !!x.riichi === this.riichiMode);
    if (a) this.playerAct(a);
  }

  private discardable(): Set<TileId> {
    const legal = this.game!.legalActions(this.me);
    return new Set(
      legal.filter((a) => a.type === 'discard' && !!a.riichi === this.riichiMode).map((a) => (a as { tile: TileId }).tile),
    );
  }

  // ---------- 画面 ----------

  private render(): void {
    if (this.table3d) {
      this.render3d();
      return;
    }
    const g = this.game;
    const table = document.getElementById('table');
    if (!g || !table) return;
    table.innerHTML = `
      ${[1, 2, 3].map((s) => this.opponentHtml(s)).join('')}
      <div class="center">${this.centerHtml()}</div>
      ${[0, 1, 2, 3].map((s) => this.pondHtml(s)).join('')}
      ${this.myAreaHtml()}
      ${this.abilityPanelHtml()}
      ${this.showResult ? this.resultHtml() : ''}`;
    this.freshDiscard = null;
    this.renderToasts();
  }

  private render3d(): void {
    const g = this.game;
    const hud = document.getElementById('hud');
    if (!g || !hud || !this.table3d) return;
    const plates = [1, 2, 3]
      .map((s) => {
        const c = this.chars[s];
        return `<div class="nameplate float ${POS[s]}" style="--c:${c.color}"><div class="avatar">${c.name.slice(-1)}</div><div><div class="pname">${this.seatLabel(s)}</div><div class="pability">${c.ability?.name ?? '无能力'}</div></div></div>`;
      })
      .join('');
    hud.innerHTML = `
      ${plates}
      ${this.myAreaHtml(false)}
      ${this.abilityPanelHtml()}
      ${this.showResult ? this.resultHtml() : ''}`;
    this.renderToasts();
    this.table3d.sync(g, {
      me: this.me,
      clickable: g.phase === 'turn' && g.turn === this.me && !this.showResult ? this.discardable() : new Set(),
      colors: this.chars.map((c) => c.color),
      ids: this.chars.map((c) => c.id),
    });
  }

  private renderToasts(): void {
    const box = document.getElementById('toasts');
    if (!box) return;
    // 提示层不跟着画面重画，只增删变化的那几个，免得动画每次重画都从头播
    const live = new Set(this.toasts.map((t) => String(t.id)));
    for (const el of Array.from(box.children) as HTMLElement[]) if (!live.has(el.dataset.id!)) el.remove();
    for (const t of this.toasts) {
      if (box.querySelector(`[data-id="${t.id}"]`)) continue;
      box.insertAdjacentHTML(
        'beforeend',
        `<div data-id="${t.id}" class="toast ${POS[t.seat]} ${t.big ? 'big' : ''} ${t.kind ? `fx fx-${t.kind}` : ''}" style="--c:${this.chars[t.seat].color}"><span>${t.text}</span></div>`,
      );
    }
  }

  private seatLabel(s: number): string {
    const g = this.game!;
    return `${WIND_CN[g.seatWind(s) - 27]} ${this.chars[s].name}`;
  }

  private centerHtml(): string {
    const g = this.game!;
    const dora = [0, 1, 2, 3, 4]
      .map((i) => (i < g.wall.doraRevealed ? tileHtml(g.wall.doraIndicators[i], { size: 'mini' }) : backHtml('mini')))
      .join('');
    const scores = [0, 1, 2, 3]
      .map((s) => {
        const p = g.players[s];
        const active = g.phase === 'turn' && g.turn === s ? 'active' : '';
        return `<div class="score ${POS[s]} ${active}" style="--c:${this.chars[s].color}">
          <span class="wind">${WIND_CN[g.seatWind(s) - 27]}</span>
          <span class="pts">${p.score}</span>
          ${p.riichi ? '<span class="stick"></span>' : ''}
        </div>`;
      })
      .join('');
    return `
      <div class="round">${g.roundLabel()}</div>
      <div class="remain">余 ${g.wall.remaining}</div>
      <div class="sticks">立直棒 ×${g.riichiSticks}</div>
      <div class="dora">${dora}</div>
      ${scores}`;
  }

  private meldsHtml(melds: Meld[], seat: number): string {
    return melds.map((m) => `<div class="meld" title="${seat}">${meldTilesHtml(m, seat, 'pond')}</div>`).join('');
  }

  private opponentHtml(s: number): string {
    const g = this.game!;
    const p = g.players[s];
    const c = this.chars[s];
    const backs = p.hand.map(() => backHtml('pond')).join('');
    return `
      <div class="opponent ${POS[s]}" style="--c:${c.color}">
        <div class="nameplate">
          <div class="avatar">${c.name.slice(-1)}</div>
          <div><div class="pname">${this.seatLabel(s)}</div><div class="pability">${c.ability?.name ?? '无能力'}</div></div>
        </div>
        <div class="ohand">${backs}</div>
        <div class="melds">${this.meldsHtml(p.melds, s)}</div>
      </div>`;
  }

  private pondHtml(s: number): string {
    const g = this.game!;
    const p = g.players[s];
    const last = g.lastDiscard;
    const tiles = p.discards
      .map((d, i) => {
        const classes: string[] = [];
        if (d.called) classes.push('called');
        if (d.tsumogiri) classes.push('tsumogiri');
        if (last && last.seat === s && i === p.discards.length - 1) classes.push('last');
        if (this.freshDiscard === `${s}-${i}`) classes.push('fresh');
        return tileHtml(d.tile, { size: 'pond', sideways: d.riichi, classes });
      })
      .join('');
    return `<div class="pond ${POS[s]}">${tiles}</div>`;
  }

  private myAreaHtml(withHand = true): string {
    const g = this.game!;
    const p = g.players[this.me];
    const legal = g.legalActions(this.me);
    const discardable = this.discardable();
    const sorted = p.hand.filter((t) => t !== p.drawn).sort((a, b) => a - b);
    const hand = sorted
      .map((t) => tileHtml(t, { classes: discardable.has(t) ? ['can'] : ['dim'], data: { tile: t } }))
      .join('');
    const drawn =
      p.drawn !== null
        ? `<div class="drawn">${tileHtml(p.drawn, { classes: discardable.has(p.drawn) ? ['can'] : ['dim'], data: { tile: p.drawn } })}</div>`
        : '';

    const buttons: string[] = [];
    legal.forEach((a, i) => {
      const label = actionLabel(a);
      if (!label) return;
      // 吃、碰、杠的按钮上画出叫了以后的样子
      const called = g.lastDiscard;
      const tiles =
        (a.type === 'chi' || a.type === 'pon' || a.type === 'daiminkan') && called
          ? `<span class="meld">${meldTilesHtml(
              {
                type: a.type === 'daiminkan' ? 'minkan' : a.type,
                tiles: [...(a.type === 'daiminkan' ? p.hand.filter((t) => kindOf(t) === kindOf(called.tile)) : a.tiles), called.tile],
                calledTile: called.tile,
                from: called.seat,
              },
              this.me,
              'mini',
            )}</span>`
          : a.type === 'ankan'
            ? tileHtml(a.kind * 4 + 1, { size: 'mini' })
            : a.type === 'kakan'
              ? tileHtml(a.tile, { size: 'mini' })
              : '';
      buttons.push(`<button class="act ${a.type}" data-act="${i}">${label}${tiles}</button>`);
    });
    if (legal.some((a) => a.type === 'discard' && a.riichi)) {
      buttons.unshift(
        `<button class="act riichi ${this.riichiMode ? 'on' : ''}" data-ui="riichi">${this.riichiMode ? '取消立直' : '立直'}</button>`,
      );
    }

    const waitHtml = g.phase === 'turn' && g.turn === this.me ? '' : this.waitsHtml(waitInfo(g, this.me));
    const hint =
      g.phase === 'turn' && g.turn === this.me && discardable.size > 0
        ? `<div class="hint">${this.riichiMode ? '选择立直宣言牌' : '点击一张牌打出'}</div>`
        : '';
    const c = this.chars[this.me];
    return `
      <div class="me" style="--c:${c.color}">
        <div class="actions">${buttons.join('')}</div>
        ${waitHtml}${hint}
        ${
          withHand
            ? `<div class="hand-row">
          <div class="hand">${hand}${drawn}</div>
          <div class="melds">${this.meldsHtml(p.melds, this.me)}</div>
        </div>`
            : ''
        }
        <div class="nameplate mine"><div class="avatar">${c.name.slice(-1)}</div><div class="pname">${this.seatLabel(this.me)}</div></div>
      </div>`;
  }

  // 待和提示：每张待和牌下面写还剩几张、荣和几番；没役、只能自摸的写明白，和不了的变灰
  private waitsHtml(info: WaitInfo): string {
    if (!info.tiles.length) return '';
    const status = info.tiles.map((w) => waitStatus(w, info.furiten));
    const tiles = info.tiles
      .map((w, i) => {
        const st = status[i];
        const label = st === 'ron' ? hanLabel(w.ron!) : st === 'tsumo' ? '仅自摸' : '无役';
        const dead = st === 'none' || w.left === 0;
        return `<div class="wait${dead ? ' dead' : ''}">${tileHtml(w.kind * 4 + 1, { size: 'pond' })}<span class="wait-left">余 ${w.left}</span><span class="wait-han ${st}">${label}</span></div>`;
      })
      .join('');
    const title = status.every((st) => st === 'none') ? '形式听牌（无役）' : '听牌';
    return `<div class="waits"><div class="waits-title">${title}${info.furiten ? '<span class="furiten">振听</span>' : ''}</div><div class="wait-list">${tiles}</div></div>`;
  }

  private abilityPanelHtml(): string {
    const g = this.game!;
    const c = this.chars[this.me];
    if (!c.ability) {
      return `<div class="ability-panel" style="--c:${c.color}"><div class="ab-name">无能力</div><div class="ab-desc">不受影响，专心打牌。</div></div>`;
    }
    let extra = '';
    const fs = c.ability.foresight?.(g, this.me);
    if (fs) {
      extra = `<div class="foresight"><div class="fs-title">${fs.title}</div>${fs.draws
        .map(
          (d) =>
            `<div class="fs-row ${d.seat === this.me ? 'mine' : ''}"><span>${d.seat === this.me ? '你' : this.chars[d.seat].name}</span>${tileHtml(d.tile, { size: 'mini' })}</div>`,
        )
        .join('')}<div class="fs-note">有人鸣牌时顺序会变</div></div>`;
    }
    const lost = (g.abilityState[this.me] as { lost?: boolean }).lost;
    return `
      <div class="ability-panel" style="--c:${c.color}">
        <div class="ab-name">${c.ability.name}${lost ? '<span class="lost">本局失效</span>' : ''}</div>
        <div class="ab-desc">${c.ability.description}</div>
        ${extra}
      </div>`;
  }

  // ---------- 结算 ----------

  private resultHtml(): string {
    const g = this.game!;
    if (g.phase === 'gameEnd') return this.gameEndHtml();
    const r = g.roundResult!;
    const title = r.kind === 'win' ? '' : r.kind === 'exhaustive' ? '<h2>荒牌流局</h2>' : `<h2>途中流局：${r.reason}</h2>`;
    const wins = r.wins.map((w) => this.winHtml(w)).join('');
    const tenpai =
      r.kind === 'exhaustive'
        ? `<div class="tenpai-list">${[0, 1, 2, 3]
            .map((s) => `<span class="${r.tenpai[s] ? 'yes' : ''}">${this.chars[s].name}：${r.tenpai[s] ? '听牌' : '未听'}</span>`)
            .join('')}</div>`
        : '';
    return `
      <div class="modal"><div class="result">
        ${title}${wins}${tenpai}
        ${this.deltasHtml(r)}
        <button class="primary" data-ui="next">继续</button>
      </div></div>`;
  }

  private winHtml(w: WinInfo): string {
    const r = w.result;
    const how = w.from === null ? '自摸' : `荣和（${this.chars[w.from].name} 放铳）`;
    const hand = w.hand
      .filter((t) => t !== w.tile)
      .sort((a, b) => a - b)
      .map((t) => tileHtml(t, { size: 'pond' }))
      .join('');
    const yaku = r.yaku.map((y) => `<div class="yaku"><span>${y.name}</span><span>${r.yakuman ? '役满' : `${y.han} 番`}</span></div>`);
    if (r.dora) yaku.push(`<div class="yaku"><span>宝牌</span><span>${r.dora} 番</span></div>`);
    if (r.aka) yaku.push(`<div class="yaku"><span>赤宝牌</span><span>${r.aka} 番</span></div>`);
    if (r.ura) yaku.push(`<div class="yaku"><span>里宝牌</span><span>${r.ura} 番</span></div>`);
    const points = w.from === null ? '' : `${r.ron} 点`;
    const summary = r.yakuman ? r.limitName : `${r.han} 番 ${r.fu} 符 ${r.limitName}`;
    const ura = w.uraIndicators.length
      ? `<div class="ura">里宝牌指示牌 ${w.uraIndicators.map((t) => tileHtml(t, { size: 'mini' })).join('')}</div>`
      : '';
    return `
      <div class="win" style="--c:${this.chars[w.seat].color}">
        <h2>${this.chars[w.seat].name} ${how}</h2>
        <div class="win-hand">${hand}<span class="gap"></span>${tileHtml(w.tile, { size: 'pond', classes: ['win-tile'] })}<span class="gap"></span>${this.meldsHtml(w.melds, w.seat)}</div>
        ${ura}
        <div class="yaku-list">${yaku.join('')}</div>
        <div class="summary">${summary} ${points}</div>
      </div>`;
  }

  private deltasHtml(r: RoundResult): string {
    const g = this.game!;
    return `<div class="deltas">${[0, 1, 2, 3]
      .map((s) => {
        const d = r.deltas[s];
        const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
        return `<div class="delta"><span>${this.chars[s].name}</span><span class="${cls}">${d > 0 ? '+' : ''}${d || ''}</span><span>${g.players[s].score}</span></div>`;
      })
      .join('')}</div>`;
  }

  private gameEndHtml(): string {
    const g = this.game!;
    const rows = g
      .ranking()
      .map(
        (s, i) =>
          `<div class="rank-row ${s === this.me ? 'me' : ''}" style="--c:${this.chars[s].color}"><span class="rank">${i + 1} 位</span><span>${this.chars[s].name}</span><span>${g.players[s].score}</span></div>`,
      )
      .join('');
    return `
      <div class="modal"><div class="result">
        <h2>对局结束</h2>
        ${rows}
        <button class="primary" data-ui="restart">再来一局</button>
      </div></div>`;
  }
}

// 一组副露的牌：横着的、扣着的、加杠叠着的都按 meldLayout 摆
function meldTilesHtml(m: Meld, seat: number, size: 'pond' | 'mini'): string {
  return meldLayout(m, seat)
    .map((sl) => {
      if (sl.hidden) return backHtml(size);
      const tile = tileHtml(sl.tile, { size, sideways: sl.sideways });
      if (sl.stacked === undefined) return tile;
      return `<div class="meld-stack">${tileHtml(sl.stacked, { size, sideways: true })}${tile}</div>`;
    })
    .join('');
}

function actionLabel(a: Action): string {
  switch (a.type) {
    case 'tsumo':
      return '自摸';
    case 'ron':
      return '荣和';
    case 'pon':
      return '碰';
    case 'chi':
      return '吃';
    case 'daiminkan':
      return '杠';
    case 'ankan':
      return '暗杠';
    case 'kakan':
      return '加杠';
    case 'kyuushu':
      return '九种九牌';
    case 'pass':
      return '跳过';
    default:
      return '';
  }
}
