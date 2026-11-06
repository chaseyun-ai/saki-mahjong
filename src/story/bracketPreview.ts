import './bracket.css';
import { advance, type Bracket, createBracket, myOut, myTable, MY_SCHOOL, ROUNDS, retryMine, roundDone, simulateMine, simulateOthers } from './bracket';
import { bracketHtml } from './bracketView';

// 晋级表预览（网址后面加 #bracket 打开）：剧情模式还没接上，这里把整届全国大赛走一遍。
// 我校这桌先用模拟代替真比赛；以后剧情接上时，换成 reportMine(真比赛的点数)
export class BracketPreview {
  private b: Bracket;
  private fresh = new Set<string>();

  constructor(
    private root: HTMLElement,
    private exit: () => void,
  ) {
    this.b = createBracket(Date.now() >>> 0);
    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-story]')?.dataset.story;
      if (act) this.act(act);
    });
    this.render();
  }

  private act(a: string): void {
    const b = this.b;
    this.fresh.clear();
    if (a === 'exit') return this.exit();
    if (a === 'draw') this.b = createBracket((Math.random() * 2 ** 32) >>> 0);
    if (a === 'play') {
      for (const t of b.tables) if (t.round === b.round && !t.result) this.fresh.add(t.name);
      simulateMine(b);
      simulateOthers(b);
    }
    if (a === 'retry') retryMine(b);
    if (a === 'next') advance(b);
    this.render();
  }

  private status(): { text: string; buttons: [string, string][] } {
    const b = this.b;
    if (b.champion) {
      const won = b.champion === MY_SCHOOL;
      return { text: won ? '我校拿下全国冠军！' : `冠军是${b.entrants[b.champion].short}。`, buttons: [['draw', '重新抽签']] };
    }
    const t = myTable(b);
    const round = ROUNDS[b.round];
    if (!t) return { text: '我校已经出局。', buttons: [['draw', '重新抽签']] };
    if (!t.result) {
      const rivals = t.schools.filter((s) => s !== MY_SCHOOL).map((s) => b.entrants[s].short).join('、');
      return { text: `${t.name.startsWith(round) ? t.name : `${round}·${t.name}`}：我校对${rivals}。`, buttons: [['play', '打这一场（预览里先模拟）']] };
    }
    if (myOut(b)) return { text: `${round}我校第 ${t.result.order.indexOf(t.schools.indexOf(MY_SCHOOL)) + 1} 名，${b.round === ROUNDS.length - 1 ? '没能夺冠' : '没能晋级'}。看完赛后对话可以重打这一场。`, buttons: [['retry', '重打这一场']] };
    if (roundDone(b)) return { text: b.round === ROUNDS.length - 1 ? '我校赢下决赛！' : `${round}我校晋级！`, buttons: [['next', b.round === ROUNDS.length - 1 ? '颁奖' : `进入${ROUNDS[b.round + 1]}`]] };
    return { text: '', buttons: [] };
  }

  private render(): void {
    const s = this.status();
    const btns = s.buttons.map(([k, label]) => `<button class="bk-btn" data-story="${k}">${label}</button>`).join('');
    this.root.innerHTML = `<div class="story-screen bracket-screen">
      <header class="bk-top">
        <div><h1>全国高中麻将大赛 · 团体赛</h1><p>十六校 · 每桌四校前两名晋级 · 重打 ${this.b.retries} 次</p></div>
        <button class="bk-btn ghost" data-story="exit">返回</button>
      </header>
      ${bracketHtml(this.b, this.fresh)}
      <footer class="bk-bar"><span>${s.text}</span><div>${btns}</div></footer>
    </div>`;
  }
}
