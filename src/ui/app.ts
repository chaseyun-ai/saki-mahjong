import { CHARACTERS, Character } from '../abilities/characters';
import { bulbLevel, dangerKinds, readTenpai } from '../abilities/hiroe';
import { makoDanger, makoKnows } from '../abilities/mako';
import { akoDistance, akoSense } from '../abilities/ako';
import { TERU, TERU_TIERS, TERU_TOP, teruDanger, teruLadder, teruMirrored } from '../abilities/teru';
import { nellyBlocked, nellySenses, nellySensesTenpai } from '../abilities/nelly';
import { awaiDomainOn, awaiSourceOn, awaiWaveTiles } from '../abilities/awai';
import { sakiKanKinds, sakiKanTiles, sakiSeesThrough } from '../abilities/saki';
import { mihokoEyeOpen } from '../abilities/mihoko';
import { shiromiRipple } from '../abilities/shiromi';
import { shizunoMist } from '../abilities/shizuno';
import { hatsumiGale, hatsumiGlowMelds, hatsumiOpen } from '../abilities/hatsumi';
import { aislinnDrawsLeft, aislinnPlan, aislinnSketch } from '../abilities/aislinn';
import { playRebuild, playShatter } from './sketchFx';
import { playNetWipe } from './netFx';
import { kuroLost } from '../abilities/kuro';
import { angelDanger, nodokaAngel } from '../abilities/nodoka';
import { tokaChisui } from '../abilities/toka';
import { ryuukaDanger, ryuukaMugoku, ryuukaSensesTenpai } from '../abilities/ryuuka';
import { komakiActiveGod } from '../abilities/komaki';
import { toyoneRedHidden } from '../abilities/toyone';
import { riiKeys } from '../abilities/rii';
import { saeCanAim, saeAim, snipedBy } from '../abilities/sae';
import { initLensDrag, lensMarkHtml, lensSlotsHtml, playLensShot } from './lensDrag';
import type { PreDealOption } from '../abilities/types';
import { chooseAction } from '../ai/ai';
import { Action, Game, GameEvent, RoundResult, WinInfo } from '../engine/game';
import { Rng } from '../engine/rng';
import { Meld } from '../engine/score';
import { Kind, TileId, WIND_CN, isRed, kindLabel, kindOf } from '../engine/tiles';
import { playCall, playChime, playClick, playRiichi, playWin } from './sound';
import { paceOf, vary } from './vary';
import { Table3D } from '../ui3d/table3d';
import { preloadModels } from '../ui3d/avatar';
import { FACES, Face, MODEL_URLS, cutinArt, portraitUrl, powerPortraitUrl, skillArt } from '../ui3d/looks';
import { backHtml, setSketchTiles, tileHtml, tintOf } from './tile';
import { meldLayout } from './meldLayout';
import { WaitInfo, hanLabel, waitInfo, waitStatus } from './waitInfo';
import { AbilityTrace, traceLine } from './abilityTrace';
import { CutinKind, Cutins } from './cutin';
import { SkinEditor, canEditSkins, onSkinsChange } from './skins';
import { TeamFlow } from './teamFlow';
import { THEMES, ThemeId, currentTheme, setTheme } from './theme';
import { SCHOOLS, membersOf, saveSchool, savedSchool } from './schools';
import { POSITIONS, TeamRun } from '../team/team';
import { CanRon, SeenStep, canRonNow, cloneGame, readSteps, rehearsalOver } from './foresee';
import { MatchSettings, loadSettings, parseTarget, pickOpponents, rulesOf, saveSettings, setOption, setupHtml } from './matchSetup';
import { ForecastCache } from '../ai/forecast';

// 座位在画面上的位置：0 是自己（下），1 下家（右），2 对家（上），3 上家（左）
const POS = ['bottom', 'right', 'top', 'left'];

const AI_TURN_DELAY = 550;
// 天使和的网络麻将：变身那一局开局后多久换牌桌（先让天使形态动画放完），平时补换等多久，顶上标题栏多高
const NET_DELAY = 1800;
const NET_CATCHUP = 400;
const NET_BAR = 26;
const NET_WIND = '東南西北';
// 2D 牌桌上里鬼门的风最多几道弧线
const GALE_ARCS = 40;
// 3D、2.5D 牌桌：上一张牌落桌、这家摸完牌以后再想这么久才出（毫秒）。
// 算上出牌动作，电脑一回合（落桌到落桌）约 1.1 秒，和雀魂差不多。3D 的角色伸手要 0.3 秒，所以想得短一点
const AI_TURN_DELAY_3D = 360;
const AI_TURN_DELAY_25D = 620;
const AI_CALL_DELAY = 250;
// 桃子隐身那一下要多久（毫秒，先停半拍再淡掉），和 style.css 里 .vanish 的动画一样长
const VANISH_MS = 1150;
// 自己立直后摸切：摸到的牌飞到空中要多久（和牌桌的摸牌飞行一样），在空中停多久（毫秒）
const AIR_FLIGHT = 250;
const AIR_PAUSE = 250;
// 摸牌路径关掉时立直后摸切：牌在牌山淡出再在手里淡入一共多久（和牌桌的 DRAW_FADE_OUT + DRAW_FADE_IN 一样），淡入以后在手里停多久（毫秒）
const FADE_DRAW = 300;
const FADE_PAUSE = 400;
// 自动和牌、自动摸切：牌落定以后停这么久再替玩家做（毫秒）
const ASSIST_DELAY = 450;
// 团体赛以外开局的点数在设置弹窗里选（matchSetup.ts），终局排名的 ± 从那里算
// 托管时结算画面停多久自动进下一局
const AUTO_NEXT = 2600;
// 怜“看下一巡”的体力：满 100，看一次 35，每局开始回 20。同一回合可以看两次，看第二次的话下一局不能用
const STAMINA_MAX = 100;
const DEEP_COST = 15;
const STAMINA_REGEN = 20;

interface Toast {
  id: number;
  seat: number;
  text: string;
  big: boolean;
  kind: string; // riichi / call / kan / win 时有特效样式
}

// 洋榎的灯：颜色从白到紫，光芒条数就是档位
// 选人页右上角的牌桌视角下拉
const SEL_MODES: ['25d' | '3d' | '2d', string][] = [
  ['25d', '2.5D'],
  ['3d', '3D 实验'],
  ['2d', '2D'],
];
// 选人页顶栏的齿轮、随机出场的骰子
const GEAR_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>`;
const DICE_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="16" cy="8" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="8" cy="16" r="1.6" fill="currentColor"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/></svg>`;

const BULB_COLORS = ['#f4f1e0', '#ffd84a', '#ff9f2e', '#ff4a3a', '#c35bff'];
const BULB_NAMES = ['一千多', '两三千', '五千左右', '满贯', '跳满以上'];
function bulbSvg(lv: number): string {
  const fill = BULB_COLORS[lv - 1];
  const rays = Array.from({ length: lv }, (_, i) => {
    const a = ((-90 + (i - (lv - 1) / 2) * 32) * Math.PI) / 180;
    const x = (r: number) => (20 + Math.cos(a) * r).toFixed(1);
    const y = (r: number) => (16 + Math.sin(a) * r).toFixed(1);
    return `<line x1="${x(15)}" y1="${y(15)}" x2="${x(21)}" y2="${y(21)}" stroke="${fill}" stroke-width="2.6" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 40 40" style="filter:drop-shadow(0 0 ${3 + lv * 3}px ${fill})">${rays}<path d="M20 4a11 11 0 0 0-6.5 19.8c1.3 1 2 2.3 2 3.7V30h9v-2.5c0-1.4.7-2.7 2-3.7A11 11 0 0 0 20 4z" fill="${fill}" stroke="#555" stroke-width="1.5"/><rect x="15" y="31" width="10" height="3" rx="1" fill="#9aa"/><rect x="16" y="35" width="8" height="2.6" rx="1.2" fill="#9aa"/></svg>`;
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
  // 桃子：这一局已经隐身的座位；正在淡掉的座位（开始的时刻）
  private gone = new Set<number>();
  private vanishAt = new Map<number, number>();
  // 25d：3D 牌桌、不坐人物，从上往下看（默认）；3d：坐着人物的实验版；2d：网页画的平面牌桌
  private mode: '25d' | '3d' | '2d' = '25d';
  // 单人对局的规则（设置弹窗），setupFor 是弹窗开着时选的角色
  private settings: MatchSettings = loadSettings();
  private setupFor: string | null = null;
  // 牌桌右边的四个开关：理（自动理牌）、和（自动和牌）、鸣（不吃碰杠）、切（自动摸切）
  private assist = { sort: true, win: false, call: false, cut: false };
  // 不自动理牌时自己手牌的摆法（不含刚摸的那张）；null 是照顺序排
  private handOrder: TileId[] | null = null;
  private table3d: Table3D | null = null;
  // 打牌前预览：轮到自己时，打出去以后能听牌的牌和打掉它以后听什么；鼠标停在哪张牌上
  private preview = new Map<TileId, WaitInfo>();
  private previewTile: TileId | null = null;
  // 能力痕迹：记下这一局牌山被动过的地方，结算时讲出来
  private trace: AbilityTrace | null = null;
  // 2.5D 头像框里每家现在的表情，到 until（毫秒时间戳）变回平常；一局结束时的表情留到下一局开始
  private faces: { face: Face; until: number }[] = [];
  private faceTimer: number | null = null;
  // 2.5D 的切入演出；能力的切入每局每种只放第一次（宝牌聚集这种一局会发动好多次），之后只出小字
  private cutins: Cutins | null = null;
  private cutinSeen = new Set<string>();
  // 爱丽丝的手绘板：牌桌现在是不是画成手绘板（重组特效刷满时才换过去，破碎时马上换回）
  private sketchView = false;
  private sketchTimer: number | null = null;
  // 原村和变成天使和：牌桌换成她脑子里的网络麻将（2D 网麻牌桌，三种视角都一样）。
  // netFrom 是换过去之前的视角（2.5D、3D 时临时把 mode 改成 2d，变回来或离开牌桌时还原）
  private netView = false;
  private netFrom: '25d' | '3d' | '2d' | null = null;
  private netTimer: number | null = null;
  // 怜“看下一巡”（演算）：玩家操作怜时的体力。
  // 演算中 vision 不是 null：this.game 换成牌局的复制品放到牌桌上演，真的牌局和演算前的表情先存在 vision 里，退出时换回来。
  // start：复制品从第几个事件开始是演算的；rons：演算里她能荣和却没和的那几次
  private stamina = STAMINA_MAX;
  private vision: { real: Game; start: number; rons: CanRon[]; faces: { face: Face; until: number }[] } | null = null;
  // 这一回合（key）看了几次，上次演算的经过（退出以后留着给她看）
  // at：上次演算是在第几个事件时看的，之后有人鸣牌、开杠（事件变了）就不再显示
  private looks: { key: string; count: number; last: string; at: number } = { key: '', count: 0, last: '', at: -1 };
  // 怜的“你下一张”：按局面缓存的演算结果
  private forecast = new ForecastCache();
  // 看第二次的惩罚：penaltyNext 等下一局开始变成 blocked，那一局不能用
  private penaltyNext = false;
  // 洋榎的提醒：这一回合（key）第一张、第二张指到的危险牌种；danger 按事件数缓存
  private say: { key: string; first: Kind | null; second: Kind | null } = { key: '', first: null, second: null };
  private dangerCache: { at: number; kinds: Set<Kind> } = { at: -1, kinds: new Set() };
  private blocked = false;
  // 团体赛：正在打的这一场是哪几队坐哪（seats[座位] = 队伍下标）、开局时的点数；auto 是托管（玩家的座位也由电脑打）
  private team: { flow: TeamFlow; run: TeamRun; seats: number[]; start: number[] } | null = null;
  private teamFlow: TeamFlow | null = null;
  private auto = false;

  // openLab：选人页上点"动作调试"时调用
  constructor(
    root: HTMLElement,
    private openLab: () => void,
  ) {
    this.root = root;
    root.addEventListener('click', (e) => this.onClick(e));
    this.initLens();
    root.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.hand [data-tile]');
      this.hoverTile(el ? Number(el.dataset.tile) : null);
    });
    // 选人页：鼠标停在卡片上看介绍；手指点的不算悬停（点一下看、再点开始，见 onClick）
    root.addEventListener('pointerdown', (e) => (this.lastPointer = e.pointerType));
    // 选人页上左右滑换学校
    let swipe: { x: number; y: number } | null = null;
    root.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      swipe = !this.game && (e.target as HTMLElement).closest('.school-page') && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    });
    root.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (!swipe || !t) return;
      const dx = t.clientX - swipe.x;
      const dy = t.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) this.stepSchool(dx < 0 ? 1 : -1);
    });
    root.addEventListener('pointerover', (e) => {
      if (this.game || e.pointerType !== 'mouse') return;
      const card = (e.target as HTMLElement).closest<HTMLElement>('.char-card');
      if (card) this.showCharTip(card);
    });
    root.addEventListener('pointerout', (e) => {
      if (e.pointerType !== 'mouse') return;
      const card = (e.target as HTMLElement).closest<HTMLElement>('.char-card');
      const to = e.relatedTarget as HTMLElement | null;
      if (!card || card.contains(to)) return;
      // 大立绘面板：移到别的头像上由 pointerover 换人，移出头像就换回选定的那位（不然走去按“出场”的路上会换成别人）
      if (!this.heroTip()) this.showCharTip(null);
      else if (!to?.closest?.('.char-card') && this.tipFor !== this.picked) this.showCharTip(this.pickedCard());
    });
    // 选人页顶栏的两个下拉：牌桌视角、皮肤
    root.addEventListener('change', (e) => {
      const el = e.target as HTMLSelectElement;
      if (el.dataset.ui === 'mode-pick' && SEL_MODES.some(([v]) => v === el.value)) {
        this.mode = el.value as '25d' | '3d' | '2d';
        this.renderSelect();
      } else if (el.dataset.ui === 'theme-pick' && THEMES.some((t) => t.id === el.value)) {
        setTheme(el.value as ThemeId);
        this.renderSelect();
      }
    });
    // 齿轮菜单开着时，点别的地方就收起来
    root.addEventListener('click', (e) => {
      const open = root.querySelector('details.sel-more[open]');
      if (open && !open.contains(e.target as Node)) open.removeAttribute('open');
    });
    root.addEventListener('focusin', (e) => {
      // 只管用键盘切过来的；点出来的焦点交给上面的指针事件
      const card = (e.target as HTMLElement).closest<HTMLElement>('.char-card');
      if (card?.matches(':focus-visible')) this.showCharTip(card);
    });
    window.addEventListener('resize', () => this.fit());
    // 大字特效用的书法字体先下好，免得第一次立直时字还没出来
    document.fonts?.load('1em "Ma Shan Zheng"', '立直碰吃杠荣和自摸暗加宝牌聚集岭上开花一巡先见的气息').catch(() => {});
    this.renderSelect();
    // 素材页里换了图：牌局里重画头像框，选人页重画一遍
    onSkinsChange(() => {
      if (this.game) this.render();
      else if (this.root.querySelector('.select-screen')) this.renderSelect();
    });
    // 调试用：?debug 时可以在控制台里直接触发牌局事件看特效
    if (location.search.includes('debug')) Object.assign(window, { app: this, chooseAction });
  }

  // ---------- 选角色 ----------

  // 离开牌桌：停掉计时器、拆掉 3D 牌桌
  private teardown(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.game = null;
    this.cutins?.clear();
    this.table3d?.dispose();
    this.table3d = null;
    this.resetNet();
    this.root.classList.remove('mihoko-eye', 'awai-dark', 'awai-source');
  }

  private renderSelect(): void {
    this.teardown();
    this.team = null;
    this.teamFlow = null;
    this.auto = false;
    // 3D 牌桌要用的人物模型现在就开始在后台下载
    if (this.mode === '3d') preloadModels(MODEL_URLS);
    const opt = (v: string, label: string, on: boolean) => `<option value="${v}"${on ? ' selected' : ''}>${label}</option>`;
    const modes = SEL_MODES.map(([v, label]) => opt(v, label, v === this.mode)).join('');
    const themes = THEMES.map((t) => opt(t.id, t.name, t.id === currentTheme())).join('');
    const hero = this.heroTip();
    // 顶栏：标题，右上角是牌桌视角、皮肤两个下拉，齿轮里放素材（页面主人才有）和动作调试。
    // 下面一排是两种玩法的标签，团体赛点了就进布阵；随机出场用上次的规则直接开局
    this.root.innerHTML = `
      <div class="select-screen">
        <div class="sel-main">
        <header class="sel-top">
          <h1>超能力麻将</h1>
          <div class="sel-tools">
            <label class="sel-tool"><span>牌桌</span><select data-ui="mode-pick" aria-label="牌桌视角">${modes}</select></label>
            <label class="sel-tool"><span>皮肤</span><select data-ui="theme-pick" aria-label="界面皮肤">${themes}</select></label>
            <details class="sel-more">
              <summary aria-label="更多" title="素材 · 动作调试">${GEAR_SVG}</summary>
              <div class="sel-more-menu"><span id="skin-entry"></span><button data-ui="lab">动作调试</button></div>
            </details>
          </div>
        </header>
        <nav class="sel-modes">
          <button class="on" aria-current="page">个人对局<small>选一位，和三个电脑打</small></button>
          <button data-ui="team">团体赛拟真<small>四队蛇形选人，五人接力</small></button>
          <button class="sel-random" data-ui="random" title="随便抽一位，用上次的规则直接开局">${DICE_SVG}随机出场</button>
        </nav>
        <div class="school-tabs" role="tablist">${this.schoolTabsHtml()}</div>
        <div class="school-page">${this.schoolPageHtml()}</div>
        <p class="sel-hint">${hero ? '点头像看能力，再点一下或按「出场」就用上次的规则开局；局数、点数、对手在「规则 · 对手」里改。' : '鼠标停在头像上看能力（手机上点一下看），点头像选定，设置好规则就开始。'}对手从其余角色里随机抽三位，由电脑操作。</p>
        <p class="footnote">原型 · 角色与能力参考《天才麻将少女》，同人非商业作品 · 3D 人物由 VRoid 官方 CC0 示例模型改色</p>
        </div>
        <div class="char-tip" hidden></div>
        <div id="setup"></div>
      </div>`;
    // 换了皮肤的选人页：介绍不再是浮窗，固定在左边当大立绘面板，先放这一页的第一位
    if (hero) this.pickCard(this.root.querySelector<HTMLElement>('.char-card'));
    // 能换素材的人（页面主人）才看得到“素材”入口
    void canEditSkins().then((ok) => {
      const slot = this.root.querySelector('#skin-entry');
      if (ok && slot) slot.innerHTML = '<button data-ui="skins">素材</button>';
    });
  }

  // 大立绘面板选定的角色：鼠标停在别的头像上时临时换过去看，移开了换回来；再点一下选定的头像就开局
  private picked: string | null = null;

  // chosen：玩家自己点选的（换页、刚打开时默认放第一位，不算点选，点它一下只是选定、不开局）
  private chosen = false;

  private pickCard(card: HTMLElement | null, chosen = false): void {
    this.picked = card?.dataset.pick ?? null;
    this.chosen = chosen && !!card;
    this.showCharTip(card);
  }

  private pickedCard(): HTMLElement | null {
    return this.picked ? this.root.querySelector<HTMLElement>(`.char-card[data-pick="${this.picked}"]`) : null;
  }

  // 出场、随机出场：不弹设置，照上次的规则开局（规则记在浏览器里，第一次是默认规则）
  private quickStart(id: string): void {
    this.setupFor = null;
    this.startGame(id);
  }

  // 「规则 · 对手」，或者经典皮肤上点了头像：弹出对局设置，按“开始对战”再开局
  private openSetup(id: string): void {
    this.setupFor = id;
    this.renderSetup();
  }

  // 选人页按学校分页（schools.ts）：一页一个学校，点角色直接开局
  private school = savedSchool();

  private schoolTabsHtml(): string {
    return SCHOOLS.map((s) => {
      const on = s.name === this.school;
      return `<button class="${on ? 'on' : ''}" role="tab" aria-selected="${on}" data-ui="school" data-school="${s.name}" style="--s:${s.color}"><i></i>${s.short}<small>${membersOf(s.name).length}</small></button>`;
    }).join('');
  }

  // 卡片上只有头像和名字；能力和介绍放在悬停时的浮窗里（见 showCharTip）
  private schoolPageHtml(): string {
    const s = SCHOOLS.find((x) => x.name === this.school) ?? SCHOOLS[0];
    const cards = membersOf(s.name)
      .map(
        (c) => `
      <button class="char-card" data-pick="${c.id}" style="--c:${c.color}" aria-label="${c.name}，${c.cost} 费：${c.ability?.name ?? '无能力'}">
        <div class="char-portrait">${c.name.slice(-1)}<img src="${this.cardPortrait(c.id)}" alt="" onerror="this.remove()" />${this.formSwitchHtml(c.id)}</div>
        <span class="char-cost" aria-hidden="true">${c.cost}</span>
        <div class="char-name">${c.name}<small>${c.ability?.name ?? '无能力'}</small></div>
      </button>`,
      )
      .join('');
    // 前一所、后一所学校（和手机上左右滑一样）
    const i = SCHOOLS.indexOf(s);
    const near = (d: number) => SCHOOLS[(i + d + SCHOOLS.length) % SCHOOLS.length].short;
    const pager = SCHOOLS.length > 1 ? `<span class="school-pager"><button data-ui="school-step" data-d="-1" aria-label="前一所学校">‹ ${near(-1)}</button><button data-ui="school-step" data-d="1" aria-label="后一所学校">${near(1)} ›</button></span>` : '';
    return `<div class="school-head" style="--s:${s.color}"><b>${s.name}</b>${s.region ? `<span>${s.region}代表</span>` : ''}<em>${membersOf(s.name).length} 人</em>${pager}</div>
      <div class="char-grid">${cards}</div>`;
  }

  // 龙门渊透华：头像旁边切换“常态 / 治水”，选了治水开局就是治水（MatchSettings.chisui）
  private cardPortrait(id: string): string {
    return id === 'toka' && this.settings.chisui ? powerPortraitUrl(id) : portraitUrl(id, 'neutral');
  }

  // 卡片头像角上的小开关（点它只切换，不选人）
  private formSwitchHtml(id: string): string {
    if (id !== 'toka') return '';
    const on = this.settings.chisui;
    return `<span class="form-switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="开局状态：${on ? '治水' : '常态'}" title="点一下切换常态 / 治水" data-ui="toka-form">${on ? '治水' : '常态'}</span>`;
  }

  // 大立绘面板上的两段切换
  private formToggleHtml(id: string): string {
    if (id !== 'toka') return '';
    const on = this.settings.chisui;
    const btn = (v: boolean, label: string, note: string) =>
      `<button class="${on === v ? 'on' : ''}" aria-pressed="${on === v}" data-ui="toka-form" data-v="${v}">${label}<small>${note}</small></button>`;
    return `<div class="form-toggle">${btn(false, '常态', '点数变动 10 万后治水')}${btn(true, '治水', '开局就是治水')}</div>`;
  }

  private toggleTokaForm(v?: string): void {
    this.settings.chisui = v === undefined ? !this.settings.chisui : v === 'true';
    saveSettings(this.settings);
    const page = this.root.querySelector('.school-page');
    if (page) page.innerHTML = this.schoolPageHtml();
    // 大立绘面板、介绍浮窗还停在透华身上的话一起重画
    if (this.tipFor === 'toka' || this.heroTip()) {
      const card = this.root.querySelector<HTMLElement>(`.char-card[data-pick="${this.tipFor ?? 'toka'}"]`);
      if (card) this.showCharTip(card);
    }
  }

  // 换一页：只重画标签和这一页，换了皮肤的选人页把左边立绘换成这一页的第一位
  private showSchool(name: string): void {
    if (!SCHOOLS.some((s) => s.name === name)) return;
    this.school = name;
    saveSchool(name);
    const tabs = this.root.querySelector('.school-tabs');
    const page = this.root.querySelector('.school-page');
    if (!tabs || !page) return;
    tabs.innerHTML = this.schoolTabsHtml();
    page.innerHTML = this.schoolPageHtml();
    tabs.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (this.heroTip()) this.pickCard(page.querySelector<HTMLElement>('.char-card'));
    else this.showCharTip(null);
  }

  // 前一页、后一页（手机上左右滑）
  private stepSchool(d: number): void {
    const i = SCHOOLS.findIndex((s) => s.name === this.school);
    this.showSchool(SCHOOLS[(i + d + SCHOOLS.length) % SCHOOLS.length].name);
  }

  // 选人页的介绍浮窗：贴在卡片旁边，不出屏幕
  private tipFor: string | null = null;
  private lastPointer = 'mouse';
  private heroTip(): boolean {
    return currentTheme() !== 'classic';
  }

  private showCharTip(card: HTMLElement | null): void {
    const tip = this.root.querySelector<HTMLElement>('.char-tip');
    if (!tip) return;
    const hero = this.heroTip();
    // 大立绘面板一直留着，鼠标移开也还是刚才那位
    if (hero && !card) return;
    this.root.querySelectorAll('.char-card.armed').forEach((x) => x.classList.remove('armed'));
    const c = card && CHARACTERS.find((x) => x.id === card.dataset.pick);
    this.tipFor = c ? c.id : null;
    if (!card || !c) {
      tip.hidden = true;
      return;
    }
    card.classList.add('armed');
    tip.style.setProperty('--c', c.color);
    tip.innerHTML = `
      <div class="char-name">${c.name}</div>
      <div class="char-school">${c.school}</div>
      <div class="char-ability">${c.ability ? c.ability.name : '无能力'}</div>
      <div class="char-desc">${c.ability ? c.ability.description : '不靠能力，只靠扎实的牌效和防守。电脑操作这个角色时不会失误。'}</div>`;
    tip.hidden = false;
    if (hero) {
      // 名字旁边是费用（团体赛选人的档位）；说明太长先收起来、淡出，按“展开全文”看完
      const region = SCHOOLS.find((s) => s.name === c.school)?.region;
      tip.innerHTML = `<div class="hero-art"><img src="${cutinArt(c.id, 'ability').url}" alt="" onerror="this.remove()" /><span>${c.name.slice(-1)}</span></div>
        <div class="hero-plate">
          <div class="char-school">${c.school}${region ? `<span>${region}代表</span>` : ''}</div>
          <div class="hero-title"><div class="char-name">${c.name}</div><span class="hero-cost" title="团体赛费用">${c.cost}<small>费</small></span></div>
          <div class="char-ability">${c.ability ? c.ability.name : '无能力'}</div>
          <div class="char-desc">${c.ability ? c.ability.description : '不靠能力，只靠扎实的牌效和防守。电脑操作这个角色时不会失误。'}</div>
          <button class="hero-more" data-ui="desc-more" hidden>展开全文</button>
          ${this.formToggleHtml(c.id)}
          <div class="hero-actions"><button class="hero-go" data-ui="go" data-id="${c.id}">出场</button><button class="hero-rules" data-ui="rules" data-id="${c.id}">规则 · 对手</button></div>
        </div>`;
      tip.style.left = tip.style.top = '';
      const desc = tip.querySelector<HTMLElement>('.char-desc');
      const more = tip.querySelector<HTMLElement>('.hero-more');
      if (desc && more && desc.scrollHeight > desc.clientHeight + 2) {
        tip.querySelector('.hero-plate')?.classList.add('clipped');
        more.hidden = false;
      }
      return;
    }
    const r = card.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const gap = 10;
    // 右边放得下放右边，不然放左边，都放不下就放卡片下面
    let x = r.right + gap;
    let y = r.top;
    if (x + w > innerWidth - 8) x = r.left - gap - w;
    if (x < 8) {
      x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - 8 - w);
      y = r.bottom + gap;
      if (y + h > innerHeight - 8) y = r.top - gap - h;
    }
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(Math.min(Math.max(8, y), innerHeight - 8 - h))}px`;
  }

  // 选了角色：先弹规则设置，按“开始对战”再开局
  private renderSetup(): void {
    const slot = this.root.querySelector('#setup');
    if (!slot) return;
    const c = this.setupFor ? CHARACTERS.find((x) => x.id === this.setupFor) : null;
    slot.innerHTML = c ? setupHtml(this.settings, c.name, c.color) : '';
  }

  // 自由输入的一位必要点数、下拉选的对手：弹窗重画、开局之前先收进来
  private readTarget(): void {
    const input = this.root.querySelector<HTMLInputElement>('#setup-target');
    if (input) this.settings.target = parseTarget(input.value);
    this.root.querySelectorAll<HTMLSelectElement>('.setup-select').forEach((el) => (this.settings.opponents[Number(el.dataset.seat)] = el.value));
  }

  private startGame(charId: string): void {
    const mine = CHARACTERS.find((c) => c.id === charId)!;
    const seed = Math.floor(Math.random() * 2 ** 31);
    // 对手：设置里选了的照选的坐，随机的从其余角色里抽
    const others = pickOpponents(this.settings, charId, new Rng(seed ^ 0x5a17));
    this.team = null;
    this.auto = false;
    const st = this.settings;
    this.beginGame([mine, ...others], new Game({ seed, format: st.length, startScore: st.start, rules: rulesOf(st), firstDealer: Math.floor(Math.random() * 4), players: [mine, ...others].map((c, i) => ({ name: c.name, ability: c.ability, manual: i === this.me, startForm: i === this.me && c.id === 'toka' && st.chisui })) }));
  }

  // 公开手牌：单人对局按设置，团体赛不公开
  private openHands(): boolean {
    return !this.team && this.settings.open;
  }

  // 团体赛的一场：玩家的队坐 0 号位，每人带着自己队伍现在的点数上场
  private startTeamMatch(run: TeamRun, seats: number[], auto: boolean): void {
    const chars = seats.map((t) => run.teams[t].lineup[run.pos]);
    const start = seats.map((t) => run.teams[t].points);
    this.team = { flow: this.teamFlow!, run, seats, start };
    this.auto = auto;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const allies = seats.map((t) => run.teams[t].lineup.map((c) => c.id));
    // 同队的哩在之前的位置拿到的钥匙
    const keys = seats.map((t) => run.keys[t]);
    const game = new Game({ seed, format: 'team', firstDealer: Math.floor(Math.random() * 4), scores: start, riichiSticks: run.riichiSticks, allies, keys, players: chars.map((c, i) => ({ name: c.name, ability: c.ability, manual: i === this.me && !auto })) });
    this.beginGame(chars, game);
  }

  private beginGame(chars: Character[], game: Game): void {
    this.chars = chars;
    this.game = game;
    // 随机微变化（落桌声、电脑想多久、出牌动作、牌河）：种子跟着牌局走，设置里能关
    vary.reset(game.seed, this.settings.vary);
    this.trace = new AbilityTrace(this.game);
    this.game.onEvent((e) => this.onGameEvent(e));
    this.toasts = [];
    this.faces = [];
    this.stamina = STAMINA_MAX;
    this.vision = null;
    this.looks = { key: '', count: 0, last: '', at: -1 };
    this.penaltyNext = false;
    this.blocked = false;
    // 头像先下好，第一次换表情时不会空一下
    for (const c of this.chars) for (const f of FACES) if (portraitUrl(c.id, f)) new Image().src = portraitUrl(c.id, f);
    this.showResult = false;
    this.pdPicks = null;
    this.pdValues = null;
    this.handOrder = null;
    this.tableBuilt = false;
    this.resetNet();
    // 第一局发牌前就要选技能：先在选角色的画面上弹出来，选好再建牌桌
    if (this.game.phase === 'predeal') {
      this.root.innerHTML = '<div class="select predeal-screen" id="predeal"></div>';
      this.renderPredeal();
      return;
    }
    this.buildTable();
  }

  private tableBuilt = false;

  // 发牌前选技能的弹窗：牌桌建好以后盖在牌桌上，第一局时单独放
  private renderPredeal(): void {
    const slot = document.getElementById('predeal');
    if (!this.tableBuilt && slot) {
      slot.innerHTML = this.predealHtml();
      return;
    }
    this.render();
  }

  // resume：牌局打到一半换视角（天使和的网络麻将），不再补开局动画
  private buildTable(resume = false): void {
    this.tableBuilt = true;
    if (this.mode !== '2d') {
      // 2.5D 竖屏时桌子只占中间一块，和 2D 一样提示横过来
      const tip = this.mode === '25d' ? '<div class="rotate-tip">手机横过来玩，牌会更大</div>' : '';
      this.root.innerHTML = `<div class="stage3d${this.mode === '25d' ? ' flat' : ''}"><div class="three" id="three"></div><div class="hud" id="hud"></div><div class="hud" id="toasts"></div><div class="hud" id="banner"></div><div class="hud" id="cutins"></div>${tip}</div>`;
      // 切入演出只在 2.5D 放；3D、2D 只放素材页换上的技能动画
      this.cutins = new Cutins(document.getElementById('cutins')!);
      this.cutinSeen.clear();
      this.table3d = new Table3D(document.getElementById('three')!, (id) => this.onTileClick(id), this.mode === '25d' ? '25d' : '3d');
      this.table3d.onHover = (id) => this.hoverTile(id);
      // 2.5D 的副露摆到画面边上，但别压着头像框和能力说明
      if (this.mode === '25d') {
        this.table3d.keepOut = () => [...this.root.querySelectorAll('.seat-frame, .ability-panel')].map((el) => el.getBoundingClientRect());
      }
      // 3D 牌桌上牌真正落到牌河时才响
      this.table3d.onMarker = (seat, _tile, name) => {
        if (name === 'land') playClick({ pan: this.clickPan(seat), varied: true });
      };
      // 第一局在牌桌建好之前就开始了，补一次开局动画
      if (!resume) {
        this.table3d.onEvent({ type: 'roundStart', label: this.game!.roundLabel() }, this.game!);
        this.roundBanner();
      }
    } else {
      // 天使和的网络麻将：顶上加一条网麻客户端的标题栏
      const bar = this.netView ? `<div class="net-bar"><span class="nb-dots"><i></i><i></i><i></i></span><b>オンライン麻雀</b><span class="nb-room">${this.team ? '団体戦' : '段位戦'}</span><span class="nb-user">のどっち · オンライン</span></div>` : '';
      this.root.innerHTML = `<div class="stage${this.netView ? ' net' : ''}">${bar}<div class="table"><div id="table" style="display: contents"></div><div id="toasts"></div></div></div><div class="cutin-layer" id="cutins"></div><div class="rotate-tip">手机横过来玩，牌会更大</div>`;
      this.cutins = new Cutins(document.getElementById('cutins')!);
      this.cutinSeen.clear();
      this.fit();
    }
    // 第一局在牌桌建好之前就画好了手绘板：补放一次重组特效
    if (this.chars[this.me]?.id === 'aislinn' && aislinnSketch(this.game!, this.me) && !this.sketchView) this.sketchFx('手绘板');
    // 开局就治水的透华：第一局在牌桌建好之前就进了治水，补放一次治水（素材页换了形态动画就放那一段）
    if (!resume) {
      const g = this.game!;
      const chisui = g.events.find((e) => e.type === 'ability' && e.ability === 'toka' && e.text === '治水');
      if (chisui && g.round === 1) window.setTimeout(() => this.game === g && this.onGameEvent(chisui), Math.max(600, this.busyMs()));
    }
    this.step();
  }

  private fit(): void {
    const table = document.querySelector<HTMLElement>('.stage .table');
    if (!table) return;
    // 网络麻将顶上有一条标题栏，牌桌放在它下面
    const top = this.netView ? NET_BAR : 0;
    const scale = Math.min(window.innerWidth / 1040, (window.innerHeight - top) / 800, 1.4);
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
    // 怜的演算打完一巡（或者有人和了、倒了牌）就停在那里，等她点“退出”
    const v = this.vision;
    if (v && rehearsalOver(g, v.start, this.me)) {
      this.render();
      return;
    }
    if (g.phase === 'predeal') {
      this.renderPredeal();
      return;
    }
    if (g.phase === 'postdeal') {
      this.render();
      return;
    }
    if (g.phase === 'roundEnd' || g.phase === 'gameEnd') {
      // 3D 牌桌先让大家看清倒牌和特效，再弹结算。2.5D 和牌照雀魂，宣言后 3.4 秒进结算
      this.render();
      const wins = g.roundResult?.wins.length ?? 0;
      const wait =
        this.mode === '2d' ? 0 : this.mode === '25d' && wins ? Math.max(3400, this.busyMs() + 900) : (wins ? 2400 : 1400) + this.busyMs();
      this.timer = window.setTimeout(() => {
        this.showResult = true;
        this.render();
        // 托管：结算看一会儿自己点“下一局”
        if (this.auto && g.phase === 'roundEnd') this.timer = window.setTimeout(() => this.advance(), AUTO_NEXT);
      }, wait);
      return;
    }
    const waiting = g.waitingSeats();
    // 托管时自己的座位也由电脑打
    const ai = waiting.filter((s) => s !== this.me || this.auto);
    // 先让电脑把自己的回应都做完，再等玩家
    if (g.phase === 'calls' && ai.length > 0) {
      this.render();
      // 荣和在牌落下的那一刻就喊出来，吃碰杠稍微想一下
      const ron = ai.some((s) => g.legalActions(s).some((a) => a.type === 'ron'));
      this.timer = window.setTimeout(() => {
        for (const s of ai) g.act(s, chooseAction(g, s, this.chars[s].ai));
        this.step();
      }, (ron ? 0 : vary.jitter(AI_CALL_DELAY, 0.15)) + this.busyMs());
      return;
    }
    this.render();
    // 演算里她一律不鸣（能荣和的话记下来），牌落桌后直接过
    if (v && g.phase === 'calls' && waiting.includes(this.me)) {
      this.timer = window.setTimeout(() => {
        const r = canRonNow(g, this.me);
        if (r) v.rons.push(r);
        g.act(this.me, { type: 'pass' });
        this.step();
      }, this.busyMs());
      return;
    }
    // 只剩自己要决定鸣不鸣：鸣牌按钮等那张牌落到牌河再弹出（雀魂落桌 0.15 秒内弹出）
    if (g.phase === 'calls' && this.busyMs() > 0) {
      this.timer = window.setTimeout(() => this.step(), this.busyMs());
      return;
    }
    if (g.phase === 'turn' && (g.turn !== this.me || this.auto)) {
      this.timer = window.setTimeout(() => {
        g.act(g.turn, chooseAction(g, g.turn, this.chars[g.turn].ai));
        this.step();
      }, this.thinkMs(g, g.turn, this.mode === '25d' ? AI_TURN_DELAY_25D : this.mode === '3d' ? AI_TURN_DELAY_3D : AI_TURN_DELAY) + this.busyMs());
      return;
    }
    if (!this.auto && !v && this.runAssist(g)) return;
    if (g.phase === 'turn' && g.turn === this.me) {
      // 立直后没有别的选择时自动摸切。3D、2.5D 牌桌上这张牌不进手牌，飞到手牌上方停一下（AIR_PAUSE），直接打进牌河：
      // 等它从牌山出发（busyMs）、飞完，再停一下。摸牌路径关掉时和“切”一样：牌淡入手里，停一下（FADE_PAUSE）再打
      const legal = g.legalActions(this.me);
      if (g.players[this.me].riichi && legal.length === 1) {
        const wait = !this.table3d ? 600 : this.settings.drawPath === 'off' ? this.busyMs() + FADE_DRAW + FADE_PAUSE : this.busyMs() + AIR_FLIGHT + AIR_PAUSE;
        this.timer = window.setTimeout(() => this.playerAct(legal[0]), wait);
      }
    }
  }

  // 理和鸣切里的“和”“鸣”“切”：轮到自己时能替玩家做的就排上计时器，返回 true
  private runAssist(g: Game): boolean {
    if (!g.waitingSeats().includes(this.me)) return false;
    const legal = g.legalActions(this.me);
    const act = (a: Action) => {
      this.timer = window.setTimeout(() => this.playerAct(a), this.busyMs() + ASSIST_DELAY);
      return true;
    };
    const win = legal.find((a) => a.type === 'ron' || a.type === 'tsumo');
    if (this.assist.win && win) return act(win);
    if (g.phase === 'calls') {
      // 不吃碰杠：能荣和的那次还是问玩家
      if (this.assist.call && !win) {
        this.timer = window.setTimeout(() => this.playerAct({ type: 'pass' }), this.busyMs());
        return true;
      }
      return false;
    }
    // 自动摸切：能自摸的时候还是等玩家（开着“和”的话上面已经和了）；立直后的摸切照原来的
    const p = g.players[this.me];
    if (!this.assist.cut || win || p.riichi || p.drawn === null) return false;
    const cut = legal.find((a) => a.type === 'discard' && a.tile === p.drawn && !a.riichi);
    return cut ? act(cut) : false;
  }

  private assistHtml(): string {
    const g = this.game!;
    if (g.phase === 'gameEnd' || this.vision || this.auto) return '';
    const btns: [keyof App['assist'], string, string][] = [
      ['sort', '理', '自动理牌'],
      ['win', '和', '自动和牌'],
      ['call', '鸣', '不吃碰杠'],
      ['cut', '切', '自动摸切'],
    ];
    const html = btns
      .map(([k, ch, tip]) => `<button class="${this.assist[k] ? 'on' : ''}" aria-pressed="${this.assist[k]}" title="${tip}" aria-label="${tip}" data-ui="assist" data-k="${k}">${ch}</button>`)
      .join('');
    return `<div class="assist-bar">${html}</div>`;
  }

  private toggleAssist(k: keyof App['assist']): void {
    this.assist[k] = !this.assist[k];
    if (k === 'sort') this.handOrder = null;
    this.riichiMode = false;
    this.step();
  }

  // 自己手牌（不含刚摸的那张）从左到右怎么摆：自动理牌照顺序排，不然新进手的牌接在最后
  private myHand(): TileId[] {
    const p = this.game!.players[this.me];
    const rest = p.hand.filter((t) => t !== p.drawn);
    if (this.assist.sort) {
      this.handOrder = null;
      return rest.sort((a, b) => a - b);
    }
    const keep = (this.handOrder ?? []).filter((t) => rest.includes(t));
    const add = rest.filter((t) => !keep.includes(t)).sort((a, b) => a - b);
    this.handOrder = [...keep, ...add];
    return this.handOrder;
  }

  // 挂机：电脑替自己打（能力的取舍也交给电脑），结算看一会儿自动下一局；再按一次收回
  private autoBtnHtml(): string {
    const g = this.game!;
    if (g.phase === 'gameEnd' || this.vision) return '';
    return `<button class="auto-btn${this.auto ? ' on' : ''}" data-ui="auto">${this.auto ? '挂机中<small>点一下接管</small>' : '挂机'}</button>`;
  }

  private toggleAuto(): void {
    const g = this.game;
    if (!g || this.vision) return;
    this.auto = !this.auto;
    g.manual[this.me] = !this.auto;
    this.riichiMode = false;
    if (this.auto && (g.phase === 'predeal' || g.phase === 'postdeal')) g.deal();
    this.step();
  }

  // 结算画面的“下一局”
  private advance(): void {
    const g = this.game;
    if (!g || g.phase !== 'roundEnd') return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.showResult = false;
    g.nextRound();
    // 终局：没拿到第一的都“懵逼”
    if ((g.phase as string) === 'gameEnd') {
      const rank = g.ranking();
      for (let i = 1; i < 4; i++) this.faces[rank[i]] = { face: 'surprised', until: Infinity };
    }
    this.step();
  }

  private playerAct(a: Action): void {
    const g = this.game!;
    this.riichiMode = false;
    g.act(this.me, a);
    this.step();
  }

  private onGameEvent(e: GameEvent): void {
    this.table3d?.onEvent(e, this.game!);
    this.updateFaces(e);
    if (e.type === 'roundStart') {
      this.roundBanner();
      // 新的一局配牌先理好
      this.handOrder = null;
      this.cutinSeen.clear();
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN);
      this.blocked = this.penaltyNext;
      this.penaltyNext = false;
      this.gone.clear();
      this.vanishAt.clear();
      this.sketchView = false;
    }
    if (e.type === 'discard') {
      // 隐身的桃子打的牌：看不见也听不见。刚隐身的那一张照常打出去，牌河和手牌慢慢淡掉（不放立直特效）
      if (this.game!.stealthed(e.seat, this.me)) {
        if (this.gone.has(e.seat)) return;
        this.gone.add(e.seat);
        this.vanishAt.set(e.seat, Date.now());
        if (!this.table3d) playClick({ pan: this.clickPan(e.seat), varied: true });
        window.setTimeout(() => this.game && this.render(), VANISH_MS + 50);
        return;
      }
      this.freshDiscard = `${e.seat}-${this.game!.players[e.seat].discards.length - 1}`;
      if (!this.table3d) playClick({ pan: this.clickPan(e.seat), varied: true });
      if (e.riichi) {
        playRiichi();
        // 第二形态（透华的治水）在素材页换了立直动画：放这一段
        if (!this.formCutin(e.seat, 'riichi', '立直')) this.bigFx(e.seat, '立直', 'riichi');
      }
    } else if (e.type === 'call') {
      // 隐身的桃子鸣牌：看不见也听不见
      if (this.game!.stealthed(e.seat, this.me)) return;
      playCall();
      this.bigFx(e.seat, e.call, e.call.includes('杠') ? 'kan' : 'call');
    } else if (e.type === 'ability') {
      // 玄的宝牌聚集、怜的一巡先见像被动一样一直开着（原作里大家都知道），不放切入也不出字；
      // 玄打出宝牌、能力失效时出一行小字。咲的杠的气息、岭上开花：这一局第一次放切入，之后只出小字
      // 控场能力换掉别人要摸的牌：悄悄换，结算时能力痕迹里再讲
      if (e.target !== undefined && e.target !== e.seat) return;
      // 姬子破碎的钥匙那一局换走自己摸到的宝牌：悄悄换
      if (e.ability === 'himeko' && e.text === '没有宝牌') return;
      // 爱丽丝自己的手绘板：画好、重画时放重组特效，碎了放破碎特效
      if (e.ability === 'aislinn' && e.seat === this.me && !this.vision) this.sketchFx(e.text);
      // 自己是原村和、变成天使和：天使形态动画放完，牌桌换成网络麻将
      if (e.ability === 'nodoka' && e.seat === this.me) this.syncNet(Math.max(NET_DELAY, this.busyMs() + 400));
      if (e.ability === 'kuro') {
        if (e.text !== '宝牌聚集') this.toast(e.seat, e.text, false);
        return;
      }
      playChime();
      // 臼泽塞的镜片：狙击镜落到被盯上的人的头像上（等这一下重画完再找头像）
      if (e.ability === 'sae') {
        const t = this.game!.abilityState[e.seat].target as number | undefined;
        if (t !== undefined) requestAnimationFrame(() => playLensShot(t));
      }
      // 这个技能在素材页换了自己的动画：每次发动都放（三种视角都放）
      const c = this.chars[e.seat];
      const skill = c.skillArts?.find((k) => k.name === e.text);
      const art = skill && skillArt(c.id, skill.id);
      if (art && this.cutins?.show({ pos: POS[e.seat], id: c.id, color: c.color, word: e.text, kind: 'ability', art, glyph: c.name.slice(-1) })) return;
      const key = `${e.seat}-${e.text}`;
      if (!(!this.cutinSeen.has(key) && this.cutin(e.seat, e.text, 'ability'))) this.toast(e.seat, e.text, false);
      this.cutinSeen.add(key);
    } else if (e.type === 'roundEnd') {
      if (e.result.wins.length) playWin();
      // 2D：初美聚着风和牌，紫光往上冲（3D、2.5D 在牌桌上放）
      const gale = this.galeView();
      if (!this.table3d && gale && e.result.wins.some((w) => w.seat === gale.seat)) requestAnimationFrame(() => this.galeBurst2d());
      for (const w of e.result.wins) {
        // 第二形态（天使和）在素材页换了和牌动画：放这一段（三种视角都放）
        const c = this.chars[w.seat];
        const word = w.from === null ? '自摸' : '荣和';
        // 初美东北都鸣出来以后和牌：放里鬼门的和牌动画
        const form = this.game!.active(w.seat)?.form?.(this.game!, w.seat) ?? (c.id === 'hatsumi' && this.game!.active(w.seat) && hatsumiOpen(this.game!, w.seat) ? 'kimon' : null);
        const art = form ? skillArt(c.id, `${form}-win`) : undefined;
        if (art && this.cutins?.show({ pos: POS[w.seat], id: c.id, color: c.color, word, kind: 'win', art, glyph: c.name.slice(-1) })) continue;
        this.bigFx(w.seat, word, 'win');
      }
    }
  }

  // 第二形态（天使和、治水）在素材页换了 `${形态}-${kind}` 的动画：放这一段，放了返回 true
  private formCutin(seat: number, kind: 'riichi' | 'win', word: string): boolean {
    const g = this.game!;
    const form = g.active(seat)?.form?.(g, seat);
    const c = this.chars[seat];
    const art = form ? skillArt(c.id, `${form}-${kind}`) : undefined;
    return !!art && !!this.cutins?.show({ pos: POS[seat], id: c.id, color: c.color, word, kind, art, glyph: c.name.slice(-1) });
  }

  // ---------- 透华的治水 ----------

  // 牌桌平静如水（谁都看得见）：有透华在治水，这一局还在打（网络麻将的画面不铺水）
  private waterOn(): boolean {
    const g = this.game;
    if (!g || this.netView || g.phase === 'predeal' || g.phase === 'postdeal') return false;
    return [0, 1, 2, 3].some((s) => this.chars[s]?.id === 'toka' && tokaChisui(g, s));
  }

  // 2D：牌桌上盖一层水面（几圈慢慢荡开的涟漪和水底的光纹）
  private water2d(on: boolean): void {
    const host = document.querySelector('.stage .table');
    if (!host) return;
    let el = host.querySelector<HTMLElement>(':scope > .still-water');
    if (!el && on) {
      el = document.createElement('div');
      el.className = 'still-water';
      el.innerHTML = '<i></i><i></i><i></i>';
      host.prepend(el);
    }
    el?.classList.toggle('on', on);
  }

  // ---------- 爱丽丝的手绘板 ----------

  // 牌桌现在画成手绘板（自己是爱丽丝、这一局画着、重组特效已经刷满）
  private sketchShown(): boolean {
    const g = this.game;
    return !!g && !this.vision && this.sketchView && this.chars[this.me]?.id === 'aislinn' && aislinnSketch(g, this.me);
  }

  // 牌桌在页面上的位置（特效盖在这上面）
  private stageRect(): DOMRect | null {
    const el = this.root.querySelector<HTMLElement>(this.table3d ? '.stage3d' : '.stage .table');
    return el?.getBoundingClientRect() ?? null;
  }

  private sketchFx(text: string): void {
    if (this.sketchTimer !== null) clearTimeout(this.sketchTimer);
    this.sketchTimer = null;
    if (text === '画板破碎') {
      const rect = this.stageRect();
      if (rect && this.sketchView) {
        // 碎掉那一刻的手绘板：3D 截一帧，2D 复制一份牌桌
        const table = this.root.querySelector<HTMLElement>('.stage .table');
        const source = this.table3d ? { image: this.table3d.snapshot() } : table ? { dom: table } : null;
        if (source) playShatter(rect, source);
      }
      this.sketchView = false;
      return;
    }
    if (text !== '手绘板' && text !== '重绘') return;
    // 发牌动画放完再画
    const start = () => {
      this.sketchTimer = null;
      const rect = this.stageRect();
      const cover = () => {
        this.sketchView = true;
        this.render();
      };
      if (rect) playRebuild(rect, cover);
      else cover();
    };
    const wait = text === '手绘板' ? Math.max(300, this.busyMs()) : 0;
    if (wait) this.sketchTimer = window.setTimeout(start, wait);
    else start();
  }

  // ---------- 原村和的网络麻将 ----------

  // 现在该不该是网络麻将：自己是原村和、这一场已经变成天使和（原作里是她脑子里的景象，别人看到的还是平常的牌桌）
  private netWanted(): boolean {
    const g = this.game;
    return !!g && this.chars[this.me]?.id === 'nodoka' && nodokaAngel(g, this.me);
  }

  // 该换牌桌时排上计时器（已经排上了就不重排）：到点放一段登录/登出的过场，过场盖满屏幕时换牌桌
  private syncNet(delay: number): void {
    if (this.netTimer !== null || !this.game || this.netWanted() === this.netView) return;
    this.netTimer = window.setTimeout(() => {
      this.netTimer = null;
      if (!this.game || this.netWanted() === this.netView) return;
      playNetWipe(this.netWanted(), () => this.switchNet());
    }, delay);
  }

  // 换牌桌：2.5D、3D 拆掉立体牌桌，换成 2D 的网麻牌桌；被平行宇宙打回原形时照原来的视角重建
  private switchNet(): void {
    if (!this.game) return;
    const on = this.netWanted();
    if (on === this.netView) return;
    if (on) {
      this.netFrom = this.mode;
      this.mode = '2d';
    } else {
      this.mode = this.netFrom ?? this.mode;
      this.netFrom = null;
    }
    this.netView = on;
    this.cutins?.clear();
    this.table3d?.dispose();
    this.table3d = null;
    this.buildTable(true);
  }

  // 离开牌桌、开新的一场：视角还原成换成网络麻将之前的
  private resetNet(): void {
    if (this.netTimer !== null) clearTimeout(this.netTimer);
    this.netTimer = null;
    if (this.netFrom) this.mode = this.netFrom;
    this.netFrom = null;
    this.netView = false;
  }

  // 网麻的头像卡：摆在牌桌四角。自己是天使和（能力发动头像、头上光环，网名のどっち），别人是 NO IMAGE 的剪影
  private netCardHtml(s: number): string {
    const g = this.game!;
    const c = this.chars[s];
    const mine = s === this.me;
    const active = g.phase === 'turn' && g.turn === s && !this.showResult ? ' active' : '';
    const badge = c.ability && g.isSealed(s) ? '封印' : this.sistersBlocked(s) ? '七姐妹·封住' : c.ability?.badge?.(g, s);
    const face = mine
      ? `<img src="${powerPortraitUrl(c.id)}" alt="" onerror="this.remove()" /><span class="halo"></span>`
      : '<span class="sil"></span><span class="noimg">NO IMAGE</span>';
    return `
      <div class="net-card ${POS[s]}${active}${mine ? ' mine' : ''}" data-seat="${s}">
        <div class="net-name">${mine ? 'のどっち' : c.name}</div>
        <div class="portrait">${face}${badge ? `<span class="badge">${badge}</span>` : ''}${this.bulbHtml(s)}${this.distHtml(s)}${this.mirrorHtml(s)}${this.lensMark(s)}</div>
        ${this.towerHtml(s)}
      </div>`;
  }

  // 网麻的中央：深灰的面板，写東一局、残り几张，四边黄色的点数牌
  private netCenterHtml(): string {
    const g = this.game!;
    const dora = [0, 1, 2, 3, 4]
      .map((i) => (i < g.wall.doraRevealed ? tileHtml(g.wall.doraIndicators[i], { size: 'mini' }) : backHtml('mini')))
      .join('');
    const scores = [0, 1, 2, 3]
      .map((s) => {
        const active = g.phase === 'turn' && g.turn === s ? ' active' : '';
        const riichi = g.players[s].riichi && g.seesRiichi(s, this.me) ? '<span class="stick"></span>' : '';
        return `<div class="score ${POS[s]}${active}"><span class="wind">${NET_WIND[g.seatWind(s) - 27]}</span>${riichi}<span class="pts">${g.shownScore(s, this.me)}</span></div>`;
      })
      .join('');
    return `
      <div class="net-round">${NET_WIND[g.roundWind]}${'一二三四'[g.roundNumber]}局</div>
      <div class="net-remain"><small>残り</small>${g.wall.remaining}</div>
      <div class="net-sub">${g.honba} 本場 · 供託 ${g.shownSticks(this.me)}</div>
      <div class="dora">${dora}</div>
      ${scores}`;
  }

  // 手绘板画在手牌上面：画上的整副牌（自摸的那张隔开放在最右边），写着再摸几张自摸、几番
  private sketchPlanKey = '';
  private sketchPlanHtml(): string {
    const g = this.game!;
    if (!this.sketchShown()) {
      this.sketchPlanKey = '';
      return '';
    }
    const plan = aislinnPlan(g, this.me)!;
    const tiles = [...plan.final.slice(0, -1)].sort((a, b) => a - b).map((t) => tileHtml(t, { size: 'pond', sketch: true })).join('');
    const left = aislinnDrawsLeft(plan);
    const han = plan.yakuman ? '役满' : `${plan.han} 番`;
    const when = left > 0 ? `再摸 ${left} 张自摸` : '自摸！';
    const melds = g.players[this.me].melds.length ? '<span class="sp-melds">＋副露</span>' : '';
    // 画面一有变化这块就重画：入场动画只在新画出来的那一下放，不然别家每打一张它都要跳一下
    const key = `${plan.final.join(',')}|${plan.win}`;
    const fresh = key !== this.sketchPlanKey;
    this.sketchPlanKey = key;
    return `<div class="sketch-plan${fresh ? ' fresh' : ''}" title="${plan.yaku.join('、')}"><div class="sp-head"><b>手绘板</b><span>${when} · ${han}</span></div><div class="sp-tiles">${tiles}${melds}<span class="sp-win">${tileHtml(plan.win, { size: 'pond', sketch: true })}</span></div></div>`;
  }

  // 立直、鸣牌、和牌的大字：2.5D 放带立绘的切入，3D、2D 还是原来的大字特效
  private bigFx(seat: number, word: string, kind: 'riichi' | 'call' | 'kan' | 'win'): void {
    if (this.mode === '25d') this.cutin(seat, word, kind);
    else this.toast(seat, word, true, kind);
  }

  private cutin(seat: number, word: string, kind: CutinKind): boolean {
    if (this.mode !== '25d') return false;
    const c = this.chars[seat];
    return !!this.cutins?.show({ pos: POS[seat], id: c.id, color: c.color, word, kind, glyph: c.name.slice(-1) });
  }

  // 头像框平时一直是头像；立直、鸣牌、和牌换的是切入图（见 looks.ts 的 cutinArt）。
  // 只有放铳的人头像变“懵逼”，留到下一局开始；终局没拿第一的也“懵逼”（见“继续”按钮）
  private updateFaces(e: GameEvent): void {
    const set = (s: number, face: Face, secs = Infinity) => (this.faces[s] = { face, until: Date.now() + secs * 1000 });
    if (e.type === 'roundStart') this.faces = [];
    else if (e.type === 'roundEnd') {
      for (let s = 0; s < 4; s++) if (e.result.wins.some((w) => w.from === s)) set(s, 'surprised');
    }
    // 有限时的表情到点后重画一次，换回原来的表情
    const next = Math.min(...this.faces.map((f) => f?.until ?? Infinity).filter((t) => t > Date.now()));
    if (this.faceTimer !== null) clearTimeout(this.faceTimer);
    this.faceTimer = Number.isFinite(next) ? window.setTimeout(() => this.render(), next - Date.now() + 20) : null;
  }

  private faceOf(s: number): Face {
    const f = this.faces[s];
    if (f && Date.now() < f.until) return f.face;
    return 'neutral';
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
      const id = el.dataset.pick;
      // 大立绘面板：点头像选定，再点一下选定的头像就开局（和按“出场”一样）
      if (this.heroTip()) {
        if (this.chosen && this.picked === id) this.quickStart(id);
        else this.pickCard(el, true);
        return;
      }
      // 经典皮肤：手指点的第一下只看介绍，再点同一个才弹设置
      if (this.lastPointer === 'touch' && this.tipFor !== id) {
        this.showCharTip(el);
        return;
      }
      this.openSetup(id);
      return;
    }
    if (el.dataset.ui === 'go' && el.dataset.id) {
      this.quickStart(el.dataset.id);
      return;
    }
    if (el.dataset.ui === 'rules' && el.dataset.id) {
      this.openSetup(el.dataset.id);
      return;
    }
    if (el.dataset.ui === 'random') {
      this.quickStart(CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id);
      return;
    }
    if (el.dataset.ui === 'school-step') {
      this.stepSchool(Number(el.dataset.d) || 1);
      return;
    }
    if (el.dataset.ui === 'desc-more') {
      const plate = el.closest('.hero-plate');
      const open = !!plate?.classList.toggle('open');
      el.textContent = open ? '收起' : '展开全文';
      return;
    }
    if (el.dataset.ui === 'toka-form') {
      this.toggleTokaForm(el.dataset.v);
      return;
    }
    if (el.dataset.ui === 'setup-opt' && el.dataset.k && el.dataset.v) {
      this.readTarget();
      setOption(this.settings, el.dataset.k, el.dataset.v);
      this.renderSetup();
      return;
    }
    if (el.dataset.ui === 'setup-cancel') {
      this.setupFor = null;
      this.renderSetup();
      return;
    }
    if (el.dataset.ui === 'setup-go' && this.setupFor) {
      this.readTarget();
      saveSettings(this.settings);
      const id = this.setupFor;
      this.setupFor = null;
      this.startGame(id);
      return;
    }
    if (el.dataset.ui === 'lab') {
      this.openLab();
      return;
    }
    if (el.dataset.ui === 'team') {
      this.teamFlow = new TeamFlow(this.root, {
        play: (run, seats, auto) => this.startTeamMatch(run, seats, auto),
        exit: () => this.renderSelect(),
      });
      return;
    }
    if (el.dataset.ui === 'team-next' && this.team && this.game) {
      const { flow, seats } = this.team;
      const g = this.game;
      this.teardown();
      this.team = null;
      flow.afterMatch(seats, g.players.map((p) => p.score), g.riichiSticks, [0, 1, 2, 3].map((s) => (g.abilities[s]?.id === 'rii' ? riiKeys(g, s) : [])));
      return;
    }
    if (el.dataset.ui === 'skins') {
      new SkinEditor(this.root, () => this.renderSelect());
      return;
    }
    if (el.dataset.ui === 'school' && el.dataset.school) {
      this.showSchool(el.dataset.school);
      return;
    }
    const g = this.game;
    if (!g) return;
    if (el.dataset.ui === 'next') {
      this.advance();
      return;
    }
    if (el.dataset.ui === 'restart') {
      this.renderSelect();
      return;
    }
    if (el.dataset.ui === 'auto') {
      this.toggleAuto();
      return;
    }
    if (el.dataset.ui === 'assist' && el.dataset.k && el.dataset.k in this.assist) {
      this.toggleAssist(el.dataset.k as keyof App['assist']);
      return;
    }
    if (el.dataset.ui === 'riichi') {
      this.riichiMode = !this.riichiMode;
      this.render();
      return;
    }
    if (el.dataset.ui === 'pd' && el.dataset.pd) {
      const id = el.dataset.pd;
      if (this.pdPicks?.has(id)) this.pdPicks.delete(id);
      else {
        // 同一组只能选一个（爽的红云给谁）
        const group = el.dataset.group;
        if (group) this.root.querySelectorAll<HTMLElement>(`[data-ui="pd"][data-group="${group}"]`).forEach((x) => this.pdPicks?.delete(x.dataset.pd!));
        this.pdPicks?.add(id);
      }
      this.renderPredeal();
      return;
    }
    if (el.dataset.ui === 'pd-step' && el.dataset.pd && this.pdValues) {
      this.pdValues[el.dataset.pd] += Number(el.dataset.d);
      this.renderPredeal();
      return;
    }
    if (el.dataset.ui === 'pd-fold') {
      this.pdFolded = !this.pdFolded;
      this.renderPredeal();
      return;
    }
    if (el.dataset.ui === 'pd-go') {
      this.finishPredeal();
      return;
    }
    if (el.dataset.ui === 'skill') {
      if (this.game && !this.vision) this.chars[this.me].ability?.pressSkill?.(this.game, this.me, el.dataset.choice);
      this.render();
      return;
    }
    if (el.dataset.ui === 'deep') {
      this.startVision();
      return;
    }
    if (el.dataset.ui === 'deep-exit') {
      this.exitVision();
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

  // 电脑这一手想多久：原来的固定值当中位数，按角色的快慢和随机微变化浮动。
  // 只看随机数和角色，不看手牌好坏，免得玩家能从停顿读出谁快听牌了。立直后摸切不会长考
  private thinkMs(g: Game, seat: number, median: number): number {
    return vary.think(median, paceOf(this.chars[seat]?.id ?? ''), g.players[seat].riichi);
  }

  // 落桌声的左右声道：下家在右，上家在左，自己和对家在中间
  private clickPan(seat: number): number {
    return [0, 0.35, 0, -0.35][(seat - this.me + 4) % 4];
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
    if (this.auto) return new Set();
    const legal = this.game!.legalActions(this.me);
    return new Set(
      legal.filter((a) => a.type === 'discard' && !!a.riichi === this.riichiMode).map((a) => (a as { tile: TileId }).tile),
    );
  }

  // ---------- 画面 ----------

  private render(): void {
    // 天使和：该换成网络麻将（或者被平行宇宙打回原形、该换回来）时排上换牌桌
    this.syncNet(NET_CATCHUP);
    // 美穗子睁开右眼：画面罩一层蓝色
    this.root.classList.toggle('mihoko-eye', !!this.game && this.eyeOpen() && !this.vision);
    // 淡的高维领域：黑暗笼罩牌桌（所有人都看得到）；巨引力源：2D 牌桌中间一个黑色引力圆（3D 画在桌面上）
    const playing = !!this.game && (this.game.phase === 'turn' || this.game.phase === 'calls');
    this.root.classList.toggle('awai-dark', playing && awaiDomainOn(this.game!));
    this.root.classList.toggle('awai-source', playing && !this.table3d && awaiSourceOn(this.game!));
    if (this.table3d) {
      this.render3d();
      return;
    }
    const g = this.game;
    const table = document.getElementById('table');
    if (!g || !table) return;
    this.updatePreview();
    const sketch = this.sketchShown();
    setSketchTiles(sketch);
    const net = this.netView;
    table.innerHTML = `
      ${[1, 2, 3].map((s) => this.opponentHtml(s)).join('')}
      <div class="center">${net ? this.netCenterHtml() : this.centerHtml()}</div>
      ${[0, 1, 2, 3].map((s) => (net ? this.netCardHtml(s) : this.seatFrameHtml(s))).join('')}
      ${[0, 1, 2, 3].map((s) => this.pondHtml(s)).join('')}
      ${this.myAreaHtml(true, false)}
      ${this.abilityPanelHtml()}
      <div class="hiroe-say" data-r="say">${this.sayText()}</div>
      ${this.showResult ? this.resultHtml() : ''}${g.phase === 'predeal' || g.phase === 'postdeal' ? this.predealHtml() : ''}`;
    document.querySelector('.stage')?.classList.toggle('deep', !!this.vision);
    table.dataset.mist = String(this.mistLevel());
    this.gale2d(this.galeView()?.level ?? 0);
    this.water2d(this.waterOn());
    setSketchTiles(false);
    table.parentElement?.classList.toggle('sketch', sketch);
    this.freshDiscard = null;
    this.renderToasts();
  }

  private render3d(): void {
    const g = this.game;
    const hud = document.getElementById('hud');
    if (!g || !hud || !this.table3d) return;
    this.updatePreview();
    const flat = this.table3d.style === '25d';
    const plates = flat
      ? [0, 1, 2, 3].map((s) => this.seatFrameHtml(s)).join('')
      : [1, 2, 3]
          .map((s) => {
            const c = this.chars[s];
            return `<div class="nameplate float ${POS[s]}" data-seat="${s}" style="--c:${c.color}"><div class="avatar">${c.name.slice(-1)}${this.bulbHtml(s)}${this.distHtml(s)}${this.mirrorHtml(s)}${this.lensMark(s)}</div><div><div class="pname">${this.seatLabel(s)}</div><div class="pability">${this.blockedText(s) ?? (c.ability?.name ?? '无能力')}</div></div>${this.towerHtml(s)}</div>`;
          })
          .join('');
    hud.innerHTML = `
      ${plates}
      ${this.myAreaHtml(false, !flat)}
      ${flat ? this.foresightHtml() : this.abilityPanelHtml()}
      <div class="hiroe-say" data-r="say">${this.sayText()}</div>
      ${this.showResult ? this.resultHtml() : ''}${g.phase === 'predeal' || g.phase === 'postdeal' ? this.predealHtml() : ''}`;
    // 看下一巡时视野变绿
    hud.parentElement?.classList.toggle('deep', !!this.vision);
    this.renderToasts();
    this.table3d.sync(g, {
      me: this.me,
      clickable: g.phase === 'turn' && g.turn === this.me && !this.showResult ? this.discardable() : new Set(),
      colors: this.chars.map((c) => c.color),
      ids: this.chars.map((c) => c.id),
      marked: new Set(this.showResult ? [] : this.preview.keys()),
      deadly: this.showResult ? undefined : this.deadlyTiles(),
      ripple: this.showResult ? null : this.rippleTile(),
      airDraw: this.airDraw(),
      tintBacks: this.eyeOpen() && !this.vision ? new Set([1, 2, 3].flatMap((d) => g.players[(this.me + d) % 4].hand)) : undefined,
      akaBacks: this.vision ? undefined : this.akaSpots(),
      kanSeen: this.sakiSees() && sakiKanTiles(this.game!, this.me),
      rinshanSeen: this.sakiSees() && new Set(this.game!.wall.rinshan),
      waveBacks: this.vision || (g.phase !== 'turn' && g.phase !== 'calls') ? undefined : awaiWaveTiles(g, this.me),
      gravity: (g.phase === 'turn' || g.phase === 'calls') && awaiSourceOn(g),
      handOrder: this.myHand(),
      openHands: this.openHands(),
      drawPath: this.settings.drawPath,
      mist: this.mistLevel(),
      sketch: this.sketchShown(),
      gale: this.galeView(),
      glowTiles: this.glowTiles(),
      stillWater: this.waterOn(),
    });
    hud.parentElement?.classList.toggle('sketch', this.sketchShown());
  }

  // 高鸭稳乃的深山：牌山上的雾有几级（谁都看得见；被封印的那一局没有雾）
  private mistLevel(): number {
    const g = this.game;
    if (!g) return 0;
    return Math.max(0, ...[0, 1, 2, 3].filter((s) => this.chars[s]?.id === 'shizuno' && g.active(s)).map((s) => shizunoMist(g, s)));
  }

  // 丰音的赤口：没公开的赤宝牌在哪（别人手里的、牌山里的）
  private akaSpots(): Set<TileId> {
    const g = this.game!;
    if (this.chars[this.me]?.id !== 'toyone' || (g.phase !== 'turn' && g.phase !== 'calls')) return new Set();
    return toyoneRedHidden(g, this.me);
  }

  // 白望的迷途之家：这一次发动了，应该打的那张牌底下泛白色水波纹
  private rippleTile(): TileId | null {
    const g = this.game!;
    if (this.vision || this.chars[this.me]?.id !== 'shiromi') return null;
    return shiromiRipple(g, this.me);
  }

  // 龙华的无极天、小莳的天照、照的照魔镜：手里打出去会放铳的牌标红
  private deadlyTiles(): Set<TileId> {
    const g = this.game!;
    if (this.vision || (g.phase !== 'turn' && g.phase !== 'calls')) return new Set();
    // 小莳的天照也看得出手里的铳牌
    const mugoku = this.chars[this.me]?.id === 'ryuuka' && ryuukaMugoku(g, this.me);
    const amaterasu = this.chars[this.me]?.id === 'komaki' && komakiActiveGod(g, this.me) === 'amaterasu';
    // 照的照魔镜：立直的人听的牌
    const teru = this.chars[this.me]?.id === 'teru';
    if (!mugoku && !amaterasu && !teru) return new Set();
    const kinds = mugoku ? ryuukaDanger(g, this.me) : amaterasu ? dangerKinds(g, this.me) : teruDanger(g, this.me);
    return new Set(g.players[this.me].hand.filter((t) => kinds.has(kindOf(t))));
  }

  // 自己立直后摸到、和不了也杠不了的那张（只能摸切）：牌桌上让它停在空中。摸牌路径关掉时照常进手牌
  private airDraw(): TileId | null {
    const g = this.game!;
    const p = g.players[this.me];
    if (this.settings.drawPath === 'off') return null;
    if (g.phase !== 'turn' || g.turn !== this.me || !p.riichi || this.showResult) return null;
    return g.legalActions(this.me).length === 1 ? p.drawn : null;
  }

  // 2.5D 的头像框：只放头像和名字（风位、点数、立直看中间的仪表盘，技能看左上角的能力说明）；轮到谁谁亮
  private seatFrameHtml(s: number): string {
    const g = this.game!;
    const c = this.chars[s];
    const active = g.phase === 'turn' && g.turn === s && !this.showResult ? 'active' : '';
    // 怜演算时换成“能力发动头像”（眼睛发光），头像框发绿光
    // 第二形态（天使和）也一直用能力发动头像
    // 臼泽塞用镜片盯上人的那一局也换头像（powered），但框不发光
    const power = (s === this.me && !!this.vision) || !!g.active(s)?.form?.(g, s);
    const src = power || g.active(s)?.powered?.(g, s) ? powerPortraitUrl(c.id) : portraitUrl(c.id, this.faceOf(s));
    const badge = c.ability && g.isSealed(s) ? '封印' : this.sistersBlocked(s) ? '七姐妹·封住' : c.ability?.badge?.(g, s);
    return `
      <div class="seat-frame ${POS[s]} ${active} ${g.seesRiichi(s, this.me) ? 'riichi' : ''}${power ? ' power' : ''}" data-seat="${s}" style="--c:${c.color}">
        ${this.teamOf(s) ? `<span class="tm-ribbon" style="--t:${this.teamOf(s)!.color}">${this.teamOf(s)!.name}</span>` : ''}
        <div class="portrait"><span class="face">${c.name.slice(-1)}</span><img src="${src}" alt="" onerror="this.remove()" />${badge ? `<span class="badge">${badge}</span>` : ''}${this.bulbHtml(s)}${this.distHtml(s)}${this.mirrorHtml(s)}${this.lensMark(s)}</div>
        ${this.towerHtml(s)}
        <div class="seat-info">${c.name}</div>
      </div>`;
  }

  // 每局开始：屏幕中间横着播一下“东场 第一局 0本场”。
  // 刚建好牌桌的那几帧很卡，等画面先出来两帧再播；播完自己拿掉
  private roundBanner(): void {
    const g = this.game;
    if (!g) return;
    const html = `<div class="round-banner"><div class="rbn-band"><span class="rbn-main">${WIND_CN[g.roundWind]}场 第${'一二三四'[g.roundNumber]}局</span><span class="rbn-sub">${g.honba} 本场</span></div></div>`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById('banner');
        if (!el) return;
        el.innerHTML = html;
        el.querySelector('.rbn-band')?.addEventListener('animationend', () => (el.innerHTML = ''));
      }),
    );
  }

  // 轮到自己出牌时，算出打哪几张能听牌、各听什么（立直模式下按立直算番）
  private updatePreview(): void {
    const g = this.game!;
    this.preview.clear();
    const myTurn = g.phase === 'turn' && g.turn === this.me;
    if (!myTurn) this.previewTile = null;
    // 这一局和不了（被七姐妹封住、照魔镜那一局）就不标听牌
    if (!myTurn || g.players[this.me].riichi || !g.canWin(this.me)) return;
    const byKind = new Map<string, WaitInfo>();
    for (const t of this.discardable()) {
      // 同一种牌打哪张都一样（赤五单算，宝牌数不同）
      const key = `${kindOf(t)}-${isRed(t)}`;
      let info = byKind.get(key);
      if (!info) byKind.set(key, (info = waitInfo(g, this.me, t, this.riichiMode)));
      if (info.tiles.length) this.preview.set(t, info);
    }
  }

  private hoverTile(id: TileId | null): void {
    if (id === this.previewTile) return;
    this.previewTile = id;
    const slot = document.querySelector('[data-r=waits]');
    if (slot) slot.innerHTML = this.waitsSlotHtml();
    const say = document.querySelector('[data-r=say]');
    if (say) say.innerHTML = this.sayText();
    const fs = document.querySelector('[data-r=fs]');
    if (fs && this.game && !this.vision) fs.innerHTML = this.nextDrawHtml();
  }

  // ---------- 憧：距离感 ----------

  // 鸣过牌以后，别人头像旁边的点：离听牌还差几步（听牌了亮「听」），不显示听什么
  private distHtml(s: number): string {
    const g = this.game!;
    if (s === this.me || (g.phase !== 'turn' && g.phase !== 'calls') || g.stealthed(s, this.me)) return '';
    // 龙华的无极天：只看得出听没听牌
    if (this.chars[this.me]?.id === 'ryuuka' && ryuukaMugoku(g, this.me)) {
      return ryuukaSensesTenpai(g, s) ? '<span class="dist tenpai" title="无极天：听牌了">听</span>' : '';
    }
    // 涅莉：手里还有运势就看得出谁听牌了
    if (this.chars[this.me]?.id === 'nelly' && !g.isSealed(this.me) && nellySenses(g, this.me)) {
      return nellySensesTenpai(g, s) ? '<span class="dist tenpai" title="运势：听牌了">听</span>' : '';
    }
    if (this.chars[this.me]?.id !== 'ako' || !akoSense(g, this.me)) return '';
    const d = akoDistance(g, s);
    const inner = d === 0 ? '听' : '●'.repeat(Math.min(3, d));
    return `<span class="dist${d === 0 ? ' tenpai' : ''}" title="距离感：${d === 0 ? '听牌了' : `还差 ${d} 步`}">${inner}</span>`;
  }

  // ---------- 洋榎：读牌 ----------

  // 读牌的人：洋榎，和读得出没有能力的人的真子
  private isHiroe(): boolean {
    return ['hiroe', 'mako'].includes(this.chars[this.me]?.id) && !this.game?.isSealed(this.me);
  }

  // 听牌的人头像旁边的灯：牌越大越亮（只给操作洋榎的玩家看）
  private bulbHtml(s: number): string {
    const g = this.game!;
    if (!this.isHiroe() || s === this.me || this.vision || (g.phase !== 'turn' && g.phase !== 'calls') || g.stealthed(s, this.me)) return '';
    if (this.chars[this.me].id === 'mako' && !makoKnows(g, s)) return '';
    const r = readTenpai(g, s);
    if (!r) return '';
    const lv = bulbLevel(r.value);
    return `<span class="bulb lv${lv}" title="听牌了：${BULB_NAMES[lv - 1]}">${bulbSvg(lv)}</span>`;
  }

  // ---------- 美穗子：右眼 ----------

  private eyeOpen(): boolean {
    const g = this.game!;
    return this.chars[this.me]?.id === 'mihoko' && mihokoEyeOpen(g, this.me) && (g.phase === 'turn' || g.phase === 'calls');
  }

  // ---------- 照：照魔镜 ----------

  // 照魔镜看过以后，别人头像上的镜子：指着（手机上点）看这家能力现在的状态
  private mirrorHtml(s: number): string {
    const g = this.game!;
    if (this.chars[this.me]?.id !== 'teru' || s === this.me || !teruMirrored(g, this.me) || g.isSealed(this.me)) return '';
    const c = this.chars[s];
    const proof = !!g.active(s)?.mirrorProof?.(g, s);
    const lines = proof ? ['天岩户：照魔镜照不进去'] : c.ability ? c.ability.insight?.(g, s) ?? [c.ability.description] : ['没有能力，只靠牌效和防守'];
    const name = c.ability ? c.ability.name : '无能力';
    return `<span class="mirror" tabindex="0" aria-label="照魔镜：${c.name}">镜<span class="mirror-pop"><b>${c.name} · ${name}</b>${lines.map((l) => `<span>${l}</span>`).join('')}</span></span>`;
  }

  // ---------- 臼泽塞：镜片 ----------

  // 这一局谁的镜片盯上了 s（谁都看得见）
  private sniper(s: number): number | null {
    const g = this.game!;
    return g.phase === 'turn' || g.phase === 'calls' ? snipedBy(g, s) : null;
  }

  private lensMark(s: number): string {
    const by = this.sniper(s);
    return by === null ? '' : lensMarkHtml(this.chars[by].name);
  }

  // 名牌上能力那一行：这一局和不了的写原因
  private blockedText(s: number): string | null {
    if (this.sistersBlocked(s)) return '被七姐妹封住';
    if (this.sniper(s) !== null) return '被镜片盯上';
    return null;
  }

  private lensDragging = false;

  private initLens(): void {
    initLensDrag(this.root, {
      canDrop: (s) => !!this.game && !this.vision && this.chars[this.me]?.id === 'sae' && saeCanAim(this.game, this.me, s),
      nameOf: (s) => this.chars[s].name,
      onDrop: (s) => {
        if (this.game && !this.vision) saeAim(this.game, this.me, s);
        this.render();
      },
      onLift: (on) => {
        this.lensDragging = on;
        this.render();
      },
    });
  }

  // 这一局被涅莉的七姐妹封住、和不了
  // 花田煌：手里有放铳会被击飞、打不出去的牌
  private bustBlocked(): boolean {
    const g = this.game!;
    if (!g.abilities[this.me]?.unbustable || this.riichiMode || g.players[this.me].riichi) return false;
    const can = this.discardable();
    return g.players[this.me].hand.some((t) => !can.has(t) && !g.players[this.me].kuikaeBan.includes(kindOf(t)));
  }

    private sistersBlocked(s: number): boolean {
    const g = this.game!;
    return [0, 1, 2, 3].some((o) => o !== s && g.active(o)?.id === 'nelly' && nellyBlocked(g, o).includes(s));
  }

  // ---------- 照：天梯 ----------

  // 头像旁边的宝塔：八层（越往上越窄），顶上是役满的塔尖；站到的那几层亮金色，下一层闪；
  // 天梯断了、还没重新起胡时塔变灰。底下八颗叽叽叽（自摸次数）。鼠标停在塔上看站在哪、下一次要和多少
  private towerHtml(s: number): string {
    const g = this.game!;
    if (this.chars[s]?.id !== 'teru' || !teruMirrored(g, s) || g.isSealed(s)) return '';
    const { level, next, broke, kiki } = teruLadder(g, s);
    const tiers = TERU_TIERS.slice(0, TERU_TOP - 1)
      .map((name, i) => {
        const n = i + 1;
        const cls = n <= level ? ' lit' : n === next ? ' next' : '';
        return `<i class="tt-tier${cls}" style="--i:${i}">${name}</i>`;
      })
      .reverse()
      .join('');
    const pips = Array.from({ length: TERU.kiki }, (_, i) => `<i${i < kiki ? ' class="on"' : ''}></i>`).join('');
    const head =
      level >= TERU_TOP ? '登顶了（役满），下一次从 1 番重新爬' : level ? `站在${TERU_TIERS[level - 1]}，下一次要正好和${TERU_TIERS[next - 1]}` : broke ? `天梯断了（${broke}），从 1 番起胡` : '先和一个 1 番起胡';
    const note = `${head}；叽叽叽 ${kiki}/${TERU.kiki}`;
    return `<span class="teru-tower${broke && !level ? ' broken' : ''}" title="${note}"><i class="tt-spire${level >= TERU_TOP ? ' lit' : ''}"></i>${tiers}<span class="tt-kiki">${pips}</span></span>`;
  }

  // 指着会放铳的牌时她的提醒：第一张“有点不妙”，第二张不一样的“恐怕也不行”，再往后不说了
  private sayText(): string {
    const g = this.game!;
    // 天使和只读得出 8000 点以上的铳牌（不亮灯）
    const angel = this.chars[this.me]?.id === 'nodoka' && nodokaAngel(g, this.me);
    if (!(this.isHiroe() || angel) || this.vision || !this.myDiscardTurn() || this.previewTile === null) return '';
    const id = this.chars[this.me].id;
    if (this.dangerCache.at !== g.events.length) this.dangerCache = { at: g.events.length, kinds: id === 'mako' ? makoDanger(g, this.me) : angel ? angelDanger(g, this.me) : dangerKinds(g, this.me) };
    const k = kindOf(this.previewTile);
    if (!this.dangerCache.kinds.has(k)) return '';
    const key = this.turnKey();
    if (this.say.key !== key) this.say = { key, first: null, second: null };
    const st = this.say;
    if (st.first === null) st.first = k;
    else if (st.second === null && k !== st.first) st.second = k;
    const text = k === st.first ? '这张牌有点不妙啊' : k === st.second ? '这张恐怕也不行' : '';
    return text ? `<div class="say-bubble">${text}</div>` : '';
  }

  // ---------- 怜：看下一巡 ----------

  private isToki(): boolean {
    return this.chars[this.me]?.id === 'toki' && !this.game?.isSealed(this.me);
  }

  // 这一回合：同一局、牌山剩的张数和自己打过的张数都没变
  private turnKey(): string {
    const g = this.game!;
    return `${g.roundWind}-${g.roundNumber}-${g.honba}-${g.wall.remaining}-${g.players[this.me].discards.length}`;
  }

  private myDiscardTurn(): boolean {
    const g = this.game!;
    return g.phase === 'turn' && g.turn === this.me && !this.showResult && this.discardable().size > 0;
  }

  private canDeep(): boolean {
    const key = this.turnKey();
    const count = this.looks.key === key ? this.looks.count : 0;
    return this.isToki() && !this.vision && this.myDiscardTurn() && !this.blocked && count < 2 && this.stamina >= DEEP_COST;
  }

  // 发动：牌局复制一份放到牌桌上，她接着在复制品上出牌
  private startVision(): void {
    if (!this.canDeep()) return;
    const real = this.game!;
    const key = this.turnKey();
    if (this.looks.key !== key) this.looks = { key, count: 0, last: '', at: -1 };
    if (++this.looks.count >= 2) this.penaltyNext = true;
    this.stamina -= DEEP_COST;
    const sim = cloneGame(real);
    sim.onEvent((e) => this.onGameEvent(e));
    this.vision = { real, start: sim.events.length, rons: [], faces: [...this.faces] };
    this.game = sim;
    playChime();
    this.step();
  }

  // 退出：换回真的牌局，牌桌直接摆回去（不播动画），表情也换回来。演算的经过留在小框里
  private exitVision(): void {
    const v = this.vision;
    if (!v) return;
    this.looks.last = this.stepsHtml(this.visionSteps());
    this.looks.at = v.real.events.length;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.game = v.real;
    this.faces = v.faces;
    this.vision = null;
    this.riichiMode = false;
    this.cutins?.clear();
    this.render();
    this.table3d?.restore();
    this.step();
  }

  private visionSteps(): SeenStep[] {
    const v = this.vision;
    return v ? readSteps(this.game!, v.start, this.me, v.rons) : [];
  }

  // 演算的经过，一行一件事
  private stepsHtml(steps: SeenStep[]): string {
    const g = this.game!;
    const name = (s: number) => (s === this.me ? '你' : this.chars[s].name);
    const tsumo = g.phase === 'turn' && g.turn === this.me && g.legalActions(this.me).some((a) => a.type === 'tsumo');
    return steps
      .map((st) => {
        if (st.kind === 'discard')
          return `<div class="fs-row${st.seat === this.me ? ' mine' : ''}"><span>${name(st.seat)}</span><span class="fs-act">${st.riichi ? '<b>立直</b> ' : ''}打 ${tileHtml(st.tile, { size: 'mini' })}</span></div>`;
        if (st.kind === 'call') return `<div class="fs-row hot"><span>${name(st.seat)}</span><b>${st.call}！</b></div>`;
        if (st.kind === 'ability') return `<div class="fs-row quiet"><span>${name(st.seat)}</span><span>${st.text}</span></div>`;
        if (st.kind === 'canRon') return `<div class="fs-row good"><span>你</span><b>能荣和 ${tileHtml(st.tile, { size: 'mini' })}</b></div>`;
        if (st.kind === 'draw')
          return `<div class="fs-row mine"><span>你</span><span class="fs-act">${tsumo ? '<b>自摸！</b> ' : ''}摸 ${tileHtml(st.tile, { size: 'mini' })}</span></div>`;
        const r = st.result;
        if (r.kind !== 'win') return `<div class="fs-row quiet"><span>流局</span><span>${r.kind === 'exhaustive' ? '荒牌流局' : (r.reason ?? '')}</span></div>`;
        return r.wins
          .map((w) => {
            const how = w.from === null ? '自摸' : w.from === this.me ? '荣和（你放铳）' : `荣和 ${name(w.from)}`;
            return `<div class="fs-row ${w.from === this.me ? 'bad' : 'hot'}"><span>${name(w.seat)}</span><b>${how}</b></div>`;
          })
          .join('');
      })
      .join('');
  }

  // 待和提示框：别人的回合显示现在听什么；自己的回合鼠标停在能听牌的牌上时，显示打掉它以后听什么
  private waitsSlotHtml(): string {
    const g = this.game!;
    if (!(g.phase === 'turn' && g.turn === this.me)) return this.waitsHtml(waitInfo(g, this.me));
    const info = this.previewTile !== null ? this.preview.get(this.previewTile) : undefined;
    return info ? this.waitsHtml(info, '打这张 ') : '';
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
    return `${WIND_CN[g.seatWind(s) - 27]} ${this.nameHtml(s)}`;
  }

  private centerHtml(): string {
    const g = this.game!;
    const dora = [0, 1, 2, 3, 4]
      .map((i) => (i < g.wall.doraRevealed ? tileHtml(g.wall.doraIndicators[i], { size: 'mini' }) : backHtml('mini')))
      .join('');
    const scores = [0, 1, 2, 3]
      .map((s) => {
        const active = g.phase === 'turn' && g.turn === s ? 'active' : '';
        return `<div class="score ${POS[s]} ${active}" style="--c:${this.chars[s].color}">
          <span class="wind">${WIND_CN[g.seatWind(s) - 27]}</span>
          <span class="pts">${g.shownScore(s, this.me)}</span>
          ${g.players[s].riichi && g.seesRiichi(s, this.me) ? '<span class="stick"></span>' : ''}
        </div>`;
      })
      .join('');
    return `
      <div class="round">${g.roundLabel()}</div>
      <div class="remain">余 ${g.wall.remaining}</div>
      <div class="sticks">立直棒 ×${g.shownSticks(this.me)}</div>
      <div class="dora">${dora}</div>
      ${this.sakiPeekHtml()}
      ${scores}`;
  }

  // 宫永咲的王牌感知（2D）：中间放 4 张岭上牌的牌背，鼠标移到上面牌背变透明看得到牌；杠材在牌山第几张一直写着
  private sakiPeekHtml(): string {
    const see = this.sakiSees();
    if (!see) return '';
    const g = this.game!;
    const tiles = g.wall.rinshan.map((t) => tileHtml(t, { size: 'mini', classes: ['peek'] })).join('');
    const kan = [...sakiKanTiles(g, this.me)].map((t) => `${kindLabel(kindOf(t))}（再摸 ${g.wall.live.indexOf(t) + 1} 张）`);
    const note = kan.length ? `杠材：${kan.join('、')}` : sakiKanKinds(g, this.me).length ? '杠材不在牌山里' : '';
    return `<div class="rinshan-peek" title="王牌感知"><span>岭上</span>${tiles}</div>${note ? `<div class="kan-peek">${note}</div>` : ''}`;
  }

  // 宫永咲的王牌感知开着没有（是她、能力没被封住、在打牌），开着时是她看得穿的牌（岭上牌、牌山里杠材的第四张）
  private sakiSees(): Set<TileId> | undefined {
    const g = this.game;
    if (!g || this.chars[this.me]?.id !== 'saki' || this.vision || (g.phase !== 'turn' && g.phase !== 'calls')) return undefined;
    if (!g.active(this.me) || g.isSealed(this.me)) return undefined;
    return sakiSeesThrough(g, this.me);
  }

  private meldsHtml(melds: Meld[], seat: number): string {
    const glow = this.glowTiles();
    return melds.map((m) => `<div class="meld" title="${seat}">${meldTilesHtml(m, seat, 'pond', glow)}</div>`).join('');
  }

  // ---------- 薄墨初美的里鬼门 ----------

  // 紫色的风聚得多浓（谁都看得见）：东北都鸣出来以后照小四喜的进度，听牌最浓。
  // 一局结束时她没和就散掉；和了的话留到紫光往上冲那一下
  private galeView(): { seat: number; level: number } | null {
    const g = this.game;
    if (!g || g.phase === 'predeal' || g.phase === 'postdeal') return null;
    const seat = [0, 1, 2, 3].find((s) => this.chars[s]?.id === 'hatsumi' && hatsumiGale(g, s) > 0);
    if (seat === undefined) return null;
    if (g.phase === 'roundEnd' || g.phase === 'gameEnd') {
      if (!g.roundResult?.wins.some((w) => w.seat === seat)) return null;
      return { seat, level: 1 };
    }
    return { seat, level: hatsumiGale(g, seat) };
  }

  // 初美鸣出来的东、北：每一副中间那张的字发紫光
  private glowTiles(): Set<TileId> {
    const g = this.game;
    const out = new Set<TileId>();
    if (!g) return out;
    for (let s = 0; s < 4; s++) {
      if (this.chars[s]?.id !== 'hatsumi') continue;
      for (const i of hatsumiGlowMelds(g, s)) {
        const slots = meldLayout(g.players[s].melds[i], s).filter((x) => !x.hidden);
        const mid = slots[Math.floor((slots.length - 1) / 2)];
        if (mid) out.add(mid.tile);
      }
    }
    return out;
  }

  // 2D 牌桌：紫色的风是一层盖在牌桌上的弧线（不跟着牌桌重画，动画不会断）；和牌时一阵紫光往上冲
  private gale2d(level: number): void {
    const host = document.querySelector('.stage .table');
    if (!host) return;
    let el = host.querySelector<HTMLElement>(':scope > .gale');
    if (!el) {
      el = document.createElement('div');
      el.className = 'gale';
      const colors = ['#c23cff', '#e04cff', '#9b3cff', '#ff5ae6', '#b45cff', '#f0a8ff'];
      const arcs = Array.from({ length: GALE_ARCS }, (_, k) => {
        const s = 180 + Math.random() * 760;
        const d = 2.6 + Math.random() * 3.4;
        return `<i style="--k:${k}"><b style="--s:${s.toFixed(0)}px;--e:${(0.7 + Math.random() * 0.3).toFixed(2)};--d:${d.toFixed(2)}s;--w:${(1.5 + Math.random() * 2.5).toFixed(1)}px;--c:${colors[k % colors.length]};animation-delay:${(-Math.random() * d).toFixed(2)}s"></b></i>`;
      }).join('');
      const rays = Array.from({ length: 72 }, () => {
        const a = (Math.random() - 0.5) * 70;
        return `<u style="--a:${a.toFixed(1)}deg;--len:${(120 + Math.random() * 260).toFixed(0)}px;--x:${((Math.random() - 0.5) * 50).toFixed(0)}px;--c:${colors[Math.floor(Math.random() * colors.length)]};animation-delay:${(Math.random() * 0.35).toFixed(2)}s"></u>`;
      }).join('');
      el.innerHTML = `${arcs}<span class="gale-burst">${rays}</span>`;
      host.prepend(el);
    }
    el.style.setProperty('--lv', level.toFixed(3));
    el.style.setProperty('--n', String(GALE_ARCS));
  }

  // 2D：和牌那一下紫光往上冲（盖在结算上面，冲完自己收起来）
  private galeBurst2d(): void {
    const el = document.querySelector<HTMLElement>('.stage .table > .gale');
    if (!el) return;
    el.classList.remove('burst');
    void el.offsetWidth;
    el.classList.add('burst');
    window.setTimeout(() => el.classList.remove('burst'), 2600);
  }

  private opponentHtml(s: number): string {
    const g = this.game!;
    const p = g.players[s];
    const c = this.chars[s];
    // 美穗子睁眼：牌背按花色上色（照理过的顺序排，刚摸的那张放最后）
    const tint = this.eyeOpen() && !this.vision;
    const order = tint ? [...p.hand.filter((t) => t !== p.drawn).sort((a, b) => a - b), ...(p.drawn !== null ? [p.drawn] : [])] : p.hand;
    const aka = this.vision ? new Set<TileId>() : this.akaSpots();
    // 隐身的桃子的手牌也看不见
    // 公开手牌：照顺序排好亮出来
    const open = this.openHands() ? [...p.hand.filter((t) => t !== p.drawn).sort((a, b) => a - b), ...(p.drawn !== null ? [p.drawn] : [])] : null;
    const vanish = this.vanishStyle(s);
    const backs = g.stealthed(s, this.me) && !vanish
      ? ''
      : open
        ? open.map((t) => tileHtml(t, { size: 'pond' })).join('')
        : order.map((t) => backHtml('top', aka.has(t) ? 'aka' : tint ? tintOf(t) : undefined)).join('');
    return `
      <div class="opponent ${POS[s]}" style="--c:${c.color}">
        <div class="ohand${vanish ? ' vanish' : ''}"${vanish}>${backs}</div>
        <div class="melds${vanish ? ' vanish' : ''}"${vanish}>${g.stealthed(s, this.me) && !vanish ? '' : this.meldsHtml(p.melds, s)}</div>
      </div>`;
  }

  private pondHtml(s: number): string {
    const g = this.game!;
    const p = g.players[s];
    const last = g.lastDiscard;
    // 隐身的桃子的牌河别人看不见（刚隐身的那一会儿慢慢淡掉）；她自己看得见，淡淡地显示
    const vanish = this.vanishStyle(s);
    if (g.stealthed(s, this.me) && !vanish) return `<div class="pond ${POS[s]}"></div>`;
    const ghost = [0, 1, 2, 3].some((o) => o !== s && g.stealthed(s, o));
    const tiles = p.discards
      .map((d, i) => {
        const classes: string[] = [];
        if (ghost) classes.push('stealth');
        if (d.called) classes.push('called');
        if (d.tsumogiri) classes.push('tsumogiri');
        if (last && last.seat === s && i === p.discards.length - 1) classes.push('last');
        if (this.freshDiscard === `${s}-${i}`) classes.push('fresh');
        // 淡掉的时候立直宣言牌也竖着：别人不该知道她立直了
        return tileHtml(d.tile, { size: 'pond', sideways: d.riichi && !vanish, classes });
      })
      .join('');
    return `<div class="pond ${POS[s]}${vanish ? ' vanish' : ''}"${vanish}>${tiles}</div>`;
  }

  // 桃子正在淡掉：返回接着播动画的 style（重画时从播到的地方接着播），没在淡就是空串
  private vanishStyle(s: number): string {
    const at = this.vanishAt.get(s);
    if (at === undefined) return '';
    const t = Date.now() - at;
    if (t >= VANISH_MS) {
      this.vanishAt.delete(s);
      return '';
    }
    return ` style="animation-delay:-${t}ms"`;
  }

  private myAreaHtml(withHand = true, withPlate = true): string {
    const g = this.game!;
    const p = g.players[this.me];
    // 演算里只出牌（可以立直），不自摸、不杠、不鸣
    // 挂机时电脑替她打，不出按钮
    const legal = this.auto ? [] : this.vision ? g.legalActions(this.me).filter((a) => a.type === 'discard') : g.legalActions(this.me);
    const discardable = this.discardable();
    const sorted = this.myHand();
    // 能打的牌亮着，打出去能听牌的上面加个小三角
    const deadly = this.deadlyTiles();
    const ripple = this.rippleTile();
    const classes = (t: TileId) => [discardable.has(t) ? 'can' : 'dim', ...(this.preview.has(t) ? ['tenpai'] : []), ...(deadly.has(t) ? ['deadly'] : []), ...(t === ripple ? ['ripple'] : [])];
    const hand = sorted.map((t) => tileHtml(t, { classes: classes(t), data: { tile: t } })).join('');
    const drawn =
      p.drawn !== null ? `<div class="drawn">${tileHtml(p.drawn, { classes: classes(p.drawn), data: { tile: p.drawn } })}</div>` : '';

    const buttons: string[] = [];
    // 3D 牌桌上别人打的牌还在半空时先不弹鸣牌按钮，落桌后 step 会再画一次
    const landing = g.phase === 'calls' && this.busyMs() > 0;
    if (!landing) legal.forEach((a, i) => {
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
            ? tileHtml(a.kind * 4 + 3, { size: 'mini' })
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

    const waitHtml = `<div data-r="waits">${this.waitsSlotHtml()}</div>`;
    const hint =
      g.phase === 'turn' && g.turn === this.me && discardable.size > 0
        ? `<div class="hint">${this.riichiMode ? '选择立直宣言牌' : '点击一张牌打出'}${this.sistersBlocked(this.me) ? '（被七姐妹封住，这一局和不了）' : ''}${this.sniper(this.me) !== null ? '（被镜片盯上，这一局和不了）' : ''}${this.bustBlocked() ? '（灰掉的牌放铳会被击飞，打不出去）' : ''}</div>`
        : '';
    const c = this.chars[this.me];
    return `
      <div class="me" style="--c:${c.color}">
        <div class="actions">${buttons.join('')}</div>
        ${this.autoBtnHtml()}${this.assistHtml()}
        ${this.sketchPlanHtml()}${waitHtml}${hint}
        ${
          withHand
            ? `<div class="hand-row">
          <div class="hand">${hand}${drawn}</div>
          <div class="melds${[0, 1, 2, 3].some((o) => o !== this.me && g.stealthed(this.me, o)) ? ' stealth' : ''}">${this.meldsHtml(p.melds, this.me)}</div>
        </div>`
            : ''
        }
        ${withPlate && !this.netView ? `<div class="nameplate mine"><div class="avatar">${c.name.slice(-1)}</div><div class="pname">${this.seatLabel(this.me)}</div></div>` : ''}
      </div>`;
  }

  // 待和提示：每张待和牌下面写还剩几张、荣和几番；没役、只能自摸的写明白，和不了的变灰
  private waitsHtml(info: WaitInfo, prefix = ''): string {
    if (!info.tiles.length) return '';
    const status = info.tiles.map((w) => waitStatus(w, info.furiten));
    const tiles = info.tiles
      .map((w, i) => {
        const st = status[i];
        const label = st === 'ron' ? hanLabel(w.ron!) : st === 'tsumo' ? '仅自摸' : '无役';
        const dead = st === 'none' || w.left === 0;
        return `<div class="wait${dead ? ' dead' : ''}">${tileHtml(w.kind * 4 + 3, { size: 'pond' })}<span class="wait-left">余 ${w.left}</span><span class="wait-han ${st}">${label}</span></div>`;
      })
      .join('');
    const title = prefix + (status.every((st) => st === 'none') ? '形式听牌（无役）' : '听牌');
    return `<div class="waits"><div class="waits-title">${title}${info.furiten ? '<span class="furiten">振听</span>' : ''}</div><div class="wait-list">${tiles}</div></div>`;
  }

  // 2.5D 不放能力说明，只在能力有东西要给玩家看时（怜的一巡先见、淡和霞的技能按钮）放一个小框
  private foresightHtml(): string {
    const c = this.chars[this.me];
    const extra = this.foresightBox() + this.skillBox();
    return extra ? `<div class="ability-panel foresight-only" style="--c:${c.color}">${extra}</div>` : '';
  }

  // 谁封印了自己：末原恭子鸣牌打乱流向只到她下一次摸牌，狮子原爽的蛇神威是一整局
  private sealText(): string {
    const g = this.game!;
    const by = g.abilities.find((a, o) => o !== this.me && a?.seals?.(g, o, g.round));
    return by?.id === 'kyouko' ? '末原恭子鸣牌打乱了流向，到她下一次摸牌之前能力不起作用' : '狮子原爽的蛇神威封印了别人的能力，这一局能力不起作用';
  }

  // 主动开的技能：能量条和开关按钮（演算中不显示）
  private skillBox(): string {
    const g = this.game!;
    const ab = this.chars[this.me].ability;
    if (ab && g.isSealed(this.me)) return `<div class="foresight skill"><div class="fs-title">${ab.name}<span class="skill-on sealed">被封印</span></div><div class="fs-note skill-state">${this.sealText()}</div></div>`;
    const b = !this.vision && ab?.skill?.(g, this.me);
    if (!b) return '';
    const meter = b.meter
      ? `<span class="stamina energy" title="${b.meter.label ?? '能量'}"><i style="width:${(b.meter.value / b.meter.max) * 100}%"></i></span><span class="st-num">${b.meter.value}</span>`
      : '';
    // 有按钮的技能（pressSkill）画按钮；发牌前选的技能（淡、霞）只显示状态
    // 要选对象的（爽的瘟神威）一个对象一个按钮
    // 爱丽丝的画笔：一支支画出来，没用的亮着、能用时可以点，用掉的变成断掉的灰笔
    const body = b.brushes
      ? `<div class="fs-note skill-state">${b.note}</div><div class="brush-row">${Array.from({ length: b.brushes.max }, (_, i) => {
          const live = i < b.brushes!.left;
          const can = live && b.brushes!.ready;
          return `<button class="brush${live ? '' : ' used'}${can ? ' ready' : ''}" data-ui="skill" title="${live ? (can ? '用这支画笔再画一次手绘板' : '画笔') : '用掉了'}" ${can ? '' : 'disabled'}>${brushSvg(!live)}</button>`;
        }).join('')}</div>`
      : b.lenses
      ? lensSlotsHtml(b.lenses, b.note, this.lensDragging)
      : b.choices
      ? `<div class="fs-note skill-state">${b.note}</div><div class="skill-choices${b.choices.length > 4 ? ' many' : ''}">${b.choices
          .map((c) => `<button class="deep-btn" data-ui="skill" data-choice="${c.id}" ${c.enabled ? '' : 'disabled'}>${c.label}</button>`)
          .join('')}</div>`
      : ab!.pressSkill
        ? `<button class="deep-btn${b.active ? ' active' : ''}" data-ui="skill" ${b.enabled ? '' : 'disabled'}>${b.label}<small>${b.note}</small></button>`
        : `<div class="fs-note skill-state">${b.note}</div>`;
    return `<div class="foresight skill"><div class="fs-title">${ab!.name}${b.active ? '<span class="skill-on">发动中</span>' : ''}${meter}</div>${body}</div>`;
  }

  // ---------- 发牌前选技能（淡、霞） ----------

  private pdPicks: Set<string> | null = null;
  // 选数的选项（涅莉分运势）现在选的数
  private pdValues: Record<string, number> | null = null;
  // 配牌后的面板收起来了（看整张牌桌）
  private pdFolded = false;

  private predealHtml(): string {
    const g = this.game!;
    const ab = this.chars[this.me].ability;
    const post = g.phase === 'postdeal';
    const opts = (post ? ab?.postDeal?.(g, this.me) : ab?.preDeal?.(g, this.me)) ?? [];
    if (opts.some((o) => o.stepper)) return this.stepperHtml(opts);
    if (!this.pdPicks) this.pdPicks = new Set(opts.filter((o) => o.picked).map((o) => o.id));
    const meter = ab?.skill?.(g, this.me)?.meter;
    const spend = opts.filter((o) => this.pdPicks!.has(o.id)).reduce((sum, o) => sum + (o.cost ?? 0), 0);
    const left = meter ? meter.value - spend : Infinity;
    const unit = meter?.label ?? '能量';
    const rows = opts
      .map((o) => {
        const on = this.pdPicks!.has(o.id);
        const affordable = on || (o.cost ?? 0) <= left;
        const usable = o.enabled && affordable;
        const note = !o.enabled ? (o.note ?? '') : !affordable ? `${unit}不够` : o.cost ? `${unit} -${o.cost}` : '';
        return `<button class="pd-opt${on ? ' on' : ''}" data-ui="pd" data-pd="${o.id}"${o.group ? ` data-group="${o.group}"` : ''} ${usable ? '' : 'disabled'}>
          <span class="pd-check">${on ? '✓' : ''}</span>
          <span class="pd-text"><b>${o.name}</b><small>${o.desc}</small></span>
          <span class="pd-note">${note}</span></button>`;
      })
      .join('');
    const energy = meter
      ? `<div class="pd-energy">${unit} <span class="stamina energy"><i style="width:${(Math.max(0, left) / meter.max) * 100}%"></i></span> ${Math.max(0, left)} / ${meter.max}${spend ? `（这一局 -${spend}）` : ''}</div>`
      : '';
    // 配牌后选（爽）：把手牌摆在上面，看着手牌选
    const hand = post
      ? `<div class="pd-hand">${[...g.players[this.me].hand].sort((a, b) => a - b).map((t) => tileHtml(t, { size: 'pond' })).join('')}</div>`
      : '';
    const stage = post ? '配牌后' : '发牌前';
    const go = post ? '开始' : '发牌';
    // 牌桌已经建好时（配牌后，或者第二局起发牌前）面板停在上面、不盖住牌桌；还能收成一条，看整张牌桌
    if (post || this.tableBuilt) {
      if (this.pdFolded) {
        const names = opts.filter((o) => this.pdPicks!.has(o.id)).map((o) => o.name);
        return `<div class="pd-dock folded" style="--c:${this.chars[this.me].color}">
        <b>${g.roundLabel()} · ${stage}</b><span class="pd-picked">${names.length ? `已选：${names.join('、')}` : '还没选'}</span>
        <button data-ui="pd-fold">展开选技能</button><button class="primary" data-ui="pd-go">${go}</button></div>`;
      }
      return `<div class="pd-dock" style="--c:${this.chars[this.me].color}">
        <div class="pd-dock-head"><b>${g.roundLabel()} · ${stage}</b><span>${post ? '看着手牌选' : '选'}这一局要发动的技能（可以都不选）</span>
          <button data-ui="pd-fold">收起，看牌桌</button><button class="primary" data-ui="pd-go">${go}</button></div>
        ${post ? hand : this.seatMapHtml()}
        ${energy}
        <div class="pd-list">${rows}</div>
      </div>`;
    }
    return `<div class="modal"><div class="result predeal" style="--c:${this.chars[this.me].color}">
        <h2>${g.roundLabel()} · 发牌前</h2>
        ${this.seatMapHtml()}
        <p class="pd-sub">选这一局要发动的技能（可以都不选）</p>
        ${energy}
        <div class="pd-list">${rows}</div>
        <button class="primary" data-ui="pd-go">发牌</button>
      </div></div>`;
  }

  // 发牌前看不到牌桌：画个小牌桌，标出每一家是谁、坐什么风、多少分、什么能力（下家在右、对家在上、上家在左）
  private seatMapHtml(): string {
    const g = this.game!;
    const REL = ['自己', '下家', '对家', '上家'];
    const POS_CLS = ['sm-me', 'sm-right', 'sm-top', 'sm-left'];
    const cells = [0, 1, 2, 3]
      .map((rel) => {
        const s = (this.me + rel) % 4;
        const c = this.chars[s];
        return `<div class="sm-seat ${POS_CLS[rel]}" style="--c:${c.color}"><span class="sm-rel">${REL[rel]} · ${WIND_CN[g.seatWind(s) - 27]}</span><b>${c.name}</b><small>${g.players[s].score} 点 · ${c.ability?.name ?? '无能力'}</small></div>`;
      })
      .join('');
    return `<div class="seat-map">${cells}<div class="sm-center">${g.roundLabel()}</div></div>`;
  }

  // 选数的发牌前界面（涅莉开场分运势）：每一项一行加减，合规矩了才能发牌
  private stepperHtml(opts: PreDealOption[]): string {
    const g = this.game!;
    const ab = this.chars[this.me].ability!;
    if (!this.pdValues) this.pdValues = Object.fromEntries(opts.map((o) => [o.id, o.stepper?.value ?? 0]));
    const vals = this.pdValues;
    const rows = opts
      .filter((o) => o.stepper)
      .map((o) => {
        const v = vals[o.id];
        const { min, max } = o.stepper!;
        const cls = v > 0 ? ' up' : v < 0 ? ' down' : '';
        return `<div class="pd-step-row"><span class="pd-step-name">${o.name}</span>
          <button class="pd-step" data-ui="pd-step" data-pd="${o.id}" data-d="-1" ${v <= min ? 'disabled' : ''}>−</button>
          <span class="pd-step-val${cls}">${v > 0 ? '+' : ''}${v}</span>
          <button class="pd-step" data-ui="pd-step" data-pd="${o.id}" data-d="1" ${v >= max ? 'disabled' : ''}>+</button>
          <span class="pd-step-bar${cls}"><i style="width:${(Math.abs(v) / Math.max(-min, max)) * 100}%"></i></span></div>`;
      })
      .join('');
    const err = ab.preDealCheck?.(g, this.me, vals) ?? null;
    return `<div class="modal"><div class="result predeal" style="--c:${this.chars[this.me].color}">
        <h2>分配运势</h2>
        <p class="pd-sub">给这一场的每一局分运势，加起来要正好是 0。正的局摸牌顺、能用七姐妹；负的局摸牌差。</p>
        <div class="pd-steps">${rows}</div>
        <p class="pd-check-msg${err ? ' bad' : ''}">${err ?? '可以了'}</p>
        <button class="primary" data-ui="pd-go" ${err ? 'disabled' : ''}>开始</button>
      </div></div>`;
  }

  // 选好了：交给能力，发牌。第一局时牌桌还没建，先建牌桌
  private finishPredeal(): void {
    const g = this.game!;
    const ab = this.chars[this.me].ability;
    if (this.pdValues && ab?.preDealCheck?.(g, this.me, this.pdValues)) return;
    if (g.phase === 'postdeal') ab?.setPostDeal?.(g, this.me, [...(this.pdPicks ?? [])]);
    else ab?.setPreDeal?.(g, this.me, [...(this.pdPicks ?? [])], this.pdValues ?? undefined);
    this.pdPicks = null;
    this.pdValues = null;
    this.pdFolded = false;
    g.deal();
    if (!this.tableBuilt) this.buildTable();
    else this.step();
  }

  // 怜的一巡先见：平时只有自己下一张摸牌；玩家操作怜时还有体力条和“看下一巡”按钮，演算中换成演算的经过和“退出”
  private foresightBox(): string {
    const g = this.game!;
    const c = this.chars[this.me];
    // 龙华只在借怜的膝枕的局看得见
    const fs = g.isSealed(this.me) || c.ability?.foresightOn?.(g, this.me) === false ? undefined : c.ability?.foresight;
    if (!this.vision && (!fs || (g.phase !== 'turn' && g.phase !== 'calls'))) return '';
    const toki = this.isToki();
    const stamina = toki
      ? `<span class="stamina" title="体力"><i style="width:${(this.stamina / STAMINA_MAX) * 100}%"></i></span><span class="st-num">${this.stamina}</span>`
      : '';
    const title = `<div class="fs-title">${fs?.title ?? '一巡先见'}${stamina}</div>`;
    const v = this.vision;
    if (v) {
      const over = rehearsalOver(g, v.start, this.me);
      const head = g.events.length === v.start ? '演算中：选一张牌打出去' : over ? '演算结束' : '演算中……';
      return `<div class="foresight deep">${title}<div class="deep-head">${head}</div>${this.stepsHtml(this.visionSteps())}
        <button class="deep-btn" data-ui="deep-exit">退出演算</button>
        <div class="fs-note">演算里你不鸣牌；退出后牌局恢复原样</div></div>`;
    }
    let btn = '';
    if (toki && this.myDiscardTurn()) {
      const count = this.looks.key === this.turnKey() ? this.looks.count : 0;
      const [label, note] =
        this.blocked
          ? ['看下一巡', '这一局用不了']
          : count >= 2
            ? ['看下一巡', '这回合不能再看了']
            : this.stamina < DEEP_COST
              ? [count ? '再看一次' : '看下一巡', '体力不够']
              : count
                ? ['再看一次', `体力 -${DEEP_COST}，下一局不能用`]
                : ['看下一巡', `体力 -${DEEP_COST}`];
      btn = `<button class="deep-btn" data-ui="deep" ${this.canDeep() ? '' : 'disabled'}>${label}<small>${note}</small></button>`;
    }
    const last =
      this.looks.last && this.looks.key === this.turnKey() && this.looks.at === g.events.length && this.myDiscardTurn()
        ? `<div class="deep-head">上次演算</div>${this.looks.last}`
        : '';
    return `<div class="foresight">${title}<div data-r="fs">${this.nextDrawHtml()}</div>${btn}${last}<div class="fs-note">别人的能力已经算在里面；有人鸣牌、开杠时重新算</div></div>`;
  }

  // “你下一张”：在复制的牌局上演算（见 src/ai/forecast.ts），按现在的局面缓存，局面一变就重新算。
  // 轮到自己打牌时，下一张可能取决于打哪张：指着哪张就算打它；没指着时打哪张都一样才直接给
  private nextDrawHtml(): string {
    const g = this.game!;
    const row = (body: string) => `<div class="fs-row mine"><span>你下一张</span>${body}</div>`;
    let tile: TileId | null;
    if (this.myDiscardTurn()) {
      const riichi = this.riichiMode;
      if (this.previewTile !== null && this.discardable().has(this.previewTile)) {
        tile = this.forecast.get(g, this.me, { discard: this.previewTile, riichi });
      } else {
        const byKind = new Map<string, TileId>();
        for (const t of this.discardable()) byKind.set(`${kindOf(t)}-${isRed(t)}`, t);
        const all = [...byKind.values()].map((t) => this.forecast.get(g, this.me, { discard: t, riichi }));
        if (all.some((t) => t === null || kindOf(t) !== kindOf(all[0]!) || isRed(t) !== isRed(all[0]!))) return row('<small>指着要打的牌看看</small>');
        tile = all[0] ?? null;
      }
    } else tile = this.forecast.get(g, this.me);
    return row(tile === null ? '<small>看不清</small>' : tileHtml(tile, { size: 'mini' }));
  }

  private abilityPanelHtml(): string {
    const g = this.game!;
    const c = this.chars[this.me];
    if (!c.ability) {
      return `<div class="ability-panel" style="--c:${c.color}"><div class="ab-name">无能力</div><div class="ab-desc">不受影响，专心打牌。</div></div>`;
    }
    const extra = this.foresightBox() + this.skillBox();
    const lost = c.ability.id === 'kuro' && kuroLost(g, this.me);
    const badge = c.ability.badge?.(g, this.me);
    return `
      <div class="ability-panel" style="--c:${c.color}">
        <div class="ab-name">${this.towerHtml(this.me)}${c.ability.name}${lost ? '<span class="lost">整场失效</span>' : ''}${badge ? `<span class="ab-badge">${badge}</span>` : ''}</div>
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
    // 2.5D 的和牌结算左边放和牌的人的立绘（雀魂那样）
    const art = this.mode === '25d' && r.wins.length > 0;
    return `
      <div class="modal"><div class="result${art ? ' with-art' : ''}">
        ${title}${wins}${tenpai}
        ${this.deltasHtml(r)}
        ${this.traceHtml()}
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
    const url = cutinArt(this.chars[w.seat].id, 'result').url;
    const art =
      this.mode === '25d'
        ? `<div class="win-art">${url ? `<img src="${url}" alt="" onerror="this.remove()" />` : `<span class="win-glyph">${this.chars[w.seat].name.slice(-1)}</span>`}</div>`
        : '';
    return `
      <div class="win" style="--c:${this.chars[w.seat].color}">
        ${art}<div class="win-body">
        <h2>${this.chars[w.seat].name} ${how}</h2>
        <div class="win-hand">${hand}<span class="gap"></span>${tileHtml(w.tile, { size: 'pond', classes: ['win-tile'] })}<span class="gap"></span>${this.meldsHtml(w.melds, w.seat)}</div>
        ${ura}
        <div class="yaku-list">${yaku.join('')}</div>
        <div class="summary">${summary} ${points}</div>
        </div>
      </div>`;
  }

  // 团体赛：这个座位是哪一队
  private teamOf(s: number): { name: string; color: string } | null {
    return this.team ? this.team.run.teams[this.team.seats[s]] : null;
  }

  // 名字前面加队伍颜色的小方块（团体赛）
  private nameHtml(s: number): string {
    const t = this.teamOf(s);
    return `${t ? `<span class="tm-dot" style="--t:${t.color}" title="${t.name}"></span>` : ''}${this.chars[s].name}`;
  }

  private deltasHtml(r: RoundResult): string {
    const g = this.game!;
    return `<div class="deltas">${[0, 1, 2, 3]
      .map((s) => {
        const d = r.deltas[s];
        const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
        return `<div class="delta"><span>${this.nameHtml(s)}</span><span class="${cls}">${d > 0 ? '+' : ''}${d || ''}</span><span>${g.players[s].score}</span></div>`;
      })
      .join('')}</div>`;
  }

  // 能力痕迹：这一局牌山被动过的地方，按发生的先后讲出来
  private traceHtml(): string {
    const lines = (this.trace?.entries ?? [])
      .map((x) => traceLine(x, (s) => this.chars[s].name, (t) => tileHtml(t, { size: 'mini' })))
      .map(
        (l) =>
          `<div class="trace-line"><span class="trace-turn">第 ${l.turn} 巡</span><span class="trace-tag ${l.cls}">${l.tag}</span><span class="trace-text">${l.html}</span></div>`,
      )
      .join('');
    return `<div class="trace"><h3>能力痕迹</h3>${lines || '<p class="trace-none">这一局牌山没被动过。</p>'}</div>`;
  }

  private gameEndHtml(): string {
    const g = this.game!;
    if (this.team) return this.teamEndHtml();
    const rows = g
      .ranking()
      .map((s, i) => {
        const score = g.players[s].score;
        const d = score - this.settings.start;
        const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
        // 自己那一行用 mine，不能叫 me：me 是牌桌上自己手牌区的样式
        return `<div class="rank-row ${s === this.me ? 'mine' : ''}" style="--c:${this.chars[s].color}"><span class="rank">${i + 1} 位</span><span>${this.chars[s].name}</span><span>${score}</span><span class="${cls}">${d > 0 ? '+' : d < 0 ? '' : '±'}${d}</span></div>`;
      })
      .join('');
    return `
      <div class="modal"><div class="result">
        <h2>对局结束</h2>
        ${rows}
        <button class="primary" data-ui="restart">再来一局</button>
      </div></div>`;
  }
  // 团体赛一场打完：每队这一场得失，点“继续”回到点数板
  private teamEndHtml(): string {
    const g = this.game!;
    const { run, seats, start } = this.team!;
    const rows = g
      .ranking()
      .map((s, i) => {
        const t = run.teams[seats[s]];
        const d = g.players[s].score - start[s];
        const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
        return `<div class="rank-row ${s === this.me ? 'mine' : ''}" style="--c:${t.color}"><span class="rank">${i + 1} 位</span><span>${this.nameHtml(s)}</span><span>${g.players[s].score}</span><span class="${cls}">${d > 0 ? '+' : d < 0 ? '' : '±'}${d}</span></div>`;
      })
      .join('');
    const sticks = g.riichiSticks ? `<p class="pd-sub">剩下的立直棒 ${g.riichiSticks} 根留给下一个位置</p>` : '';
    return `
      <div class="modal"><div class="result">
        <h2>${POSITIONS[run.pos]}战结束</h2>
        ${rows}${sticks}
        <button class="primary" data-ui="team-next">继续</button>
      </div></div>`;
  }

}

// 一组副露的牌：横着的、扣着的、加杠叠着的都按 meldLayout 摆
// glow：字发紫光的牌（初美鸣出来的东、北中间那张）
function meldTilesHtml(m: Meld, seat: number, size: 'pond' | 'mini', glow?: Set<TileId>): string {
  return meldLayout(m, seat)
    .map((sl) => {
      if (sl.hidden) return backHtml(size);
      const tile = tileHtml(sl.tile, { size, sideways: sl.sideways, classes: glow?.has(sl.tile) ? ['kimon-glow'] : [] });
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

// 技能栏里的一支画笔（爱丽丝）：木杆、金属箍、笔头蘸着颜料；用掉的笔断成两截、颜色变灰
function brushSvg(broken: boolean): string {
  const body = broken
    ? '<g transform="rotate(-8 20 34)"><rect x="17.5" y="30" width="5" height="17" rx="2" fill="#7a7a80"/></g><g transform="rotate(14 20 20)"><rect x="17.5" y="11" width="5" height="16" rx="1.5" fill="#8a8a90"/><rect x="16.8" y="8" width="6.4" height="4" fill="#a0a0a6"/><path d="M17 8 Q20 -1 23 8 Z" fill="#9a9aa0"/></g>'
    : '<rect x="17.5" y="20" width="5" height="27" rx="2" fill="#c98a4a" stroke="#7a4e22" stroke-width="0.8"/><rect x="16.8" y="14" width="6.4" height="7" rx="1" fill="#d8dbe2" stroke="#7d828c" stroke-width="0.7"/><path d="M17 14 Q20 1 23 14 Z" fill="#2b2b33"/><path d="M18.6 13 Q20 5 21.4 13 Z" fill="var(--paint, #d8463c)"/>';
  return `<svg viewBox="0 0 40 50" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
}
