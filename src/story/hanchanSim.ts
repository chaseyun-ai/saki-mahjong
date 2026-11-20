import type { Character } from '../abilities/characters';
import { chooseAction } from '../ai/ai';
import { DEFAULT_RULES, Game, type Rules } from '../engine/game';
import { Rng } from '../engine/rng';

// 后台真打一个半庄（全国大赛个人赛用）：四个人、25000 点起、规则固定（SOLO_RULES），剩下的立直棒归第一。
// 和 TeamSim 一样一点一点打（step 给一个时间预算），可以塞进浏览器空闲的时候算；runAll 一口气打完（测试、node 里用）。
// 种子固定：入座、起家、牌山都由种子定，同一桌什么时候算、分几次算，结果都一样。

// 个人赛每一场的规则：不跟个人对局的设置走（用户 2026-11-20 定的方案 A）
export const SOLO_START = 25000;
export const SOLO_RULES: Rules = { ...DEFAULT_RULES, target: 30000, tobi: true, red: 3, kuitan: true, minHan: 1 };

// 一个半庄最多走这么多步（防死循环：真到了就按当时的点数算打完）
const MAX_STEPS = 200000;
const WINDS = ['东', '南', '西', '北'];

export class HanchanSim {
  // 终局点数，按传进来的 chars 的顺序；打完以前是 null
  scores: number[] | null = null;
  done = false;
  private game: Game | null = null;
  private readonly seats: number[]; // 每个座位坐的是 chars 里第几个
  private readonly firstDealer: number;
  private readonly gameSeed: number;
  private steps = 0;

  constructor(
    readonly chars: Character[],
    readonly seed: number,
  ) {
    const rng = new Rng(seed);
    this.seats = rng.shuffle([0, 1, 2, 3]);
    this.firstDealer = rng.int(4);
    this.gameSeed = rng.int(2 ** 31);
  }

  // 打到哪了（积分榜上写「进行中 · 南 2 局」用）
  get label(): string {
    const g = this.game;
    if (this.done) return '打完了';
    if (!g) return '东 1 局';
    return `${WINDS[g.roundWind] ?? ''} ${g.roundNumber + 1} 局`;
  }

  // 打到这次的时间用完（毫秒）为止；打完了返回 true
  step(budgetMs = 8): boolean {
    const end = performance.now() + budgetMs;
    while (!this.done && performance.now() < end) this.tick(6);
    return this.done;
  }

  runAll(): number[] {
    while (!this.done) this.tick(1000);
    return this.scores!;
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
      g.act(s, chooseAction(g, s, this.chars[this.seats[s]].ai));
    }
    if (g.phase === 'gameEnd' || this.steps >= MAX_STEPS) this.finish(g);
  }

  private begin(): void {
    const sat = this.seats.map((i) => this.chars[i]);
    this.game = new Game({
      seed: this.gameSeed,
      format: 'south',
      startScore: SOLO_START,
      rules: SOLO_RULES,
      firstDealer: this.firstDealer,
      players: sat.map((c) => ({ name: c.name, ability: c.ability })),
    });
  }

  private finish(g: Game): void {
    const out = [0, 0, 0, 0];
    this.seats.forEach((i, s) => (out[i] = g.players[s].score));
    this.scores = out;
    this.done = true;
    this.game = null;
  }
}
