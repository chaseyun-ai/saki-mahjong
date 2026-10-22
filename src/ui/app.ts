import { CHARACTERS, Character } from '../abilities/characters';
import { chooseAction } from '../ai/ai';
import { Action, Game, GameEvent, RoundResult, WinInfo } from '../engine/game';
import { Meld } from '../engine/score';
import { TileId, WIND_CN, kindLabel } from '../engine/tiles';
import { playClick, playChime } from './sound';
import { backHtml, tileHtml } from './tile';

// 座位在画面上的位置：0 是自己（下），1 下家（右），2 对家（上），3 上家（左）
const POS = ['bottom', 'right', 'top', 'left'];

const AI_TURN_DELAY = 550;
const AI_CALL_DELAY = 250;

interface Toast {
  id: number;
  seat: number;
  text: string;
  big: boolean;
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

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('resize', () => this.fit());
    this.renderSelect();
  }

  // ---------- 选角色 ----------

  private renderSelect(): void {
    this.game = null;
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
        <div class="char-grid">${cards}</div>
        <p class="footnote">2D 原型 · 角色与能力参考《天才麻将少女》，同人非商业作品</p>
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
    this.root.innerHTML =
      '<div class="stage"><div class="table" id="table"></div></div><div class="rotate-tip">手机横过来玩，牌会更大</div>';
    this.fit();
    this.step();
  }

  private fit(): void {
    const table = document.getElementById('table');
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
      this.showResult = true;
      this.render();
      return;
    }
    const waiting = g.waitingSeats();
    const ai = waiting.filter((s) => s !== this.me);
    // 先让电脑把自己的回应都做完，再等玩家
    if (g.phase === 'calls' && ai.length > 0) {
      this.render();
      this.timer = window.setTimeout(() => {
        for (const s of ai) g.act(s, chooseAction(g, s, this.chars[s].ai));
        this.step();
      }, AI_CALL_DELAY);
      return;
    }
    this.render();
    if (g.phase === 'turn' && g.turn !== this.me) {
      this.timer = window.setTimeout(() => {
        g.act(g.turn, chooseAction(g, g.turn, this.chars[g.turn].ai));
        this.step();
      }, AI_TURN_DELAY);
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
    if (e.type === 'discard') {
      playClick();
      if (e.riichi) this.toast(e.seat, '立直', true);
    } else if (e.type === 'call') {
      playClick();
      this.toast(e.seat, e.call, true);
    } else if (e.type === 'ability') {
      playChime();
      this.toast(e.seat, e.text, false);
    } else if (e.type === 'roundEnd') {
      for (const w of e.result.wins) this.toast(w.seat, w.from === null ? '自摸' : '荣和', true);
    }
  }

  private toast(seat: number, text: string, big: boolean): void {
    const id = ++this.toastSeq;
    this.toasts.push({ id, seat, text, big });
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.renderToasts();
    }, big ? 1100 : 1800);
  }

  // ---------- 点击 ----------

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pick],[data-tile],[data-act],[data-ui]');
    if (!el) return;
    if (el.dataset.pick) {
      this.startGame(el.dataset.pick);
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
    const legal = g.legalActions(this.me);
    if (el.dataset.tile !== undefined) {
      const tile = Number(el.dataset.tile);
      const a = legal.find((x) => x.type === 'discard' && x.tile === tile && !!x.riichi === this.riichiMode);
      if (a) this.playerAct(a);
      return;
    }
    if (el.dataset.act !== undefined) {
      const a = legal[Number(el.dataset.act)];
      if (a) this.playerAct(a);
    }
  }

  // ---------- 画面 ----------

  private render(): void {
    const g = this.game;
    const table = document.getElementById('table');
    if (!g || !table) return;
    table.innerHTML = `
      ${[1, 2, 3].map((s) => this.opponentHtml(s)).join('')}
      <div class="center">${this.centerHtml()}</div>
      ${[0, 1, 2, 3].map((s) => this.pondHtml(s)).join('')}
      ${this.myAreaHtml()}
      ${this.abilityPanelHtml()}
      <div id="toasts"></div>
      ${this.showResult ? this.resultHtml() : ''}`;
    this.renderToasts();
  }

  private renderToasts(): void {
    const box = document.getElementById('toasts');
    if (!box) return;
    box.innerHTML = this.toasts
      .map(
        (t) =>
          `<div class="toast ${POS[t.seat]} ${t.big ? 'big' : ''}" style="--c:${this.chars[t.seat].color}">${t.text}</div>`,
      )
      .join('');
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
    return melds
      .map((m) => {
        const tiles = m.tiles
          .map((t, i) => {
            if (m.type === 'ankan' && (i === 0 || i === 3)) return backHtml('pond');
            const sideways = m.calledTile === t && m.type !== 'kakan';
            return tileHtml(t, { size: 'pond', sideways });
          })
          .join('');
        return `<div class="meld" title="${seat}">${tiles}</div>`;
      })
      .join('');
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
        return tileHtml(d.tile, { size: 'pond', sideways: d.riichi, classes });
      })
      .join('');
    return `<div class="pond ${POS[s]}">${tiles}</div>`;
  }

  private myAreaHtml(): string {
    const g = this.game!;
    const p = g.players[this.me];
    const legal = g.legalActions(this.me);
    const discardable = new Set(
      legal.filter((a) => a.type === 'discard' && !!a.riichi === this.riichiMode).map((a) => (a as { tile: TileId }).tile),
    );
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
      const tiles =
        a.type === 'chi' || a.type === 'pon'
          ? a.tiles.map((t) => tileHtml(t, { size: 'mini' })).join('')
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

    const waits = g.phase === 'turn' && g.turn === this.me ? [] : g.waits(this.me);
    const waitHtml = waits.length
      ? `<div class="waits">听牌：${waits.map((k) => kindLabel(k)).join('、')}${g.isFuriten(this.me) ? '<span class="furiten">振听</span>' : ''}</div>`
      : '';
    const hint =
      g.phase === 'turn' && g.turn === this.me && discardable.size > 0
        ? `<div class="hint">${this.riichiMode ? '选择立直宣言牌' : '点击一张牌打出'}</div>`
        : '';
    const c = this.chars[this.me];
    return `
      <div class="me" style="--c:${c.color}">
        <div class="actions">${buttons.join('')}</div>
        ${waitHtml}${hint}
        <div class="hand-row">
          <div class="hand">${hand}${drawn}</div>
          <div class="melds">${this.meldsHtml(p.melds, this.me)}</div>
        </div>
        <div class="nameplate mine"><div class="avatar">${c.name.slice(-1)}</div><div class="pname">${this.seatLabel(this.me)}</div></div>
      </div>`;
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
