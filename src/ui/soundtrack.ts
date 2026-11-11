import type { Game, GameEvent } from '../engine/game';
import { audio, duckMusic } from './audioBus';
import { playDraw, playDrawGame, playGameStart, playMyWin, playPrompt, playRank, playTally, playTenpai, playUiTick } from './jingles';
import { installMusic, playMusic } from './music';
import type { MusicSlot } from './musicTracks';
import { waitInfo } from './waitInfo';

// 配乐：牌局走到哪，该放哪首曲子、该响哪个提示音。App 只在几个地方叫一声，规矩都在这里。
//
//   选人页                 → 选人页的曲子
//   对局                   → 东场 / 南场的曲子
//   有人立直、最后一局、
//   团体赛大将战           → 紧张的曲子，这一局打完为止
//   整场打完看名次         → 结算的曲子，先响一段名次乐句
//
// 每一局的结算不换曲子（一场下来换十几次太碎），只把音乐压低；能力演出、立直、和牌时也是压低，不切歌。

export interface Scene {
  // 自己的座位
  me: number;
  // 托管、怜的演算：不放给玩家自己听的提示（摸牌、听牌、轮到你）
  quiet: boolean;
  // 团体赛大将战
  finale: boolean;
  // 牌桌上的动画还要多久（毫秒）：摸牌声等牌飞到再响
  delay: number;
}

// 这一局的状态：有人立直了没有、自己听牌提示过没有、哪些能力已经压过一次音乐、轮到自己时上次提示的是哪几个按钮
const round = { riichi: false, tenpai: false, ducked: new Set<string>(), offered: '' };
// 刚开的一场还没响过开局乐句
let fresh = false;
let prompted = '';

// 牌桌上该放哪首：按先后试，前面的格子没有曲子就放后面的
export function tableScene(g: Game, finale: boolean, riichi: boolean): MusicSlot[] {
  const wind: MusicSlot = g.roundWind >= 1 ? 'south' : 'east';
  const other: MusicSlot = wind === 'south' ? 'east' : 'south';
  // 一局战从头到尾都是「最后一局」，不算紧张
  const tense = riichi || finale || (g.format !== 'one' && g.isLastRounds(1));
  return tense ? ['tense', wind, other] : [wind, other];
}

// 选人页（团体赛排阵、点数板也是它）
export function menuMusic(): void {
  playMusic('menu');
}

// 调试场景、晋级表这些不是游戏的页面：不放
export function stopMusic(): void {
  playMusic(null);
}

// 开了一场新的对局
export function gameMusic(g: Game, finale: boolean): void {
  newRound();
  prompted = '';
  fresh = true;
  playMusic(tableScene(g, finale, false));
  startCue();
}

function newRound(): void {
  round.riichi = false;
  round.tenpai = false;
  round.ducked.clear();
  round.offered = '';
}

function startCue(): void {
  if (!fresh) return;
  fresh = false;
  duckMusic(1.6);
  playGameStart();
}

// 牌局里的每件事都过一遍这里
export function soundtrackEvent(e: GameEvent, g: Game, s: Scene): void {
  if (e.type === 'roundStart') {
    newRound();
    playMusic(tableScene(g, s.finale, false));
    startCue();
  } else if (e.type === 'draw') {
    if (e.seat === s.me && !s.quiet) later(s.delay, () => playDraw());
  } else if (e.type === 'discard') {
    // 隐身的桃子立直：看不见也听不见，音乐不能露馅
    if (e.riichi && !round.riichi && !g.stealthed(e.seat, s.me)) {
      round.riichi = true;
      playMusic(tableScene(g, s.finale, true));
      duckMusic(1.6);
    }
    // 自己打完这张听牌了：这一局提示一次（立直有立直的声音，不用再提示）
    if (e.seat === s.me && !s.quiet && !round.tenpai && !e.riichi && !g.players[s.me].riichi && waitInfo(g, s.me).tiles.length > 0) {
      round.tenpai = true;
      later(Math.max(250, s.delay), () => playTenpai());
    }
  } else if (e.type === 'ability') {
    // 换别人牌的那种悄悄发动的不压；同一个能力一局里只压第一次（之后只出小字，不放切入）
    if (e.target !== undefined && e.target !== e.seat) return;
    const key = `${e.seat}-${e.text}`;
    if (round.ducked.has(key)) return;
    round.ducked.add(key);
    duckMusic(1.5);
  } else if (e.type === 'roundEnd') {
    if (e.result.wins.length) {
      duckMusic(3.2);
      if (!s.quiet && e.result.wins.some((w) => w.seat === s.me)) later(420, () => playMyWin());
    } else {
      duckMusic(2.4);
      playDrawGame();
    }
  }
}

// 结算画面弹出来了。整场打完：名次乐句，换成结算的曲子；一局打完：点数滚动的声音。
// staged 是新结算（点数那一页自己会叫 tallyCue），这里就不响了
export function resultMusic(g: Game, s: Scene, staged: boolean): void {
  if (g.phase === 'gameEnd') {
    const wind: MusicSlot = g.roundWind >= 1 ? 'south' : 'east';
    playMusic(['result', wind, wind === 'south' ? 'east' : 'south']);
    duckMusic(3);
    playRank(g.ranking().indexOf(s.me));
    return;
  }
  if (!staged) tallyCue(0.6, 0.7);
}

// 点数开始滚了
export function tallyCue(delay = 0.55, dur = 1.1): void {
  playTally(delay, dur);
}

// 轮到玩家拿主意（桌上弹出了吃碰杠和、立直、自摸的按钮）：响一声。同一个时刻只响一次。
// 别人打的牌能鸣、能和：每次都响。轮到自己时的立直、暗杠这些会一巡一巡地一直挂着，只在按钮变了的时候响
export function promptCue(g: Game, me: number): void {
  if (!g.waitingSeats().includes(me)) return;
  const key = `${g.seed}-${g.events.length}`;
  if (prompted === key) return;
  prompted = key;
  const legal = g.legalActions(me);
  if (g.phase === 'calls') {
    if (legal.some((a) => a.type !== 'pass')) playPrompt();
    return;
  }
  if (g.phase !== 'turn') return;
  const offered = [...new Set(legal.map((a) => (a.type === 'discard' ? (a.riichi ? 'riichi' : '') : a.type)).filter(Boolean))].sort().join();
  if (offered && offered !== round.offered) playPrompt();
  round.offered = offered;
}

function later(ms: number, f: () => void): void {
  if (ms <= 0) f();
  else setTimeout(f, ms);
}

let installed = false;

// 整页接一次：等玩家点过以后开始放音乐；点按钮响一下。main.ts 启动时叫
export function installSoundtrack(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  installMusic();
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>('button, [data-ui], [data-pick]');
      // 手牌、吃碰杠和这些牌桌上的操作有自己的声音；滑杆松手时会试音
      if (!el || el.closest('[data-tile], [data-act]') || (el as HTMLButtonElement).disabled) return;
      if (audio()) playUiTick();
    },
    true,
  );
}
