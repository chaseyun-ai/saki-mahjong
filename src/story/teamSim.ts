import type { Character } from '../abilities/characters';
import { riiKeys } from '../abilities/rii';
import type { BindKey } from '../abilities/types';
import { chooseAction } from '../ai/ai';
import { Game } from '../engine/game';
import { Rng } from '../engine/rng';
import { POSITIONS, TEAM_START } from '../team/team';

// 后台真打一桌团体赛：四所学校，先锋到大将各打一个半庄（Game 的 team 规则），
// 点数、剩下的立直棒、白水哩拿到的钥匙接着往下一个位置带；有队点数小于 0，整场立刻结束。
// 一点一点打（step 给一个时间预算），可以塞进浏览器空闲的时候算，不卡画面；runAll 一口气打完（测试、node 里用）。
// 种子固定：同一桌不管什么时候、分几次算，结果都一样（存档读回来重新算也一样）。
// 一个半庄电脑上大约 0.25 秒（2026-11-19 实测），一桌五个半庄一秒多。

// 一个半庄最多走这么多步（防死循环：真到了就按当时的点数算这一场打完）
const MAX_STEPS = 200000;

export interface TeamSimRecord {
  pos: number;
  seats: number[]; // 每个座位是哪一校（lineups 的下标）
  start: number[]; // 这一场开始时每校的点数（按学校下标）
  end: number[];
}

export class TeamSim {
  readonly points: number[];
  pos = 0;
  done = false;
  readonly history: TeamSimRecord[] = [];
  private rng: Rng;
  private sticks = 0;
  private keys: BindKey[][];
  private game: Game | null = null;
  private seats: number[] = [];
  private chars: Character[] = [];
  private steps = 0;

  constructor(
    readonly lineups: Character[][],
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.points = lineups.map(() => TEAM_START);
    this.keys = lineups.map(() => []);
  }

  // 现在打到哪个位置（给晋级表上写「中坚战」用）
  get label(): string {
    return this.done ? '打完了' : `${POSITIONS[this.pos]}战`;
  }

  // 打到这次的时间用完（毫秒）为止；打完了返回 true
  step(budgetMs = 8): boolean {
    const end = performance.now() + budgetMs;
    while (!this.done && performance.now() < end) this.tick(6);
    return this.done;
  }

  runAll(): number[] {
    while (!this.done) this.tick(1000);
    return this.points;
  }

  private tick(actions: number): void {
    if (!this.game) this.begin();
    const g = this.game!;
    for (let i = 0; i < actions && g.phase !== 'gameEnd' && this.steps < MAX_STEPS; i++, this.steps++) {
      if (g.phase === 'roundEnd') {
        g.nextRound();
        continue;
      }
      const s = g.waitingSeats()[0];
      g.act(s, chooseAction(g, s, this.chars[s].ai));
    }
    if (g.phase === 'gameEnd' || this.steps >= MAX_STEPS) this.finish(g);
  }

  // 这个位置开打：四校随机入座，庄家随机
  private begin(): void {
    this.seats = this.rng.shuffle([0, 1, 2, 3]);
    this.chars = this.seats.map((t) => this.lineups[t][this.pos]);
    this.steps = 0;
    this.game = new Game({
      seed: this.rng.int(2 ** 31),
      format: 'team',
      firstDealer: this.rng.int(4),
      scores: this.seats.map((t) => this.points[t]),
      riichiSticks: this.sticks,
      allies: this.seats.map((t) => this.lineups[t].map((c) => c.id)),
      keys: this.seats.map((t) => this.keys[t]),
      players: this.chars.map((c) => ({ name: c.name, ability: c.ability })),
    });
  }

  private finish(g: Game): void {
    const start = [...this.points];
    this.seats.forEach((t, s) => {
      this.points[t] = g.players[s].score;
      if (g.abilities[s]?.id === 'rii') this.keys[t].push(...riiKeys(g, s));
    });
    this.history.push({ pos: this.pos, seats: [...this.seats], start, end: [...this.points] });
    this.sticks = g.riichiSticks;
    this.game = null;
    this.pos++;
    if (this.pos >= POSITIONS.length || this.points.some((p) => p < 0)) this.done = true;
  }
}
