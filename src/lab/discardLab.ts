import './lab.css';
import { CHARACTERS } from '../abilities/characters';
import { tileHtml } from '../ui/tile';
import { DEFAULT_DISCARD, DiscardParams, RIICHI_DISCARD } from '../ui3d/discardMotion';
import { SyncView, Table3D } from '../ui3d/table3d';
import { HAND_SLOTS, LabScene, LabSetup, POND_SLOTS, applyDiscard, composeScene } from './scene';

// 出牌动作调试场景：选人物、座位、打哪张、落到牌河哪里，反复看同一个出牌动作。
// 牌桌、人物模型、IK 和出牌动作都和正式牌局是同一套代码，这里只负责摆场景和重放。

const SEATS = ['自己', '下家', '对家', '上家'];

interface LabState {
  char: string; // 出牌的人物
  rel: number; // 座位，相对镜头：0 自己，1 下家，2 对家，3 上家
  handSlot: number;
  pondSlot: number;
  sideways: boolean;
}

export class DiscardLab {
  private table: Table3D;
  private panel: HTMLElement;
  private status: HTMLElement;
  private state: LabState = { char: 'saki', rel: 2, handSlot: 6, pondSlot: 3, sideways: false };
  // 模型加载完要先重放一次；换人物时旧的等待作废
  private waiting = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="lab">
        <div class="lab-stage">
          <div class="lab-three" id="lab-three"></div>
          <div class="lab-status" id="lab-status"></div>
        </div>
        <aside class="lab-panel" id="lab-panel"></aside>
      </div>`;
    this.panel = root.querySelector('#lab-panel')!;
    this.status = root.querySelector('#lab-status')!;
    this.renderPanel();
    this.table = new Table3D(root.querySelector('#lab-three')!, () => {});
    this.panel.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', this.onKey);
    this.table.sync(this.compose().game, this.view());
    this.whenReady();
    // 调试用：?debug 时可以在控制台里拿到调试场景
    if (location.search.includes('debug')) (window as unknown as { lab: DiscardLab }).lab = this;
  }

  // ---------- 场景 ----------

  private get seat(): number {
    return this.state.rel;
  }

  private setup(): LabSetup {
    const { handSlot, pondSlot, sideways } = this.state;
    return { seat: this.seat, handSlot, pondSlot, sideways };
  }

  // 出牌的人坐在选的座位，其余三位按顺序坐满
  private seating(): string[] {
    const others = CHARACTERS.map((c) => c.id).filter((id) => id !== this.state.char);
    return [0, 1, 2, 3].map((s) => (s === this.seat ? this.state.char : others.shift()!));
  }

  private view(): SyncView {
    const ids = this.seating();
    const chars = ids.map((id) => CHARACTERS.find((c) => c.id === id)!);
    return { me: 0, clickable: new Set(), colors: chars.map((c) => c.color), ids };
  }

  private compose(): LabScene {
    const names = this.seating().map((id) => CHARACTERS.find((c) => c.id === id)!.name);
    return composeScene(names, this.setup());
  }

  private motion(): DiscardParams {
    return this.state.sideways ? RIICHI_DISCARD : DEFAULT_DISCARD;
  }

  // 重放：牌回到手里，所有东西摆好，再从头出一次牌
  replay(): void {
    const scene = this.compose();
    const view = this.view();
    this.table.sync(scene.game, view);
    this.table.snap();
    this.table.playDiscard(this.seat, scene.tile, this.motion());
    applyDiscard(scene, this.setup());
    this.table.sync(scene.game, view);
    this.renderPanel();
  }

  // 换了人物或座位：重新请人入座，模型都加载好再演
  private reseat(): void {
    this.table.rebuildCharacters(this.view());
    this.whenReady();
  }

  private whenReady(): void {
    const id = ++this.waiting;
    this.status.textContent = '人物加载中…';
    const check = () => {
      if (id !== this.waiting) return;
      if (!this.table.charactersReady()) {
        window.setTimeout(check, 150);
        return;
      }
      this.status.textContent = '';
      this.replay();
    };
    check();
  }

  // ---------- 面板 ----------

  private renderPanel(): void {
    const s = this.state;
    const chip = (act: string, value: string | number, label: string, on: boolean) =>
      `<button class="lab-chip${on ? ' on' : ''}" data-act="${act}" data-v="${value}">${label}</button>`;
    const chars = CHARACTERS.map((c) => chip('char', c.id, c.name, c.id === s.char)).join('');
    const seats = SEATS.map((name, i) => chip('seat', i, name, i === s.rel)).join('');

    // 出牌前的手牌：理好的 13 张，隔开一点是刚摸的牌
    const before = this.compose();
    const p = before.game.players[this.seat];
    const sorted = p.hand.filter((t) => t !== p.drawn).sort((a, b) => a - b);
    const slot = (t: number, i: number) =>
      `<button class="lab-tile${i === s.handSlot ? ' on' : ''}" data-act="hand" data-v="${i}" title="${i < HAND_SLOTS ? `第 ${i + 1} 张` : '摸到的牌'}">${tileHtml(t, { size: 'mini' })}</button>`;
    const hand = sorted.map(slot).join('') + `<span class="lab-gap"></span>` + slot(p.drawn!, HAND_SLOTS);

    // 牌河：六张一行，已经有的牌画成小方块，选中的位置高亮
    const pond = Array.from({ length: POND_SLOTS }, (_, i) => {
      const cls = i < s.pondSlot ? 'filled' : i === s.pondSlot ? 'on' : '';
      return `<button class="lab-cell ${cls}" data-act="pond" data-v="${i}" title="牌河第 ${i + 1} 张">${i === s.pondSlot ? i + 1 : ''}</button>`;
    }).join('');

    this.panel.innerHTML = `
      <header class="lab-head">
        <h1>出牌动作调试</h1>
        <a href="#" data-act="exit">返回游戏</a>
      </header>
      <section>
        <h2>人物</h2>
        <div class="lab-row">${chars}</div>
      </section>
      <section>
        <h2>座位</h2>
        <div class="lab-row">${seats}</div>
      </section>
      <section>
        <h2>打哪张 <small>${s.handSlot < HAND_SLOTS ? `手牌第 ${s.handSlot + 1} 张` : '摸切'}</small></h2>
        <div class="lab-hand">${hand}</div>
      </section>
      <section>
        <h2>落到牌河 <small>第 ${s.pondSlot + 1} 张</small></h2>
        <div class="lab-pond">${pond}</div>
        <label class="lab-check"><input type="checkbox" data-act="sideways" ${s.sideways ? 'checked' : ''} /> 横放（立直宣言牌）</label>
      </section>
      <button class="lab-primary" data-act="replay">重放 <kbd>R</kbd></button>`;
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const v = el.dataset.v ?? '';
    const s = this.state;
    if (act === 'exit') {
      e.preventDefault();
      location.hash = '';
      return;
    }
    if (act === 'char' && v !== s.char) {
      s.char = v;
      this.renderPanel();
      this.reseat();
    } else if (act === 'seat' && +v !== s.rel) {
      s.rel = +v;
      this.renderPanel();
      this.reseat();
    } else if (act === 'hand') {
      s.handSlot = +v;
      this.replay();
    } else if (act === 'pond') {
      s.pondSlot = +v;
      this.replay();
    } else if (act === 'sideways') {
      s.sideways = (el as HTMLInputElement).checked;
      this.replay();
    } else if (act === 'replay') {
      this.replay();
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return;
    if (e.key === 'r' || e.key === 'R') this.replay();
  };
}
