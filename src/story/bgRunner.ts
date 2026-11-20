import type { TeamSim } from './teamSim';

// 后台把别桌一点一点打完（团体赛的一桌、个人赛的一个半庄）：
// - 平时塞进浏览器空闲的时候（requestIdleCallback，每次只用剩下的空闲时间），玩家打自己那桌时牌桌照样流畅；
// - 玩家在晋级表上等结果时 hurry()：每帧多算一点（画面上没什么在动），一两秒就出来。
// 每桌打完调 onDone；stop() 以后不再算（离开全国大赛时）。

type IdleDeadline = { timeRemaining(): number };
type IdleWin = { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };

// 能放到后台算的：一点一点打（打完返回 true），label 写打到哪了。团体赛是 TeamSim，个人赛是 HanchanSim
export interface BgSim {
  step(budgetMs: number): boolean;
  readonly label: string;
}

export interface BgJob<S extends BgSim = TeamSim> {
  key: string;
  sim: S;
}

export class BgRunner<S extends BgSim = TeamSim> {
  private jobs: BgJob<S>[] = [];
  private handle: number | null = null;
  private idle = false;
  private fast = false;

  constructor(private onDone: (job: BgJob<S>) => void) {}

  // 加几桌进来（同一个 key 已经在算的不重复加）
  add(jobs: BgJob<S>[]): void {
    for (const j of jobs) if (!this.jobs.some((x) => x.key === j.key)) this.jobs.push(j);
    this.schedule();
  }

  get busy(): boolean {
    return this.jobs.length > 0;
  }

  // 还在算的桌：key → 打到哪了（「中坚战」）
  progress(): Map<string, string> {
    return new Map(this.jobs.map((j) => [j.key, j.sim.label]));
  }

  // 玩家在等：算快一点
  hurry(on = true): void {
    if (this.fast === on) return;
    this.fast = on;
    this.cancel();
    this.schedule();
  }

  stop(): void {
    this.cancel();
    this.jobs = [];
  }

  private cancel(): void {
    if (this.handle === null) return;
    const w = window as unknown as IdleWin;
    if (this.idle) w.cancelIdleCallback?.(this.handle);
    else clearTimeout(this.handle);
    this.handle = null;
  }

  private schedule(): void {
    if (this.handle !== null || !this.jobs.length) return;
    const w = window as unknown as IdleWin;
    if (!this.fast && w.requestIdleCallback) {
      this.idle = true;
      this.handle = w.requestIdleCallback((d) => this.work(Math.max(2, d.timeRemaining() - 1)), { timeout: 250 });
    } else {
      this.idle = false;
      // 着急：每次算 28 毫秒，中间让出一下给画面；不着急又没有空闲回调：每 50 毫秒算 6 毫秒
      this.handle = window.setTimeout(() => this.work(this.fast ? 28 : 6), this.fast ? 0 : 50);
    }
  }

  private work(budget: number): void {
    this.handle = null;
    const end = performance.now() + budget;
    // 几桌轮流算，谁先打完谁先出结果
    while (this.jobs.length && performance.now() < end) {
      const j = this.jobs[0];
      if (j.sim.step(Math.min(8, end - performance.now()))) {
        this.jobs.shift();
        this.onDone(j);
      } else this.jobs.push(this.jobs.shift()!);
    }
    this.schedule();
  }
}
