import './lab.css';
import { CHARACTERS } from '../abilities/characters';
import { playClick } from '../ui/sound';
import { tileHtml } from '../ui/tile';
import { DiscardParams, DiscardPath, markers, phaseAt, totalTime } from '../ui3d/discardMotion';
import { SyncView, Table3D } from '../ui3d/table3d';
import { TILE_W, TableLayout, tableDims } from '../ui3d/tableLayout';
import { GIZMO_COLORS, GIZMO_LABELS, GizmoKind, Gizmos } from './gizmos';
import { CAMERA_LABELS, CameraMode, LabCamera } from './labCamera';
import { ParamsPanel } from './paramsPanel';
import { DISCARD_KIT, TABLE_KIT } from './presets';
import { HAND_SLOTS, LabScene, LabSetup, POND_SLOTS, applyDiscard, composeScene } from './scene';
import { Timeline } from './timeline';

// 出牌动作调试场景：选人物、座位、打哪张、落到牌河哪里，反复看同一个出牌动作。
// 牌桌、人物模型、IK 和出牌动作都和正式牌局是同一套代码，这里只负责摆场景和重放。

const SEATS = ['自己', '下家', '对家', '上家'];
const TABS = { scene: '场景', params: '动作参数', table: '牌桌', view: '机位' };
type Tab = keyof typeof TABS;
// 收手之后多看一会儿再循环
const TAIL = 0.35;
const FRAME = 1 / 60;
// 比赛用的 28 毫米牌宽约 21 毫米，拿来把牌桌换算成真实尺寸
const REAL_TILE_MM = 21;

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
  private timeline: Timeline;
  // 这次出牌开始时牌桌的动画时间；动作时间 = 牌桌时间 - t0
  private t0 = 0;
  private playing = true;
  private speed = 1;
  private loop = true;
  // 定位时间时从头快进，这期间经过的标记不响也不闪
  private seeking = false;
  private gizmos: Gizmos;
  private shown: Record<GizmoKind, boolean> = { target: true, arm: true, contact: true, wristPath: true, tilePath: true };
  private cam: LabCamera;
  private path: DiscardPath | null = null;
  // 只看出牌的人（侧面看时别家会挡住镜头）
  private hideOthers = false;
  private hud: HTMLElement;
  private tab: Tab = 'scene';
  private sceneTab: HTMLElement;
  private viewTab: HTMLElement;
  private paramsPanel: ParamsPanel<DiscardParams>;
  private layoutPanel: ParamsPanel<TableLayout>;
  // 拖牌桌滑块时，等停手再让大家重新坐稳
  private settleTimer = 0;

  // onExit：点"返回游戏"时调用，这之前调试场景已经自己收拾干净
  constructor(
    root: HTMLElement,
    private onExit: () => void,
  ) {
    root.innerHTML = `
      <div class="lab">
        <div class="lab-stage">
          <div class="lab-view">
            <div class="lab-three" id="lab-three"></div>
            <div class="lab-status" id="lab-status"></div>
            <div class="lab-hud" id="lab-hud"></div>
          </div>
          <div class="lab-timeline" id="lab-timeline"></div>
        </div>
        <aside class="lab-panel" id="lab-panel"></aside>
      </div>`;
    this.panel = root.querySelector('#lab-panel')!;
    this.status = root.querySelector('#lab-status')!;
    this.hud = root.querySelector('#lab-hud')!;
    this.panel.innerHTML = `
      <header class="lab-head">
        <h1>出牌动作调试</h1>
        <button class="lab-exit" data-act="exit">返回游戏</button>
      </header>
      <nav class="lab-tabs">${Object.entries(TABS)
        .map(([k, label]) => `<button data-act="tab" data-v="${k}">${label}</button>`)
        .join('')}</nav>
      <div data-tab="scene"></div>
      <div data-tab="params"></div>
      <div data-tab="table"></div>
      <div data-tab="view"></div>`;
    this.sceneTab = this.panel.querySelector('[data-tab=scene]')!;
    this.viewTab = this.panel.querySelector('[data-tab=view]')!;
    this.paramsPanel = new ParamsPanel(this.panel.querySelector('[data-tab=params]')!, DISCARD_KIT, (structural) => this.paramsChanged(structural));
    this.layoutPanel = new ParamsPanel(
      this.panel.querySelector('[data-tab=table]')!,
      TABLE_KIT,
      () => this.layoutChanged(),
      (l) => this.layoutNote(l),
    );
    this.showTab(this.tab);
    this.renderScene();
    this.timeline = new Timeline(
      root.querySelector('#lab-timeline')!,
      {
        toggle: () => this.toggle(),
        step: (dir) => this.step(dir),
        replay: () => this.replay(),
        seek: (t) => this.seek(t),
        speed: (v) => this.setSpeed(v),
        loop: (on) => (this.loop = on),
      },
      this.speed,
      this.loop,
    );
    this.table = new Table3D(root.querySelector('#lab-three')!, () => {});
    this.table.setLayout(this.layoutPanel.params);
    this.table.onMarker = (_seat, _tile, name) => {
      if (this.seeking) return;
      this.timeline.flash(name);
      if (name === 'land') playClick();
    };
    this.gizmos = new Gizmos(this.table.overlay);
    this.cam = new LabCamera(this.table);
    this.renderView();
    this.table.beforeRender = () => this.tick();
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

  // 正在调的参数；出牌动作直接引用这一份，面板上改了马上生效
  private motion(): DiscardParams {
    return this.paramsPanel.params;
  }

  // 参数改了：时间轴和轨迹按新参数重画；暂停时停在同一时刻重新算这一帧，播放时接着播；
  // 整套换了（换预设）就从头播
  private paramsChanged(structural: boolean): void {
    if (!this.table) return;
    if (structural && this.playing) return this.replay();
    if (!this.playing) return this.seek(this.t);
    this.timeline.setMarkers(markers(this.motion()), this.duration());
    if (this.path) this.gizmos.setPaths(this.motion(), this.path);
  }

  // 牌回到手里，所有东西摆好，从头出一次牌（动作时间回到 0）
  private restart(): void {
    const scene = this.compose();
    const view = this.view();
    this.table.sync(scene.game, view);
    this.table.snap();
    this.t0 = this.table.time;
    this.table.playDiscard(this.seat, scene.tile, this.motion());
    applyDiscard(scene, this.setup());
    this.table.sync(scene.game, view);
    this.table.setOthersVisible(this.seat, !this.hideOthers);
    this.timeline.setMarkers(markers(this.motion()), this.duration());
    const info = this.table.discardInfo(this.seat);
    if (info) {
      this.path = info.path;
      this.gizmos.setPaths(info.params, info.path);
    }
  }

  // 重放并开始播放；reframe 为真时（换了座位、牌位）按新的路线重新摆机位
  replay(reframe = false): void {
    this.restart();
    if (reframe) this.cam.set(this.cam.mode, this.path);
    this.setPlaying(true);
  }

  // ---------- 时间 ----------

  // 这次出牌的动作时间（秒），去掉累加带来的浮点零头，正好停在标记上时算已经到了
  get t(): number {
    return Math.round((this.table.time - this.t0) * 1e6) / 1e6;
  }

  private duration(): number {
    return totalTime(this.motion()) + TAIL;
  }

  private setPlaying(on: boolean): void {
    this.playing = on;
    this.table.timeScale = on ? this.speed : 0;
  }

  private toggle(): void {
    if (!this.playing && this.t >= this.duration() - 1e-6) this.restart();
    this.setPlaying(!this.playing);
  }

  private setSpeed(v: number): void {
    this.speed = v;
    if (this.playing) this.table.timeScale = v;
  }

  // 定位到动作时间 t：从头按固定步长快进过去，画面和正常播放到这一刻一样
  seek(t: number): void {
    this.setPlaying(false);
    this.seeking = true;
    this.restart();
    this.table.advance(Math.max(0, Math.min(t, this.duration())));
    this.seeking = false;
  }

  // 逐帧：往前直接走一帧（经过落桌会响），往回就定位到上一帧
  private step(dir: 1 | -1): void {
    this.setPlaying(false);
    if (dir > 0) this.table.advance(Math.min(FRAME, Math.max(0, this.duration() - this.t)));
    else this.seek(Math.max(0, Math.ceil(this.t / FRAME - 1 - 1e-6) * FRAME));
  }

  // 每帧画之前：播完了循环或者停在最后，刷新时间轴、辅助线、读数和跟手的镜头
  tick(): void {
    if (this.playing && this.t > this.duration()) {
      if (this.loop) this.restart();
      else this.setPlaying(false);
    }
    const t = Math.min(this.t, this.duration());
    this.timeline.show(t, phaseAt(this.motion(), t), this.playing);
    const av = this.table.avatarAt(this.seat);
    if (!av) return;
    const info = this.table.discardInfo(this.seat);
    const arm = av.rightArm();
    const pose = info?.pose ?? null;
    this.gizmos.update({ target: pose?.wrist ?? null, goal: av.rightGoal, arm, contact: pose?.contact ?? null });
    this.cam.update(arm.wrist);
    // 世界单位换算成人物身上的毫米
    const mm = (d: number) => Math.round((d / this.table.dims.scale) * 1000);
    const row = (color: string, label: string, value: string) =>
      `<div><i style="background:${color}"></i>${label}<b>${value}</b></div>`;
    this.hud.innerHTML = [
      row('transparent', '伸手权重', av.reachWeight.toFixed(2)),
      row('#ff4b3e', '手腕误差', `${mm(av.rightGoal.distanceTo(arm.wrist))} mm`),
      row(GIZMO_COLORS.contact, '指尖到接触点', pose ? `${mm(pose.contact.distanceTo(arm.tip))} mm` : '—'),
      row(GIZMO_COLORS.tilePath, '牌离牌河', pose && info ? `${mm(Math.max(0, pose.tilePos.y - info.path.to.y))} mm` : '—'),
    ].join('');
  }

  // 停掉渲染、作废还在等的模型加载、拿掉键盘监听
  private dispose(): void {
    this.waiting++;
    window.clearTimeout(this.settleTimer);
    window.removeEventListener('keydown', this.onKey);
    this.cam.dispose();
    this.table.dispose();
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
      this.settleDown();
      this.layoutPanel.refreshNote();
      this.replay(true);
    };
    check();
  }

  // 先让大家坐稳（视线、头发都静下来），记下这个样子作为每次重放的起点
  private settleDown(): void {
    this.table.sync(this.compose().game, this.view());
    this.table.snap();
    this.table.advance(2, 1 / 30);
    this.table.captureIdle();
  }

  // 牌桌尺寸改了：桌子马上重建；人的位置和大小变了，头发要重新静下来、重新记起点，
  // 拖滑块时等停手 0.2 秒再做，然后从同一时刻接着看（播放中就从头播）
  private layoutChanged(): void {
    this.table.setLayout(this.layoutPanel.params);
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      if (!this.table.charactersReady()) return;
      const t = this.t;
      this.settleDown();
      if (this.playing) return this.replay(true);
      this.seek(t);
      this.cam.set(this.cam.mode, this.path);
    }, 200);
  }

  // 牌桌参数下面的换算：按比赛用牌算，桌子多大、出牌的人多高
  private layoutNote(l: TableLayout): string {
    const d = tableDims(l);
    const cm = (world: number) => Math.round((world / TILE_W) * REAL_TILE_MM) / 10;
    const name = CHARACTERS.find((c) => c.id === this.state.char)?.name ?? '';
    const av = this.table?.avatarAt(this.seat);
    const height = av ? `${name}约 ${Math.round(cm(av.stature * d.scale))} 厘米高（真人约 155）` : `${name}的身高等人物加载好再算`;
    return `按比赛用牌（宽 ${REAL_TILE_MM} 毫米）换算：桌子外框 ${Math.round(cm(d.bodyHalf * 2))} 厘米（真实 89–98），${height}。`;
  }

  // ---------- 面板 ----------

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const el of this.panel.querySelectorAll<HTMLElement>('[data-tab]')) el.hidden = el.dataset.tab !== tab;
    for (const b of this.panel.querySelectorAll<HTMLElement>('[data-act=tab]')) b.classList.toggle('on', b.dataset.v === tab);
  }

  private chip(act: string, value: string | number, label: string, on: boolean): string {
    return `<button class="lab-chip${on ? ' on' : ''}" data-act="${act}" data-v="${value}">${label}</button>`;
  }

  // 场景：人物、座位、打哪张、落到牌河哪里
  private renderScene(): void {
    const s = this.state;
    const chars = CHARACTERS.map((c) => this.chip('char', c.id, c.name, c.id === s.char)).join('');
    const seats = SEATS.map((name, i) => this.chip('seat', i, name, i === s.rel)).join('');

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

    this.sceneTab.innerHTML = `
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
      </section>`;
  }

  // 机位和辅助线
  private renderView(): void {
    const mode = this.cam.mode;
    const cams = (Object.keys(CAMERA_LABELS) as CameraMode[]).map((m) => this.chip('camera', m, CAMERA_LABELS[m], m === mode)).join('');
    const gizmos = (Object.keys(GIZMO_LABELS) as GizmoKind[])
      .map(
        (k) =>
          `<label class="lab-check"><input type="checkbox" data-act="gizmo" data-v="${k}" ${this.shown[k] ? 'checked' : ''} /><i style="background:${GIZMO_COLORS[k]}"></i>${GIZMO_LABELS[k]}</label>`,
      )
      .join('');
    this.viewTab.innerHTML = `
      <section>
        <h2>机位 <small>${mode === 'side' || mode === 'top' ? '可以拖动旋转、滚轮缩放' : ''}</small></h2>
        <div class="lab-row">${cams}</div>
        <label class="lab-check"><input type="checkbox" data-act="others" ${this.hideOthers ? 'checked' : ''} /> 只看出牌的人</label>
      </section>
      <section>
        <h2>辅助线</h2>
        <div class="lab-gizmos">${gizmos}</div>
      </section>`;
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const v = el.dataset.v ?? '';
    const s = this.state;
    if (act === 'exit') {
      this.dispose();
      this.onExit();
    } else if (act === 'tab') {
      this.showTab(v as Tab);
    } else if (act === 'char' && v !== s.char) {
      s.char = v;
      this.renderScene();
      this.reseat();
    } else if (act === 'seat' && +v !== s.rel) {
      s.rel = +v;
      this.renderScene();
      this.reseat();
    } else if (act === 'hand') {
      s.handSlot = +v;
      this.renderScene();
      this.replay(true);
    } else if (act === 'pond') {
      s.pondSlot = +v;
      this.renderScene();
      this.replay(true);
    } else if (act === 'sideways') {
      s.sideways = (el as HTMLInputElement).checked;
      this.renderScene();
      // 还在用没改过的内置参数时，跟着换成立直出牌（或换回默认出牌）
      this.paramsPanel.followSideways(s.sideways);
      this.replay(true);
    } else if (act === 'camera') {
      // 侧面看时别家正好挡在镜头前，先藏起来（可以再勾回来）
      if (v === 'side') this.hideOthers = true;
      this.table.setOthersVisible(this.seat, !this.hideOthers);
      this.cam.set(v as CameraMode, this.path);
      this.renderView();
    } else if (act === 'others') {
      this.hideOthers = (el as HTMLInputElement).checked;
      this.table.setOthersVisible(this.seat, !this.hideOthers);
    } else if (act === 'gizmo') {
      this.shown[v as GizmoKind] = (el as HTMLInputElement).checked;
      this.gizmos.show(v as GizmoKind, this.shown[v as GizmoKind]);
    }
  }

  // 空格暂停 / 继续，← → 逐帧，R 重放
  private onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 在参数面板里打字、拖滑块时不抢键盘（时间轴的滑块除外）
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'checkbox');
    if (typing && !t.closest('.lab-timeline')) return;
    if (e.key === ' ') this.toggle();
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'r' || e.key === 'R') this.replay();
    else return;
    e.preventDefault();
    // 焦点在按钮或勾选框上时，空格松开会再点一次它
    if (e.target instanceof HTMLElement && e.target !== document.body) e.target.blur();
  };
}
