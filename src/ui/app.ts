import { CHARACTERS, Character } from '../abilities/characters';
import { bulbLevel, dangerKinds, readTenpai } from '../abilities/hiroe';
import { makoDanger, makoKnows } from '../abilities/mako';
import { akoDistance, akoSense } from '../abilities/ako';
import { HIROKO_NOTES } from '../abilities/hiroko';
import { TERU, TERU_TIERS, TERU_TOP, teruDanger, teruLadder, teruMirrored, teruNote, teruPoints, teruTwister, teruWallCounts, teruWinValue } from '../abilities/teru';
import { teruMirrors } from './teruFx';
import { tornado2d } from './tornado2d';
import { flapPages } from '../ui3d/flapBoard';
import { DARK, FLICK, FLICKER } from '../ui3d/lamp';
import { nellyBlocked, nellySenses, nellySensesTenpai } from '../abilities/nelly';
import { awaiCornerKan, awaiDomainOn, awaiFields, awaiKanUra, awaiKanUraHit, awaiSourceOn, awaiStars, awaiWaveTiles } from '../abilities/awai';
import { sakiKanKinds, sakiKanTiles, sakiRinshan, sakiSeesThrough } from '../abilities/saki';
import { mihokoEyeOpen } from '../abilities/mihoko';
import { shiromiRipple } from '../abilities/shiromi';
import { shizunoMist } from '../abilities/shizuno';
import { hatsumiGale, hatsumiGlowMelds, hatsumiOpen } from '../abilities/hatsumi';
import { MYEONGHWA, myeonghwaCut, myeonghwaSecondSong, myeonghwaSinging, myeonghwaSong, myeonghwaWinds } from '../abilities/myeonghwa';
import { cutTagHtml, fuujinBreeze, fuujinCut, fuujinGust, songHtml } from './fuujin';
import { MEGAN, MEGAN_BULLET, MEGAN_STAND, duelledBy, meganBlind, meganDuel, meganDuelEnd, meganDuelTarget, meganSenses } from '../abilities/megan';
import { duelEscape, duelMarkHtml, duelShot, duelStart, hatHtml } from './duel';
import { yukikoLeft } from '../abilities/yukiko';
import { HE_SVG, leftHandSign, leftHandWin } from './leftHand';
import { Gale2D } from './gale2d';
import { Stars2D } from './stars2d';
import { Lily2D } from './lily2d';
import { AISLINN_DROP, aislinnDrawsLeft, aislinnPlan, aislinnSketch } from '../abilities/aislinn';
import { satohaBlade, satohaCut, satohaDistance, satohaRenchanDealer, satohaScouts, satohaSheathed } from '../abilities/satoha';
import { bladeHtml, iaiSlash, zanFx, IAI_DRAWN, IAI_PUSH_MS, IAI_SLASH_ALL_MS, IAI_WINDUP_MS, IAI_ZAN_ALL_MS } from './iai';
import { type HuiyuCard, huiyuBar, huiyuCards, huiyuMissedRon, huiyuReady, huiyuWinGb } from '../abilities/huiyu';
import { playGlitch, playRebuild, playShatter } from './sketchFx';
import { playNetWipe } from './netFx';
import { kuroLost } from '../abilities/kuro';
import { angelDanger, nodokaAngel } from '../abilities/nodoka';
import { tokaChisui } from '../abilities/toka';
import { ryuukaDanger, ryuukaMugoku, ryuukaSensesTenpai } from '../abilities/ryuuka';
import { komakiActiveGod } from '../abilities/komaki';
import { toyoneRedHidden } from '../abilities/toyone';
import { RII, riiBind, riiCanBind, riiKeys } from '../abilities/rii';
import { Chains2D } from './chains2d';
import { ChainOutcome, chainEnd, chainOutcomes, outcomeTime, skyStart, skyTime } from './riiChainPlan';
import { ChainStyleId, PlockStyleId, RiiProj, RiiSfxId, lookChoices, riiLook, setRiiLook, useRiiLook } from './riiLook';
import { RiiTestStart, riiSetPanelHtml, riiTestPanelHtml } from './riiSetup';
import { riichiTsumoStage } from './riiStage';
import { RinshanTier, rinshanStage, rinshanTestPanelHtml } from './sakiStage';
import { slamStage, slamTestPanelHtml } from './slamStage';
import { koromoSea } from './koromoSea';
import { SEA_TEST_OPPONENTS, koromoSeaStage } from './waterStage';
import { padlockArrive, playPadlock } from './riiPadlock';
import { PlockEnd, PlockPlace, plockHtml } from './riiPlock';
import { SkyKey } from './skyKey';
import { keyTag } from './keyArt';
import { saeCanAim, saeAim, snipedBy } from '../abilities/sae';
import { initLensDrag, lensMarkHtml, lensSlotsHtml, playLensShot } from './lensDrag';
import type { PreDealOption } from '../abilities/types';
import { chooseAction } from '../ai/ai';
import { Action, Game, GameEvent, RoundResult, Stage, WinInfo } from '../engine/game';
import { riichiSideIndex } from '../engine/pond';
import { Rng } from '../engine/rng';
import { Meld } from '../engine/score';
import { Kind, TileId, WIND_CN, isRed, kindLabel, kindOf } from '../engine/tiles';
import { playCall, playChime, playClick, playCrackle, playFlapTicks, playFlip, playGust, playBreeze, playDuelMiss, playDuelStart, playDuelStep, playGunshot, playIaiDraw, playIaiPush, playIaiSheath, playSong, playLamp, playLily, playMachine, playRiichi, playScrape, playShift, playShuffle, playSlam, playStamp, playSplash, playTide, playWhirl, playWin, playWindow } from './sound';
import { lilyGrand } from '../ui3d/lilyFx';
import { playLockSlam, playRiiLock, playRiiOutcome, preloadRiiSound, previewRiiSound } from './riiSound';
import { closeSoundPanel, onSoundTab, openSoundPanel, soundButtonHtml, soundPanelOpen } from './soundPanel';
import { entryFormHtml, rosterPageHtml, rosterTabsHtml, savePick, savedPick, selectBoardHtml } from './selectPage';
import { Scene, gameMusic, menuMusic, promptCue, resultMusic, soundtrackEvent, tallyCue } from './soundtrack';
import { homeGo, homeHtml, mountHome } from './home';
import { mountCodex } from './codex';
import { NationalFlow } from '../story/national';
import { IndividualFlow } from '../story/individual';
import { SOLO_RULES, SOLO_START } from '../story/hanchanSim';
import { fmtPts } from '../story/soloView';
import { type HandEvent, recordHands } from '../story/hands';
import { type NationalTab, saveTab, savedTab } from '../story/tabs';
import { hash01, paceOf, pickDiscardStyle, pondJitter, pondStyleOf, vary } from './vary';
import { type DiscardStyle, isPush, landWeight, pushDistAt, pushSeconds } from '../ui3d/discardMotion';
import { HAND_STYLES_V2, Table3D } from '../ui3d/table3d';
import { preloadModels } from '../ui3d/avatar';
import { FACES, Face, MODEL_URLS, cutinArt, portraitUrl, powerPortraitUrl, skillArt } from '../ui3d/looks';
import { TileSize, backHtml, setSketchTiles, tileHtml, tintOf } from './tile';
import { FlowPage, PointSeat, ResultFlow, animatePoints, drawBannerHtml, pointsPageHtml, ranksOf } from './resultFlow';
import { meldLayout } from './meldLayout';
import { WaitInfo, drawWaits, hanLabel, waitInfo, waitStatus } from './waitInfo';
import { AbilityTrace, traceLine } from './abilityTrace';
import { CutinKind, Cutins } from './cutin';
import { SkinEditor, canEditSkins, onSkinsChange } from './skins';
import { preloadVoices, sayVoice, stopVoices } from './voice';
import { VoiceCue, cueKeys } from './voiceLines';
import { TeamFlow } from './teamFlow';
import { CONSOLE_SHAPES, type ConsoleShapeId, TABLE_STYLES, THEMES, type TableStyleId, ThemeId, currentConsoleShape, currentTableStyle, currentTheme, setConsoleShape, setTableStyle, setTheme, tableColors } from './theme';
import { lastDeltas, lastWinners, winCounts } from './winTally';
import { SCHOOLS, membersOf, saveSchool, savedSchool } from './schools';
import { POSITIONS, TEAM_START, TeamRun } from '../team/team';
import { CanRon, SeenStep, canRonNow, cloneGame, readSteps, rehearsalOver } from './foresee';
import { DEFAULT_SETTINGS, MatchSettings, TABLE_MODES, TableMode, loadSettings, loadTableMode, matchPanelHtml, parseTarget, pickOpponents, rulesOf, saveSettings, saveTableMode, setOption, visualPanelHtml } from './matchSetup';
import { ForecastCache } from '../ai/forecast';
import { himekoKeySeat } from '../abilities/himeko';
import type { BindKey } from '../abilities/types';
import { Himeko2D } from './himeko2d';
import { beatSeed } from './himekoBeat';
import { inTransition, setTransitionStyle, transition } from './transition';

// 座位在画面上的位置：0 是自己（下），1 下家（右），2 对家（上），3 上家（左）
const POS = ['bottom', 'right', 'top', 'left'];

const AI_TURN_DELAY = 550;
// 天使和的网络麻将：变身那一局开局后多久换牌桌（先让天使形态动画放完），平时补换等多久，顶上标题栏多高
const NET_DELAY = 1800;
// 角色说了台词的那一下，提示音（立直的滑音、吃碰杠的两声、能力的叮、和牌的琶音）压到这么大
const VOICED_CUE = 0.5;
// 一炮多响：几个人的「荣和」错开这么多秒
const WIN_VOICE_GAP = 0.35;
const NET_CATCHUP = 400;
const NET_BAR = 26;
const NET_WIND = '東南西北';
// 2D 牌桌上里鬼门的风最多几道弧线
// 3D、2.5D 牌桌：上一张牌落桌、这家摸完牌以后再想这么久才出（毫秒）。
// 算上出牌动作，电脑一回合（落桌到落桌）约 1.1 秒，和雀魂差不多。3D 的角色伸手要 0.3 秒，所以想得短一点
const AI_TURN_DELAY_3D = 360;
const AI_TURN_DELAY_25D = 620;
const AI_CALL_DELAY = 250;
// 桃子隐身那一下要多久（毫秒，先停半拍再淡掉），和 style.css 里 .vanish 的动画一样长
const VANISH_MS = 1150;
// 2D 牌桌每种出牌动画多长、什么时候响哪一声（毫秒；和 style.css 里 .pond .tile.fresh.fx-* 的时长对得上）
type Fresh2dSound = 'soft' | 'click' | 'slap' | 'scrape';
const FRESH_2D: Record<DiscardStyle, { ms: number; sounds: [number, Fresh2dSound][] }> = {
  place: { ms: 250, sounds: [[0, 'click']] },
  snap: { ms: 220, sounds: [[170, 'slap']] },
  slide: { ms: 300, sounds: [[50, 'soft'], [60, 'scrape']] },
  spin: { ms: 380, sounds: [[320, 'click']] },
  toss: { ms: 520, sounds: [[215, 'click'], [400, 'soft']] },
  stand: { ms: 420, sounds: [[0, 'soft'], [400, 'soft']] },
  turn: { ms: 520, sounds: [[145, 'click'], [240, 'scrape']] },
  top: { ms: 950, sounds: [[110, 'click'], [130, 'scrape']] },
  hold: { ms: 900, sounds: [[845, 'slap']] },
  push: { ms: 560, sounds: [[130, 'soft'], [370, 'scrape'], [540, 'slap']] },
  brake: { ms: 640, sounds: [[130, 'soft'], [370, 'scrape'], [625, 'soft']] },
  fling: { ms: 1200, sounds: [[140, 'soft'], [160, 'scrape'], [1180, 'click']] },
};
// 2D 的横推：放下、停一下一共多久（毫秒，和 style.css 的 drop-push-in 一样长），之后往回带一点、猛地推过去（多久照推多远算，和 3D 一样）
const PUSH_2D_IN = 240;
const push2dMs = (push: number, brake = false) => Math.round(pushSeconds(push, brake).all * 1000);
// 撞上前一张以后，前一张歪过去要多久（毫秒）；歪多少度（最少、最多）、往左让多少像素
const KNOCK_2D_MS = 150;
const KNOCK_2D_DEG: [number, number] = [2.2, 3.6];
const KNOCK_2D_PX = 1.4;
// 这一次出牌的动画多长、什么时候响哪一声：横推照推多远算（push 是推多远，牌宽），别的样子是固定的
function fresh2d(style: DiscardStyle, push = 0): { ms: number; sounds: [number, Fresh2dSound][] } {
  if (!isPush(style) || !push) return FRESH_2D[style];
  const brake = style === 'brake';
  const go = push2dMs(push, brake);
  // 猛推的到头是重的一声；刹车的滑到停只有轻轻一下
  return { ms: PUSH_2D_IN + go, sounds: [[130, 'soft'], [PUSH_2D_IN + Math.round(pushSeconds(push).wind * 1000), 'scrape'], [PUSH_2D_IN + go - 15, brake ? 'soft' : 'slap']] };
}
// 2D 的牌河里牌歪多少：牌小（28 像素宽），转角照 3D 的七成，免得挤到旁边的牌
const POND_2D_TWIST = 0.7;
const POND_2D_PX = 28;
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
// 怜“看下一巡”不花体力：同一回合可以看两次，看第二次的话下一局不能用

// 郝慧宇：国标这么多番以上，「食糊」和结算面板换金色
const GB_GOLD_FAN = 24;
const GB_GOLD = '#e6b422';
// 智叶的刀光开始后多久出「自摸」「荣和」；和牌的字出来以后多久出「斬」（毫秒）
const IAI_SLASH_MS = 900;
const IAI_ZAN_MS = 1100;

interface Toast {
  id: number;
  seat: number;
  text: string;
  big: boolean;
  kind: string; // riichi / call / kan / win 时有特效样式
  color?: string; // 不用角色色时（郝慧宇国标 24 番以上的金色「食糊」）
}

// 选人页顶栏：对局设置（滑杆）、视觉设置（调色盘）、更多（三个点）；随机出场的骰子
const GEAR_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M10.3 3h3.4l.5 2.4 1.7.9 2.3-.9 1.7 2.9-1.8 1.6v2.2l1.8 1.6-1.7 2.9-2.3-.9-1.7.9-.5 2.4h-3.4l-.5-2.4-1.7-.9-2.3.9-1.7-2.9 1.8-1.6v-2.2L4.1 8.3l1.7-2.9 2.3.9 1.7-.9z"/><circle cx="12" cy="12" r="3"/></g></svg>`;
const MORE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>`;

// 洋榎的灯：颜色从白到紫，光芒条数就是档位
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

// 2D：平行宇宙的动画多长（毫秒；和 style.css 的 awai-parallel 一样长）
const PARALLEL_MS = 2800;

export class App {
  private root: HTMLElement;
  private game: Game | null = null;
  private chars: Character[] = [];
  private readonly me = 0;
  private riichiMode = false;
  // 白水哩：按了“番缚”，手牌扣下去、正在选缚几番
  private riiPicking = false;
  // 手牌扣下去 / 翻回来是什么时候（2D 的翻牌动画按这个时间接着放，重画不会从头再翻）
  private riiFlipAt = 0;
  // 2D 牌桌上画锁链的 canvas；结算要等锁链放完再弹（到这个时间）
  private chains2d: Chains2D | null = null;
  private skyKey: SkyKey | null = null;
  private riiHold = 0;
  // 智叶的刀：这一局现在推出来多少、上一次换档是从哪儿推过来的、什么时候换的（画面重画时动画接着放）
  private blade: { game: Game | null; round: number; from: number; to: number; at: number } = { game: null, round: -1, from: 0, to: 0, at: 0 };
  // 番缚锁死的动画：什么时候按下的（Date.now），缚几番；结算时每个哩头像上的锁怎么样（开锁 / 碎掉 / 淡掉）、从什么时候开始
  private riiLockAt = 0;
  private riiLockN = 0;
  private riiLockEnd = new Map<number, { kind: PlockEnd; at: number; n: number }>();
  // 换了头像锁的样子：新样子从这时候挂上去
  private riiPlockSwapAt = 0;
  private riiPadlockStop: (() => void) | null = null;
  private toasts: Toast[] = [];
  private toastSeq = 0;
  private timer: number | null = null;
  private showResult = false;
  // 刚打出的牌只在第一次画出来时播放落桌动画，之后重绘不再重播
  // 2D 牌桌刚打出来的那一张：哪一张（座位-第几张）、怎么放下去的、什么时候打的（动画没播完又重画时接着播）
  // （push：横推的那一张横着放在落点右边多远再推过来，牌宽）
  private freshDiscard: { key: string; style: DiscardStyle; at: number; push: number } | null = null;
  // 2D：被横推的宣言牌撞歪的牌（牌的编号 → 歪多少度、什么时候撞上的）。round 是哪一局记的，换局就清
  private knocks2d = new Map<TileId, { deg: number; at: number }>();
  private knocksRound = -1;
  // 桃子：这一局已经隐身的座位；正在淡掉的座位（开始的时刻）
  private gone = new Set<number>();
  private vanishAt = new Map<number, number>();
  // 25d：3D 牌桌、不坐人物，从上往下看（默认）；3d：坐着人物的实验版；2d：网页画的平面牌桌
  private mode: TableMode = loadTableMode();
  // 单人对局的规则、动画开关（matchSetup.ts）；panel 是选人页上开着的设置面板
  private settings: MatchSettings = loadSettings();
  private panel: 'match' | 'visual' | 'rii' | 'riiTest' | 'sakiTest' | 'slamTest' | null = null;
  // 这一局是「白水哩 · 姬子测试」窗口开的：番缚的样子用测试那一份，对局里也能换样子、试结算
  private riiTest = false;
  // 页面主人才能换素材：视觉设置里多一行入口
  private canSkins = false;
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
  // 新结算（视觉设置「结算画面：新」）：正在放的几页；流局大字之后挂「听牌 / 不听」的计时器
  private flow: ResultFlow | null = null;
  private flowTimer: number | null = null;
  private cutinSeen = new Set<string>();
  // 这一局已经说过台词的能力（同一个能力一局只说第一次）
  private voiceSeen = new Set<string>();
  // 爱丽丝的手绘板：牌桌现在是不是画成手绘板（重组特效刷满时才换过去，破碎时马上换回）
  private sketchView = false;
  private sketchTimer: number | null = null;
  // 手绘板掉线：到这个时间（performance.now）之前，手牌上面的手绘板画面是乱码
  private sketchGlitchUntil = 0;
  private sketchGlitchTimer: number | null = null;
  // 原村和变成天使和：牌桌换成她脑子里的网络麻将（2D 网麻牌桌，三种视角都一样）。
  // netFrom 是换过去之前的视角（2.5D、3D 时临时把 mode 改成 2d，变回来或离开牌桌时还原）
  private netView = false;
  private netFrom: '25d' | '3d' | '2d' | null = null;
  private gale2dFx: Gale2D | null = null; // 2D 牌桌上初美的紫色旋风
  private stars2dFx: Stars2D | null = null; // 2D 牌桌上大星淡的星空
  private starHold2d = 0; // 双立直宣言的光圈放出来之前，夜空先不铺
  private fxHold2d = 0; // 2D：平行宇宙的动画放完之前牌局先等着（performance.now 的时刻）
  private wave2dTimer = 0; // 2D：引力波开着时，隔几秒再荡一圈淡的
  private starUraShown = false; // 这一局杠里的流星放过了
  // 2D 沙滩、草甸、原木换局：上一次画的是哪一局（换了局就一个浪打过来、一阵风刮过来、手搓洗牌，见 shift2d）
  private shiftRound: { g: Game; round: number } | null = null;
  // 2D：初美聚着风和牌，结算里手牌先倒、和了牌往下砸（哪一家、什么时候开始；结算重画时动画接着放）
  private galeSlam: { seat: number; t0: number } | null = null;
  // 2D：淡中了杠里的自摸（逆回旋）是哪个座位（结算里手牌逆着翻开，见 style.css 的 .win.slam.whirl）
  private whirl2d: number | null = null;
  // 2D：照的旋风自摸是哪个座位（结算里砸下去以后那张牌转起来，见 style.css 的 .win.slam.twist）
  private twist2d: number | null = null;
  private netTimer: number | null = null;
  // 怜“看下一巡”（演算）：玩家操作怜时用。
  // 演算中 vision 不是 null：this.game 换成牌局的复制品放到牌桌上演，真的牌局和演算前的表情先存在 vision 里，退出时换回来。
  // start：复制品从第几个事件开始是演算的；rons：演算里她能荣和却没和的那几次
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
    // 手指还是鼠标（2D 牌桌上手指点中间那块写点差）
    root.addEventListener('pointerdown', (e) => (this.lastPointer = e.pointerType));
    // 个人对局页的名册上左右滑换学校
    let swipe: { x: number; y: number } | null = null;
    root.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      swipe = !this.game && (e.target as HTMLElement).closest('.sr-page') && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    });
    root.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (!swipe || !t) return;
      const dx = t.clientX - swipe.x;
      const dy = t.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) this.stepSchool(dx < 0 ? 1 : -1);
    });
    // 对局设置里的对手下拉、一位必要点数：改了就记下来；报名表上的对手下拉也一样
    root.addEventListener('change', (e) => {
      const el = e.target as HTMLElement;
      if (el.matches('.setup-select, #setup-target')) {
        this.readTarget();
        saveSettings(this.settings);
        this.refreshRuleSummary();
      } else if (el instanceof HTMLSelectElement && el.matches('.sf-opp-sel')) {
        this.settings.opponents[Number(el.dataset.seat)] = el.value;
        saveSettings(this.settings);
        el.closest('.sf-opp')?.classList.toggle('rand', !el.value);
      }
    });
    // Esc 关掉设置面板
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel) this.closePanel();
    });
    // 更多菜单开着时，点别的地方就收起来
    root.addEventListener('click', (e) => {
      const open = root.querySelector('details.sel-more[open]');
      if (open && !open.contains(e.target as Node)) open.removeAttribute('open');
    });
    window.addEventListener('resize', () => this.fit());
    // 大字特效用的书法字体先下好，免得第一次立直时字还没出来
    document.fonts?.load('1em "Ma Shan Zheng"', '立直碰吃杠荣和自摸暗加宝牌聚集岭上开花一巡先见的气息').catch(() => {});
    // 一打开先到主页（直接是部室）
    this.renderTitle();
    // 视觉设置里选的过场动画
    setTransitionStyle(this.settings.xfade);
    // 声音设置那页顶上点「对局」「视觉」：换回这边的面板
    onSoundTab((v) => this.openPanel(v));
    // 素材页里换了图：牌局里重画头像框，选人页重画一遍
    onSkinsChange(() => {
      if (this.game) this.render();
      else if (this.root.querySelector('.sel-board, .select-screen')) this.renderSelect();
    });
    // 调试用：?debug 时可以在控制台里直接触发牌局事件看特效
    if (location.search.includes('debug')) Object.assign(window, { app: this, chooseAction });
  }

  // ---------- 选角色 ----------

  // 离开牌桌：停掉计时器、拆掉 3D 牌桌
  private teardown(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.closeFlow();
    this.game = null;
    stopVoices();
    this.cutins?.clear();
    this.table3d?.dispose();
    this.table3d = null;
    this.resetNet();
    this.root.classList.remove('mihoko-eye', 'awai-dark', 'awai-source');
  }

  // 主页（home.ts）：麻将部的部室，白板上的纸、便签、收音机、麻将桌是入口。一打开就进部室，不用先点一下
  private renderTitle(): void {
    this.teardown();
    menuMusic();
    this.team = null;
    this.soloMatch = null;
    this.teamFlow = null;
    this.auto = false;
    this.root.innerHTML = homeHtml();
    const room = this.root.querySelector<HTMLElement>('.home-room');
    if (room) mountHome(room);
    // 换皮肤会重画整页：开着的设置面板照样开着
    this.renderPanel();
  }

  // 全国大赛：团体赛（story/national.ts：报名、东西半区晋级表；玩家那桌用团体赛画面打）和
  // 个人赛（story/individual.ts：报名、积分榜、决赛桌；玩家那场用个人对局的牌桌打）两个页签，别桌都在后台真打。
  // 进来时回到上次看的那一边；返回回到主页
  private national: NationalFlow | null = null;
  private solo: IndividualFlow | null = null;
  // 个人赛里玩家正在打的那一场：order[座位] 是这一桌第几个人（玩家坐 0 号位），打完把点数按桌上的顺序交回去
  private soloMatch: { order: number[]; label: string; finale: boolean; hands: HandEvent[]; done: (scores: number[], hands: HandEvent[]) => void } | null = null;

  private openBracket(tab: NationalTab = savedTab()): void {
    this.teardown();
    menuMusic();
    this.team = null;
    this.soloMatch = null;
    this.teamFlow = null;
    this.panel = null;
    this.national?.dispose();
    this.national = null;
    this.solo?.dispose();
    this.solo = null;
    saveTab(tab);
    const exit = () =>
      transition(() => {
        this.national?.dispose();
        this.national = null;
        this.solo?.dispose();
        this.solo = null;
        this.renderTitle();
      });
    if (tab === 'solo') {
      this.solo = new IndividualFlow(this.root, {
        playHanchan: (chars, me, info, done) => transition(() => this.startSoloMatch(chars, me, info, done)),
        switchTab: () => transition(() => this.openBracket('team')),
        exit,
      });
      return;
    }
    this.national = new NationalFlow(this.root, {
      playTable: (run, done) => transition(() => this.openNationalTable(run, done)),
      switchTab: () => transition(() => this.openBracket('solo')),
      exit,
    });
  }

  // 个人赛里玩家那一场：规则固定（半庄、25000 点起……见 SOLO_RULES），玩家坐 0 号位，其余三人照桌上的顺序往下坐；
  // 起家随机。焦点桌、决赛桌放决战的音乐；每一局的和牌记下来（赛事快报用）。打完结算窗的按钮是「回到积分榜」
  private startSoloMatch(chars: Character[], me: number, info: { label: string; finale: boolean }, done: (scores: number[], hands: HandEvent[]) => void): void {
    const order = [0, 1, 2, 3].map((i) => (me + i) % 4);
    const players = order.map((k) => chars[k]);
    this.teardown();
    this.team = null;
    this.teamFlow = null;
    this.auto = false;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const game = new Game({ seed, format: 'south', startScore: SOLO_START, rules: SOLO_RULES, firstDealer: Math.floor(Math.random() * 4), players: players.map((c, i) => ({ name: c.name, ability: c.ability, manual: i === this.me })) });
    this.soloMatch = { order, label: info.label, finale: info.finale, hands: recordHands(game, order), done };
    this.beginGame(players, game);
  }

  // 全国大赛里玩家那一桌：团体赛的布阵、点数板、上场 / 托管；打完把四校点数交回晋级表，中途退出就不算
  private openNationalTable(run: TeamRun, done: (points: number[]) => void): void {
    const back = (): void => {
      this.teardown();
      menuMusic();
      this.team = null;
      this.soloMatch = null;
      this.teamFlow = null;
      this.national?.show();
    };
    this.teardown();
    menuMusic();
    this.teamFlow = new TeamFlow(
      this.root,
      {
        play: (r, seats, auto) => transition(() => this.startTeamMatch(r, seats, auto)),
        exit: () => transition(back),
        finish: (r) => {
          done(r.teams.map((t) => t.points));
          transition(back);
        },
        finishLabel: '回到晋级表',
      },
      undefined,
      run,
    );
  }

  // 角色图鉴（codex.ts）：主页的收音机进来，返回回到主页
  private renderCodex(): void {
    this.teardown();
    menuMusic();
    this.team = null;
    this.soloMatch = null;
    this.teamFlow = null;
    this.panel = null;
    mountCodex(this.root, () => transition(() => this.renderTitle()));
  }

  // 设置面板上次停在哪一页（便签打开时回到那一页）
  private settingsTab: 'match' | 'visual' = 'match';

  // 团体赛是从哪儿进的：退出时回到那里
  private teamFrom: 'title' | 'select' = 'select';

  private renderSelect(): void {
    this.teardown();
    menuMusic();
    this.team = null;
    this.soloMatch = null;
    this.teamFlow = null;
    this.auto = false;
    // 3D 牌桌要用的人物模型现在就开始在后台下载
    if (this.mode === '3d') preloadModels(MODEL_URLS);
    // 部室白板上的名册 + 报名表（selectPage.ts）。右上角便签是设置（对局、视觉、声音三页），蓝磁铁「…」里放动作调试
    const more = `<details class="sel-more sb-more"><summary aria-label="更多" title="动作调试">${MORE_SVG}</summary><div class="sel-more-menu"><button data-ui="lab">动作调试</button></div></details>`;
    this.root.innerHTML = selectBoardHtml({ ...this.selectParts(), more }) + '<div id="setup"></div>';
    // 「更多」菜单里加一个白水哩、姬子的测试窗口（全部样子、开测试对局）
    this.root.querySelector('.sel-more-menu')?.insertAdjacentHTML('beforeend', '<button data-ui="rii-test">白水哩 · 姬子测试</button>');
    // 宫永咲的岭上开花测试：每局暗杠、岭上自摸，看砸牌和岭上开花的特效
    this.root.querySelector('.sel-more-menu')?.insertAdjacentHTML('beforeend', '<button data-ui="saki-test">宫永咲 · 岭上开花测试</button>');
    // 自摸动作测试：挑一个人、坐哪家，每局第二张自摸，看她砸牌的动作
    this.root.querySelector('.sel-more-menu')?.insertAdjacentHTML('beforeend', '<button data-ui="slam-test">自摸动作测试</button>');
    // 水的特效：衣每一局都海底捞月、一路打到海底自摸；透华开局就治水
    this.root
      .querySelector('.sel-more-menu')
      ?.insertAdjacentHTML('beforeend', '<button data-ui="water-test" data-v="koromo">衣 · 海底捞月测试</button><button data-ui="water-test" data-v="toka">透华 · 治水测试</button>');
    // 大星淡的星空：对手没有能力、谁都不鸣牌，每一局都双立直、转角暗杠、杠里自摸
    this.root.querySelector('.sel-more-menu')?.insertAdjacentHTML('beforeend', '<button data-ui="awai-test">大星淡 · 转角暗杠测试</button>');
    this.fitDesc();
    // 能换素材的人（页面主人）在视觉设置里多一行“角色素材”
    void canEditSkins().then((ok) => {
      if (ok === this.canSkins) return;
      this.canSkins = ok;
      if (this.panel === 'visual') this.renderPanel();
    });
    // 换皮肤会重画整页：开着的设置面板照样开着
    this.renderPanel();
  }

  // 报名表上的本人（红笔圈着的那张）：记在浏览器里，下次进来还是她；没记过就是这一页第一位
  private picked: string | null = savedPick();

  private pickedChar(): Character {
    return CHARACTERS.find((c) => c.id === this.picked) ?? membersOf(this.school)[0] ?? CHARACTERS[0];
  }

  private selectParts() {
    return {
      school: this.school,
      picked: this.pickedChar(),
      settings: this.settings,
      photo: (id: string) => this.cardPortrait(id),
      badge: (id: string) => (id === 'toka' && this.settings.chisui ? '治水' : id === 'saki' && this.settings.sakiStrong ? '加强' : ''),
      extras: (id: string) => this.formToggleHtml(id),
    };
  }

  // 只重画名册这一页（照片、红圈）和报名表；draw：圈刚选的那张时一笔画出来
  private refreshSelect(draw = false): void {
    const page = this.root.querySelector('.sr-page');
    if (!page) return;
    const parts = this.selectParts();
    page.innerHTML = rosterPageHtml(parts);
    const form = this.root.querySelector<HTMLElement>('.sf');
    if (form) {
      form.classList.remove('open');
      form.innerHTML = entryFormHtml(parts);
    }
    if (draw) page.querySelector('.sr-card.on')?.classList.add('draw');
    this.fitDesc();
  }

  // 报名表上能力说明太长：先收着，露出「全文」
  private fitDesc(): void {
    const desc = this.root.querySelector<HTMLElement>('.sf-desc');
    const more = this.root.querySelector<HTMLElement>('.sf-more');
    if (desc && more) more.hidden = desc.scrollHeight <= desc.clientHeight + 2;
  }

  // 点照片：没圈的圈上（当本人），已经圈着的再点一下就出场
  private pickOrStart(id: string): void {
    if (id === this.pickedChar().id) {
      this.quickStart(id);
      return;
    }
    this.picked = id;
    savePick(id);
    this.refreshSelect(true);
    playClick({ varied: true });
  }

  // 出场、随机出场、点头像：照对局设置开局（记在浏览器里，第一次是默认规则）。
  // 上牌桌也过场（视觉设置里选的那种，transition.ts）；主页的随机出场已经在过场里了，直接开
  private quickStart(id: string): void {
    const go = (): void => {
      this.panel = null;
      this.startGame(id);
    };
    if (inTransition()) go();
    else transition(go);
  }

  // 右上角的两个设置面板
  private openPanel(kind: 'match' | 'visual' | 'rii' | 'riiTest' | 'sakiTest' | 'slamTest'): void {
    this.root.querySelector('details.sel-more[open]')?.removeAttribute('open');
    // 从声音那页换过来：先把声音面板关了
    if (soundPanelOpen()) closeSoundPanel();
    if (kind === 'match' || kind === 'visual') this.settingsTab = kind;
    this.panel = kind;
    // 番缚设置、测试窗口各改各的那一份
    useRiiLook(kind === 'riiTest' ? 'test' : 'main');
    this.renderPanel();
    this.root.querySelector<HTMLElement>('.set-x')?.focus();
  }

  // refocus：关了以后焦点回到打开它的按钮（换到声音那页时不用）
  private closePanel(refocus = true): void {
    if (this.panel === 'match') {
      this.readTarget();
      saveSettings(this.settings);
    }
    const kind = this.panel;
    this.panel = null;
    useRiiLook('main');
    this.renderPanel();
    this.refreshRuleSummary();
    if (refocus) (this.root.querySelector<HTMLElement>(`[data-ui="open-${kind}"]`) ?? this.root.querySelector<HTMLElement>('[data-ui="open-settings"]'))?.focus();
  }

  // 面板重画：滚动位置、键盘焦点留在原处（手机上面板会滚动，点一个选项不要跳回顶上）
  private renderPanel(): void {
    const slot = this.root.querySelector('#setup');
    if (!slot) return;
    const old = slot.querySelector<HTMLElement>('.set-panel');
    const top = old?.scrollTop ?? 0;
    const focus = document.activeElement instanceof HTMLElement && slot.contains(document.activeElement) ? document.activeElement : null;
    const key = focus?.dataset.ui ? `[data-ui="${focus.dataset.ui}"]${focus.dataset.k ? `[data-k="${focus.dataset.k}"]` : ''}[data-v="${focus.dataset.v ?? ''}"]` : null;
    slot.innerHTML =
      this.panel === 'match'
        ? matchPanelHtml(this.settings)
        : this.panel === 'visual'
          ? visualPanelHtml(this.settings, currentTheme(), this.mode, this.canSkins, currentTableStyle(), currentConsoleShape())
          : this.panel === 'rii'
            ? riiSetPanelHtml()
            : this.panel === 'riiTest'
              ? riiTestPanelHtml()
              : this.panel === 'sakiTest'
                ? rinshanTestPanelHtml()
                : this.panel === 'slamTest'
                  ? slamTestPanelHtml(this.settings)
                  : '';
    const panel = slot.querySelector<HTMLElement>('.set-panel');
    if (panel) panel.scrollTop = top;
    if (key) slot.querySelector<HTMLElement>(key)?.focus();
  }

  // 报名表上的规则一行、对手下拉：对局设置里改了跟着变
  private refreshRuleSummary(): void {
    if (this.root.querySelector('.sf')) this.refreshSelect();
  }

  // 个人对局页按学校分页（schools.ts）：一页一个学校
  private school = savedSchool();

  // 龙门渊透华：选了治水，照片换成发动能力的那张（MatchSettings.chisui）
  private cardPortrait(id: string): string {
    return id === 'toka' && this.settings.chisui ? powerPortraitUrl(id) : portraitUrl(id, 'neutral');
  }

  // 报名表本人底下：透华常态 / 治水、咲标准 / 加强（手写两个字，选中的红笔圈起来）；白水哩是番缚设置
  private formToggleHtml(id: string): string {
    if (id === 'rii') return `<button class="sf-rii" data-ui="rii-set">${GEAR_SVG}番缚设置：锁链、头像锁、音效</button>`;
    if (id !== 'toka' && id !== 'saki') return '';
    const on = id === 'saki' ? this.settings.sakiStrong : this.settings.chisui;
    const btn = (v: boolean, label: string, note: string) =>
      `<button class="${on === v ? 'on' : ''}" aria-pressed="${on === v}" data-ui="${id}-form" data-v="${v}" title="${note}">${label}</button>`;
    // 宫永咲：标准 / 加强（MatchSettings.sakiStrong），只管自己用的咲
    if (id === 'saki') return `<div class="sf-form">形态：${btn(false, '标准', '5 费魔物的强度')}${btn(true, '加强', '更容易成刻、开花、连杠')}</div>`;
    return `<div class="sf-form">开局：${btn(false, '常态', '点数变动 10 万后治水')}${btn(true, '治水', '开局就是治水')}</div>`;
  }

  // 透华的常态 / 治水、咲的标准 / 加强：v 没给就来回切
  private toggleForm(id: 'toka' | 'saki', v?: string): void {
    const key = id === 'saki' ? 'sakiStrong' : 'chisui';
    this.settings[key] = v === undefined ? !this.settings[key] : v === 'true';
    saveSettings(this.settings);
    this.refreshSelect();
  }

  // 换一页：只重画胶带和名册这一页；报名表上的本人不动（翻页只是看看）
  private showSchool(name: string): void {
    if (!SCHOOLS.some((s) => s.name === name)) return;
    this.school = name;
    saveSchool(name);
    const tabs = this.root.querySelector('.sr-tabs');
    const page = this.root.querySelector('.sr-page');
    if (!tabs || !page) return;
    tabs.innerHTML = rosterTabsHtml(name);
    page.innerHTML = rosterPageHtml(this.selectParts());
    tabs.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // 前一页、后一页（手机上左右滑）
  private stepSchool(d: number): void {
    const i = SCHOOLS.findIndex((s) => s.name === this.school);
    this.showSchool(SCHOOLS[(i + d + SCHOOLS.length) % SCHOOLS.length].name);
  }

  private lastPointer = 'mouse';
  // 2D 牌桌：手指点过中间那块，到这个时候（毫秒）为止写点差
  private diffUntil = 0;
  private diffTimer = 0;
  // 深夜：2D 中间那只小表拨针的定时器（clockHtml）
  private clockTimer: number | undefined;

  // 自由输入的一位必要点数、下拉选的对手：面板重画、关上之前先收进来
  private readTarget(): void {
    const input = this.root.querySelector<HTMLInputElement>('#setup-target');
    if (input) this.settings.target = parseTarget(input.value);
    this.root.querySelectorAll<HTMLSelectElement>('.setup-select').forEach((el) => (this.settings.opponents[Number(el.dataset.seat)] = el.value));
  }

  // 「白水哩 · 姬子测试」窗口开的对局：番缚的样子用测试那一份
  private startRiiTest(kind: RiiTestStart): void {
    this.pendingRiiTest = true;
    if (kind === 'rii') this.startGame('rii');
    else if (kind === 'riichi') this.startGame('rii', undefined, riichiTsumoStage(this.me));
    else if (kind === 'pair') this.startGame('rii', 'himeko');
    else this.startHimekoDemo(kind === 'himeko-broken');
  }

  private pendingRiiTest = false;

  // 「大星淡 · 转角暗杠测试」：别家不吃不碰不杠（能荣和照样荣和），摸牌顺序不错开，转角那张一定轮到她
  private quietTable = false;
  private pendingQuiet = false;

  // 「宫永咲 · 岭上开花测试」：自己打咲、开局坐庄，每局配牌都是暗杠、岭上自摸的那一档（cycle 一局一档轮着来）。
  // 对手照对局设置坐，但不用能力（会抢庄、挡自摸、封听牌的能力都会把这一下挡掉）；不击飞，一直连庄
  private startRinshanTest(tier: RinshanTier | 'cycle'): void {
    const mine = CHARACTERS.find((c) => c.id === 'saki')!;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const others = pickOpponents(this.settings, 'saki', new Rng(seed ^ 0x5a17));
    this.team = null;
    this.soloMatch = null;
    this.auto = false;
    const st = this.settings;
    const players = [mine, ...others];
    const stage = rinshanStage(this.me, tier);
    this.beginGame(players, new Game({ seed, format: st.length, startScore: st.start, rules: { ...rulesOf(st), tobi: false }, firstDealer: this.me, stage, players: players.map((c, i) => ({ name: c.name, ability: i === this.me ? c.ability : null, manual: i === this.me })) }));
  }

  // 「自摸动作测试」：charId 坐在 rel 那一家（0 自己、1 下家、2 对家、3 上家）、坐庄，每局第二张自摸（slamStage.ts）。
  // 别的座位坐三位没有特别动作的人；谁都不用能力、不击飞，挂机看（点「挂机中」可以接管）
  private startSlamTest(charId: string, rel: number): void {
    const seat = (this.me + rel) % 4;
    const star = CHARACTERS.find((c) => c.id === charId)!;
    const fill = ['hajime', 'tomoki', 'izumi', 'kana'].filter((id) => id !== charId).map((id) => CHARACTERS.find((c) => c.id === id)!);
    const players = [0, 1, 2, 3].map((s) => (s === seat ? star : fill.shift()!));
    const seed = Math.floor(Math.random() * 2 ** 31);
    const st = this.settings;
    this.team = null;
    this.soloMatch = null;
    this.auto = true;
    const game = new Game({ seed, format: st.length, startScore: st.start, rules: { ...rulesOf(st), tobi: false }, firstDealer: seat, stage: slamStage(seat, charId === 'teru'), players: players.map((c) => ({ name: c.name, ability: null, manual: false })) });
    this.beginGame(players, game);
  }

  // 试玩姬子的配牌特效：自己是姬子，每一局（东南两场、0–9 本场）都当作哩拿到了钥匙（broken：破碎的钥匙），开局就是那一局
  private startHimekoDemo(broken = false): void {
    const mine = CHARACTERS.find((c) => c.id === 'himeko')!;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const others = pickOpponents(this.settings, 'himeko', new Rng(seed ^ 0x5a17));
    const keys: BindKey[] = [];
    let round = 1;
    for (const wind of ['东', '南']) for (let n = 1; n <= 4; n++, round++) for (let h = 0; h < 10; h++) keys.push({ label: `${wind}${n}局 ${h}本场`, round, bind: 3, broken });
    this.team = null;
    this.soloMatch = null;
    this.auto = false;
    const st = this.settings;
    const players = [mine, ...others];
    this.beginGame(players, new Game({ seed, format: st.length, startScore: st.start, rules: rulesOf(st), firstDealer: Math.floor(Math.random() * 4), keys: [0, 1, 2, 3].map((i) => (i === this.me ? keys : [])), players: players.map((c, i) => ({ name: c.name, ability: c.ability, manual: i === this.me })) }));
  }

  // with：测试用，下家固定坐这位（白水哩和姬子同桌）；stage：测试用的摆牌（见 Game 的 Stage）；
  // opts.dealer 测试用的起家，opts.chisui 透华不管设置开局就治水
  private startGame(charId: string, withId?: string, stage?: Stage, opts: { dealer?: number; chisui?: boolean; opponents?: string[] } = {}): void {
    const mine = CHARACTERS.find((c) => c.id === charId)!;
    const seed = Math.floor(Math.random() * 2 ** 31);
    // 对手：设置里选了的照选的坐，随机的从其余角色里抽（测试局可以直接指定）
    const pick = withId ? { ...this.settings, opponents: [withId, ...this.settings.opponents.slice(1).map((id) => (id === withId ? '' : id))] } : this.settings;
    const others = opts.opponents?.map((id) => CHARACTERS.find((c) => c.id === id)!) ?? pickOpponents(pick, charId, new Rng(seed ^ 0x5a17));
    this.team = null;
    this.soloMatch = null;
    this.auto = false;
    const st = this.settings;
    const chisui = opts.chisui ?? st.chisui;
    const firstDealer = opts.dealer ?? Math.floor(Math.random() * 4);
    this.beginGame([mine, ...others], new Game({ seed, format: st.length, startScore: st.start, rules: rulesOf(st), firstDealer, players: [mine, ...others].map((c, i) => ({ name: c.name, ability: c.ability, manual: i === this.me, startForm: i === this.me && ((c.id === 'toka' && chisui) || (c.id === 'saki' && !stage && st.sakiStrong)) })), stage }));
  }

  // 公开手牌：单人对局按设置，团体赛不公开
  private openHands(): boolean {
    return !this.team && !this.soloMatch && this.settings.open;
  }

  // 团体赛的一场：玩家的队坐 0 号位，每人带着自己队伍现在的点数上场
  // 团体赛布阵：from 记下是从主页还是选人页进的，退出时回去
  private openTeam(from: 'title' | 'select'): void {
    this.teamFrom = from;
    this.teamFlow = new TeamFlow(this.root, {
      play: (run, seats, auto) => transition(() => this.startTeamMatch(run, seats, auto)),
      exit: () => transition(() => (this.teamFrom === 'title' ? this.renderTitle() : this.renderSelect())),
    });
  }

  private startTeamMatch(run: TeamRun, seats: number[], auto: boolean): void {
    const chars = seats.map((t) => run.teams[t].lineup[run.pos]);
    const start = seats.map((t) => run.teams[t].points);
    this.team = { flow: this.teamFlow!, run, seats, start };
    this.auto = auto;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const allies = seats.map((t) => run.teams[t].lineup.map((c) => c.id));
    // 同队的哩在之前的位置拿到的钥匙
    const keys = seats.map((t) => run.keys[t]);
    const game = new Game({ seed, format: 'team', firstDealer: Math.floor(Math.random() * 4), startScore: TEAM_START, scores: start, riichiSticks: run.riichiSticks, allies, keys, players: chars.map((c, i) => ({ name: c.name, ability: c.ability, manual: i === this.me && !auto })) });
    this.beginGame(chars, game);
  }

  private beginGame(chars: Character[], game: Game): void {
    this.riiTest = this.pendingRiiTest;
    this.pendingRiiTest = false;
    this.quietTable = this.pendingQuiet;
    this.pendingQuiet = false;
    useRiiLook(this.riiTest ? 'test' : 'main');
    this.chars = chars;
    this.game = game;
    // 桌上四个人的语音先解码好（第一局在这里取，之后每局开始再看一眼有没有新放的）
    this.voiceSeen.clear();
    preloadVoices(chars.map((c) => c?.id));
    // 随机微变化（落桌声、电脑想多久、出牌动作、牌河）：种子跟着牌局走，设置里能关
    vary.reset(game.seed, this.settings.vary);
    this.trace = new AbilityTrace(this.game);
    this.game.onEvent((e) => this.onGameEvent(e));
    gameMusic(game, this.finale());
    this.toasts = [];
    this.faces = [];
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
      // 2.5D 改良布局（试做）：牌桌上加 v2，样式和镜头都只在 v2 里改，原版不动
      const v2 = this.mode === '25d' && this.settings.layout === 'improved';
      this.root.innerHTML = `<div class="stage3d${this.mode === '25d' ? ' flat' : ''}${v2 ? ' v2' : ''}"><div class="three" id="three"></div><div class="hud" id="hud"></div><div class="hud" id="toasts"></div><div class="hud" id="banner"></div><div class="hud" id="cutins"></div><div class="rf-layer" id="rf"></div>${tip}</div>`;
      // 切入演出只在 2.5D 放；3D、2D 只放素材页换上的技能动画
      this.cutins = new Cutins(document.getElementById('cutins')!);
      this.cutinSeen.clear();
      this.table3d = new Table3D(document.getElementById('three')!, (id) => this.onTileClick(id), this.mode === '25d' ? '25d' : '3d', v2);
      // 改良布局的手牌画法：照视觉设置（B / C）；网址后面加 ?hand=A 到 F 可以临时换成别的几种看
      const handStyle = HAND_STYLES_V2[new URLSearchParams(location.search).get('hand')?.toUpperCase() ?? ''] ?? HAND_STYLES_V2[this.settings.hand];
      if (v2 && handStyle) this.table3d.setView25(handStyle);
      this.table3d.onHover = (id) => this.hoverTile(id);
      // 爱丽丝的手绘板摆在手牌上方：照手牌在画面上实际的上沿往上让（见 style.css 的 --hand-clear）
      this.table3d.onHandClear = (px) => {
        const hud = document.getElementById('hud');
        if (px === null) hud?.style.removeProperty('--hand-clear');
        else hud?.style.setProperty('--hand-clear', `${Math.round(px + 8)}px`);
      };
      // 2.5D 的副露摆到画面边上，但别压着头像框和能力说明
      if (this.mode === '25d') {
        this.table3d.keepOut = () => [...this.root.querySelectorAll('.seat-frame, .ability-panel')].map((el) => el.getBoundingClientRect());
      }
      // 3D 牌桌上牌真正落到牌河时才响
      this.table3d.onMarker = (seat, _tile, name, style) => {
        if (name === 'land') playClick({ pan: this.clickPan(seat), varied: true, weight: landWeight(style) });
      };
      // 出牌的花样里落桌以后的动静：弹一下、倒平了的轻响，推到位的重响，贴着桌面滑的沙沙声
      this.table3d.onCue = (seat, _tile, kind, seconds) => {
        const pan = this.clickPan(seat);
        if (kind === 'scrape') playScrape(pan, seconds);
        else if (kind === 'tap' || kind === 'slap' || kind === 'knock') playClick({ pan, varied: true, weight: kind === 'tap' ? 'soft' : 'slap' });
      };
      // 自摸砸牌：牌扣到桌上“嗒”一声，翻起来炸开时一记闷响加一阵旋风；咲的岭上开花再加一串铃和风声
      this.table3d.onSlam = (seat, lily, phase) => {
        if (phase === 'press') {
          playClick({ pan: this.clickPan(seat) });
          return;
        }
        playSlam();
        if (lily !== null) playLily(lilyGrand(lily));
      };
      // 衣的海底牌砸进海里：水声
      this.table3d.onSeaSlam = () => playSplash();
      // 全自动麻将机：仪表盘抬起落下、牌掉进去、升降板沉下去又升上来、到顶卡住
      this.table3d.onMachine = (cue, dur) => playMachine(cue, dur);
      this.table3d.onShift = (cue, dur) => playShift(cue, dur);
      this.table3d.onFlaps = (n) => playFlapTicks(n);
      // 原木：小朱印盖到仪表盘上
      this.table3d.onStamp = () => playStamp();
      // 照的旋风自摸：牌拍下去、风卷起来时一记闷响加一阵风声，电劈下来、劈到桌上“噼啪”一声，风散开时再噼啪一下
      this.table3d.onTwister = (_seat, size, phase) => {
        if (phase === 'erupt') {
          playSlam();
          playWhirl(size);
        } else playCrackle(phase === 'bolt' ? 0.85 : 0.55);
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
      // 照魔镜也是：第一局在牌桌建好之前就开始了，补放一次（切入、语音、对手头像上的镜子）
      const mirror = g.events.find((e) => e.type === 'ability' && e.ability === 'teru' && e.text === '照魔镜');
      if (mirror && g.round === 1) window.setTimeout(() => this.game === g && this.onGameEvent(mirror), Math.max(900, this.busyMs()));
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
      // 新结算：流局先在牌桌中间出大字、手牌上挂听牌 / 不听，多停一会儿再进点数移动
      const staged = g.phase === 'roundEnd' && this.staged();
      if (staged && !wins) this.drawBanner(g);
      const base =
        this.mode === '2d' ? Math.max(0, this.riiHold - Date.now()) : Math.max(this.riiHold - Date.now(), this.mode === '25d' && wins ? Math.max(3400, this.busyMs() + 900) : (wins ? 2400 : 1400) + this.busyMs());
      const wait = staged && !wins ? Math.max(base, 3000) : base;
      this.timer = window.setTimeout(() => {
        this.showResult = true;
        if (!this.vision) resultMusic(g, this.scene(), staged);
        if (staged) {
          this.render();
          this.openFlow(g);
          return;
        }
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
        for (const s of ai) {
          const quiet = this.quietTable && s !== this.me ? (g.legalActions(s).find((a) => a.type === 'ron') ?? g.legalActions(s).find((a) => a.type === 'pass')) : undefined;
          g.act(s, quiet ?? chooseAction(g, s, this.chars[s].ai));
        }
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
    if (!this.auto && !v) promptCue(g, this.me);
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
    return `<div class="assist-bar">${html}${soundButtonHtml()}</div>`;
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
    this.closeFlow();
    this.showResult = false;
    g.nextRound();
    // 下一局发牌前要选技能（爽的五色云等）：引擎已经把上一局的牌收走了，桌上的倒牌、锁链这些也收掉，停在空牌桌上选
    if ((g.phase as string) === 'predeal') {
      this.clearRoundFx();
      this.table3d?.clearRound();
    }
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

  // 上一局留在桌上的东西收掉（隐身淡掉的牌河、手绘板、哩的锁链和钥匙）：新的一局开始，或者发牌前选技能时
  private clearRoundFx(): void {
    this.gone.clear();
    this.vanishAt.clear();
    this.sketchView = false;
    this.sketchGlitchUntil = 0;
    this.riiPicking = false;
    this.chains2d?.clear();
    this.skyKey?.clear();
    this.riiPadlockStop?.();
    this.riiPadlockStop = null;
    this.riiLockAt = 0;
    this.riiPlockSwapAt = 0;
    this.riiLockEnd.clear();
  }

  // 配乐要知道的：自己坐哪、现在该不该给玩家提示音、是不是团体赛大将战、牌桌动画还要多久
  private scene(): Scene {
    return { me: this.me, quiet: this.auto || !!this.vision, finale: this.finale(), delay: this.busyMs() };
  }

  // 压轴的一场（放决战的音乐）：团体赛的大将战、个人赛的焦点桌和决赛桌
  private finale(): boolean {
    return (!!this.team && this.team.run.pos >= POSITIONS.length - 1) || !!this.soloMatch?.finale;
  }

  private onGameEvent(e: GameEvent): void {
    this.table3d?.onEvent(e, this.game!);
    // 配乐、提示音（怜的演算里发生的事不算数）
    if (!this.vision) soundtrackEvent(e, this.game!, this.scene());
    this.updateFaces(e);
    if (e.type === 'roundStart') {
      this.roundBanner();
      // 新的一局配牌先理好
      this.handOrder = null;
      this.cutinSeen.clear();
      this.gbSighed.clear();
      this.blocked = this.penaltyNext;
      this.penaltyNext = false;
      this.clearRoundFx();
      this.stars2dFx?.clear();
      this.starHold2d = 0;
      this.starUraShown = false;
      // 桌上有哩：先把番缚的音效解码好
      if (this.chars.some((c) => c?.id === 'rii')) preloadRiiSound();
      // 桌上四个人的语音（素材页里放了的）先解码好
      this.voiceSeen.clear();
      preloadVoices(this.chars.map((c) => c?.id));
    }
    // 梅根的决斗：对手每摸一次牌，转轮转一格
    if (e.type === 'draw' && this.game && duelledBy(this.game, e.seat) !== null) playDuelStep();
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
      // 2D：这一张怎么放下去（3D、2.5D 的牌桌自己挑，见 table3d 的 pickStyle），落桌声跟着动画响
      const pond = this.game!.players[e.seat].discards;
      // 宣言牌被鸣走以后补横的那一张不是宣言，平放下去，不耍花样
      const plain = !!this.table3d || (!e.riichi && riichiSideIndex(pond) === pond.length - 1);
      // 大星淡的双立直是她自己的一套（回旋），设置里选了哪种都照这个来
      const fling = !!e.riichi && this.chars[e.seat]?.id === 'awai' && this.game!.players[e.seat].doubleRiichi;
      const style = plain ? 'place' : fling ? 'fling' : pickDiscardStyle(this.chars[e.seat]?.id ?? '', !!e.riichi, e.riichi ? this.settings.riichiFx : this.settings.discardFx);
      // 横推推多远看这一张落在一行里的第几格（第三行放不下的接着往右排）
      const n = Math.max(0, pond.filter((d) => !d.called).length - 1);
      const col = n - Math.min(2, Math.floor(n / 6)) * 6;
      const push = isPush(style) ? pushDistAt(col) : 0;
      this.freshDiscard = { key: `${e.seat}-${pond.length - 1}`, style, at: Date.now(), push };
      // 横推撞上前一张：前一张歪一点（撞上的那一刻才歪）。刹车的那一种自己停住，不撞
      if (push && style === 'push' && col > 0) {
        const g = this.game!;
        if (this.knocksRound !== g.round) this.knocks2d.clear();
        this.knocksRound = g.round;
        const prev = pond.filter((d) => !d.called).at(-2)!.tile;
        const sign = hash01(g.seed, prev, 11) < 0.5 ? -1 : 1;
        this.knocks2d.set(prev, { deg: sign * (KNOCK_2D_DEG[0] + (KNOCK_2D_DEG[1] - KNOCK_2D_DEG[0]) * hash01(g.seed, prev, 12)), at: Date.now() + PUSH_2D_IN + push2dMs(push) });
      }
      if (!this.table3d) this.freshSounds(e.seat, style, push);
      this.gbSigh(e.seat, e.tile);
      if (e.riichi) {
        playRiichi(this.speak(e.seat, { kind: 'riichi' }) ? VOICED_CUE : 1);
        // 第二形态（透华的治水）在素材页换了立直动画：放这一段
        if (!this.formCutin(e.seat, 'riichi', '立直')) this.bigFx(e.seat, '立直', 'riichi');
        // 2D：大星淡的双立直，金色的光圈从她那边扫开，桌面变成夜空（3D、2.5D 画在牌桌里）
        const g = this.game!;
        if (!this.table3d && g.players[e.seat].doubleRiichi && this.chars[e.seat]?.id === 'awai' && g.active(e.seat)) {
          this.starHold2d = performance.now() + 420;
          window.setTimeout(() => {
            const fx = this.game === g ? this.stars2dLayer() : null;
            if (!fx) return;
            fx.declare(fx.center(document.querySelector(`.center .score.${POS[e.seat]}`)) ?? fx.middle);
            this.stars2d();
          }, 400);
        }
      }
    } else if (e.type === 'call') {
      // 隐身的桃子鸣牌：看不见也听不见
      if (this.game!.stealthed(e.seat, this.me)) return;
      // 2D：大星淡的转角暗杠，头像角上那颗星化成流星落到杠子上（等这一下重画完再找杠子）
      if (!this.table3d && e.call === '暗杠' && awaiCornerKan(this.game!, e.seat)) {
        const from = this.stars2dFx?.beaconAt;
        const seat = e.seat;
        window.setTimeout(() => this.starKan2d(seat, from ?? null), 60);
      }
      playCall(this.speak(e.seat, { kind: 'call', call: e.call }) ? VOICED_CUE : 1);
      this.bigFx(e.seat, e.call, e.call.includes('杠') ? 'kan' : 'call');
    } else if (e.type === 'ability') {
      // 玄的宝牌聚集、怜的一巡先见像被动一样一直开着（原作里大家都知道），不放切入也不出字；
      // 玄打出宝牌、能力失效时出一行小字。咲的杠的气息、岭上开花：这一局第一次放切入，之后只出小字
      // 控场能力换掉别人要摸的牌：悄悄换，结算时能力痕迹里再讲
      // （淡的高维领域、加速驱动例外：2D 牌桌上那一家的头像闪一下封印 / 粉光；3D、2.5D 在牌桌里放）
      if (e.target !== undefined && e.target !== e.seat) {
        if (e.ability === 'awai' && !this.table3d) this.awaiDeny2d(e.text, e.target);
        return;
      }
      // 姬子破碎的钥匙那一局换走自己摸到的宝牌：悄悄换
      if (e.ability === 'himeko' && e.text === '没有宝牌') return;
      // 爱丽丝自己的手绘板：画好、重画时放重组特效，碎了放破碎特效
      if (e.ability === 'aislinn' && e.seat === this.me && !this.vision) this.sketchFx(e.text);
      // 自己是原村和、变成天使和：天使形态动画放完，牌桌换成网络麻将
      if (e.ability === 'nodoka' && e.seat === this.me) this.syncNet(Math.max(NET_DELAY, this.busyMs() + 400));
      if (e.ability === 'kuro') {
        if (e.text !== '宝牌聚集') {
          this.sayAbility(e.seat, e.text);
          this.toast(e.seat, e.text, false);
        }
        return;
      }
      // 白水哩的钥匙：锁链变金汇成钥匙 / 崩断，在结算时放（见 roundEnd），这里不放切入
      if (e.ability === 'rii') return;
      // 智叶：拔刀是悄悄换的（鞘里的听牌谁也察觉不到），和牌时才见刀光；「斬」在结算时放（见 roundEnd）。看破只出一行小字
      if (e.ability === 'satoha') {
        if (e.text === '看破') this.toast(e.seat, e.text, false);
        return;
      }
      // 梅根：决斗开始时画面压成正午、两家之间拉一条线；换牌（子弹、对峙）不出字；对手拆听逃了转轮空转一下
      if (e.ability === 'megan') {
        const g = this.game!;
        if (e.text === MEGAN_BULLET || e.text === MEGAN_STAND) return;
        const fx = (ms: number, run: (host: HTMLElement) => void) =>
          window.setTimeout(() => {
            const host = this.game === g ? this.fxHost() : null;
            if (host) run(host);
          }, ms);
        if (e.text === '决斗' && e.target !== undefined) {
          const t = e.target;
          // 等「立直」的大字过去再放
          fx(700, (host) => duelStart(host, POS[e.seat], POS[t]));
          window.setTimeout(() => this.game === g && playDuelStart(), 700);
        }
        if (e.text === '逃脱' && e.target !== undefined) {
          const t = e.target;
          fx(0, (host) => duelEscape(host, POS[t]));
          playDuelMiss();
          this.toast(e.seat, `${this.chars[t].name}拆听，逃掉了`, false);
          return;
        }
        if (e.text === '决斗结束' || e.text === '抬牌') {
          this.toast(e.seat, e.text === '抬牌' ? '抬牌（役做出来了）' : '决斗结束', false);
          return;
        }
      }
      // 明华：起风每局都有，不出字，她座位上吹一阵风；场风悄悄摸来（只有操作她的人听得到一声风）；
      // 开嗓、升段时哼一句（越往后越长）；断风时那一家座位上的风被截断
      // 由晖子换左手：她座位上亮起腓尼基字母 𐤄（「窗」），一声开窗似的清响。
      // 电脑最后一局开局就按，那时第一局的牌桌可能还没建好，所以等一下再找画特效的那一层
      if (e.ability === 'yukiko' && e.text === '左手') {
        const g = this.game!;
        const seat = e.seat;
        window.setTimeout(() => {
          const host = this.game === g ? this.fxHost() : null;
          if (host) leftHandSign(host, POS[seat]);
        }, 150);
        playWindow();
      }
      if (e.ability === 'myeonghwa') {
        const g = this.game!;
        // 第一局的发牌前面板关掉以后牌桌才建好，所以等一下再找画特效的那一层
        const later = (ms: number, fx: (host: HTMLElement) => void) =>
          window.setTimeout(() => {
            const host = this.game === g ? this.fxHost() : null;
            if (host) fx(host);
          }, ms);
        if (e.text === '起风') {
          const winds = myeonghwaWinds(g, e.seat);
          const wind = winds.seat - 27;
          const more = [winds.round, winds.guest].filter((k): k is number => k !== null).map((k) => k - 27);
          const level = myeonghwaSinging(g, e.seat);
          later(350, (host) => fuujinBreeze(host, POS[e.seat], wind, level, more));
          playBreeze(0.5);
          return;
        }
        if (e.text === '风来') {
          if (e.seat === this.me && !this.vision) playBreeze(0.35);
          return;
        }
        if (e.text === '歌停了') {
          this.toast(e.seat, e.text, false);
          return;
        }
        if (e.text === '断风') {
          const t = myeonghwaCut(g, e.seat);
          if (t !== null) later(500, (host) => fuujinCut(host, POS[t]));
        } else {
          playSong(myeonghwaSong(g, e.seat));
          // 一场里的第二次开嗓：在场外唱够了带进来的，一阵大风吹过整张桌子
          if (e.text === '开嗓' && myeonghwaSecondSong(g, e.seat)) later(450, (host) => fuujinGust(host, POS[e.seat]));
        }
      }
      playChime(this.sayAbility(e.seat, e.text) ? VOICED_CUE : 1);
      // 大星淡的技能：平行宇宙换牌桌时画面错开一下（三种视角都有）；2D 牌桌上的光圈、流星、北斗七星（3D、2.5D 画在牌桌里）
      if (e.ability === 'awai') this.awaiSkillFx2d(e.seat, e.text);
      // 照魔镜：另外三家的头像上各罩一面镜子（等这一下重画完再找头像）
      if (e.ability === 'teru' && e.text === '照魔镜') requestAnimationFrame(() => this.teruMirrorFx(e.seat));
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
      // 和牌的人喊「荣和」「自摸」：一炮多响时错开；她刚说完和牌的能力台词（岭上开花、海底捞月）就不再补
      let voiced = false;
      e.result.wins.forEach((w, i) => {
        if (this.speak(w.seat, { kind: 'win', tsumo: w.from === null }, { polite: true, delay: i * WIN_VOICE_GAP })) voiced = true;
      });
      if (e.result.wins.length) playWin(voiced ? VOICED_CUE : 1);
      this.riiPicking = false;
      this.riiFinish(e.result);
      // 2D：初美聚着风和牌，紫光往上冲（3D、2.5D 在牌桌上放）
      const gale = this.galeView();
      const slam = !this.table3d && gale ? e.result.wins.find((w) => w.seat === gale.seat) : undefined;
      if (slam) {
        this.galeSlam = { seat: slam.seat, t0: performance.now() };
        window.setTimeout(() => this.galeBurst2d(), slamImpact2d(slam.hand.filter((t) => t !== slam.tile).length) * 1000);
      }
      // 2D：咲的岭上开花（岭上牌自摸；役满时役里不写岭上开花，看这一张是不是岭上摸的）也是结算里手牌倒下、和了牌砸下去，
      // 砸到那一下从这张牌卷出旋风（3D、2.5D 在牌桌上放）
      const g = this.game!;
      const bloom = !this.table3d && !slam ? e.result.wins.find((w) => w.from === null && this.chars[w.seat]?.id === 'saki' && (g.rinshanDraw || w.result.yaku.some((y) => y.name === '岭上开花'))) : undefined;
      if (bloom) {
        this.galeSlam = { seat: bloom.seat, t0: performance.now() };
        window.setTimeout(() => this.game === g && this.lilyBurst2d(bloom.result.base), slamImpact2d(bloom.hand.filter((t) => t !== bloom.tile).length) * 1000);
      }
      // 2D：照连和中自摸，也是结算里手牌倒下、和了牌砸下去；砸到那一下牌转起来，
      // 从这张牌底下卷起龙卷风，风散了牌还转一会儿才停（3D、2.5D 在牌桌上放）
      this.twist2d = null;
      const twirl = !this.table3d && !slam && !bloom ? e.result.wins.find((w) => this.twistSize2d(w) !== null) : undefined;
      if (twirl) {
        const size = this.twistSize2d(twirl)!;
        this.galeSlam = { seat: twirl.seat, t0: performance.now() };
        this.twist2d = twirl.seat;
        window.setTimeout(() => this.game === g && this.teruTornado2d(size), slamImpact2d(twirl.hand.filter((t) => t !== twirl.tile).length) * 1000);
      }
      // 2D：淡中了杠里的自摸（逆回旋），结算里手牌从和了牌那一头起一张张逆着翻开，亮一下，和了牌再砸下去（3D、2.5D 在牌桌上放）
      this.whirl2d = null;
      const whirl = !this.table3d && !slam && !bloom && !twirl ? e.result.wins.find((w) => w.from === null && this.chars[w.seat]?.id === 'awai' && awaiKanUraHit(g, w.seat)) : undefined;
      if (whirl) {
        this.galeSlam = { seat: whirl.seat, t0: performance.now() };
        this.whirl2d = whirl.seat;
        const pan = this.clickPan(whirl.seat);
        window.setTimeout(() => this.game === g && playClick({ pan, weight: 'slap' }), 1000);
        window.setTimeout(() => this.game === g && playClick({ pan, weight: 'slap' }), (whirlStart2d() + 0.55) * 1000);
      }
      for (const w of e.result.wins) {
        // 郝慧宇和牌喊「食糊」，国标 24 番以上金色
        if (this.gbWinFx(w)) continue;
        // 智叶没立直和牌：先一道刀光；结束了别人的连庄出「斬」
        if (this.iaiWinFx(w)) continue;
        // 明华唱着歌和牌：一阵风吹过整张桌子
        if (this.fuujinWinFx(w)) continue;
        // 梅根决斗打中了：一声枪响
        if (this.duelWinFx(w)) continue;
        // 由晖子左手的局和牌：𐤄 再亮一次，光铺满整张桌子
        if (this.leftWinFx(w)) continue;
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

  // 角色语音（src/ui/voice.ts）：这个座位的人说一句，说了返回 true。没放音频、设置里关了就不说
  private speak(seat: number, cue: VoiceCue, opts: { polite?: boolean; delay?: number } = {}): boolean {
    const c = this.chars[seat];
    if (!c) return false;
    return sayVoice(c.id, cueKeys(c.id, cue), { seat, pan: this.clickPan(seat), ...opts });
  }

  // 能力台词：同一个能力一局只说第一次
  private sayAbility(seat: number, text: string): boolean {
    const key = `${seat}-${text}`;
    if (this.voiceSeen.has(key)) return false;
    this.voiceSeen.add(key);
    return this.speak(seat, { kind: 'ability', text });
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

  // ---------- 衣的海底 ----------

  // 牌桌上的海水（谁都看得见：海底捞月发动时放了切入）：海底路线上越接近海底涨得越高（网络麻将的画面不铺水）
  private seaView() {
    const g = this.game;
    if (!g || this.netView || g.phase === 'predeal' || g.phase === 'postdeal') return null;
    return koromoSea(g, this.chars.map((c) => c?.id));
  }

  // 2D 换局（牌桌风格沙滩、草甸、原木、翻牌屏、深夜）：换了局就把换局前那一刻 #table 里的东西复制一份（结算框不要）盖在新的一局上面，
  // 沙滩一个浪打过来把它冲掉（wash2d），草甸一阵风把它吹散（gust2d），原木的牌扣过来绕着中间搓几圈再码出去（shuffle2d），
  // 翻牌屏的牌一排排翻成牌背、中间那块的字一页页翻到新的一局（flip2d），深夜熄灯，黑里扫一圈换成新的一局（lamp2d）。
  // 3D、2.5D 的在 tide.ts、gust.ts、shuffle.ts、flip.ts、lamp.ts；这里只是一层画面，不挡发牌、出牌
  private shift2d(g: Game, table: HTMLElement, off: boolean): void {
    const prev = this.shiftRound;
    this.shiftRound = { g, round: g.round };
    const kind = document.documentElement.dataset.table;
    if (off || !prev || prev.g !== g || prev.round === g.round || (kind !== 'beach' && kind !== 'meadow' && kind !== 'wood' && kind !== 'flap' && kind !== 'night')) return;
    // 系统里设了「减少动态效果」：不演
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = table.parentElement;
    if (!host || !table.firstElementChild) return;
    host
      .querySelectorAll(
        ':scope > .wash-old, :scope > .wash-water, :scope > .wash-wet, :scope > .gust-old, :scope > .gust-cover, :scope > .gust-air, :scope > .shuf-old, :scope > .shuf-cover, :scope > .flip-old, :scope > .flip-cover, :scope > .lamp-old, :scope > .lamp-dark, :scope > .lamp-glow',
      )
      .forEach((e) => e.remove());
    const old = document.createElement('div');
    old.innerHTML = table.innerHTML;
    old.querySelectorAll('.modal, .hiroe-say, canvas').forEach((e) => e.remove());
    old.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    if (kind === 'beach') this.wash2d(host, old);
    else if (kind === 'meadow') this.gust2d(host, old);
    else if (kind === 'flap') this.flip2d(host, old, g);
    else if (kind === 'night') this.lamp2d(host, old, table);
    else this.shuffle2d(host, old, tableColors().seals ? lastWinners(g) : []);
  }

  // 深夜：“啪嗒”一声熄灯，整张桌子罩上一层黑（.lamp-dark），黑里只看得见牌背上的夜光月牙（别家立着的手牌只看得到牌背那半边，是一道光）。
  // 然后像秒针扫过一圈：从 12 点起顺时针，扫过的地方上一局的样子（.lamp-old，连桌面一起）没了、露出新的一局，上一局牌背的光跟着灭掉；
  // 隔一小会儿再扫一圈，新一局牌背的光一处处亮起来。扫完日光灯闪两下亮起来（黑的那层照 lamp.ts 的 FLICK 一闪一闪淡掉）。
  // 都是 WAAPI 动画（扫到哪是注册过的 CSS 变量 --lamp-sweep），截图时暂停、拨时间一起走。
  // 调用的时候 #table 里还是上一局，新的一局等这一下画完（microtask）再找它的牌背
  private lamp2d(host: HTMLElement, old: HTMLElement, table: HTMLElement): void {
    old.className = 'lamp-old';
    const dark = document.createElement('div');
    dark.className = 'lamp-dark';
    const glow = document.createElement('div');
    glow.className = 'lamp-glow';
    host.append(old, dark, glow);
    const box = host.getBoundingClientRect();
    // 扫的中心是中间那块的中心
    const mid = old.querySelector('.center')?.getBoundingClientRect();
    const cx = mid ? mid.left + mid.width / 2 - box.left : box.width / 2;
    const cy = mid ? mid.top + mid.height / 2 - box.top : box.height / 2;
    old.style.setProperty('--lamp-x', `${cx.toFixed(1)}px`);
    old.style.setProperty('--lamp-y', `${cy.toFixed(1)}px`);
    // 熄灯要多久、熄灯以后多久开始扫、扫一圈多久、新的光那一圈晚多久、什么时候开灯（毫秒）；黑的那层最黑多不透明
    const [OFF, FROM, SWEEP, LAG, ON] = [120, 170, 560, 200, 1150];
    const DIM = 0.93;
    const total = ON + FLICKER * 1000;
    // 黑的那层、发光的那层：灯多亮（lamp.ts 的 DARK 到 1）换成多不透明
    const frames = (op: (v: number) => number): Keyframe[] => [
      { opacity: 0, offset: 0 },
      { opacity: op(DARK), offset: OFF / total },
      { opacity: op(DARK), offset: ON / total },
      ...FLICK.map(([t, v]) => ({ opacity: op(v), offset: Math.min(1, (ON + t * 1000) / total) })),
    ];
    dark.animate(frames((v) => (1 - v) * DIM), { duration: total, fill: 'both' });
    glow.animate(frames((v) => Math.min(1, Math.max(0, (1 - v) / (1 - DARK)))), { duration: total, fill: 'both' });
    old.animate([{ '--lamp-sweep': '0deg' }, { '--lamp-sweep': '360deg' }], { duration: SWEEP, delay: FROM, fill: 'both' });
    // 牌背的光：扣着的牌是一弯月牙，别家立着的手牌是靠桌子中间那半边（牌背）一道光。旧的扫到就灭，新的第二圈扫到才亮
    const lights = (root: Element, gone: boolean) => {
      for (const el of root.querySelectorAll<HTMLElement>('.tile.back:not(.tint, .sketch)')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const x = r.left + r.width / 2 - box.left;
        const y = r.top + r.height / 2 - box.top;
        const i = document.createElement('i');
        if (el.classList.contains('t-top')) {
          // 横着的（对家）还是竖着的（上下家）：靠中间那半边
          const flat = r.width >= r.height;
          const [w, h] = flat ? [r.width, r.height / 2] : [r.width / 2, r.height];
          const left = flat ? r.left : x < cx ? r.left + r.width / 2 : r.left;
          const top = flat ? (y < cy ? r.top + r.height / 2 : r.top) : r.top;
          i.className = 'edge';
          i.style.cssText = `left:${(left - box.left).toFixed(1)}px;top:${(top - box.top).toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px`;
        } else {
          const d = Math.min(r.width, r.height) * 0.54;
          i.className = 'moon';
          i.style.cssText = `left:${(x - d / 2).toFixed(1)}px;top:${(y - d / 2).toFixed(1)}px;width:${d.toFixed(1)}px;height:${d.toFixed(1)}px;--d:${d.toFixed(1)}px`;
        }
        glow.append(i);
        // 这一张在表盘上是几点（12 点在上，顺时针）
        let a = Math.atan2(x - cx, cy - y) / (Math.PI * 2);
        if (a < 0) a += 1;
        const at = FROM + (gone ? 0 : LAG) + a * SWEEP;
        i.animate(gone ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: at, fill: 'both' });
      }
    };
    lights(old, true);
    queueMicrotask(() => {
      if (glow.isConnected) lights(table, false);
    });
    playLamp('off', 0.1);
    window.setTimeout(() => playLamp('collect', SWEEP / 1000), FROM);
    window.setTimeout(() => playLamp('stack', SWEEP / 1000), FROM + LAG);
    window.setTimeout(() => playLamp('flicker', FLICKER), ON);
    window.setTimeout(() => {
      old.remove();
      dark.remove();
      glow.remove();
    }, total + 200);
  }

  // 沙滩：一个浪从对面（画面上方）涌下来盖住上一局的牌，停一下再退回去，退过的地方露出新的一局，
  // 沙子湿一会儿才干。上一局的样子浪头扫到哪就切到哪
  private wash2d(host: HTMLElement, old: HTMLElement): void {
    old.className = 'wash-old';
    const water = document.createElement('div');
    water.className = 'wash-water';
    const wet = document.createElement('div');
    wet.className = 'wash-wet';
    host.append(wet, old, water);
    // 涌过来 0.75 秒、漫着停 0.15 秒、退回去 0.8 秒；湿沙在水退完以后再过 1.2 秒干掉
    const [IN, HOLD, OUT, DRY] = [750, 150, 800, 1200];
    const all = IN + HOLD + OUT;
    const surge = 'cubic-bezier(.25,.7,.4,1)';
    const ebb = 'cubic-bezier(.55,0,.8,.45)';
    water.animate(
      [
        { transform: 'translateY(-104%)', easing: surge },
        { transform: 'translateY(0)', offset: IN / all },
        { transform: 'translateY(0)', offset: (IN + HOLD) / all, easing: ebb },
        { transform: 'translateY(-104%)' },
      ],
      { duration: all, fill: 'forwards' },
    );
    // 上一局的样子：浪头盖到哪就切掉到哪
    old.animate([{ clipPath: 'inset(0 0 0 0)', easing: surge }, { clipPath: 'inset(100% 0 0 0)' }], { duration: IN, fill: 'forwards' });
    wet.animate(
      [
        { opacity: 0 },
        { opacity: 0, offset: (IN + HOLD) / (all + DRY) },
        { opacity: 1, offset: (IN + HOLD + 1) / (all + DRY) },
        { opacity: 1, offset: all / (all + DRY) },
        { opacity: 0 },
      ],
      { duration: all + DRY, fill: 'forwards' },
    );
    playTide('surge', IN / 1000);
    window.setTimeout(() => playTide('crash', 0.5), IN * 0.3);
    window.setTimeout(() => playTide('ebb', OUT / 1000), IN + HOLD);
    window.setTimeout(() => old.remove(), IN + 20);
    window.setTimeout(() => {
      water.remove();
      wet.remove();
    }, all + DRY + 50);
  }

  // 草甸：一阵风从画面左边或右边刮过来，上一局的牌从上风那头起一张张被掀起来、翻着跟头往下风飞，散成花瓣、草叶；
  // 草面上跟着风头一道亮光，空中几道风痕。新的一局先用一层一模一样的草地（.gust-cover）盖着，风过去以后这层草地淡掉，露出新的牌山
  private gust2d(host: HTMLElement, old: HTMLElement): void {
    old.className = 'gust-old';
    const cover = document.createElement('div');
    cover.className = 'gust-cover';
    const air = document.createElement('div');
    air.className = 'gust-air';
    host.append(cover, old, air);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const box = host.getBoundingClientRect();
    const W = Math.max(1, box.width);
    // 风头扫过整张桌 0.6 秒，一张牌飞 0.65 秒；风过去以后 0.12 秒草地开始淡掉，淡 0.45 秒
    const [SWEEP, FLY, CALM, FADE] = [600, 650, 120, 450];
    const gone = SWEEP + FLY;
    const petals = ['#fbfaf3', '#fbfaf3', '#f6e7a6', '#f4d3da', '#4f7f45', '#8db06c'];
    // 每张牌外面那几层的旋转（左右两家的牌河是转过 90 度的）：把屏幕上往下风的方向换成这张牌自己那层的方向
    const frames = new Map<Element, DOMMatrix>();
    const frameOf = (el: Element | null): DOMMatrix => {
      if (!el || el === old) return new DOMMatrix();
      const hit = frames.get(el);
      if (hit) return hit;
      const t = getComputedStyle(el).transform;
      const own = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
      const m = frameOf(el.parentElement).multiply(new DOMMatrix([own.a, own.b, own.c, own.d, 0, 0]));
      frames.set(el, m);
      return m;
    };
    // 中间那块上的宝牌指示牌是仪表盘的一部分，不飞
    const tiles = [...old.querySelectorAll<HTMLElement>('.tile')].filter((el) => !el.closest('.center'));
    for (const el of tiles) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2 - box.left;
      const cy = r.top + r.height / 2 - box.top;
      const k = dir > 0 ? cx / W : 1 - cx / W;
      const at = Math.max(0, k) * SWEEP + Math.random() * 60;
      // 屏幕上：往下风飞出去 180 到 320 像素，先往上掀一点
      const dx = dir * (180 + Math.random() * 140);
      const dy = -(20 + Math.random() * 50);
      const inv = frameOf(el.parentElement).inverse();
      const lp = inv.transformPoint(new DOMPoint(dx, dy, 0, 0));
      const mid = inv.transformPoint(new DOMPoint(dx * 0.35, dy * 1.2, 0, 0));
      const spin = dir * (180 + Math.random() * 360);
      el.animate(
        [
          { translate: '0px 0px', rotate: '0deg', scale: '1', opacity: 1, easing: 'cubic-bezier(.4,0,.9,.6)' },
          { translate: `${mid.x.toFixed(1)}px ${mid.y.toFixed(1)}px`, rotate: `${(spin * 0.3).toFixed(0)}deg`, scale: '0.9', opacity: 1, offset: 0.35 },
          { translate: `${lp.x.toFixed(1)}px ${lp.y.toFixed(1)}px`, rotate: `${spin.toFixed(0)}deg`, scale: '0.3', opacity: 0 },
        ],
        { duration: FLY, delay: at, fill: 'both' },
      );
      // 飞到一半散成两三片花瓣、草叶，被风带着往下风飘
      for (let i = 0, n = 1 + Math.floor(Math.random() * 2); i < n; i++) {
        const p = document.createElement('i');
        p.style.left = `${(cx + dx * 0.3).toFixed(0)}px`;
        p.style.top = `${(cy + dy * 0.8).toFixed(0)}px`;
        p.style.background = petals[Math.floor(Math.random() * petals.length)];
        air.append(p);
        const fx = dir * (140 + Math.random() * 220);
        const fy = 10 + Math.random() * 70;
        const turn = dir * (240 + Math.random() * 480);
        p.animate(
          [
            { translate: '0px 0px', rotate: '0deg', opacity: 0 },
            { opacity: 1, offset: 0.1 },
            { translate: `${(fx * 0.55).toFixed(0)}px ${(fy * 0.3 - 18).toFixed(0)}px`, rotate: `${(turn * 0.5).toFixed(0)}deg`, opacity: 1, offset: 0.55 },
            { translate: `${fx.toFixed(0)}px ${fy.toFixed(0)}px`, rotate: `${turn.toFixed(0)}deg`, opacity: 0 },
          ],
          { duration: 800 + Math.random() * 400, delay: at + FLY * 0.4, fill: 'both', easing: 'cubic-bezier(.3,.5,.6,1)' },
        );
      }
    }
    // 风头：一道亮光（风压倒的草）扫过去，前后几道风痕
    const sheen = document.createElement('b');
    sheen.className = 'gust-sheen';
    air.append(sheen);
    // 亮光那一条宽 34%：从桌子一边外面扫到另一边外面（translate 的百分比按它自己的宽算）
    const from = dir > 0 ? '-110%' : '300%';
    const to = dir > 0 ? '300%' : '-110%';
    sheen.animate([{ translate: `${from} 0`, opacity: 0.9 }, { translate: `${to} 0`, opacity: 0.6 }], { duration: SWEEP + 300, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'both' });
    for (let i = 0; i < 6; i++) {
      const st = document.createElement('u');
      st.className = 'gust-streak';
      st.style.top = `${(8 + i * 15 + Math.random() * 8).toFixed(0)}%`;
      st.style.width = `${(14 + Math.random() * 10).toFixed(0)}%`;
      if (dir < 0) st.style.transform = 'scaleX(-1)';
      air.append(st);
      st.animate([{ left: dir > 0 ? '-25%' : '110%', opacity: 0 }, { opacity: 0.8, offset: 0.3 }, { left: dir > 0 ? '110%' : '-25%', opacity: 0 }], {
        duration: 420 + Math.random() * 160,
        delay: (i / 6) * SWEEP + Math.random() * 80,
        fill: 'both',
        easing: 'linear',
      });
    }
    // 风过去以后：盖着的那层草地和上一局剩下的东西（中间那块）一起淡掉，新的一局露出来
    const fadeAt = gone + CALM;
    for (const el of [cover, old]) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE, delay: fadeAt, fill: 'both', easing: 'ease-in-out' });
    playGust('gust', (SWEEP + 400) / 1000);
    window.setTimeout(() => playGust('scatter', 0.6), 180);
    window.setTimeout(() => playGust('breeze', FADE / 1000), fadeAt - 100);
    window.setTimeout(() => playGust('land', 0.2), fadeAt + FADE - 80);
    window.setTimeout(() => {
      old.remove();
      cover.remove();
      air.remove();
    }, fadeAt + FADE + 400);
  }

  // 原木：上一局的牌一张张扣过来（翻成竹子牌背），推到中间那块四周，绕着它搓几圈；然后往四边散出去、淡掉，
  // 垫着的那层木桌面（.shuf-cover）跟着淡掉，露出码好牌山的新一局。中间那块（宝牌指示牌）不动
  private shuffle2d(host: HTMLElement, old: HTMLElement, winners: number[]): void {
    old.className = 'shuf-old';
    const cover = document.createElement('div');
    cover.className = 'shuf-cover';
    host.append(cover, old);
    const box = host.getBoundingClientRect();
    const panel = old.querySelector('.center')?.getBoundingClientRect();
    // 牌堆绕着中间那块：圈的中心、里圈半径（中间那块外面一点）、外圈半径（不出桌子）
    const cx = panel ? panel.left + panel.width / 2 - box.left : box.width / 2;
    const cy = panel ? panel.top + panel.height / 2 - box.top : box.height / 2;
    const inner = (panel ? Math.max(panel.width, panel.height) / 2 : 70) + 16;
    const outer = Math.max(inner + 20, Math.min(inner + 80, cx - 24, box.width - cx - 24, cy - 24, box.height - cy - 24));
    // 扣过来推进去 0.45 秒，搓到 1.3 秒，然后 0.55 秒散出去（新的一局同时露出来）
    const [SCOOP, SWIRL_END, OUT] = [450, 1300, 550];
    const all = SWIRL_END + OUT;
    // 每张牌外面那几层的旋转（左右两家的牌河是转过 90 度的）：屏幕上的位移换成这张牌自己那层的方向（和 gust2d 一样）
    const frames = new Map<Element, DOMMatrix>();
    const frameOf = (el: Element | null): DOMMatrix => {
      if (!el || el === old) return new DOMMatrix();
      const hit = frames.get(el);
      if (hit) return hit;
      const t = getComputedStyle(el).transform;
      const own = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
      const m = frameOf(el.parentElement).multiply(new DOMMatrix([own.a, own.b, own.c, own.d, 0, 0]));
      frames.set(el, m);
      return m;
    };
    const tiles = [...old.querySelectorAll<HTMLElement>('.tile')].filter((el) => !el.closest('.center'));
    for (const el of tiles) {
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2 - box.left;
      const y0 = r.top + r.height / 2 - box.top;
      const inv = frameOf(el.parentElement).inverse();
      const local = (x: number, y: number) => {
        const p = inv.transformPoint(new DOMPoint(x - x0, y - y0, 0, 0));
        return `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`;
      };
      // 推到圈上离它最近的地方，然后逆时针搓；每张转多少、离中心多远都不一样
      const a0 = Math.atan2(y0 - cy, x0 - cx) + (Math.random() - 0.5) * 0.5;
      const rad = inner + Math.random() * (outer - inner);
      const turn = 1.4 + Math.random() * 0.9;
      const spin = (Math.random() - 0.5) * 120;
      // 大小统一成牌河那么大，别家手牌那种只看得到顶边的扁条拉成整张
      const w = Math.max(1, el.offsetWidth);
      const h = Math.max(1, el.offsetHeight);
      const sc = `${(24 / w).toFixed(3)} ${(33 / h).toFixed(3)}`;
      const at = (k: number, dr = 0) => {
        const a = a0 - turn * k;
        return local(cx + Math.cos(a) * (rad + dr), cy + Math.sin(a) * (rad + dr));
      };
      const lag = Math.random() * 80;
      const kf: Keyframe[] = [
        { offset: 0, translate: '0px 0px', rotate: '0deg', scale: '1 1', opacity: 1, easing: 'ease-in' },
        // 翻身：先压扁成一条（侧面），翻过来是牌背
        { offset: (SCOOP * 0.25) / all, translate: local(x0 + (cx - x0) * 0.12, y0 + (cy - y0) * 0.12), rotate: `${(spin * 0.2).toFixed(0)}deg`, scale: `0.08 ${(33 / h).toFixed(3)}`, opacity: 1, easing: 'ease-out' },
        { offset: SCOOP / all, translate: at(0), rotate: `${spin.toFixed(0)}deg`, scale: sc, opacity: 1, easing: 'linear' },
      ];
      for (let i = 1; i <= 4; i++) {
        const k = i / 4;
        kf.push({ offset: (SCOOP + (SWIRL_END - SCOOP) * k) / all, translate: at(k, Math.sin(k * 5 + a0) * 7), rotate: `${(spin + k * 160).toFixed(0)}deg`, scale: sc, opacity: 1, easing: i === 4 ? 'ease-in' : 'linear' });
      }
      // 码牌：往外散到牌山那边，淡掉
      kf.push({ offset: 1, translate: at(1.15, outer - rad + 60), rotate: `${(spin + 200).toFixed(0)}deg`, scale: sc, opacity: 0 });
      el.animate(kf, { duration: all, delay: lag, fill: 'both' });
      // 牌背：翻到侧面那一下换成竹子牌背
      const back = document.createElement('b');
      back.className = 'shuf-back';
      el.append(back);
      back.animate([{ opacity: 0 }, { opacity: 0, offset: 0.24 }, { opacity: 1, offset: 0.25 }, { opacity: 1 }], { duration: SCOOP, delay: lag, fill: 'both' });
    }
    // 上一局和了的那家：点数旁边新的小朱印从上面按下来，“嗒”地盖上，四周一圈印泥的红晕散开（结算框挡着的时候没看到）
    const [STAMP_AT, DROP] = [140, 220];
    const scores = old.querySelectorAll('.center > .score');
    let stamped = false;
    for (const s of new Set(winners)) {
      const seal = scores[s]?.querySelector<HTMLElement>('.seals > i:last-child');
      if (!seal) continue;
      stamped = true;
      seal.animate(
        [
          { scale: '3.2', opacity: 0 },
          { scale: '2.6', opacity: 1, offset: 0.3 },
          { scale: '1', opacity: 1 },
        ],
        { duration: DROP, delay: STAMP_AT, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'backwards' },
      );
      seal.animate(
        [
          { boxShadow: 'inset 0 0 0 1px rgba(255,244,230,.6), 0 0 0 0 rgba(181,55,28,.65)' },
          { boxShadow: 'inset 0 0 0 1px rgba(255,244,230,.6), 0 0 0 7px rgba(181,55,28,0)' },
        ],
        { duration: 420, delay: STAMP_AT + DROP, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
    }
    if (stamped) playStamp((STAMP_AT + DROP) / 1000);
    // 散出去的时候：垫着的木桌面和上一局剩下的东西（中间那块）一起淡掉，新的一局露出来
    for (const el of [cover, old]) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT, delay: SWIRL_END + 60, fill: 'both', easing: 'ease-in-out' });
    playShuffle('scoop', SCOOP / 1000);
    window.setTimeout(() => playShuffle('shuffle', (SWIRL_END - 250) / 1000), 250);
    window.setTimeout(() => playShuffle('build', OUT / 1000), SWIRL_END);
    window.setTimeout(() => playShuffle('push', 0.18), SWIRL_END + OUT - 120);
    window.setTimeout(() => {
      old.remove();
      cover.remove();
    }, all + 500);
  }

  // 翻牌屏：上一局的牌从画面上方那排起，一排排往下翻成橙色的牌背（像车站的翻牌屏一行行翻过去），都翻完停一下，
  // 连着垫着的桌面一起淡掉，露出新的一局。中间那块的局数、风位、点数一块块翻牌一页页翻到新的一局（点数从结算前翻到结算后）
  private flip2d(host: HTMLElement, old: HTMLElement, g: Game): void {
    old.className = 'flip-old';
    const cover = document.createElement('div');
    cover.className = 'flip-cover';
    host.append(cover, old);
    const box = host.getBoundingClientRect();
    // 从最上面一排翻到最下面一排要多久，同一排从左到右晚多少，一张翻一下（压扁、换成牌背、展开）多久；
    // 都翻完以后停多久，淡掉多久；中间那块的翻牌翻一页多久
    const [SWEEP, SKEW, TURN, HOLD, FADE, PAGE] = [520, 110, 190, 260, 300, 75];
    // 每张牌外面那几层的旋转（左右两家的牌是转过 90 度的）：压扁的方向换成这张牌自己那层的方向（和 shuffle2d 一样）
    const frames = new Map<Element, DOMMatrix>();
    const frameOf = (el: Element | null): DOMMatrix => {
      if (!el || el === old) return new DOMMatrix();
      const hit = frames.get(el);
      if (hit) return hit;
      const t = getComputedStyle(el).transform;
      const own = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
      const m = frameOf(el.parentElement).multiply(new DOMMatrix([own.a, own.b, own.c, own.d, 0, 0]));
      frames.set(el, m);
      return m;
    };
    let last = 0;
    const tiles = [...old.querySelectorAll<HTMLElement>('.tile')].filter((el) => !el.closest('.center'));
    for (const el of tiles) {
      const r = el.getBoundingClientRect();
      const row = Math.min(1, Math.max(0, (r.top + r.height / 2 - box.top) / box.height));
      const col = Math.min(1, Math.max(0, (r.left + r.width / 2 - box.left) / box.width));
      const delay = row * SWEEP + col * SKEW + Math.random() * 25;
      last = Math.max(last, delay + TURN);
      // 绕画面上横着的轴翻：在这张牌那一层里，画面的上下是哪个方向就往哪个方向压扁
      const v = frameOf(el.parentElement).inverse().transformPoint(new DOMPoint(0, 1, 0, 0));
      const flat = Math.abs(v.x) > Math.abs(v.y) ? '0.04 1' : '1 0.04';
      el.animate(
        [
          { scale: '1 1', filter: 'brightness(1)', easing: 'ease-in' },
          { scale: flat, filter: 'brightness(0.55)', offset: 0.5, easing: 'ease-out' },
          { scale: '1 1', filter: 'brightness(1)' },
        ],
        { duration: TURN, delay, fill: 'both' },
      );
      // 翻到侧面那一下换成橙色的翻牌牌背
      const back = document.createElement('b');
      back.className = 'flip-back';
      el.append(back);
      back.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration: TURN, delay, fill: 'both' });
    }
    playFlip('clatter', last / 1000);
    // 中间那块：结算前的点数（这一局结算的点数加减倒回去），翻到现在的
    const deltas = lastDeltas(g);
    const before = (s: number) => g.shownScore(s, this.me) - (deltas?.[s] ?? 0);
    const inner = (html: string) => {
      const t = document.createElement('template');
      t.innerHTML = html;
      return t.content.firstElementChild?.innerHTML ?? '';
    };
    const blocks: { el: HTMLElement; pages: string[]; at: number; html: (text: string) => string }[] = [];
    const add = (el: HTMLElement | null | undefined, from: string, to: string, at: number, html = (text: string) => text) => {
      if (!el) return;
      const pages = flapPages(from, to);
      if (pages.length) blocks.push({ el, pages: [from, ...pages], at, html });
    };
    const center = old.querySelector('.center');
    const mid = SWEEP * 0.45;
    add(center?.querySelector<HTMLElement>(':scope > .round'), center?.querySelector(':scope > .round')?.textContent ?? '', g.roundLabel(), mid);
    center?.querySelectorAll<HTMLElement>(':scope > .score').forEach((row, s) => {
      add(row.querySelector<HTMLElement>('.wind'), row.querySelector('.wind')?.textContent ?? '', WIND_CN[g.seatWind(s) - 27], mid + 60 + s * 30);
      const pts = row.querySelector<HTMLElement>('.pts');
      if (!pts) return;
      // 点数那块：自己的是一个数，别家的还有一份点差（.d，指着的时候才露出来），翻的时候点差直接用新的
      const now = this.ptsHtml(s);
      const d = (() => {
        const t = document.createElement('template');
        t.innerHTML = now;
        return t.content.querySelector('.d')?.outerHTML ?? '';
      })();
      const wrap = (text: string) => (s === this.me ? text : `<span class="v">${text}</span>${d}`);
      pts.innerHTML = inner(this.ptsHtml(s, before));
      add(pts, String(before(s)), String(g.shownScore(s, this.me)), mid + 120 + s * 40, wrap);
    });
    // 一块翻牌翻一页：上半页已经是下一页，下半页还是这一页；前一半是这一页的上半页往前倒，后一半是下一页的下半页落下来
    const PARTS = ['top next', 'bottom cur', 'top flap', 'bottom flap'];
    const live = blocks.map((b) => {
      b.el.classList.add('flip-block');
      const parts = PARTS.map((cls) => {
        const p = document.createElement('span');
        p.className = `flip-page ${cls}`;
        // 还没轮到这块翻：先藏着，露出原来的字
        p.style.visibility = 'hidden';
        b.el.append(p);
        return p;
      });
      return { ...b, parts, shown: -1 };
    });
    let end = last;
    for (const b of live) end = Math.max(end, b.at + (b.pages.length - 1) * PAGE);
    // 都翻完了：停一下，连着垫着的桌面一起淡掉。中间那块的翻牌照淡掉那段动画的时间走（动画暂停、拨时间的时候一起停、一起拨）
    const fadeAt = Math.max(last, end) + HOLD;
    const [clock] = [old, cover].map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE, delay: fadeAt, fill: 'both', easing: 'ease-in-out' }));
    let ticked = 0;
    const step = () => {
      if (!old.isConnected) return;
      const t = Number(clock.currentTime ?? 0);
      let flips = 0;
      for (const b of live) {
        const k = (t - b.at) / PAGE;
        if (k < 0) continue;
        const i = Math.floor(k);
        flips += Math.min(i + 1, b.pages.length - 1);
        if (i >= b.pages.length - 1) {
          if (b.shown !== Infinity) {
            for (const p of b.parts) p.remove();
            b.el.classList.remove('flip-block');
            b.el.innerHTML = b.html(b.pages[b.pages.length - 1]);
            b.shown = Infinity;
          }
          continue;
        }
        const [cur, next] = [b.html(b.pages[i]), b.html(b.pages[i + 1])];
        if (b.shown !== i) {
          b.parts[0].innerHTML = next;
          b.parts[1].innerHTML = cur;
          b.parts[2].innerHTML = cur;
          b.parts[3].innerHTML = next;
          b.parts[0].style.visibility = b.parts[1].style.visibility = '';
          b.shown = i;
        }
        const c = Math.cos(Math.PI * (k - i));
        b.parts[2].style.cssText = c > 0 ? `transform: scaleY(${c.toFixed(3)}); filter: brightness(${(1 - 0.5 * (1 - c)).toFixed(3)})` : 'visibility: hidden';
        b.parts[3].style.cssText = c <= 0 ? `transform: scaleY(${(-c).toFixed(3)}); filter: brightness(${(1 - 0.35 * (1 + c)).toFixed(3)})` : 'visibility: hidden';
      }
      if (flips > ticked) playFlapTicks(flips - ticked);
      ticked = Math.max(ticked, flips);
      if (t < end + PAGE) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    window.setTimeout(() => playFlip('latch', 0.2), Math.max(last, end));
    window.setTimeout(() => {
      old.remove();
      cover.remove();
    }, fadeAt + FADE + 300);
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

  // ---------- 白水哩的番缚 ----------

  // 2D：这个座位手牌在画面上的位置（锁链画在这上面）
  private handRect(s: number): { x: number; y: number; w: number; h: number } | null {
    const el = s === this.me ? document.querySelector('.me .hand') : document.querySelector(`.opponent.${POS[s]} .ohand`);
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }

  // 2D：自己是哩，缚了番就锁上
  private syncChains2d(): void {
    const g = this.game;
    if (!g) return;
    const host = document.querySelector<HTMLElement>('.stage');
    if (this.chars[this.me]?.id !== 'rii' && !this.chains2d) return;
    if (host && (!this.chains2d || !host.contains(document.querySelector('canvas.rii-chains')))) {
      this.chains2d?.destroy();
      this.chains2d = new Chains2D(host, () => document.querySelector('.stage .table')?.getBoundingClientRect() ?? null);
    }
    const bind = this.chars[this.me]?.id === 'rii' && !this.vision ? riiBind(g, this.me) : null;
    // 换了锁链样子（试看）：照新样子重新锁一次
    if (bind !== null && this.chains2d && this.chains2d.has(this.me) && this.chains2d.styleOf(this.me) !== riiLook.chain && g.phase === 'turn') {
      this.chains2d.lock(this.me, bind, () => this.handRect(this.me), 'lock');
    } else if (bind !== null && this.chains2d && !this.chains2d.has(this.me) && g.phase === 'turn') {
      this.chains2d.lock(this.me, bind, () => this.handRect(this.me), g.players[this.me].discards.length === 0 ? 'lock' : 'settled');
    }
    this.chains2d?.redraw();
  }

  // 刚缚上（或者换了锁链样子）：锁链射过来的同时，大锁砸下来锁死，再飞到头像上
  private riiLockStart(): void {
    const g = this.game;
    const bind = g && this.chars[this.me]?.id === 'rii' && !this.vision ? riiBind(g, this.me) : null;
    if (!g || bind === null) return;
    this.riiLockN = bind;
    this.riiPadlockStop?.();
    playRiiLock(bind);
    const at = this.table3d ? this.table3d.handScreenPoint(this.me, this.me, g) : this.handPoint(this.me);
    if (!at) return;
    const seat = this.me;
    this.riiPadlockStop = playPadlock({
      from: at,
      n: bind,
      to: () => this.plockTarget(seat),
      onSlam: () => {
        playLockSlam();
        // 2D 牌桌没有镜头可以震：整张牌桌抖一下
        if (!this.table3d)
          document.querySelector('.stage .table')?.animate(
            [{ transform: 'translate(0,0)' }, { transform: 'translate(-7px,5px)' }, { transform: 'translate(6px,-4px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(0,0)' }],
            { duration: 280, easing: 'ease-out' },
          );
      },
    });
    // 头像上的锁到了以后重画一次（挂上去的那一下由 CSS 按时间播）
    window.setTimeout(() => this.game === g && this.render(), padlockArrive(bind) + 30);
  }

  // 大锁飞到哪：头像上那把锁（还没出来，透明地占着位置）；找不到就头像右下角
  private plockTarget(s: number): DOMRect | null {
    const q = (frame: string, plate: string) =>
      document.querySelector(`.seat-frame[data-seat="${s}"] ${frame}, .net-card[data-seat="${s}"] ${frame}, .nameplate[data-seat="${s}"] ${plate}`)?.getBoundingClientRect();
    const spot = q('.rpl-lock', '.rpl-lock');
    if (spot && spot.width > 0) return spot;
    const r = q('.portrait', '.avatar');
    if (!r || r.width <= 0) return null;
    const w = r.width * 0.44;
    return new DOMRect(r.right - r.width * 0.03 - w, r.bottom - r.height * 0.03 - w * 1.2, w, w * 1.2);
  }

  // 头像上挂的锁：自己缚上以后一直挂着（别人看不见）；结算时开锁变金 / 碎掉 / 淡掉（别人的哩这时才现出来）。
  // 动画按时间对齐（负的 animation-delay），重画也不会从头播。几种样子见 riiPlock.ts
  private riiLockHtml(s: number, place: PlockPlace): string {
    const g = this.game;
    if (!g || this.chars[s]?.id !== 'rii') return '';
    const end = this.riiLockEnd.get(s);
    const mine = s === this.me && !this.vision && riiBind(g, s) !== null;
    if (!mine && !end) return '';
    const now = Date.now();
    const n = riiBind(g, s) ?? end?.n ?? this.riiLockN;
    const arrive = Math.max(mine && this.riiLockAt ? this.riiLockAt + padlockArrive(n) : 0, this.riiPlockSwapAt);
    const d = arrive ? (arrive - now) / 1000 : -9;
    const e = end ? (end.at - now) / 1000 : 0;
    return plockHtml(riiLook.plock, place, n, end?.kind ?? null, d, e);
  }

  // 结算：哩番缚了的这一局，锁链变金冲上天、天空放晴、钥匙落下 / 没和成、番数不够时崩断碎成粒子散掉
  private riiFinish(result: RoundResult): void {
    const g = this.game!;
    for (const o of chainOutcomes(g, result)) this.riiOutcome(o);
  }

  // 一个哩的结算画面和声音；返回放完要多久（秒）
  private riiOutcome(o: { seat: number; bind: number; kind: ChainOutcome }): number {
    const g = this.game!;
    const tag = keyTag(g.roundWind, g.roundNumber, g.honba);
    const end = chainEnd(o.kind);
    // 头像上的锁和锁链一起出结果（锁链开始变金 / 崩断的时候）
    const lockEnd = (sec: number) => {
      this.riiLockEnd.set(o.seat, { kind: end, at: Date.now() + sec * 1000, n: o.bind });
      window.setTimeout(() => this.render(), 30);
    };
    let delay = 0;
    let fresh = false;
    if (this.table3d) {
      fresh = this.table3d.riiFresh(o.seat);
      delay = this.table3d.riiOutcome(o.seat, end, o.bind, g, this.me);
    } else {
      const host = document.querySelector<HTMLElement>('.stage');
      if (!host) return 0;
      this.chains2d ??= new Chains2D(host, () => document.querySelector('.stage .table')?.getBoundingClientRect() ?? null);
      fresh = !this.chains2d.has(o.seat) || this.chains2d.vanished(o.seat);
      if (fresh) this.chains2d.lock(o.seat, o.bind, () => this.handRect(o.seat), 'quick');
      delay = fresh ? 0.6 : 0.15;
      this.chains2d.finish(o.seat, end, delay * 1000);
    }
    lockEnd(delay + 0.3);
    playRiiOutcome(end, o.bind, delay, fresh);
    let total = delay + outcomeTime(o.kind);
    if (end === 'key') {
      const at = this.table3d ? this.table3d.handScreenPoint(o.seat, this.me, g) : this.handPoint(o.seat);
      const root = document.querySelector<HTMLElement>('.stage3d') ?? document.querySelector<HTMLElement>('.stage');
      if (at && root) {
        if (!this.skyKey || !root.contains(document.querySelector('canvas.rii-sky'))) {
          this.skyKey?.destroy();
          this.skyKey = new SkyKey(root);
        }
        this.skyKey.play(at, o.bind, tag, delay + skyStart());
        total = delay + skyStart() + skyTime();
      }
    }
    this.riiHold = Math.max(this.riiHold, Date.now() + total * 1000 + 200);
    return total;
  }

  // 测试对局里的「试结算」：照真的放一遍，放完把头像上的锁挂回去（锁链等真的结算时再射出来）
  private riiTryOutcome(kind: ChainOutcome): void {
    const g = this.game;
    const bind = g ? riiBind(g, this.me) : null;
    if (!g || bind === null || this.chars[this.me]?.id !== 'rii') return;
    const total = this.riiOutcome({ seat: this.me, bind, kind });
    window.setTimeout(() => {
      if (this.game !== g) return;
      this.riiLockEnd.delete(this.me);
      this.riiPlockSwapAt = Date.now();
      this.render();
    }, total * 1000 + 300);
  }

  private handPoint(s: number): { x: number; y: number; w: number } | null {
    const r = this.handRect(s);
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, w: Math.max(r.w, r.h) } : null;
  }

  // ---------- 爱丽丝的手绘板 ----------

  // 牌桌现在画成手绘板（自己是爱丽丝、这一局画着、重组特效已经刷满）
  private sketchShown(): boolean {
    const g = this.game;
    // 掉线的乱码那一段：手绘板已经碎了，牌桌先还画成手绘板
    return !!g && !this.vision && this.sketchView && this.chars[this.me]?.id === 'aislinn' && (aislinnSketch(g, this.me) || performance.now() < this.sketchGlitchUntil);
  }

  // 牌桌在页面上的位置（特效盖在这上面）
  private stageRect(): DOMRect | null {
    const el = this.root.querySelector<HTMLElement>(this.table3d ? '.stage3d' : '.stage .table');
    return el?.getBoundingClientRect() ?? null;
  }

  private sketchFx(text: string): void {
    if (this.sketchTimer !== null) clearTimeout(this.sketchTimer);
    this.sketchTimer = null;
    if (text === AISLINN_DROP) {
      this.sketchDrop();
      return;
    }
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
    const face = mine
      ? `<img src="${powerPortraitUrl(c.id)}" alt="" onerror="this.remove()" /><span class="halo"></span>`
      : '<span class="sil"></span><span class="noimg">NO IMAGE</span>';
    return `
      <div class="net-card ${POS[s]}${active}${mine ? ' mine' : ''}" data-seat="${s}">
        <div class="net-name">${mine ? 'のどっち' : c.name}</div>
        <div class="portrait">${face}${this.badgeHtml(s)}${this.bulbHtml(s)}${this.fjHtml(s)}${this.mgHtml(s)}${this.distHtml(s)}${this.mirrorHtml(s)}${this.lensMark(s)}${this.riiLockHtml(s, 'net')}</div>
        ${this.towerHtml(s)}${mine ? this.bladeBarHtml() : ''}
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
        return `<div class="score ${POS[s]}${active}"><span class="wind">${NET_WIND[g.seatWind(s) - 27]}</span>${riichi}${this.ptsHtml(s)}</div>`;
      })
      .join('');
    return `
      <div class="net-round">${NET_WIND[g.roundWind]}${'一二三四'[g.roundNumber]}局</div>
      <div class="net-remain"><small>残り</small>${g.wall.remaining}</div>
      <div class="net-sub">${g.honba} 本場 · 供託 ${g.shownSticks(this.me)}</div>
      <div class="dora">${dora}</div>
      ${scores}`;
  }

  // 手绘板掉线（画上要摸的牌被花田煌换掉）：先是手牌上面的手绘板画面乱成乱码（牌桌还是手绘板），
  // 一会儿以后整张牌桌横着乱跳、跳出「信号中断」，像老电视关机一样黑掉，换回普通牌桌
  private sketchDrop(): void {
    if (!this.sketchView) return;
    const garbleMs = 1100;
    this.sketchGlitchUntil = performance.now() + garbleMs;
    if (this.sketchGlitchTimer !== null) clearInterval(this.sketchGlitchTimer);
    // 乱码自己一直换（不用整个重画）
    this.sketchGlitchTimer = window.setInterval(() => {
      if (performance.now() < this.sketchGlitchUntil) {
        const el = this.root.querySelector<HTMLElement>('.sketch-plan.glitch');
        if (el) el.innerHTML = this.sketchGlitchInner();
        return;
      }
      clearInterval(this.sketchGlitchTimer!);
      this.sketchGlitchTimer = null;
      if (!this.sketchView) return;
      const rect = this.stageRect();
      if (rect) {
        const table = this.root.querySelector<HTMLElement>('.stage .table');
        const source = this.table3d ? { image: this.table3d.snapshot() } : table ? { dom: table } : null;
        if (source) playGlitch(rect, source);
      }
      this.sketchView = false;
      this.render();
    }, 70);
    this.render();
  }

  // 乱码的手绘板：乱七八糟的牌、乱码字、有的牌歪了、有的闪没了
  private sketchGlitchInner(): string {
    const junk = '▒░▓█#@%&$?!¿¤§¶ΞΨЖЯ※〓◆◇□■手绘板掉线信号';
    const garble = (n: number) => Array.from({ length: n }, () => junk[Math.floor(Math.random() * junk.length)]).join('');
    const n = 10 + Math.floor(Math.random() * 5);
    const tiles = Array.from({ length: n }, () => {
      const html = tileHtml(Math.floor(Math.random() * 136), { size: 'pond', sketch: true });
      const r = Math.random();
      const cls = r < 0.18 ? 'gl-skew' : r < 0.3 ? 'gl-hide' : '';
      return cls ? `<span class="${cls}">${html}</span>` : html;
    }).join('');
    return `<div class="sp-head"><b>${garble(3)}</b><span>${garble(5 + Math.floor(Math.random() * 5))}</span></div><div class="sp-tiles">${tiles}<span class="sp-win">${tileHtml(Math.floor(Math.random() * 136), { size: 'pond', sketch: true })}</span></div>`;
  }

  // 手绘板画在手牌上面：画上的整副牌（自摸的那张隔开放在最右边），写着再摸几张自摸、几番
  private sketchPlanKey = '';
  private sketchPlanHtml(): string {
    const g = this.game!;
    if (!this.vision && performance.now() < this.sketchGlitchUntil && this.chars[this.me]?.id === 'aislinn') {
      this.sketchPlanKey = '';
      return `<div class="sketch-plan glitch">${this.sketchGlitchInner()}</div>`;
    }
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
    return `<div class="sketch-plan${fresh ? ' fresh' : ''}"><div class="sp-head" title="${plan.yaku.join('、')}"><b>手绘板</b><span>${when} · ${han}</span></div><div class="sp-tiles">${tiles}${melds}<span class="sp-win">${tileHtml(plan.win, { size: 'pond', sketch: true })}</span></div></div>`;
  }

  // ---------- 辻垣内智叶的居合 ----------

  // 刀光、「斬」挂在哪一层：提示层的上一层，不跟着牌局重画
  // 照魔镜：另外三家的头像上各罩一面镜子。隐身的桃子看不见她的人，镜子也不往她头上罩
  private teruMirrorFx(seat: number): void {
    const g = this.game;
    if (!g) return;
    const spots = [1, 2, 3]
      .map((d) => (seat + d) % 4)
      .filter((s) => !g.stealthed(s, this.me))
      .map((s) => (document.querySelector(`[data-seat="${s}"] .portrait, [data-seat="${s}"] .avatar`) ?? document.querySelector(`[data-seat="${s}"]`))?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r && r.width > 0);
    teruMirrors(spots);
  }

  // 照的旋风自摸是不是这一手（自摸 12000 点以上）：是就给风多大（0–1，点数越大越大），不是 null
  private twistSize2d(w: WinInfo): number | null {
    if (this.chars[w.seat]?.id !== 'teru' || w.from !== null) return null;
    return teruTwister(this.game!, w.seat, w.result);
  }

  // 2D：和了牌砸到结算上那一下，从这张牌底下卷起龙卷风（tornado2d.ts；牌自己在结算里转）。
  // 位置按排版算（offsetLeft / offsetTop），不看牌此刻被动画转到哪了
  private teruTornado2d(size: number): void {
    const tile = document.querySelector<HTMLElement>('.win.slam .win-tile');
    const dock = tile?.offsetParent as HTMLElement | null;
    let at = { x: window.innerWidth / 2, y: window.innerHeight * 0.62 };
    if (tile && dock) {
      const pr = dock.getBoundingClientRect();
      const ps = dock.offsetWidth > 0 ? pr.width / dock.offsetWidth : 1;
      at = { x: pr.left + (dock.clientLeft + tile.offsetLeft + tile.offsetWidth / 2) * ps, y: pr.top + (dock.clientTop + tile.offsetTop + tile.offsetHeight / 2) * ps };
    }
    playSlam();
    tornado2d(at, size, { onErupt: () => playWhirl(size), onBolt: () => playCrackle(0.7) });
  }

  private fxHost(): HTMLElement | null {
    return document.getElementById('toasts')?.parentElement ?? null;
  }

  // 明华唱着歌和牌：风从她的座位吹过整张桌子（素材页“风神·和牌”那格有动画就放那段）。没在唱照一般的和牌放
  private fuujinWinFx(w: WinInfo): boolean {
    const g = this.game!;
    const c = this.chars[w.seat];
    if (c?.id !== 'myeonghwa' || myeonghwaSinging(g, w.seat) <= 0) return false;
    const host = this.fxHost();
    if (host) fuujinGust(host, POS[w.seat]);
    playBreeze(1);
    const word = w.from === null ? '自摸' : '荣和';
    const art = skillArt(c.id, 'song-win');
    if (art && this.cutins?.show({ pos: POS[w.seat], id: c.id, color: c.color, word, kind: 'win', art, glyph: c.name.slice(-1) })) return true;
    return false;
  }

  // 由晖子左手的局和牌：她座位上的 𐤄 再亮一次，光铺满整张桌子（素材页“左手·和牌”那格有动画就放那段），然后照一般的和牌放
  private leftWinFx(w: WinInfo): boolean {
    const g = this.game!;
    const c = this.chars[w.seat];
    if (c?.id !== 'yukiko' || !yukikoLeft(g, w.seat)) return false;
    const host = this.fxHost();
    if (host) leftHandWin(host, POS[w.seat]);
    playWindow(true);
    const word = w.from === null ? '自摸' : '荣和';
    const art = skillArt(c.id, 'left-win');
    if (art && this.cutins?.show({ pos: POS[w.seat], id: c.id, color: c.color, word, kind: 'win', art, glyph: c.name.slice(-1) })) return true;
    return false;
  }

  // 梅根决斗的对手打出了她的和了牌：对手座位上一声枪响（素材页“决斗·击中”那格有动画就放那段），然后照一般的荣和放
  private duelWinFx(w: WinInfo): boolean {
    const g = this.game!;
    const c = this.chars[w.seat];
    if (c?.id !== 'megan' || w.from === null) return false;
    const end = meganDuelEnd(g, w.seat);
    if (!end || end.end !== 'hit' || end.target !== w.from) return false;
    const host = this.fxHost();
    if (host) duelShot(host, POS[w.from]);
    playGunshot();
    const art = skillArt(c.id, 'hit');
    if (art && this.cutins?.show({ pos: POS[w.seat], id: c.id, color: c.color, word: '荣和', kind: 'win', art, glyph: c.name.slice(-1) })) return true;
    return false;
  }

  // 立直按钮：梅根现在立直是向谁决斗就写出来
  private duelRiichiLabel(): string {
    const g = this.game!;
    if (this.chars[this.me]?.id !== 'megan' || this.vision) return '立直';
    const t = meganDuelTarget(g, this.me);
    return t === null ? '立直' : `决斗立直<small> → ${this.chars[t].name}</small>`;
  }

  // 梅根决斗的对手头像上：准星和转轮（谁都看得见：被决斗的人要知道这几巡别打生张）
  private mgHtml(s: number): string {
    const g = this.game;
    if (!g || !this.chars.some((c) => c?.id === 'megan')) return '';
    const by = duelledBy(g, s);
    if (by === null) return '';
    return duelMarkHtml(this.chars[by].name, meganDuel(g, by)!.left, MEGAN.duelSteps);
  }

  // 头像旁的东西：明华唱着歌时飘音符（谁都看得见，歌是唱给全桌听的）；被她断风的那一家挂一块“無風”
  private fjHtml(s: number): string {
    const g = this.game;
    if (!g || !this.chars.some((c) => c?.id === 'myeonghwa')) return '';
    let out = '';
    if (this.chars[s]?.id === 'myeonghwa') {
      const level = myeonghwaSong(g, s);
      const on = myeonghwaSinging(g, s) > 0;
      if (level > 0) out += songHtml(level, performance.now() % 3200, on ? `歌 第${'一二三'[level - 1]}段：配牌、进张 +${Math.round(MYEONGHWA.songDraw[level] * 100)}%。她和牌升一段，别人和牌就停` : '歌还在唱，但这一局不起作用');
    }
    if ([0, 1, 2, 3].some((o) => o !== s && myeonghwaCut(g, o) === s)) out += cutTagHtml();
    return out;
  }

  // 她没立直和牌：一道刀光（荣和切向放铳的人，自摸横切另外三家），刀光过后才出「自摸」「荣和」；
  // 素材页“居合”那格有动画就放那段。和牌结束了别人的连庄，再出「斬」（素材页“斩”那格有动画就放那段）
  private iaiWinFx(w: WinInfo): boolean {
    const g = this.game!;
    const c = this.chars[w.seat];
    if (c?.id !== 'satoha') return false;
    const dama = !g.players[w.seat].riichi;
    const cut = satohaCut(g, w.seat);
    if (!dama && cut === null) return false;
    const host = this.fxHost();
    const word = w.from === null ? '自摸' : '荣和';
    const show = () => {
      if (this.game !== g) return;
      const art = dama ? skillArt(c.id, 'iai') : undefined;
      if (art && this.cutins?.show({ pos: POS[w.seat], id: c.id, color: c.color, word, kind: 'win', art, glyph: c.name.slice(-1) })) return;
      this.bigFx(w.seat, word, 'win');
    };
    let wait = 0;
    if (dama && host) {
      iaiSlash(host, POS[w.seat], w.from === null ? null : POS[w.from]);
      window.setTimeout(() => this.game === g && playIaiDraw(), IAI_WINDUP_MS);
      wait = IAI_SLASH_MS;
      window.setTimeout(show, wait);
      window.setTimeout(() => this.game === g && playIaiSheath(), IAI_SLASH_ALL_MS - 100);
    } else show();
    // 结算等刀光、「斬」放完再出来
    this.riiHold = Math.max(this.riiHold, Date.now() + (cut !== null ? wait + IAI_ZAN_MS + IAI_ZAN_ALL_MS : IAI_SLASH_ALL_MS + 100));
    if (cut !== null) {
      window.setTimeout(() => {
        if (this.game !== g) return;
        this.sayAbility(w.seat, '斬');
        const art = skillArt(c.id, 'zan');
        if (art && this.cutins?.show({ pos: POS[w.seat], id: c.id, color: c.color, word: '斬', kind: 'ability', art, glyph: c.name.slice(-1) })) return;
        const at = this.fxHost();
        if (at) zanFx(at, this.chars[cut].name);
      }, wait + IAI_ZAN_MS);
    }
    return true;
  }

  // 头像旁竖着的刀：从鞘里推出来几分跟着间合走（只有操作她的玩家看得见）。
  // 档位变了，刀慢慢推出来（收回去）；头一下推开鞘口有一声轻响
  private bladeBarHtml(): string {
    const g = this.game!;
    if (this.chars[this.me]?.id !== 'satoha' || (g.phase !== 'turn' && g.phase !== 'calls') || this.vision) return '';
    const b = satohaBlade(g, this.me);
    const k = this.blade;
    const now = performance.now();
    // 新的一局：刀收在鞘里
    if (k.game !== g || k.round !== g.round) this.blade = { game: g, round: g.round, from: 0, to: 0, at: -IAI_PUSH_MS };
    const st = this.blade;
    const to = IAI_DRAWN[b.stage];
    if (to !== st.to) {
      if (st.to === 0 && !b.off) playIaiPush();
      st.from = st.to;
      st.to = to;
      st.at = now;
    }
    const elapsed = now - st.at;
    return bladeHtml(b, satohaSheathed(g, this.me), satohaRenchanDealer(g, this.me) !== null, elapsed < IAI_PUSH_MS ? { from: st.from, elapsed } : undefined);
  }

  // ---------- 郝慧宇的国标 ----------

  // 这一局冒过“日麻无役”气泡的座位
  private gbSighed = new Set<number>();
  // 番种栏上次画的样子：番种、哪几格亮着、翻过几次面（新亮的格子闪金光，换番种整排翻面）
  private gbShown: { key: string; lit: boolean[]; flips: number } | null = null;

  // 别人打出她的和了牌：国标够 8 番，日麻却没役荣和不了。头像旁冒一个气泡，一局一次
  private gbSigh(from: number, tile: TileId): void {
    const g = this.game!;
    for (let s = 0; s < 4; s++) {
      if (this.chars[s]?.id !== 'huiyu' || this.gbSighed.has(s)) continue;
      const fan = huiyuMissedRon(g, s, from, tile);
      if (fan === null) continue;
      this.gbSighed.add(s);
      this.toast(s, `国标 ${fan} 番……日麻无役`, false, 'gb-sigh');
    }
  }

  // 和牌喊「食糊」（素材页“食糊”那格有动画就放那段），国标 24 番以上换金色
  private gbWinFx(w: WinInfo): boolean {
    const c = this.chars[w.seat];
    if (c?.id !== 'huiyu') return false;
    const fan = huiyuWinGb(this.game!, w.seat)?.total ?? 0;
    const color = fan >= GB_GOLD_FAN ? GB_GOLD : c.color;
    const art = skillArt(c.id, 'sik');
    if (this.mode === '25d' && this.cutins?.show({ pos: POS[w.seat], id: c.id, color, word: '食糊', kind: 'win', art, glyph: c.name.slice(-1) })) return true;
    this.toast(w.seat, '食糊', true, 'win', color);
    return true;
  }

  // 番种牌（配牌后三选一）：番种名、示意的 14 张（已有的亮、缺的暗）、还差几张、国标几番 / 日麻几点
  private gbCardHtml(c: HuiyuCard, on: boolean): string {
    const tiles = c.tiles.map((k, i) => tileHtml(k * 4 + 1, { size: 'mini', classes: [c.lit[i] ? 'gb-lit' : 'gb-dim'] })).join('');
    const riichi = c.points ? `日麻约 ${c.points} 点` : '日麻无役';
    return `<button class="pd-opt gb-card${on ? ' on' : ''}" data-ui="pd" data-pd="${c.key}" data-group="gb">
      <span class="pd-check">${on ? '✓' : ''}</span>
      <span class="pd-text"><b>${c.name}</b><span class="gb-tiles">${tiles}</span>
        <small>还差 ${c.missing} 张 · <em class="gb-fan">国标约 ${c.gb} 番</em> / ${riichi}${c.ronOk ? '' : ' · <em class="gb-noron">荣和无役</em>'}</small></span>
    </button>`;
  }

  // 番种栏：手牌上面一排小牌（番种牌那 14 张），听牌而且国标够 8 番时盖“成”字印。立直、被封印时变灰
  private gbBarHtml(): string {
    const g = this.game!;
    const bar = this.chars[this.me]?.id === 'huiyu' && (g.phase === 'turn' || g.phase === 'calls') && !this.vision ? huiyuBar(g, this.me) : null;
    if (!bar) {
      this.gbShown = null;
      return '';
    }
    const c = bar.card;
    const prev = this.gbShown;
    const flip = !!prev && prev.flips !== bar.flips;
    const same = !!prev && prev.key === c.key && !flip;
    this.gbShown = { key: c.key, lit: c.lit, flips: bar.flips };
    const tiles = c.tiles
      .map((k, i) => {
        const hit = same && c.lit[i] && !prev!.lit[i];
        return tileHtml(k * 4 + 1, { size: 'pond', classes: [c.lit[i] ? 'gb-lit' : 'gb-dim', ...(hit ? ['gb-hit'] : [])] });
      })
      .join('');
    const left = c.missing ? `还差 ${c.missing} 张` : '齐了';
    const riichi = c.points ? `日麻约 ${c.points} 点` : '日麻无役';
    const seal = !bar.off && huiyuReady(g, this.me) ? '<span class="gb-seal">成</span>' : '';
    return `<div class="gb-bar${bar.off ? ' off' : ''}${flip ? ' flip' : ''}">${seal}
      <div class="gb-head"><b>番种</b><span class="gb-name">${c.name}</span><span>${left}</span>
        <span class="gb-vs"><em>国标约 ${c.gb} 番</em> / ${riichi}${c.ronOk ? '' : ' · <i>荣和无役</i>'}</span></div>
      <div class="gb-tiles">${tiles}</div></div>`;
  }

  // 结算：她和牌时在日麻点数下面加国标面板，最后一行大字对照“国标 X 番 / 日麻 Y 点”
  private gbPanelHtml(w: WinInfo): string {
    const g = this.game!;
    const gb = this.chars[w.seat]?.id === 'huiyu' ? huiyuWinGb(g, w.seat) : null;
    if (!gb) return '';
    const r = w.result;
    const pts = w.from !== null ? r.ron : w.seat === g.dealer ? r.tsumoOtherPays * 3 : r.tsumoDealerPays + 2 * r.tsumoOtherPays;
    const rows = gb.fans.map((f) => `<div class="gb-f"><span>${f.name}${f.count > 1 ? ` ×${f.count}` : ''}</span><b>${f.fan * f.count} 番</b></div>`).join('');
    return `<div class="gb-panel${gb.total >= GB_GOLD_FAN ? ' gold' : ''}"><div class="gb-panel-title">国标</div><div class="gb-fans">${rows}</div>
      <div class="gb-versus"><b>国标 ${gb.total} 番</b><span class="gb-slash">/</span><span>日麻 ${pts.toLocaleString('en-US')} 点</span></div></div>`;
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

  private toast(seat: number, text: string, big: boolean, kind = '', color?: string): void {
    const id = ++this.toastSeq;
    this.toasts.push({ id, seat, text, big, kind, color });
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
    // 点设置面板外面的暗处：关上
    if ((e.target as HTMLElement).classList?.contains('set-modal')) {
      this.closePanel();
      return;
    }
    // 2D 牌桌：手指点一下中间那块，3 秒内其他三家写点差
    if (this.lastPointer !== 'mouse' && (e.target as HTMLElement).closest?.('#table .center')) this.flashDiff();
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pick],[data-tile],[data-act],[data-ui]');
    if (!el) return;
    // 个人对局页的照片：第一下红笔圈上（当本人），再点圈着的那张就出场
    if (el.dataset.pick) {
      this.pickOrStart(el.dataset.pick);
      return;
    }
    if (el.dataset.ui === 'go' && el.dataset.id) {
      this.quickStart(el.dataset.id);
      return;
    }
    // 主页：白板纸上三行（个人对局进选人页，团体赛进布阵，全国大赛进晋级表），麻将桌是随机出场
    if (el.dataset.ui === 'home-go') {
      const v = el.dataset.v;
      homeGo(el, () => {
        if (v === 'single') this.renderSelect();
        else if (v === 'team') this.openTeam('title');
        else if (v === 'story') this.openBracket();
        else if (v === 'random') this.quickStart(CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id);
      });
      return;
    }
    if (el.dataset.ui === 'codex') {
      transition(() => this.renderCodex());
      return;
    }
    // 便签上的齿轮：设置面板（对局、视觉、声音三页），回到上次看的那一页
    if (el.dataset.ui === 'open-settings') {
      this.openPanel(this.settingsTab);
      return;
    }
    // 设置面板顶上的三页：声音那页是另一个面板（挂在 body 上，见 soundPanel.ts），换过去时把这边的关掉
    if (el.dataset.ui === 'set-tab') {
      const v = el.dataset.v;
      if (v === 'sound') {
        this.closePanel(false);
        openSoundPanel();
      } else if (v === 'match' || v === 'visual') this.openPanel(v);
      return;
    }
    if (el.dataset.ui === 'home') {
      transition(() => {
        this.panel = null;
        this.renderTitle();
      });
      return;
    }
    if (el.dataset.ui === 'open-match' || el.dataset.ui === 'open-visual') {
      this.openPanel(el.dataset.ui === 'open-match' ? 'match' : 'visual');
      return;
    }
    if (el.dataset.ui === 'panel-close') {
      this.closePanel();
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
      const open = !!el.closest('.sf')?.classList.toggle('open');
      el.textContent = open ? '收起' : '全文';
      return;
    }
    if (el.dataset.ui === 'toka-form' || el.dataset.ui === 'saki-form') {
      this.toggleForm(el.dataset.ui === 'saki-form' ? 'saki' : 'toka', el.dataset.v);
      return;
    }
    if (el.dataset.ui === 'setup-opt' && el.dataset.k && el.dataset.v) {
      this.readTarget();
      setOption(this.settings, el.dataset.k, el.dataset.v);
      saveSettings(this.settings);
      setTransitionStyle(this.settings.xfade);
      this.renderPanel();
      return;
    }
    if (el.dataset.ui === 'match-reset') {
      // 只换规则和对手；透华的常态 / 治水、咲的标准 / 加强、动画开关是别处的设置，留着
      const { chisui, sakiStrong, drawPath, vary, discardFx, riichiFx, pondFx, spotlight, winZoom, layout, hand, slam, slamOrder, slamStyle, xfade } = this.settings;
      this.settings = { ...DEFAULT_SETTINGS, opponents: [...DEFAULT_SETTINGS.opponents], chisui, sakiStrong, drawPath, vary, discardFx, riichiFx, pondFx, spotlight, winZoom, layout, hand, slam, slamOrder, slamStyle, xfade };
      saveSettings(this.settings);
      this.renderPanel();
      return;
    }
    if (el.dataset.ui === 'vis-theme' && THEMES.some((t) => t.id === el.dataset.v)) {
      setTheme(el.dataset.v as ThemeId);
      if (this.root.querySelector('.home-room')) this.renderTitle();
      else this.renderSelect();
      return;
    }
    // 牌桌风格：下一局建牌桌时用（2D 牌桌马上换）
    if (el.dataset.ui === 'vis-table' && TABLE_STYLES.some((t) => t.id === el.dataset.v)) {
      setTableStyle(el.dataset.v as TableStyleId);
      this.renderPanel();
      return;
    }
    // 仪表盘形状：下一局建牌桌时用（2D 牌桌中间那块马上换）
    if (el.dataset.ui === 'vis-shape' && CONSOLE_SHAPES.some((t) => t.id === el.dataset.v)) {
      setConsoleShape(el.dataset.v as ConsoleShapeId);
      this.renderPanel();
      return;
    }
    if (el.dataset.ui === 'vis-mode' && TABLE_MODES.some((m) => m.id === el.dataset.v)) {
      this.mode = el.dataset.v as TableMode;
      saveTableMode(this.mode);
      if (this.mode === '3d') preloadModels(MODEL_URLS);
      this.renderPanel();
      return;
    }
    if (el.dataset.ui === 'lab') {
      this.openLab();
      return;
    }
    if (el.dataset.ui === 'water-test') {
      this.root.querySelector('details.sel-more[open]')?.removeAttribute('open');
      // 衣坐庄家的下家：没人鸣牌时牌山最后一张归她
      if (el.dataset.v === 'koromo') {
        // 对手固定成没有能力的三位：别人的能力（错开流向、改牌山）会把海底挪走，就测不到捞月
        this.startGame('koromo', undefined, koromoSeaStage(this.me), { dealer: (this.me + 3) % 4, opponents: SEA_TEST_OPPONENTS });
        // 挂机看：电脑替她打到海底自摸（点「挂机中」可以接管）
        this.auto = true;
        if (this.game) this.game.manual[this.me] = false;
        this.render();
      } else this.startGame('toka', undefined, undefined, { chisui: true });
      return;
    }
    // 白水哩番缚设置（局外）、白水哩 · 姬子测试窗口
    if (el.dataset.ui === 'rii-set' || el.dataset.ui === 'rii-test') {
      this.openPanel(el.dataset.ui === 'rii-set' ? 'rii' : 'riiTest');
      return;
    }
    if (el.dataset.ui === 'rii-opt' && el.dataset.k && el.dataset.v) {
      setRiiLook({ [el.dataset.k]: el.dataset.v });
      if (el.dataset.k === 'sfx') previewRiiSound();
      this.renderPanel();
      return;
    }
    if (el.dataset.ui === 'rii-try') {
      previewRiiSound(el.dataset.v as 'lock' | 'key' | 'broken');
      return;
    }
    if (el.dataset.ui === 'awai-test') {
      this.root.querySelector('details.sel-more[open]')?.removeAttribute('open');
      // 对手固定成没有能力的三位，挂机看（点「挂机中」可以接管）
      this.pendingQuiet = true;
      this.startGame('awai', undefined, undefined, { opponents: SEA_TEST_OPPONENTS });
      this.auto = true;
      if (this.game) this.game.manual[this.me] = false;
      this.render();
      return;
    }
    if (el.dataset.ui === 'saki-test') {
      this.openPanel('sakiTest');
      return;
    }
    if (el.dataset.ui === 'saki-test-go') {
      this.panel = null;
      this.startRinshanTest(el.dataset.v as RinshanTier | 'cycle');
      return;
    }
    if (el.dataset.ui === 'slam-test') {
      this.openPanel('slamTest');
      return;
    }
    if (el.dataset.ui === 'slam-test-go' && el.dataset.v) {
      this.panel = null;
      this.startSlamTest(el.dataset.v, Number(el.dataset.seat ?? 0));
      return;
    }
    if (el.dataset.ui === 'rii-test-go') {
      this.panel = null;
      this.startRiiTest(el.dataset.v as RiiTestStart);
      return;
    }
    if (el.dataset.ui === 'team') {
      transition(() => this.openTeam('select'));
      return;
    }
    if (el.dataset.ui === 'solo-done' && this.soloMatch && this.game) {
      const { order, hands, done } = this.soloMatch;
      const g = this.game;
      const scores = [0, 0, 0, 0];
      order.forEach((k, seat) => (scores[k] = g.players[seat].score));
      this.soloMatch = null;
      done(scores, hands);
      transition(() => {
        this.teardown();
        menuMusic();
        this.solo?.show();
      });
      return;
    }
    if (el.dataset.ui === 'team-next' && this.team && this.game) {
      const { flow, seats } = this.team;
      const g = this.game;
      this.teardown();
      this.team = null;
      this.soloMatch = null;
      flow.afterMatch(seats, g.players.map((p) => p.score), g.riichiSticks, [0, 1, 2, 3].map((s) => (g.abilities[s]?.id === 'rii' ? riiKeys(g, s) : [])));
      return;
    }
    if (el.dataset.ui === 'skins') {
      this.panel = null;
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
      transition(() => this.renderSelect());
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
      const picking = this.riiPicking;
      if (this.game && !this.vision) this.chars[this.me].ability?.pressSkill?.(this.game, this.me, el.dataset.choice);
      this.riiPicking = false;
      if (picking) this.riiFlipAt = Date.now();
      // 先记下时间，这一次重画头像上的锁就按这个时间等大锁飞过来
      if (picking) this.riiLockAt = Date.now();
      this.render();
      if (picking) this.riiLockStart();
      return;
    }
    // 白水哩的番缚：先把手牌扣下去再选番数；不缚就翻回来
    // 番缚的样子（试看）：投影朝内 / 朝外，几种锁链
    if (el.dataset.ui === 'rii-look') {
      if (el.dataset.proj) setRiiLook({ proj: el.dataset.proj as RiiProj });
      const relock = !!el.dataset.chain && el.dataset.chain !== riiLook.chain && !this.riiPicking;
      if (el.dataset.chain) setRiiLook({ chain: el.dataset.chain as ChainStyleId });
      // 换头像锁：新样子马上挂上去（锁还在飞的时候换就照旧等它飞到）
      if (el.dataset.plock && el.dataset.plock !== riiLook.plock) {
        setRiiLook({ plock: el.dataset.plock as PlockStyleId });
        this.riiPlockSwapAt = Date.now();
      }
      // 换音效：马上试听一段锁上的声音
      if (el.dataset.sfx) {
        setRiiLook({ sfx: el.dataset.sfx as RiiSfxId });
        previewRiiSound();
      }
      // 试结算：画面和声音照真的结算放一遍，放完头像上的锁挂回去
      if (el.dataset.end) {
        this.riiTryOutcome(el.dataset.end as ChainOutcome);
        return;
      }
      // 试听结算的声音（拿到钥匙 / 没和成），不用等到这一局结束
      if (el.dataset.try) {
        previewRiiSound(el.dataset.try as 'lock' | 'key' | 'broken');
        return;
      }
      if (relock) this.riiLockAt = Date.now();
      this.render();
      // 缚上以后换锁链样子：照新样子重新锁一次，大锁也再砸一次
      if (relock) this.riiLockStart();
      return;
    }
    if (el.dataset.ui === 'rii-bind' || el.dataset.ui === 'rii-cancel') {
      const was = this.riiPicking;
      this.riiPicking = el.dataset.ui === 'rii-bind' && !!this.game && riiCanBind(this.game, this.me);
      if (was !== this.riiPicking) this.riiFlipAt = Date.now();
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
  // 2D 牌桌上姬子拿到钥匙那一局的光柱和火（哪一局放过了）
  private himeko2d = new Himeko2D();
  private himeko2dRound = '';

  private busyMs(): number {
    return this.table3d?.busyMs() ?? Math.max(this.himeko2d.busyMs(), this.fxHold2d - performance.now(), 0);
  }

  // 2D：姬子拿到钥匙的那一局，配牌时她的牌错落着竖着砸下来、理完牌火从右烧到左（3D、2.5D 在 table3d 里放）
  private himekoFx2d(g: Game, table: HTMLElement): void {
    // 发牌前选技能时桌上是空的，等真的配牌再放
    if (g.phase === 'predeal') return;
    const seat = himekoKeySeat(g);
    const fresh = g.players.every((p) => p.discards.length === 0 && p.melds.length === 0);
    const key = `${g.seed}-${g.round}`;
    if (seat !== null && fresh && this.himeko2dRound !== key && !this.vision) {
      this.himeko2dRound = key;
      this.himeko2d.begin(beatSeed(g.seed, g.round));
    }
    if (seat === null) return;
    const sel = seat === this.me ? '.me .hand' : `.opponent.${POS[seat]} .ohand`;
    this.himeko2d.apply(table, sel, (seat - this.me + 4) % 4);
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
    if (this.auto || this.riiPicking) return new Set();
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
    // 全自动麻将机两副牌轮流用：第几副（牌桌风格是自动麻将机时 2D 的牌背照这个换颜色，见 tableStyles.css）
    table.parentElement?.setAttribute('data-set', String(Math.max(0, g.round - 1) % 2));
    // 沙滩、草甸：换了局，先把上一局的样子留一份，一个浪打过来把它冲掉（一阵风把它吹散）
    this.shift2d(g, table, net || sketch);
    table.innerHTML = `
      ${[1, 2, 3].map((s) => this.opponentHtml(s)).join('')}
      <div class="center${Date.now() < this.diffUntil ? ' diff-on' : ''}">${net ? this.netCenterHtml() : this.centerHtml()}</div>
      ${[0, 1, 2, 3].map((s) => (net ? this.netCardHtml(s) : this.seatFrameHtml(s))).join('')}
      ${[0, 1, 2, 3].map((s) => this.pondHtml(s)).join('')}
      ${this.myAreaHtml(true, false)}
      ${this.abilityPanelHtml()}
      <div class="hiroe-say" data-r="say">${this.sayText()}</div>
      ${this.showResult ? this.resultHtml() : ''}${g.phase === 'predeal' || g.phase === 'postdeal' ? this.predealHtml() : ''}`;
    this.himekoFx2d(g, table.parentElement ?? table);
    document.querySelector('.stage')?.classList.toggle('deep', !!this.vision);
    table.dataset.mist = String(this.mistLevel());
    this.gale2d(this.galeView()?.level ?? 0);
    this.stars2d();
    this.awaiField2d();
    this.water2d(this.waterOn());
    this.syncChains2d();
    setSketchTiles(false);
    table.parentElement?.classList.toggle('sketch', sketch);
    // 刚打的那一张动画播完了才不再标着（陀螺要转将近一秒，中间重画不能把它打断）
    if (this.freshDiscard && Date.now() - this.freshDiscard.at >= fresh2d(this.freshDiscard.style, this.freshDiscard.push).ms) this.freshDiscard = null;
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
            return `<div class="nameplate float ${POS[s]}" data-seat="${s}" style="--c:${c.color}"><div class="avatar">${c.name.slice(-1)}${this.bulbHtml(s)}${this.fjHtml(s)}${this.mgHtml(s)}${this.distHtml(s)}${this.mirrorHtml(s)}${this.lensMark(s)}${this.riiLockHtml(s, 'plate')}</div><div><div class="pname">${this.seatLabel(s)}</div><div class="pability">${this.blockedText(s) ?? (c.ability?.name ?? '无能力')}</div></div>${this.towerHtml(s)}</div>`;
          })
          .join('');
    hud.innerHTML = `
      ${plates}
      ${this.myAreaHtml(false, !flat)}
      ${flat ? this.foresightHtml() : this.abilityPanelHtml()}
      <div class="hiroe-say" data-r="say">${this.sayText()}</div>
      ${this.showResult && !(g.phase === 'roundEnd' && this.staged()) ? this.resultHtml() : ''}${g.phase === 'predeal' || g.phase === 'postdeal' ? this.predealHtml() : ''}`;
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
      rinshanSeen: this.sakiSees() && new Set(sakiRinshan(this.game!, this.me)),
      waveBacks: this.vision || (g.phase !== 'turn' && g.phase !== 'calls') ? undefined : awaiWaveTiles(g, this.me),
      gravity: (g.phase === 'turn' || g.phase === 'calls') && awaiSourceOn(g),
      awai: awaiFields(g, this.me),
      stars: g.phase === 'turn' || g.phase === 'calls' || g.phase === 'roundEnd' ? awaiStars(g) : null,
      handOrder: this.myHand(),
      openHands: this.openHands(),
      drawPath: this.settings.drawPath,
      discardFx: this.settings.discardFx,
      riichiFx: this.settings.riichiFx,
      pondFx: this.settings.pondFx,
      spotlight: this.settings.spotlight,
      winZoom: this.settings.winZoom,
      slamHand: this.settings.slam !== 'tile',
      slamOrder: this.settings.slamOrder,
      slamStyle: this.settings.slamStyle,
      mist: this.mistLevel(),
      sketch: this.sketchShown(),
      gale: this.galeView(),
      glowTiles: this.glowTiles(),
      stillWater: this.waterOn(),
      sea: this.seaView(),
      riiCover: this.riiPicking,
      riiBind: this.chars[this.me]?.id === 'rii' && !this.vision ? riiBind(g, this.me) : null,
    });
    hud.parentElement?.classList.toggle('sketch', this.sketchShown());
  }

  // 高鸭稳乃的深山：牌山上的雾有几级（谁都看得见；被封印的那一局没有雾）。
  // 发牌前（选技能的时候）牌山还没摆出来，不起雾；3D 牌桌还要等牌山真的摆好（table3d 的 mistFill）
  private mistLevel(): number {
    const g = this.game;
    if (!g || g.phase === 'predeal' || g.phase === 'postdeal') return 0;
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
    // 智叶鞘里听着牌的样子只有操作她的玩家看得见，别人看到的始终是平常头像
    const powered = !!g.active(s)?.powered?.(g, s) && (c.id !== 'satoha' || s === this.me);
    const src = power || powered ? powerPortraitUrl(c.id) : portraitUrl(c.id, this.faceOf(s));
    return `
      <div class="seat-frame ${POS[s]} ${active} ${g.seesRiichi(s, this.me) ? 'riichi' : ''}${power ? ' power' : ''}" data-seat="${s}" style="--c:${c.color}">
        <div class="portrait"><span class="face">${c.name.slice(-1)}</span><img src="${src}" alt="" onerror="this.remove()" />${this.badgeHtml(s)}${this.bulbHtml(s)}${this.fjHtml(s)}${this.mgHtml(s)}${this.distHtml(s)}${this.mirrorHtml(s)}${this.lensMark(s)}${this.riiLockHtml(s, 'seat')}</div>
        ${this.towerHtml(s)}
        <div class="seat-info">${c.name}</div>${this.teamPlateHtml(s)}${s === this.me ? this.bladeBarHtml() : ''}
      </div>`;
  }

  // 头像框上的能力小标签（衣的月相、尧深的「种N」……）。能力写了 badgeTip 的，指着（手机上点）弹出说明和一排牌
  private badgeHtml(s: number): string {
    const g = this.game!;
    const c = this.chars[s];
    const blocked = c.ability && g.isSealed(s) ? '封印' : this.sistersBlocked(s) ? '七姐妹·软封印' : null;
    const badge = blocked ?? c.ability?.badge?.(g, s);
    if (!badge) return '';
    const tip = blocked ? null : c.ability?.badgeTip?.(g, s);
    if (!tip) return `<span class="badge">${badge}</span>`;
    // 种类换成那种牌的第四张：第四张从来不是赤宝牌
    const tiles = tip.kinds?.length ? `<span class="bp-tiles">${tip.kinds.map((k) => tileHtml(k * 4 + 3, { size: 'mini' })).join('')}</span>` : '';
    const lines = (tip.lines ?? []).map((l) => `<span class="bp-line">${l}</span>`).join('');
    return `<span class="badge has-pop" tabindex="0" aria-label="${tip.title}">${badge}<span class="badge-pop"><b>${tip.title}</b>${tiles}${lines}</span></span>`;
  }

  // 团体赛：名牌下面一条队伍颜色的牌子写队名。头像上沿正中常挂着能力的标记（智叶的间合、哩的光锁、梅根的牛仔帽），
  // 队名不放那里，免得被盖住；浅色的队（黄队）用深色字
  private teamPlateHtml(s: number): string {
    const t = this.teamOf(s);
    if (!t) return '';
    const hex = t.color.replace('#', '');
    const [r, gr, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const light = 0.2126 * r + 0.7152 * gr + 0.0722 * b > 0.35;
    return `<div class="tm-plate${light ? ' light' : ''}" style="--t:${t.color}">${t.name}</div>`;
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
    // 这一局和不了（照魔镜那一局）就不标听牌
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
      return ryuukaSensesTenpai(g, s, this.me) ? '<span class="dist tenpai" title="无极天：听牌了">听</span>' : '';
    }
    // 涅莉：手里还有运势就看得出谁听牌了
    if (this.chars[this.me]?.id === 'nelly' && !g.isSealed(this.me) && nellySenses(g, this.me)) {
      return nellySensesTenpai(g, s, this.me) ? '<span class="dist tenpai" title="运势：听牌了">听</span>' : '';
    }
    // 梅根：她自己听牌时，听牌的对手戴上牛仔帽
    if (this.chars[this.me]?.id === 'megan') {
      if (this.vision) return '';
      return meganSenses(g, this.me).includes(s) ? hatHtml() : '';
    }
    // 智叶的间合：一到三道刀痕是还差几步，听牌了变红（旁边另有洋榎那种灯，见 bulbHtml）。连庄的庄家少算一步
    if (this.chars[this.me]?.id === 'satoha') {
      if (this.vision) return '';
      const d = satohaDistance(g, this.me, s);
      const cut = satohaRenchanDealer(g, this.me) === s;
      const marks = d === 0 ? '听' : '<i></i>'.repeat(Math.min(3, d));
      const tip = `间合：${d === 0 ? '听牌了' : `还差 ${d} 步`}${cut ? '（连庄：少算一步）' : ''}`;
      return `<span class="dist iai${d === 0 ? ' tenpai' : ''}${cut ? ' cut' : ''}" title="${tip}">${marks}${cut ? '<em>连</em>' : ''}</span>`;
    }
    if (this.chars[this.me]?.id !== 'ako' || !akoSense(g, this.me)) return '';
    const d = akoDistance(g, s, this.me);
    const inner = d === 0 ? '听' : '●'.repeat(Math.min(3, d));
    return `<span class="dist${d === 0 ? ' tenpai' : ''}" title="距离感：${d === 0 ? '听牌了' : `还差 ${d} 步`}">${inner}</span>`;
  }

  // ---------- 洋榎：读牌 ----------

  // 读牌的人：洋榎，和读得出没有能力的人的真子
  private isHiroe(): boolean {
    return ['hiroe', 'mako'].includes(this.chars[this.me]?.id) && !this.game?.isSealed(this.me);
  }

  // 感知得到别人听牌多大的人：洋榎、真子，和天江衣、智叶（只有灯，不知道听哪几张）。智叶的间合是技术，被封印也照旧
  private sensesTenpaiSize(): boolean {
    return this.isHiroe() || (this.chars[this.me]?.id === 'koromo' && !this.game?.isSealed(this.me)) || this.chars[this.me]?.id === 'satoha';
  }

  // 听牌的人头像旁边的灯：牌越大越亮（只给操作洋榎、衣的玩家看）
  private bulbHtml(s: number): string {
    const g = this.game!;
    if (!this.sensesTenpaiSize() || s === this.me || this.vision || (g.phase !== 'turn' && g.phase !== 'calls') || g.stealthed(s, this.me)) return '';
    if (this.chars[this.me].id === 'mako' && !makoKnows(g, s)) return '';
    // 别的智叶藏着的听牌，智叶的间合也看不出
    if (this.chars[this.me].id === 'satoha' && g.tenpaiHidden(s, this.me)) return '';
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
    if (this.chars[this.me]?.id === 'hiroko' && s !== this.me) return this.notebookHtml(s);
    // 智叶的看破：打过两局以后也看得到资料本
    if (this.chars[this.me]?.id === 'satoha' && s !== this.me) return satohaScouts(g, this.me) ? this.notebookHtml(s) : '';
    if (this.chars[this.me]?.id !== 'teru' || s === this.me || !teruMirrored(g, this.me) || g.isSealed(this.me)) return '';
    const c = this.chars[s];
    const proof = !!g.active(s)?.mirrorProof?.(g, s);
    const lines = proof ? ['天岩户：照魔镜照不进去'] : c.ability ? c.ability.insight?.(g, s) ?? [c.ability.description] : ['没有能力，只靠牌效和防守'];
    const name = c.ability ? c.ability.name : '无能力';
    return `<span class="mirror" tabindex="0" aria-label="照魔镜：${c.name}">镜<span class="mirror-pop"><b>${c.name} · ${name}</b>${lines.map((l) => `<span>${l}</span>`).join('')}</span></span>`;
  }

  // ---------- 船久保浩子：资料本 ----------

  // 别人头像上的“资”：指着（手机上点）看浩子资料本里这家能力的对策
  private notebookHtml(s: number): string {
    const c = this.chars[s];
    if (!c.ability) return '';
    const tip = HIROKO_NOTES[c.ability.id] ?? c.ability.description;
    return `<span class="mirror notebook" tabindex="0" aria-label="资料本：${c.name}">资<span class="mirror-pop"><b>${c.name} · ${c.ability.name}</b><span>${tip}</span></span></span>`;
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
    if (this.sistersBlocked(s)) return '被七姐妹软封印';
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

  // 这一局被涅莉的七姐妹软封印：摸不到和了牌（自摸不了），荣和照样可以
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
    const { level, next, broke, kiki, last, streak } = teruLadder(g, s);
    // 按打点递增的连和：一层是一次连和，亮着的层上写那一次和了多少点，闪的那层写这一局要超过多少；塔尖是九莲宝灯
    if (teruPoints()) {
      const tiers = Array.from({ length: 8 }, (_, i) => {
        const n = i + 1;
        const lit = n <= level;
        const up = !lit && n === level + 1;
        return `<i class="tt-tier${lit ? ' lit' : up ? ' next' : ''}" style="--i:${i}">${lit ? (streak[i] ?? '') : up ? (level ? `>${last}` : '起胡') : ''}</i>`;
      })
        .reverse()
        .join('');
      const pips = Array.from({ length: TERU.kiki }, (_, i) => `<i${i < kiki ? ' class="on"' : ''}></i>`).join('');
      const note = `${teruNote(g, s)}；叽叽叽 ${kiki}/${TERU.kiki}`;
      return `<span class="teru-tower${broke && !level ? ' broken' : ''}" title="${note}"><i class="tt-spire${kiki >= TERU.kiki ? ' lit' : ''}"></i>${tiers}<span class="tt-kiki">${pips}</span></span>`;
    }
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
    return this.isToki() && !this.vision && this.myDiscardTurn() && !this.blocked && count < 2;
  }

  // 发动：牌局复制一份放到牌桌上，她接着在复制品上出牌
  private startVision(): void {
    if (!this.canDeep()) return;
    const real = this.game!;
    const key = this.turnKey();
    if (this.looks.key !== key) this.looks = { key, count: 0, last: '', at: -1 };
    if (++this.looks.count >= 2) this.penaltyNext = true;
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
      // 郝慧宇“日麻无役”的气泡（gb-sigh）不放特效
      const fx = !!t.kind && t.kind !== 'gb-sigh';
      box.insertAdjacentHTML(
        'beforeend',
        `<div data-id="${t.id}" class="toast ${POS[t.seat]} ${t.big ? 'big' : ''} ${fx ? `fx fx-${t.kind}` : t.kind}" style="--c:${t.color ?? this.chars[t.seat].color}">${fx ? fxSparksHtml(t.kind) : ''}<span>${t.text}</span></div>`,
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
    // 原木：这个半庄谁和一局，那家点数后面多盖一个小朱印
    const wins = tableColors().seals ? winCounts(g) : null;
    const scores = [0, 1, 2, 3]
      .map((s) => {
        const active = g.phase === 'turn' && g.turn === s ? 'active' : '';
        const seals = wins?.[s] ? `<span class="seals" title="这个半庄和了 ${wins[s]} 局">${'<i></i>'.repeat(wins[s])}</span>` : '';
        return `<div class="score ${POS[s]} ${active}" style="--c:${this.chars[s].color}">
          <span class="wind">${WIND_CN[g.seatWind(s) - 27]}</span>
          ${this.ptsHtml(s)}
          ${g.players[s].riichi && g.seesRiichi(s, this.me) ? '<span class="stick"></span>' : ''}${seals}
        </div>`;
      })
      .join('');
    return `
      <div class="round">${g.roundLabel()}</div>
      <div class="remain">余 ${g.phase === 'predeal' ? '—' : g.wall.remaining}</div>
      <div class="sticks">立直棒 ×${g.shownSticks(this.me)}</div>
      <div class="dora">${dora}</div>
      ${this.sakiPeekHtml()}
      ${scores}${tableColors().clock ? this.clockHtml() : ''}`;
  }

  // 深夜：中间那块角上一只小表，指着现在几点（3D 是仪表盘中间的表盘）。牌桌不重画的时候每 15 秒自己拨一次针
  private clockHtml(): string {
    const d = new Date();
    const [h, m] = [d.getHours(), d.getMinutes()];
    this.clockTimer ??= window.setInterval(() => {
      const el = document.querySelector<HTMLElement>('#table .center .night-clock');
      if (!el) {
        window.clearInterval(this.clockTimer);
        this.clockTimer = undefined;
        return;
      }
      const t = document.createElement('template');
      t.innerHTML = this.clockHtml();
      const fresh = t.content.firstElementChild as HTMLElement | null;
      if (fresh && fresh.getAttribute('style') !== el.getAttribute('style')) el.replaceWith(fresh);
    }, 15000);
    const hm = `${h}:${String(m).padStart(2, '0')}`;
    return `<i class="night-clock" style="--h:${(((h % 12) + m / 60) * 30).toFixed(1)}deg;--m:${m * 6}deg" title="现在 ${hm}" aria-label="现在 ${hm}"></i>`;
  }

  // 中间那块上一家的点数。其他三家另外备一份点差（自己比他多几点）：鼠标停在中间那块上（手机上点一下，3 秒）时换成点差，
  // 多了是 +、蓝字，少了是 -、红字（颜色看底色深浅，见 style.css 的 --diff-plus）
  // scoreOf：照哪份点数写（翻牌屏换局时要写结算前的，见 flip2d）
  private ptsHtml(s: number, scoreOf = (x: number) => this.game!.shownScore(x, this.me)): string {
    const score = scoreOf(s);
    if (s === this.me) return `<span class="pts">${score}</span>`;
    const d = scoreOf(this.me) - score;
    const sign = d > 0 ? ['plus', '+'] : d < 0 ? ['minus', '-'] : ['even', '±'];
    return `<span class="pts"><span class="v">${score}</span><span class="d ${sign[0]}">${sign[1]}${Math.abs(d)}</span></span>`;
  }

  // 手指点一下中间那块：3 秒内写点差（鼠标停在上面时 CSS 自己换）。2D 牌桌每次重画都会换掉中间那块，所以记下到什么时候，重画时照着加
  private flashDiff(): void {
    this.diffUntil = Date.now() + 3000;
    document.querySelector('#table .center')?.classList.add('diff-on');
    clearTimeout(this.diffTimer);
    this.diffTimer = window.setTimeout(() => document.querySelector('#table .center')?.classList.remove('diff-on'), 3000);
  }

  // 宫永咲的王牌感知（2D）：中间放 4 张岭上牌的牌背，鼠标移到上面牌背变透明看得到牌；成刻以后杠材的第四张在牌山第几张、轮到谁摸一直写着
  private sakiPeekHtml(): string {
    const see = this.sakiSees();
    if (!see) return '';
    const g = this.game!;
    const tiles = sakiRinshan(g, this.me).map((t) => tileHtml(t, { size: 'mini', classes: ['peek'] })).join('');
    // 第四张现在轮到谁摸（没人鸣牌的话）：被鸣牌错开了就写出来
    const kan = [...sakiKanTiles(g, this.me)].map((t) => {
      const i = g.wall.live.indexOf(t);
      const who = g.drawerOf(i);
      return `${kindLabel(kindOf(t))}（再摸 ${i + 1} 张，${who === this.me ? '轮到你' : `错开了，轮到${this.chars[who].name}`}）`;
    });
    const note = kan.length ? `杠材：${kan.join('、')}` : sakiKanKinds(g, this.me).length ? '杠材不在牌山里' : '';
    // 杠材有两项时字多，另外排紧一点（style.css 的 .kan-peek.multi），免得压到上下两家的点数
    return `<div class="rinshan-peek" title="王牌感知"><span>岭上</span>${tiles}</div>${note ? `<div class="kan-peek${kan.length > 1 ? ' multi' : ''}">${note}</div>` : ''}`;
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

  // 2D 牌桌：初美的紫色旋风画在一层盖在牌桌上的 canvas 里（不跟着牌桌重画，动画不会断）
  private gale2d(level: number): void {
    const host = document.querySelector('.stage .table');
    if (!host) return;
    let el = host.querySelector<HTMLElement>(':scope > .gale');
    if (!el) {
      el = document.createElement('div');
      el.className = 'gale';
      this.gale2dFx = new Gale2D();
      el.append(this.gale2dFx.el);
      host.prepend(el);
    }
    this.gale2dFx?.setLevel(level);
  }

  // ---------- 大星淡的星空（2D 牌桌；3D、2.5D 画在牌桌里，见 ui3d/starFx.ts） ----------

  // 夜空铺在牌底下、流星和闪光盖在最上面（都不跟着牌桌重画）
  private stars2dLayer(): Stars2D | null {
    if (this.table3d) return null;
    const host = document.querySelector('.stage .table');
    if (!host) return null;
    if (!this.stars2dFx || !this.stars2dFx.fx.isConnected) {
      this.stars2dFx = new Stars2D();
      host.prepend(this.stars2dFx.sky);
      this.stars2dFx.sky.after(this.stars2dFx.field);
      host.append(this.stars2dFx.fx);
    }
    return this.stars2dFx;
  }

  // 一家头像的正中（在星空那一层里的坐标）
  private starSeat2d(fx: Stars2D, s: number) {
    return fx.center(document.querySelector(`.seat-frame[data-seat="${s}"] .portrait`)) ?? fx.middle;
  }

  // 每次重画：双立直的夜空铺着没有，头像角上那颗星写着再摸几张到转角；结算弹出来时放杠里的流星
  private stars2d(): void {
    const g = this.game;
    if (!g || this.table3d) return;
    const v = g.phase === 'turn' || g.phase === 'calls' || g.phase === 'roundEnd' ? awaiStars(g) : null;
    if (!v) {
      this.stars2dFx?.setOn(false);
      return;
    }
    if (performance.now() < this.starHold2d) return;
    const fx = this.stars2dLayer();
    if (!fx) return;
    fx.setOn(true);
    const r = document.querySelector(`.seat-frame[data-seat="${v.seat}"] .portrait`)?.getBoundingClientRect();
    fx.setBeacon(v.corner !== null && r && g.phase !== 'roundEnd' ? fx.local(r.right - 6, r.top + 6) : null, v.draws, v.lost);
    if (g.phase === 'roundEnd' && this.showResult && !this.starUraShown) {
      this.starUraShown = true;
      const i = g.roundResult?.wins.findIndex((w) => w.seat === v.seat && w.melds.some((m) => m.type === 'ankan')) ?? -1;
      const k = awaiKanUra(g, v.seat);
      // 逆回旋自摸：等结算里那张里宝牌指示牌翻开了流星才飞
      const whirl = this.whirl2d === v.seat && this.galeSlam?.seat === v.seat;
      const wait = whirl ? Math.max(650, uraShown2d(g.roundResult?.wins[i]?.uraIndicators.length ?? 1) * 1000 - (performance.now() - this.galeSlam!.t0)) : 650;
      if (i >= 0 && k !== undefined) window.setTimeout(() => this.game === g && this.starUra2d(i, k), wait);
    }
  }

  // 每次重画：高维领域的网格铺着没有，加速驱动的准星挂在另外三家头像上没有；引力波开着时隔几秒再荡一圈淡的
  private awaiField2d(): void {
    const g = this.game;
    if (!g || this.table3d) return;
    const v = g.phase === 'turn' || g.phase === 'calls' ? awaiFields(g, this.me) : null;
    const wave = v?.wave ?? null;
    if (wave === null && this.wave2dTimer) {
      window.clearInterval(this.wave2dTimer);
      this.wave2dTimer = 0;
    }
    // 这一局没人开过这几个技能、也没铺过星空：不用为它建这一层
    if (!this.stars2dFx && (!v || (v.domain === null && v.accel === null && wave === null))) return;
    const fx = this.stars2dLayer();
    if (!fx) return;
    fx.setField(!!v && v.domain !== null);
    const accel = v?.accel ?? null;
    fx.setReticles(accel === null ? null : [0, 1, 2, 3].filter((s) => s !== accel).map((s) => this.starSeat2d(fx, s)));
    if (wave !== null && !this.wave2dTimer) {
      this.wave2dTimer = window.setInterval(() => {
        const layer = this.game === g && !this.table3d ? this.stars2dFx : null;
        if (!layer?.fx.isConnected || document.hidden) return;
        const far = Math.hypot(layer.fx.offsetWidth, layer.fx.offsetHeight);
        const home = this.starSeat2d(layer, wave);
        layer.ring(home, far * 0.7, 2, '#5d3fb0');
        layer.ring(home, far * 0.7, 2, '#4a3390', 0.3);
      }, 6000);
    }
  }

  // 淡的规矩挡掉了 target 的一张摸牌：高维领域——他头像上盖一个紫色的封印；加速驱动——准星那里闪一下粉光
  private awaiDeny2d(text: string, target: number): void {
    if (text !== '高维领域' && text !== '加速驱动') return;
    const fx = this.stars2dLayer();
    if (!fx) return;
    const at = this.starSeat2d(fx, target);
    if (text === '高维领域') fx.seal(at);
    else {
      fx.flare(at, 100, 0.6, '#ff8ad8', 0.8, 0.4);
      fx.ring(at, 56, 0.45, '#ff7ad0');
    }
  }

  // 转角暗杠：星（from，没有就从她头像）化成流星，落到她刚亮出来的杠子上
  private starKan2d(seat: number, from: { x: number; y: number } | null): void {
    const fx = this.stars2dLayer();
    if (!fx) return;
    const melds = document.querySelectorAll(seat === this.me ? '.me .melds .meld' : `.opponent.${POS[seat]} .melds .meld`);
    const meld = melds[melds.length - 1];
    const to = fx.center(meld) ?? this.starSeat2d(fx, seat);
    const start = from ?? this.starSeat2d(fx, seat);
    fx.flare(start, 90, 0.5, '#ffffff', 0.9, 0.5);
    fx.comet(start, to, {
      dur: 0.6,
      lift: 90,
      size: 56,
      onHit: () => {
        fx.flare(to, 150, 1.1, '#ffd36b', 0.9, 0.8);
        fx.ring(to, 150, 0.8, '#ffe9a8');
        fx.ring(to, 70, 0.4, '#ffffff');
        [...(meld?.children ?? [])].forEach((t, i) => window.setTimeout(() => t.isConnected && fx.flare(fx.center(t) ?? to, 50, 0.7, '#fff1c4', 0.7, 0.4), 80 + i * 70));
      },
    });
  }

  // 杠里：结算里第 k 张里宝牌指示牌上亮一下，四颗流星飞到杠的四张牌上（win：结算里的第几位和牌的人）
  private starUra2d(win: number, k: number): void {
    const fx = this.stars2dLayer();
    const box = document.querySelectorAll('.result .win')[win];
    if (!fx || !box) return;
    const w = this.game?.roundResult?.wins[win];
    const from = fx.center(box.querySelectorAll('.ura .tile')[k]);
    const meld = box.querySelectorAll('.win-hand .meld')[w?.melds.findIndex((m) => m.type === 'ankan') ?? -1];
    if (!from || !meld) return;
    fx.flare(from, 110, 1.4, '#ffffff', 0.9, 0.6);
    fx.ring(from, 80, 0.6, '#ffe9a8');
    [...meld.children].forEach((t, i) => {
      const to = fx.center(t);
      if (!to) return;
      fx.comet(from, to, {
        delay: 0.25 + i * 0.16,
        dur: 0.55,
        lift: 60 + i * 10,
        size: 40,
        onHit: () => {
          fx.flare(to, 70, 1.5, '#ffd36b', 0.85, 0.5);
          fx.ring(to, 46, 0.5, '#ffe9a8');
        },
      });
    });
  }

  // 大星淡的技能发动那一下，只管 2D 牌桌（3D、2.5D 在牌桌里放，见 Table3D.awaiSkillFx）：
  // 平行宇宙——整张桌子晃着错开、白光一闪翻到左右颠倒的另一边，再翻回来（style.css 的 awai-parallel），这段时间牌局等着；
  // 时间迟滞——另外三家头像上落一圈冷蓝的光；星符汇聚——桌子上方北斗七星一颗颗亮起来，挂到这一局结束；
  // 高维领域——暗紫的波从她那边推过整张桌子，桌面压暗、浮出两层慢慢扭动的网格（awaiField2d），被压住的人头像上盖封印；
  // 退相干——三团错开的光合成一颗；引力波——一圈圈涟漪从她那边荡开，之后隔几秒再荡一圈淡的；
  // 加速驱动——三颗流星扎到另外三家，之后他们头像上各挂一个转着的准星；巨引力源——整张桌子往中间拧一下（awai-kick），一圈圈光往桌心收
  private awaiSkillFx2d(seat: number, text: string): void {
    const fx = this.stars2dLayer();
    if (!fx) return;
    const shake = (cls: string, ms: number) => {
      this.root.classList.remove(cls);
      void this.root.offsetWidth;
      this.root.classList.add(cls);
      window.setTimeout(() => this.root.classList.remove(cls), ms);
    };
    const span = Math.min(fx.fx.offsetWidth, fx.fx.offsetHeight);
    const far = Math.hypot(fx.fx.offsetWidth, fx.fx.offsetHeight);
    const home = this.starSeat2d(fx, seat);
    const mid = fx.middle;
    const others = [0, 1, 2, 3].filter((s) => s !== seat);
    if (text === '时间迟滞') {
      others.forEach((s, i) => {
        const at = this.starSeat2d(fx, s);
        fx.ring(at, span * 0.14, 1.5, '#7fb4ff', 0.5 + i * 0.18);
        window.setTimeout(() => fx.flare(at, span * 0.16, 1.4, '#8fc0ff', 0.55, 0.3), (0.5 + i * 0.18) * 1000);
      });
    } else if (text === '星符汇聚') {
      const shape: [number, number][] = [[-0.55, -0.1], [-0.5, 0.18], [-0.13, 0.23], [-0.1, -0.02], [0.17, -0.1], [0.4, -0.18], [0.7, -0.02]];
      fx.figure(shape.map(([x, y]) => ({ x: mid.x + x * span * 0.5, y: mid.y - span * 0.23 + y * span * 0.5 })), [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]]);
      fx.ring(home, span * 0.16, 0.8, '#ffe9a8', 7 * 0.16);
      // 七颗星各落一颗流星进她的手牌
      shape.forEach(([x, y], i) => {
        fx.comet({ x: mid.x + x * span * 0.5, y: mid.y - span * 0.23 + y * span * 0.5 }, { x: home.x + (i - 3) * span * 0.03, y: home.y }, { delay: 7 * 0.16 + 0.15 + i * 0.07, dur: 0.45, lift: 20, size: 30 });
      });
    } else if (text === '高维领域') {
      fx.flare(home, span * 0.3, 1, '#8a5cff', 0.8, 0.8);
      fx.ring(home, far, 1.3, '#6a3cff');
      fx.ring(home, far, 1.5, '#3a1e8a', 0.2);
      // 网格从她那边铺开；管牌山的能力被压住的人，头像上各盖一个封印
      fx.setField(true, home);
      const g = this.game!;
      others.forEach((s, i) => {
        const a = g.abilities[s];
        if (!a || !(a.beforeAnyDraw || a.dealRules) || !g.quelled(s)) return;
        window.setTimeout(() => this.game === g && fx.fx.isConnected && fx.seal(this.starSeat2d(fx, s)), 700 + i * 160);
      });
    } else if (text === '退相干' || text === '退相干·自摸') {
      const tsumo = text !== '退相干';
      ['#7fe6ff', '#b58cff', '#ffffff'].forEach((c, i) => {
        fx.comet({ x: home.x + (i - 1) * span * 0.12, y: home.y - span * 0.12 - i * 12 }, home, {
          dur: 0.34,
          lift: 14,
          size: 34,
          head: c,
          tail: c,
          onHit: i === 2 ? () => {
            fx.flare(home, span * (tsumo ? 0.24 : 0.16), 0.7, '#9fe8ff', 0.9, 0.5);
            fx.ring(home, span * (tsumo ? 0.18 : 0.12), 0.5, '#9fe8ff');
          } : undefined,
        });
      });
    } else if (text === '引力波') {
      for (let i = 0; i < 3; i++) fx.ring(home, far * (0.6 + i * 0.2), 1.5, i === 1 ? '#d9b8ff' : '#9b6bff', i * 0.28);
      fx.flare(home, span * 0.2, 0.9, '#b58cff', 0.8, 0.6);
    } else if (text === '平行宇宙') {
      shake('awai-parallel', PARALLEL_MS + 100);
      this.fxHold2d = performance.now() + PARALLEL_MS - 300;
      const flash = PARALLEL_MS * 0.46;
      // 先是桌心一颗星越来越亮、光圈往里收；白光那一下炸开；翻回来时再荡一圈
      fx.flare(mid, span * 0.3, flash / 1000 + 0.2, '#9fb6ff', 0.7, 1.2);
      for (let i = 0; i < 3; i++) fx.ring(mid, far * (0.5 - i * 0.1), 0.7, i === 1 ? '#d9b8ff' : '#8f7bff', i * 0.32, true);
      window.setTimeout(() => {
        fx.flare(mid, span * 0.7, 1.1, '#ffffff', 0.9, 1);
        fx.flare(mid, span * 0.4, 1.5, '#9fb6ff', 0.9, 0.6);
      }, flash);
      fx.ring(mid, far * 0.6, 0.9, '#ffffff', flash / 1000);
      fx.ring(mid, far * 0.6, 1.2, '#8f7bff', flash / 1000 + 0.12);
      fx.ring(mid, far * 0.5, 0.8, '#cfd8ff', (PARALLEL_MS * 0.84) / 1000);
    } else if (text === '加速驱动') {
      fx.flare(home, span * 0.2, 0.6, '#ff8ad8', 0.8, 0.5);
      others.forEach((s, i) => {
        const to = this.starSeat2d(fx, s);
        fx.comet(home, to, {
          delay: 0.1 + i * 0.12,
          dur: 0.5,
          lift: 60,
          size: 44,
          head: '#ffd6f2',
          tail: '#c58cff',
          onHit: () => {
            fx.flare(to, span * 0.15, 0.8, '#ff7ad0', 0.8, 0.5);
            fx.ring(to, span * 0.1, 0.5, '#ff7ad0');
          },
        });
      });
    } else if (text === '巨引力源') {
      shake('awai-kick', 1300);
      fx.ring(mid, span * 0.42, 0.9, '#7a4dff', 0, true);
      fx.ring(mid, span * 0.42, 0.9, '#c9b0ff', 0.25, true);
      fx.ring(mid, span * 0.3, 0.9, '#7a4dff', 0.5, true);
    }
  }

  // 2D：和了牌砸到结算上那一下，从这张牌炸开，紫色的风往上喷（这时盖在结算上面，放完自己收起来）
  private galeBurst2d(): void {
    const el = document.querySelector<HTMLElement>('.stage .table > .gale');
    if (!el) return;
    const tile = document.querySelector<HTMLElement>('.win.slam .win-tile');
    const box = el.getBoundingClientRect();
    const r = tile?.getBoundingClientRect();
    el.classList.add('burst');
    this.gale2dFx?.burst(r ? { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top } : undefined);
    window.setTimeout(() => el.classList.remove('burst'), 2600);
  }

  // 2D：咲的岭上开花。和了牌砸到结算上那一下，从这张牌卷出一阵白色的旋风，花瓣、星光飘开（lily2d.ts），
  // 画在一层盖在结算上面的 canvas 里，放完自己收起来
  private lilyBurst2d(base: number): void {
    const host = document.querySelector<HTMLElement>('.stage .table');
    if (!host) return;
    host.querySelector(':scope > .lily')?.remove();
    const el = document.createElement('div');
    el.className = 'lily';
    const fx = new Lily2D();
    el.append(fx.el);
    host.append(el);
    const tile = document.querySelector<HTMLElement>('.win.slam .win-tile');
    const box = el.getBoundingClientRect();
    // 牌桌整个缩放过（fit）：屏幕上的距离换回这一层里的
    const k = box.width > 0 ? el.offsetWidth / box.width : 1;
    // 这张牌落定以后的位置：按排版算（offsetLeft / offsetTop），不看它此刻被动画抬到哪了。
    // 页面卡的时候定时器会比砸牌的动画先到，照此刻的位置量花就开在半空
    const dock = tile?.offsetParent as HTMLElement | null;
    const pr = dock?.getBoundingClientRect();
    const ps = dock && pr && dock.offsetWidth > 0 ? pr.width / dock.offsetWidth : 1;
    const at = tile && dock && pr
      ? {
          x: (pr.left + (dock.clientLeft + tile.offsetLeft + tile.offsetWidth / 2) * ps - box.left) * k,
          y: (pr.top + (dock.clientTop + tile.offsetTop + tile.offsetHeight / 2) * ps - box.top) * k,
        }
      : { x: el.offsetWidth / 2, y: el.offsetHeight * 0.3 };
    playSlam();
    playLily(lilyGrand(base));
    fx.bloom(at, base, () => el.remove());
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
    const ron = new Set(g.phase === 'roundEnd' ? (g.roundResult?.wins ?? []).filter((w) => w.from === s).map((w) => w.tile) : []);
    // 横放的那张：立直宣言牌，宣言牌被鸣走了就是下一巡打的那张（被鸣走的宣言牌半透明留着，竖回来）
    const side = riichiSideIndex(p.discards);
    // 牌河摆得多齐（和 3D、2.5D 一样看设置和这个人的手风）：每张牌歪一点、偏一点，这一局里不变
    const salt = Math.floor(hash01(g.seed, g.round, 17) * 2 ** 31);
    const pond = pondStyleOf(this.chars[s]?.id ?? '', this.settings.pondFx, salt, s);
    const fresh = this.freshDiscard;
    const tiles = p.discards
      .map((d, i) => {
        const classes: string[] = [];
        const css: string[] = [];
        if (ghost) classes.push('stealth');
        if (d.called) classes.push('called');
        if (d.tsumogiri) classes.push('tsumogiri');
        if (last && last.seat === s && i === p.discards.length - 1) classes.push('last');
        if (fresh?.key === `${s}-${i}`) {
          classes.push('fresh', `fx-${fresh.style}`);
          // 动画播到一半重画：从播到的地方接着播
          const t = Date.now() - fresh.at;
          if (isPush(fresh.style) && fresh.push) {
            // 横推是两段动画接起来的（放下、推过去），推多远、推多久照这一张算
            const hit = fresh.style === 'push' && !d.called && p.discards.slice(0, i).filter((x) => !x.called).length % 6 > 0;
            if (hit) classes.push('hit');
            const go = push2dMs(fresh.push, fresh.style === 'brake');
            css.push(`--push:${(fresh.push * POND_2D_PX).toFixed(0)}px`, `--push-ms:${go}ms`);
            if (t > 30 || hit) css.push(`animation-delay:-${t}ms,${PUSH_2D_IN - t}ms${hit ? `,${PUSH_2D_IN + go - t}ms` : ''}`);
          } else if (t > 30) css.push(`animation-delay:-${t}ms`);
        }
        // 被荣和的那张：留在牌河里发金光，到下一局
        if (ron.has(d.tile)) classes.push('ron');
        const j = pondJitter(salt, d.tile, pond);
        const turn = ((j.yaw * 180) / Math.PI) * POND_2D_TWIST;
        const at = [j.dx * POND_2D_PX, j.dz * POND_2D_PX];
        // 被横推的宣言牌撞过的：多歪一点、往左让一点；刚撞上的那一下从原来的样子歪过去，亮一下
        const k = this.knocksRound === g.round && !d.called ? this.knocks2d.get(d.tile) : undefined;
        if (k) {
          const dt = Date.now() - k.at;
          if (dt < KNOCK_2D_MS) {
            classes.push('knocked');
            css.push(`--k-rot:${turn.toFixed(2)}deg`, `--k-at:${at[0].toFixed(1)}px ${at[1].toFixed(1)}px`, `animation-delay:${-dt}ms`);
          }
          css.push(`rotate:${(turn + k.deg).toFixed(2)}deg`, `translate:${(at[0] - KNOCK_2D_PX).toFixed(1)}px ${at[1].toFixed(1)}px`);
        } else if (j.yaw) css.push(`rotate:${turn.toFixed(2)}deg`, `translate:${at[0].toFixed(1)}px ${at[1].toFixed(1)}px`);
        // 淡掉的时候立直宣言牌也竖着：别人不该知道她立直了
        return tileHtml(d.tile, { size: 'pond', sideways: i === side && !vanish, classes, style: css.join(';') });
      })
      .join('');
    return `<div class="pond ${POS[s]}${vanish ? ' vanish' : ''}"${vanish}>${tiles}</div>`;
  }

  // 2D 牌桌出牌的声音：照这种出牌动画的节奏，落桌、弹起、推到位各响一下
  private freshSounds(seat: number, style: DiscardStyle, push = 0): void {
    const pan = this.clickPan(seat);
    const scrape = isPush(style) && push ? pushSeconds(push, style === 'brake').all - pushSeconds(push).wind : style === 'top' ? 0.6 : style === 'fling' ? 0.85 : 0.2;
    for (const [ms, kind] of fresh2d(style, push).sounds) {
      const play = () => (kind === 'scrape' ? playScrape(pan, scrape) : playClick({ pan, varied: true, weight: kind }));
      if (ms <= 0) play();
      else window.setTimeout(play, ms);
    }
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

  // 白水哩选番数：手牌上方一排“几番”的牌子，和“不缚”
  private riiPickerHtml(): string {
    if (!this.riiPicking || !this.game || !riiCanBind(this.game, this.me)) return '';
    const n = Array.from({ length: RII.maxBind }, (_, i) => `<button class="rii-han" data-ui="skill" data-choice="${i + 1}">${'一二三四五六七'[i]}<small>番</small></button>`).join('');
    return `<div class="rii-picker"><div class="rii-title">番缚 · 缚几番</div><div class="rii-row">${n}<button class="rii-han no" data-ui="rii-cancel">不缚</button></div>${this.riiLookHtml(true)}</div>`;
  }

  // 测试对局（「白水哩 · 姬子测试」窗口开的）里才有：换投影、锁链、头像锁、音效（全部样子）；
  // 缚上以后技能框里多一排「试结算」，不用等这一局打完就能看拿到钥匙 / 没和成 / 番数不够
  private riiLookHtml(picking: boolean): string {
    if (!this.riiTest) return '';
    const c = lookChoices('test');
    const btn = (on: boolean, attr: string, label: string) => `<button class="rii-look${on ? ' on' : ''}" data-ui="rii-look" ${attr}>${label}</button>`;
    const row = (name: string, body: string) => `<div class="rii-looks"><span>${name}</span>${body}</div>`;
    const projRow = picking ? row('投影', c.proj.map((x) => btn(riiLook.proj === x.id, `data-proj="${x.id}"`, x.name)).join('')) : '';
    const chainRow = row('锁链', c.chain.map((x) => btn(riiLook.chain === x.id, `data-chain="${x.id}"`, x.name)).join(''));
    const plockRow = row('头像锁', c.plock.map((x) => btn(riiLook.plock === x.id, `data-plock="${x.id}"`, x.name)).join(''));
    const tryBtn = (scene: string, label: string) => `<button class="rii-look try" data-ui="rii-look" data-try="${scene}">${label}</button>`;
    const sfxRow = row('音效', c.sfx.map((x) => btn(riiLook.sfx === x.id, `data-sfx="${x.id}"`, x.name)).join('') + `<span>试听</span>${tryBtn('lock', '锁上')}${tryBtn('key', '钥匙')}${tryBtn('broken', '崩断')}`);
    const endBtn = (kind: ChainOutcome, label: string) => `<button class="rii-look try" data-ui="rii-look" data-end="${kind}">${label}</button>`;
    const endRow = picking ? '' : row('试结算', endBtn('key', '拿到钥匙') + endBtn('broken', '没和成') + endBtn('short', '番数不够'));
    return projRow + chainRow + plockRow + sfxRow + endRow;
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
    // 白水哩选番数：手牌扣下去（牌背），上面浮着一排投影的牌面
    const cover = this.riiPicking;
    // 2D：扣下去、翻回来各翻一下（照着按下去的时间接着放）
    const flipAge = (Date.now() - this.riiFlipAt) / 1000;
    const uncover = !cover && flipAge < 0.34;
    const flip = cover ? ' rii-cover' : uncover ? ' rii-uncover' : '';
    const flipStyle = cover || uncover ? ` style="--rcd:${(-flipAge).toFixed(3)}s"` : '';
    const covered = (t: TileId) => (cover ? [...classes(t), 'covered'] : classes(t));
    const hand = sorted.map((t) => tileHtml(t, { classes: covered(t), data: { tile: t } })).join('');
    const drawn =
      p.drawn !== null ? `<div class="drawn">${tileHtml(p.drawn, { classes: covered(p.drawn), data: { tile: p.drawn } })}</div>` : '';
    const ghosts = cover && withHand ? `<div class="rii-ghosts${riiLook.proj === 'out' ? ' out' : ''}">${sorted.map((t) => tileHtml(t)).join('')}${p.drawn !== null ? `<div class="drawn">${tileHtml(p.drawn)}</div>` : ''}</div>` : '';

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
        `<button class="act riichi ${this.riichiMode ? 'on' : ''}" data-ui="riichi">${this.riichiMode ? '取消立直' : this.duelRiichiLabel()}</button>`,
      );
    }

    const waitHtml = `<div data-r="waits">${this.waitsSlotHtml()}</div>`;
    const hint =
      g.phase === 'turn' && g.turn === this.me && discardable.size > 0
        ? `<div class="hint">${this.riichiMode ? '选择立直宣言牌' : '点击一张牌打出'}${this.sistersBlocked(this.me) ? '（被七姐妹软封印：这一局摸不到和了牌，别人打出来的照样能荣和）' : ''}${this.sniper(this.me) !== null ? '（被镜片盯上，这一局摸不到和了牌）' : ''}${this.bustBlocked() ? '（灰掉的牌放铳会被击飞，打不出去）' : ''}</div>`
        : '';
    const c = this.chars[this.me];
    return `
      <div class="me${c.id === 'satoha' ? ' iai' : ''}${c.id === 'megan' && meganBlind(g, this.me) ? ' mg-blind' : ''}" style="--c:${c.color}">
        <div class="actions">${buttons.join('')}</div>
        ${this.autoBtnHtml()}${this.assistHtml()}
        ${this.sketchPlanHtml()}${this.gbBarHtml()}${waitHtml}${hint}${this.riiPickerHtml()}
        ${
          withHand
            ? `<div class="hand-row">
          <div class="hand${flip}"${flipStyle}>${ghosts}${hand}${drawn}</div>
          <div class="melds${[0, 1, 2, 3].some((o) => o !== this.me && g.stealthed(this.me, o)) ? ' stealth' : ''}">${this.meldsHtml(p.melds, this.me)}</div>
        </div>`
            : ''
        }
        ${withPlate && !this.netView ? `<div class="nameplate mine" data-seat="${this.me}"><div class="avatar">${c.name.slice(-1)}${this.fjHtml(this.me)}${this.mgHtml(this.me)}${this.riiLockHtml(this.me, 'plate')}</div><div class="pname">${this.seatLabel(this.me)}</div>${this.bladeBarHtml()}</div>` : ''}
      </div>`;
  }

  // 待和提示：每张待和牌下面写还剩几张、荣和几番；没役、只能自摸的写明白，和不了的变灰
  private waitsHtml(info: WaitInfo, prefix = ''): string {
    if (!info.tiles.length) return '';
    const status = info.tiles.map((w) => waitStatus(w, info.furiten));
    // 照：连和看的是点数，待和牌下面直接写荣和、自摸各拿多少点；接不上连和的（不比上一次高）划掉
    const g = this.game!;
    const teru = this.chars[this.me]?.id === 'teru' && teruPoints() && teruMirrored(g, this.me) && !g.isSealed(this.me);
    const last = teru ? teruLadder(g, this.me).last : 0;
    const dealer = this.me === g.dealer;
    // 照看得见牌山：“余”是自己看不见的张数（别人手里、王牌里的也算），“山”才是牌山里还摸得到、她的能力送得来的张数
    const wall = teru ? teruWallCounts(g) : null;
    const pts = (r: WaitInfo['tiles'][number]['ron'], tsumo: boolean, show: boolean) => {
      if (!r || !show) return '';
      const v = teruWinValue(r, tsumo, dealer);
      return `<span class="wait-pts${v > last ? '' : ' low'}">${tsumo ? '摸' : '荣'} ${v}</span>`;
    };
    const tiles = info.tiles
      .map((w, i) => {
        const st = status[i];
        const label = st === 'ron' ? hanLabel(w.ron!) : st === 'tsumo' ? '仅自摸' : '无役';
        const dead = st === 'none' || w.left === 0;
        const han = teru && st !== 'none' ? pts(w.ron, false, st === 'ron') + pts(w.tsumo, true, true) : `<span class="wait-han ${st}">${label}</span>`;
        return `<div class="wait${dead ? ' dead' : ''}">${tileHtml(w.kind * 4 + 3, { size: 'pond' })}<span class="wait-left">余 ${w.left}${wall ? `<span class="wait-wall${wall[w.kind] ? '' : ' none'}" title="牌山里还摸得到几张（别人手里、王牌里的不算）">山 ${wall[w.kind]}</span>` : ''}</span>${han}</div>`;
      })
      .join('');
    const title = prefix + (status.every((st) => st === 'none') ? '形式听牌（无役）' : '听牌') + (teru && last ? `<span class="wait-goal">要超过 ${last} 点</span>` : '');
    return `<div class="waits"><div class="waits-title">${title}${info.furiten ? '<span class="furiten">振听</span>' : ''}</div><div class="wait-list">${tiles}</div></div>`;
  }

  // 2.5D 不放能力说明，只在能力有东西要给玩家看时（怜的一巡先见、淡和霞的技能按钮）放一个小框
  private foresightHtml(): string {
    const c = this.chars[this.me];
    const extra = this.foresightBox() + this.skillBox();
    return extra ? `<div class="ability-panel foresight-only" style="--c:${c.color}">${extra}</div>` : '';
  }

  // 谁封印了自己：末原恭子鸣牌打乱流向只到她下一次摸牌，狮子原爽的蛇神威是一整局，神代小莳的天照是天照附在她身上的这几局
  private sealText(): string {
    const g = this.game!;
    const by = g.abilities.find((a, o) => o !== this.me && a?.seals?.(g, o, g.round));
    if (by?.id === 'kyouko') return '末原恭子鸣牌打乱了流向，到她下一次摸牌之前能力不起作用';
    if (by?.id === 'komaki') return '神代小莳的天照·天岩户封印了别人的能力，天照附在她身上时能力不起作用';
    return '狮子原爽的蛇神威封印了别人的能力，这一局能力不起作用';
  }

  // 主动开的技能：能量条和开关按钮（演算中不显示）
  private skillBox(): string {
    const g = this.game!;
    const ab = this.chars[this.me].ability;
    if (ab && g.isSealed(this.me)) return `<div class="foresight skill"><div class="fs-title">${ab.name}<span class="skill-on sealed">被封印</span></div><div class="fs-note skill-state">${this.sealText()}</div></div>`;
    const b = !this.vision && ab?.skill?.(g, this.me);
    if (!b) return '';
    // 白水哩没缚的时候：能缚就一个“番缚”按钮（点了在手牌上方挑几番），不能缚只写一句状态，不放 1～7 番那一排
    if (ab?.id === 'rii' && !b.active) {
      if (!b.enabled) return `<div class="foresight skill"><div class="fs-title">${ab.name}</div><div class="fs-note skill-state">${b.note}</div></div>`;
      if (!this.riiPicking) return `<div class="foresight skill"><div class="fs-title">${ab.name}</div><button class="deep-btn rii-go" data-ui="rii-bind">番缚<small>手牌扣下去，缚上几番</small></button></div>`;
      return `<div class="foresight skill"><div class="fs-title">${ab.name}</div><div class="fs-note skill-state">缚几番？缚上了这一局要和出这么多番才拿得到钥匙。</div><button class="deep-btn" data-ui="rii-cancel">不缚</button></div>`;
    }
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
      : ab!.pressSkill && b.glyph === 'he'
        ? `<button class="deep-btn glyph-btn${b.active ? ' active' : ''}" data-ui="skill" title="${b.label}" aria-label="${b.label}" ${b.enabled ? '' : 'disabled'}>${HE_SVG}<small>${b.note}</small></button>`
      : ab!.pressSkill
        ? `<button class="deep-btn${b.active ? ' active' : ''}" data-ui="skill" ${b.enabled ? '' : 'disabled'}>${b.label}<small>${b.note}</small></button>`
        : `<div class="fs-note skill-state">${b.note}</div>`;
    // 测试对局里白水哩缚上以后：换个样子、试结算
    const looks = ab?.id === 'rii' && riiBind(g, this.me) !== null && g.phase === 'turn' ? this.riiLookHtml(false) : '';
    return `<div class="foresight skill"><div class="fs-title">${ab!.name}${b.active ? '<span class="skill-on">发动中</span>' : ''}${meter}</div>${body}${looks}</div>`;
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
    const gbCards = post && ab?.id === 'huiyu' ? new Map(huiyuCards(g, this.me).map((c) => [c.key, c])) : null;
    const rows = opts
      .map((o) => {
        const on = this.pdPicks!.has(o.id);
        const card = gbCards?.get(o.id);
        if (card) return this.gbCardHtml(card, on);
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
        return `<div class="pd-step-row"><span class="pd-step-name">${o.name}${o.note ? `<small class="pd-step-tag">${o.note}</small>` : ''}</span>
          <button class="pd-step" data-ui="pd-step" data-pd="${o.id}" data-d="-1" ${v <= min ? 'disabled' : ''}>−</button>
          <span class="pd-step-val${cls}">${v > 0 && min < 0 ? '+' : ''}${v}</span>
          <button class="pd-step" data-ui="pd-step" data-pd="${o.id}" data-d="1" ${v >= max ? 'disabled' : ''}>+</button>
          <span class="pd-step-bar${cls}"><i style="width:${(Math.abs(v) / Math.max(-min, max)) * 100}%"></i></span></div>`;
      })
      .join('');
    const err = ab.preDealCheck?.(g, this.me, vals) ?? null;
    return `<div class="modal"><div class="result predeal" style="--c:${this.chars[this.me].color}">
        <h2>分配运势</h2>
        ${this.seatMapHtml()}
        <p class="pd-sub">把运势分到这一场的各局（每局最多 3 点），开局排好就不能改：1 点朝 3 番到满贯，2 点朝跳满，3 点朝三倍满、和牌挡不住。连庄、流局重打的本场不再用；比赛提前结束，排在后面的就浪费了。先按电脑的排法填好了，可以改。</p>
        <div class="pd-steps${opts.length > 4 ? ' two' : ''}">${rows}</div>
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

  // 怜的一巡先见：平时只有自己下一张摸牌；玩家操作怜时还有“看下一巡”按钮，演算中换成演算的经过和“退出”
  private foresightBox(): string {
    const g = this.game!;
    const c = this.chars[this.me];
    // 龙华只在借怜的膝枕的局看得见
    const fs = g.isSealed(this.me) || c.ability?.foresightOn?.(g, this.me) === false ? undefined : c.ability?.foresight;
    if (!this.vision && (!fs || (g.phase !== 'turn' && g.phase !== 'calls'))) return '';
    const toki = this.isToki();
    const title = `<div class="fs-title">${fs?.title ?? '一巡先见'}</div>`;
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
            : count
              ? ['再看一次', '下一局不能用']
              : ['看下一巡', ''];
      btn = `<button class="deep-btn" data-ui="deep" ${this.canDeep() ? '' : 'disabled'}>${label}${note ? `<small>${note}</small>` : ''}</button>`;
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
    // 2.5D 的和牌结算左边放和牌的人的立绘（雀魂那样）
    const art = this.mode === '25d' && r.wins.length > 0;
    // 荒牌流局：每家听什么写在下面点数那一行里（见 deltasHtml）
    return `
      <div class="modal"><div class="result${art ? ' with-art' : ''}">
        ${title}${wins}
        ${this.deltasHtml(r)}
        ${this.traceHtml()}
        <button class="primary" data-ui="next">继续</button>
      </div></div>`;
  }

  private winHtml(w: WinInfo): string {
    const r = w.result;
    const how = w.from === null ? '自摸' : `荣和（${this.chars[w.from].name} 放铳）`;
    // 2D 初美砸牌：结算重画时用负的 animation-delay 接着放，不从头再来
    const since = this.galeSlam?.seat === w.seat && !this.table3d ? (performance.now() - this.galeSlam.t0) / 1000 : Infinity;
    // 照的旋风自摸：牌砸下去以后还要转（风卷完、再转一会儿），放得久一点
    const twist = this.twist2d === w.seat;
    // 淡的逆回旋：整排手牌在半空逆着翻滚落下来，亮一下，和了牌再砸；接着里宝牌指示牌一张张从上往下翻开（杠里的那张最后翻）
    const whirl = this.whirl2d === w.seat;
    const slam = since < (twist ? 5 : 4);
    const count = w.hand.filter((t) => t !== w.tile).length;
    const hand = w.hand
      .filter((t) => t !== w.tile)
      .sort((a, b) => a - b)
      .map((t, i) => tileHtml(t, { size: 'pond', style: slam ? `--i:${whirl ? 0 : i}` : undefined }))
      .join('');
    const yaku = r.yaku.map((y) => `<div class="yaku"><span>${y.name}</span><span>${r.yakuman ? '役满' : `${y.han} 番`}</span></div>`);
    if (r.dora) yaku.push(`<div class="yaku"><span>宝牌</span><span>${r.dora} 番</span></div>`);
    if (r.aka) yaku.push(`<div class="yaku"><span>赤宝牌</span><span>${r.aka} 番</span></div>`);
    if (r.ura) yaku.push(`<div class="yaku"><span>里宝牌</span><span>${r.ura} 番</span></div>`);
    const points = w.from === null ? '' : `${r.ron} 点`;
    const summary = r.yakuman ? r.limitName : `${r.han} 番 ${r.fu} 符 ${r.limitName}`;
    // （翻的先后：杠里的那张排最后；摆的位置不变）
    const kanUra = whirl ? awaiKanUra(this.game!, w.seat) : undefined;
    const turnAt = (i: number) => (kanUra === undefined ? i : i === kanUra ? w.uraIndicators.length - 1 : i > kanUra ? i - 1 : i);
    const uraTile = (t: TileId, i: number) => (slam && whirl ? `<span class="ura-flip" style="--i:${turnAt(i)}">${backHtml('mini')}${tileHtml(t, { size: 'mini' })}</span>` : tileHtml(t, { size: 'mini' }));
    const ura = w.uraIndicators.length ? `<div class="ura">里宝牌指示牌 ${w.uraIndicators.map(uraTile).join('')}</div>` : '';
    const url = cutinArt(this.chars[w.seat].id, 'result').url;
    const art =
      this.mode === '25d'
        ? `<div class="win-art">${url ? `<img src="${url}" alt="" onerror="this.remove()" />` : `<span class="win-glyph">${this.chars[w.seat].name.slice(-1)}</span>`}</div>`
        : '';
    return `
      <div class="win${slam ? ' slam' : ''}${slam && twist ? ' twist' : ''}${slam && whirl ? ' whirl' : ''}" style="--c:${this.chars[w.seat].color}${slam ? `;--t:${(-since).toFixed(3)}s;--slam:${(whirl ? whirlStart2d() : slamStart2d(count)).toFixed(3)}s` : ''}">
        ${art}<div class="win-body">
        <h2>${this.chars[w.seat].name} ${how}</h2>
        <div class="win-hand">${hand}<span class="gap"></span>${tileHtml(w.tile, { size: 'pond', classes: ['win-tile'] })}<span class="gap"></span>${this.meldsHtml(w.melds, w.seat)}</div>
        ${ura}
        <div class="yaku-list">${yaku.join('')}</div>
        <div class="summary">${summary} ${points}</div>
        ${this.gbPanelHtml(w)}
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
    // 荒牌流局：名字后面写这一家听哪几张，没听的写「未听」
    const waits = r.kind === 'exhaustive' ? drawWaits(g) : null;
    return `<div class="deltas${waits ? ' draw' : ''}">${[0, 1, 2, 3]
      .map((s) => {
        const d = r.deltas[s];
        const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
        const wait = waits ? this.drawWaitHtml(r.tenpai[s], waits[s], 'mini') : '';
        return `<div class="delta"><span>${this.nameHtml(s)}</span>${wait}<span class="${cls}">${d > 0 ? '+' : ''}${d || ''}</span><span>${g.players[s].score}</span></div>`;
      })
      .join('')}</div>`;
  }

  // 流局时一家听什么：听牌写「听牌」和听的那几张，没听的写「未听」。
  // 用 div、b 不用 span：有的皮肤给结算行里除名字以外的 span 换了比分的字体（见 themes.css）
  private drawWaitHtml(tenpai: boolean, kinds: Kind[], size: TileSize): string {
    if (!tenpai) return '<div class="draw-wait"><b>未听</b></div>';
    const tiles = kinds.map((k) => tileHtml(k * 4 + 3, { size })).join('');
    return `<div class="draw-wait yes"><b>听牌</b>${tiles ? `<div class="draw-wait-tiles">${tiles}</div>` : ''}</div>`;
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

  // ---------- 新结算（试做） ----------

  // 用新结算：视觉设置选了「新」，3D、2.5D 牌桌（2D、天使和的网麻、怜的演算照旧用原版弹窗）
  private staged(): boolean {
    return this.settings.result === 'staged' && !!this.table3d && !this.netView && !this.vision;
  }

  private closeFlow(): void {
    if (this.flowTimer !== null) clearTimeout(this.flowTimer);
    this.flowTimer = null;
    this.flow?.dispose();
    this.flow = null;
    document.getElementById('rf')?.replaceChildren();
  }

  // 流局：牌桌中间的大字；倒牌倒下去以后，每家手牌上挂「听牌 / 未听」，听牌的带上听哪几张（途中流局不挂）
  private drawBanner(g: Game): void {
    const r = g.roundResult;
    const layer = document.getElementById('rf');
    if (!r || !layer) return;
    const main = r.kind === 'exhaustive' ? '荒牌流局' : '途中流局';
    const sub = r.kind === 'abortive' ? (r.reason ?? '') : '';
    layer.innerHTML = drawBannerHtml(main, sub, []);
    if (r.kind !== 'exhaustive') return;
    this.flowTimer = window.setTimeout(() => {
      this.flowTimer = null;
      if (this.game !== g || this.flow || !this.table3d) return;
      // 听牌的人牌子上接着写听哪几张
      const waits = drawWaits(g);
      const tags = [0, 1, 2, 3]
        .map((s) => ({ s, at: this.table3d!.handScreenPos(s) }))
        .filter((x): x is { s: number; at: { x: number; y: number } } => !!x.at)
        .map(({ s, at }) => {
          // 牌子挂在手牌上面：自己的手牌大，往上多让一点；不出画面
          const w = this.root.clientWidth;
          const h = this.root.clientHeight;
          const y = at.y - (s === this.me ? h * 0.1 : 28);
          const tiles = waits[s].map((k) => tileHtml(k * 4 + 3, { size: 'mini' })).join('');
          return { s, x: Math.min(w - 60, Math.max(60, at.x)), y: Math.min(h - 20, Math.max(48, y)), tenpai: r.tenpai[s], waits: tiles };
        });
      layer.innerHTML = drawBannerHtml(main, sub, tags);
      // 自己的牌子带上牌以后变宽，手机上会压到手牌左边的待和提示框：压到了就挪到提示框右边
      const mine = tags.findIndex((t) => t.s === this.me);
      const el = mine < 0 ? undefined : layer.querySelectorAll<HTMLElement>('.rf-tag')[mine];
      const box = this.root.querySelector('.waits')?.getBoundingClientRect();
      if (el && box && box.width) {
        const base = layer.getBoundingClientRect();
        const { x, y } = tags[mine];
        const [tw, th] = [el.offsetWidth, el.offsetHeight];
        const left = base.left + x - tw / 2;
        const top = base.top + y - th;
        if (left < box.right + 8 && left + tw > box.left && top < box.bottom && top + th > box.top)
          el.style.left = `${Math.min(base.width - tw / 2 - 8, box.right + 8 - base.left + tw / 2).toFixed(0)}px`;
      }
    }, 1400);
  }

  // 结算的几页：每个和牌的人一页，最后点数移动；翻完进下一局
  private openFlow(g: Game): void {
    const r = g.roundResult;
    const layer = document.getElementById('rf');
    if (!r || !layer) {
      this.render();
      return;
    }
    if (this.flowTimer !== null) clearTimeout(this.flowTimer);
    this.flowTimer = null;
    const pages: FlowPage[] = r.wins.map((w, i) => ({ html: this.flowWinHtml(w, i === r.wins.length - 1), secs: this.auto ? 4 : 10 }));
    const seats = this.pointSeats(r);
    const trace = r.wins.length ? '' : this.flowTraceHtml();
    pages.push({ html: pointsPageHtml(g.roundLabel(), seats, trace), secs: this.auto ? 3 : 6, after: (el) => (tallyCue(), animatePoints(el, seats)) });
    this.flow = new ResultFlow(layer, pages, () => {
      this.flow = null;
      this.advance();
    });
  }

  private flowTraceHtml(): string {
    return `<details class="rf-trace"><summary>能力痕迹（${this.trace?.entries.length ?? 0}）</summary>${this.traceHtml()}</details>`;
  }

  // 和牌那一页：左边立绘；右边手牌、宝牌里宝牌、役一条条出来、最后盖番符章和得点。last：能力痕迹放在最后一个和牌的人那页
  private flowWinHtml(w: WinInfo, last: boolean): string {
    const g = this.game!;
    const c = this.chars[w.seat];
    const r = w.result;
    const hand = w.hand
      .filter((t) => t !== w.tile)
      .sort((a, b) => a - b)
      .map((t) => tileHtml(t, { size: 'pond' }))
      .join('');
    const how = w.from === null ? '自摸' : '荣和';
    const from = w.from === null ? '' : `<span class="rf-from">${this.chars[w.from].name} 放铳</span>`;
    // 宝牌、里宝牌各五格：翻开的画牌面，其余画牌背
    const slots = (tiles: TileId[], shown: number) =>
      [0, 1, 2, 3, 4].map((i) => (i < shown && tiles[i] !== undefined ? tileHtml(tiles[i], { size: 'pond' }) : backHtml('pond'))).join('');
    const yaku = r.yaku.map((y) => [y.name, r.yakuman ? '役满' : `${y.han} 番`]);
    if (r.dora) yaku.push(['宝牌', `${r.dora} 番`]);
    if (r.aka) yaku.push(['赤宝牌', `${r.aka} 番`]);
    if (r.ura) yaku.push(['里宝牌', `${r.ura} 番`]);
    const rows = yaku.map(([n, h], i) => `<div class="rf-y" style="--i:${i}"><span>${n}</span><b>${h}</b></div>`).join('');
    // 役一条条出完再盖章
    const at = `${(0.7 + yaku.length * 0.28).toFixed(2)}s`;
    const stamp = r.yakuman ? '<div class="rf-stamp yakuman"><b>役满</b></div>' : `<div class="rf-stamp"><em>番</em><b>${r.han}</b><small>${r.fu} 符</small></div>`;
    const gain = g.roundResult?.deltas[w.seat] ?? 0;
    const url = cutinArt(c.id, 'result').url;
    const art = url ? `<img src="${url}" alt="" onerror="this.remove()" />` : `<span class="rf-glyph">${c.name.slice(-1)}</span>`;
    return `<div class="rf-page rf-win" style="--c:${c.color}">
      <div class="rf-art">${art}</div>
      <div class="rf-body" style="--at:${at}">
        <div class="rf-head"><span class="rf-name">${c.name}</span><span class="rf-how">${how}</span>${from}</div>
        <div class="rf-hand">${hand}<span class="gap"></span>${tileHtml(w.tile, { size: 'pond', classes: ['win-tile'] })}<span class="gap"></span>${this.meldsHtml(w.melds, w.seat)}</div>
        <div class="rf-dora"><span><label>宝牌</label>${slots(g.wall.doraIndicators, g.wall.doraRevealed)}</span><span><label>里宝牌</label>${slots(w.uraIndicators, w.uraIndicators.length)}</span></div>
        <div class="rf-yaku">${rows}</div>
        <div class="rf-total">${stamp}<div class="rf-limit">${r.limitName ? `<span>${r.limitName}</span>` : ''}<b>+${gain.toLocaleString('en-US')}</b></div></div>
        ${this.gbPanelHtml(w)}
        ${last ? this.flowTraceHtml() : ''}
      </div>
      <button class="rf-next" data-ui="rf-next">继续 <i></i></button>
    </div>`;
  }

  // 点数移动页的四张卡：这一局之前、之后的点数和名次
  private pointSeats(r: RoundResult): PointSeat[] {
    const g = this.game!;
    const after = g.players.map((p) => p.score);
    const before = after.map((s, i) => s - r.deltas[i]);
    const rb = ranksOf(before, g.firstDealer);
    const ra = ranksOf(after, g.firstDealer);
    // 荒牌流局：点数卡下面写这一家听哪几张（手牌上的牌子只挂一会儿，这一页停得久）
    const waits = r.kind === 'exhaustive' ? drawWaits(g) : null;
    return [0, 1, 2, 3].map((s) => {
      const c = this.chars[s];
      const wait = waits ? this.drawWaitHtml(r.tenpai[s], waits[s], 'mini') : undefined;
      return { seat: s, rel: (s - this.me + 4) % 4, name: c.name, color: c.color, portrait: portraitUrl(c.id, this.faceOf(s)), glyph: c.name.slice(-1), before: before[s], after: after[s], rankBefore: rb[s], rankAfter: ra[s], mine: s === this.me, wait };
    });
  }

  private gameEndHtml(): string {
    const g = this.game!;
    if (this.team) return this.teamEndHtml();
    if (this.soloMatch) return this.soloEndHtml();
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
  // 个人赛的一场打完：每人的终局点数和这一场的积分（（终局点数 − 25000）÷ 1000），点“回到积分榜”交回去
  private soloEndHtml(): string {
    const g = this.game!;
    const rows = g
      .ranking()
      .map((s, i) => {
        const d = g.players[s].score - SOLO_START;
        const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
        return `<div class="rank-row ${s === this.me ? 'mine' : ''}" style="--c:${this.chars[s].color}"><span class="rank">${i + 1} 位</span><span>${this.chars[s].name}</span><span>${g.players[s].score}</span><span class="${cls}">${fmtPts(d)}</span></div>`;
      })
      .join('');
    return `
      <div class="modal"><div class="result">
        <h2>个人赛 · ${this.soloMatch!.label}结束</h2>
        ${rows}
        <button class="primary" data-ui="solo-done">回到积分榜</button>
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
      const lit = glow?.has(sl.tile);
      const tile = tileHtml(sl.tile, { size, sideways: sl.sideways, classes: lit ? ['kimon-glow'] : [], after: lit ? kimonBeamHtml() : undefined });
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

// 立直、鸣牌、和牌的大字后面迸出去的火星：方向、飞多远、拖多长、几时迸都随机一点（style.css 的 .fx-sparks）
function fxSparksHtml(kind: string): string {
  const win = kind === 'win';
  const n = win ? 24 : kind === 'call' ? 10 : 14;
  const reach = win ? 260 : 150;
  let html = '';
  for (let i = 0; i < n; i++) {
    const a = (360 * (i + Math.random() * 0.8)) / n;
    const d = Math.round(reach * (0.55 + 0.45 * Math.random()));
    const l = Math.round((win ? 46 : 30) * (0.6 + 0.6 * Math.random()));
    const t = (0.45 + 0.35 * Math.random() + (win ? 0.2 : 0)).toFixed(2);
    const w = (Math.random() * 0.06).toFixed(2);
    html += `<i style="--a:${a.toFixed(0)}deg;--d:${d}px;--l:${l}px;--t:${t}s;--w:${w}s"></i>`;
  }
  return `<b class="fx-sparks" aria-hidden="true">${html}</b>`;
}

// 2D 初美砸牌的节奏（秒，从结算出来算起）：手牌一张隔 0.035 秒倒下（每张 0.22 秒），倒完和了牌举起来、停一下、砸下去（共 0.55 秒）。
// 和 style.css 里 .win.slam 的动画对得上
function slamStart2d(handTiles: number): number {
  return Math.max(0, handTiles - 1) * 0.035 + 0.22 + 0.05;
}
// 2D 淡的逆回旋：整排手牌在半空逆着翻滚 1 秒落下来，亮 0.45 秒，和了牌才举起来。和 style.css 里 .win.slam.whirl 的动画对得上
function whirlStart2d(): number {
  return 1 + 0.45;
}
// 和了牌砸下去以后多久开始翻里宝牌指示牌，相邻两张隔多久，一张翻多久（秒；和 style.css 里 .ura-flip 的动画对得上）
const URA_2D = { lead: 0.5, gap: 0.22, turn: 0.34 };
// 从结算里开始翻滚算起，第 k 张里宝牌指示牌（一共 n 张，杠里的那张最后翻）什么时候翻开
function uraShown2d(n: number): number {
  return whirlStart2d() + 0.55 + URA_2D.lead + Math.max(0, n - 1) * URA_2D.gap + URA_2D.turn;
}
function slamImpact2d(handTiles: number): number {
  return slamStart2d(handTiles) + 0.55;
}

// 2D：初美鸣出来的东、北中间那张上的紫色光柱（照原作：和牌一样宽，底下亮往上淡）。
// 明暗的动画按现在的时间接着放，牌桌重画时不会从头跳
const KIMON_PULSE = 2.4;
function kimonBeamHtml(): string {
  const delay = -((performance.now() / 1000) % KIMON_PULSE);
  return `<span class="kimon-beam" aria-hidden="true" style="animation-delay:${delay.toFixed(2)}s"></span>`;
}
