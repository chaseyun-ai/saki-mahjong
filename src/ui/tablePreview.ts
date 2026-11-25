import './tablePreview.css';
import { CHARACTERS } from '../abilities/characters';
import { Game } from '../engine/game';
import { type SyncView, Table3D } from '../ui3d/table3d';
import { playFlapTicks, playMachine, playShift, playStamp } from './sound';
import { CONSOLE_SHAPES, TABLE_STYLES, currentConsoleShape, currentTableStyle, currentTheme, tableColors } from './theme';

// 视觉设置里的牌桌预览：点了「牌桌风格」（或「仪表盘形状」）以后，设置面板右边出一张小照片，
// 用真的 2.5D 牌桌摆一局打到一半的样子（桌布、桌框、仪表盘、牌背都是选中的那套）。
// 有换局演出的牌桌（自动麻将机、原木、深夜、翻转、沙滩、草甸）可以点「看换局」当场放一遍。
// 宽屏放在设置面板右边（.tp-side），窄的地方放在牌桌风格那一行下面（.tp-inline）；
// 面板每点一下都整个重画，这张照片（连同里面的牌桌）是同一个元素，重画后再挂回去，不用重建牌桌

// 摆在桌上的四家（只要名字，没有能力）
const SEATS = ['saki', 'nodoka', 'yuuki', 'mako'].map((id) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]);
const SEED = 20261123;
// 每家牌河里先放几张
const POND = 8;
// 够宽才放在面板右边（面板 640 + 照片 440 + 两边的空）
const WIDE = '(min-width: 1160px)';

function view(): SyncView {
  return { me: 0, clickable: new Set(), colors: SEATS.map((c) => c.color), ids: SEATS.map((c) => c.id) };
}

// 一局打到一半：配好牌，每家牌河里 POND 张（从牌山前面拿，牌山跟着变短），轮到庄家（自己）出牌
function midGame(seed: number): Game {
  const g = new Game({ seed, players: SEATS.map((c) => ({ name: c.name })) });
  for (let k = 0; k < POND; k++) {
    for (const p of g.players) {
      const t = g.wall.live.shift();
      if (t !== undefined) p.discards.push({ tile: t, riichi: false, tsumogiri: false, called: false });
    }
  }
  return g;
}

class TablePreview {
  // 打开了没有：设置面板里第一次点牌桌风格（仪表盘形状）才打开，关面板时收掉
  private opened = false;
  private card: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private table: Table3D | null = null;
  // 现在这张牌桌是照哪套建的（皮肤 | 牌桌风格 | 仪表盘形状），变了才重建
  private key = '';
  private round = 1;
  private mq: MediaQueryList | null = null;
  private onMq = () => this.place();

  show(): void {
    this.opened = true;
  }

  // 设置面板画好以后调：开着就把照片挂到面板上，牌桌照现在的设置（变了就重建）
  mount(root: ParentNode): void {
    if (!this.opened) return;
    const modal = root.querySelector<HTMLElement>('.set-modal');
    // 面板关了、换到对局或声音那页：收掉（再点牌桌风格才出来）
    if (!modal?.querySelector('.tp-side')) {
      this.close();
      return;
    }
    modal.classList.add('has-preview');
    const card = this.ensureCard();
    this.fill(card);
    this.place();
    const key = `${currentTheme()}|${currentTableStyle()}|${currentConsoleShape()}`;
    if (key !== this.key || !this.table) this.rebuild(key);
  }

  close(): void {
    this.opened = false;
    this.disposeTable();
    this.card?.remove();
    this.card = null;
    this.stage = null;
    this.key = '';
    this.mq?.removeEventListener('change', this.onMq);
    this.mq = null;
  }

  private ensureCard(): HTMLElement {
    if (this.card) return this.card;
    const card = document.createElement('figure');
    card.className = 'tp-card';
    card.innerHTML = `<figcaption class="tp-head"><b></b><small></small></figcaption><div class="tp-stage"></div><p class="tp-note"></p><div class="tp-actions"><button type="button" class="tp-play">▶ 看换局</button><span class="tp-hint"></span></div>`;
    card.querySelector('.tp-play')!.addEventListener('click', () => this.playChangeover());
    this.card = card;
    this.stage = card.querySelector('.tp-stage');
    this.mq = window.matchMedia(WIDE);
    this.mq.addEventListener('change', this.onMq);
    return card;
  }

  // 照片上的字：名字、说明、有没有换局可看
  private fill(card: HTMLElement): void {
    const style = TABLE_STYLES.find((t) => t.id === currentTableStyle()) ?? TABLE_STYLES[0];
    const shape = currentConsoleShape();
    const shapeName = shape === 'auto' ? '' : `仪表盘：${CONSOLE_SHAPES.find((s) => s.id === shape)?.name ?? ''}`;
    card.querySelector('.tp-head b')!.textContent = style.name;
    card.querySelector('.tp-head small')!.textContent = ['2.5D 预览', shapeName].filter(Boolean).join(' · ');
    card.querySelector('.tp-note')!.textContent = style.note;
    const colors = tableColors();
    const shift = !!(colors.changeover || colors.machine);
    card.querySelector<HTMLElement>('.tp-actions')!.hidden = !shift;
    card.querySelector('.tp-hint')!.textContent = shift ? '每局开始时就是这样换牌' : '';
  }

  // 宽屏挂在面板右边，窄的地方挂在牌桌风格那一行下面
  private place(): void {
    const card = this.card;
    if (!card) return;
    const modal = document.querySelector<HTMLElement>('.set-modal.has-preview');
    const slot = modal?.querySelector<HTMLElement>(this.mq?.matches ? '.tp-side' : '.tp-inline');
    if (slot && card.parentElement !== slot) slot.appendChild(card);
  }

  private rebuild(key: string): void {
    this.disposeTable();
    const stage = this.stage;
    if (!stage) return;
    this.key = key;
    this.round = 1;
    const table = new Table3D(stage, () => {}, '25d');
    this.table = table;
    // 没经过面板就离开了（比如直接开局，整页换掉）：照片不在页面上了，牌桌也收掉
    table.beforeRender = () => {
      if (!this.card?.isConnected && this.table === table) setTimeout(() => this.table === table && this.close());
    };
    table.sync(midGame(SEED), view());
    table.snap();
  }

  // 看换局：桌上这局收掉，换下一局（换一副牌、下一个种子），牌桌自己演换局、码牌山、掷骰子、发牌
  private playChangeover(): void {
    const table = this.table;
    if (!table) return;
    table.onShift = (cue, dur) => playShift(cue, dur);
    table.onMachine = (cue, dur) => playMachine(cue, dur);
    table.onFlaps = (n) => playFlapTicks(n);
    table.onStamp = () => playStamp();
    this.round++;
    const g = new Game({ seed: SEED + this.round, players: SEATS.map((c) => ({ name: c.name })) });
    // 自动麻将机两副牌轮流用，照局数换
    g.round = this.round;
    table.onEvent({ type: 'roundStart', label: g.roundLabel() }, g);
    table.sync(g, view());
  }

  private disposeTable(): void {
    const table = this.table;
    if (!table) return;
    this.table = null;
    // 马上还掉 WebGL（浏览器同时只给十几个），不等回收
    const canvas = this.stage?.querySelector('canvas');
    table.dispose();
    (canvas?.getContext('webgl2') ?? canvas?.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export const tablePreview = new TablePreview();
