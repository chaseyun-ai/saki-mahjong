import { CHARACTERS } from '../abilities/characters';
import { drawEyeShot, drawFace, eyeStateAt } from './eyeDraw';
import { eyeLookOf } from './eyeLooks';
import { EyeShots } from './eyeShot';

// 睁眼特写预览（网址后面加 #eyes）：每个角色的眼睛排一排，点一个放一次；
// 上面的按钮放两个人、四个人同时发动。调 eyeLooks.ts 的参数时对着这里看

const POS = ['bottom', 'right', 'top', 'left'];

export class EyeGallery {
  private shots: EyeShots;

  constructor(root: HTMLElement, exit: () => void) {
    root.innerHTML = `<div class="eye-gallery">
      <header><button data-g="exit">← 回到游戏</button><h1>能力发动 · 睁眼特写</h1>
        <span class="eg-btns"><button data-g="1">放一个</button><button data-g="2">两个人</button><button data-g="4">四个人一起</button></span></header>
      <p>点一个人放一次。眼睛是同一个模板，每人换瞳色、瞳孔、高光、眼型（src/ui/eyeLooks.ts）。素材导入页换了「睁眼特写」的放换上的图。</p>
      <div class="eg-grid"></div><div class="eg-layer"></div></div>`;
    const grid = root.querySelector('.eg-grid')!;
    this.shots = new EyeShots(root.querySelector('.eg-layer') as HTMLElement);
    const cards = CHARACTERS.map((c) => {
      const b = document.createElement('button');
      b.className = 'eg-card';
      b.dataset.id = c.id;
      b.innerHTML = `<canvas width="320" height="100"></canvas><span>${c.name}</span>`;
      grid.appendChild(b);
      return { c, canvas: b.querySelector('canvas')! };
    });
    // 静态的睁开的样子
    for (const { c, canvas } of cards) {
      const look = eyeLookOf(c.id, c.color);
      const ctx = canvas.getContext('2d')!;
      const face = document.createElement('canvas');
      face.width = canvas.width;
      face.height = canvas.height;
      drawFace(face.getContext('2d')!, face.width, face.height, look, c.id);
      drawEyeShot(ctx, canvas.width, canvas.height, look, { ...eyeStateAt(1.4, look), flash: 0, ring: -1 }, face);
    }
    let seq = 0;
    const play = (ids: string[]) => {
      this.shots.clear();
      ids.forEach((id, i) => {
        const c = CHARACTERS.find((x) => x.id === id)!;
        const words = c.skillArts?.map((k) => k.name) ?? [];
        window.setTimeout(() => this.shots.show({ seat: i, pos: POS[i], id: c.id, name: c.name, color: c.color, word: words[0] ?? '能力发动' }), i * 140);
      });
    };
    const pick = (n: number) => {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) ids.push(CHARACTERS[(seq++ * 7) % CHARACTERS.length].id);
      return ids;
    };
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-g], .eg-card');
      if (!el) return;
      if (el.dataset.g === 'exit') {
        this.shots.clear();
        exit();
      } else if (el.dataset.g) play(pick(Number(el.dataset.g)));
      else if (el.dataset.id) play([el.dataset.id]);
    });
  }
}
