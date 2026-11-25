import { CHARACTERS } from '../abilities/characters';
import { importEyes } from '../assets/eyeImport';
import { onCustomAssets } from '../assets/layers';
import { type Target, importTarget, placedIn, putImage, removeImage } from '../assets/quickPut';
import { mineEnabled } from '../assets/store';
import { skinOf } from '../ui3d/looks';
import { drawEyeShot, drawFace, eyeStateAt } from './eyeDraw';
import { eyeLookOf } from './eyeLooks';
import { EyeShots } from './eyeShot';

// 睁眼特写预览（网址后面加 #eyes）：每个角色的眼睛排一排，点一个放一次；
// 上面的按钮放两个人、四个人同时发动。调 eyeLooks.ts 的参数时对着这里看。
// 每个人下面「导入头像图」：选一张头像图（或者用现有的头像、立绘）框住眼睛裁好，就换成这张（eyeImport.ts），
// 存到素材导入页选的地方（这个浏览器 / 项目文件夹）；「换回现画」删掉换上的

const POS = ['bottom', 'right', 'top', 'left'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class EyeGallery {
  private shots: EyeShots;
  private target: Target = 'mine';
  private busy = false;
  private off: () => void;

  constructor(
    private root: HTMLElement,
    exit: () => void,
  ) {
    root.innerHTML = `<div class="eye-gallery">
      <header><button data-g="exit">← 回到游戏</button><h1>能力发动 · 睁眼特写</h1>
        <span class="eg-btns"><button data-g="1">放一个</button><button data-g="2">两个人</button><button data-g="4">四个人一起</button></span>
        <a class="eg-link" href="#assets">素材导入页 ›</a></header>
      <p>点一个人放一次。眼睛是同一个模板，每人换瞳色、瞳孔、高光、眼型（src/ui/eyeLooks.ts）。
        想用动画里的样子：点下面的<b>「导入头像图」</b>，选一张头像图（或者直接用这个人现有的头像、立绘），框住两只眼睛裁好就换上。<span class="eg-where"></span></p>
      <p class="eg-status" role="status"></p>
      <div class="eg-grid"></div><div class="eg-layer"></div></div>`;
    const grid = root.querySelector('.eg-grid')!;
    this.shots = new EyeShots(root.querySelector('.eg-layer') as HTMLElement);
    grid.innerHTML = CHARACTERS.map(
      (c) => `<div class="eg-item" data-item="${c.id}" style="--c:${esc(c.color)}">
        <button class="eg-card" data-id="${c.id}"><canvas width="320" height="100"></canvas><span>${esc(c.name)}</span></button>
        <div class="eg-acts"></div>
      </div>`,
    ).join('');
    for (const c of CHARACTERS) this.paint(c.id);
    void importTarget().then((t) => {
      this.target = t;
      const where = root.querySelector('.eg-where');
      if (where) where.textContent = `换上的存在${t === 'mine' ? '这个浏览器' : '项目文件夹（public/custom）'}，和素材导入页一样。`;
      this.allActs();
    });
    // 素材换了（这里导入的、别的页面改的）：重画眼睛和按钮
    this.off = onCustomAssets(() => {
      for (const c of CHARACTERS) this.paint(c.id);
      this.allActs();
    });
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
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-g], .eg-card, [data-g-face], [data-g-reset]');
      if (!el) return;
      if (el.dataset.g === 'exit') {
        this.shots.clear();
        this.off();
        exit();
      } else if (el.dataset.g) play(pick(Number(el.dataset.g)));
      else if (el.dataset.gFace) void this.importFor(el.dataset.gFace);
      else if (el.dataset.gReset) void this.reset(el.dataset.gReset);
      else if (el.dataset.id) play([el.dataset.id]);
    });
    root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.gPick && t.files?.[0]) {
        void this.importFor(t.dataset.gPick, t.files[0]);
        t.value = '';
      }
    });
  }

  private say(text: string): void {
    const p = this.root.querySelector('.eg-status');
    if (p) p.textContent = text;
  }

  // 静态的睁开的样子：换了图就画换上的图（铺满，和格子里一样），没换画模板
  private paint(id: string): void {
    const c = CHARACTERS.find((x) => x.id === id)!;
    const canvas = this.root.querySelector<HTMLCanvasElement>(`.eg-card[data-id="${id}"] canvas`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const own = skinOf(id, 'eyes');
    if (own && !own.video) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const s = Math.max(canvas.width / img.width, canvas.height / img.height);
        ctx.drawImage(img, (canvas.width - img.width * s) / 2, (canvas.height - img.height * s) / 2, img.width * s, img.height * s);
      };
      img.src = own.url;
      return;
    }
    const look = eyeLookOf(c.id, c.color);
    const face = document.createElement('canvas');
    face.width = canvas.width;
    face.height = canvas.height;
    drawFace(face.getContext('2d')!, face.width, face.height, look, c.id);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawEyeShot(ctx, canvas.width, canvas.height, look, { ...eyeStateAt(1.4, look), flash: 0, ring: -1 }, face);
  }

  // 每个人下面的按钮：导入头像图（选文件）、用现有的头像（直接开裁剪框）、换回现画（换过才有）
  private acts(id: string): void {
    const box = this.root.querySelector(`.eg-item[data-item="${id}"] .eg-acts`);
    if (!box) return;
    const own = placedIn(this.target, id, 'eyes');
    const dis = this.busy ? ' disabled' : '';
    box.innerHTML = `<label class="eg-btn main"${this.busy ? ' aria-disabled="true"' : ''}>导入头像图<input type="file" accept="image/*" data-g-pick="${id}"${dis} /></label>
      <button class="eg-btn" data-g-face="${id}"${dis} title="不选文件，直接在这个人现有的头像、立绘上框">用现有头像</button>
      ${own ? `<button class="eg-btn ghost" data-g-reset="${id}"${dis} title="删掉换上的，回到游戏现画的眼睛">换回现画</button>` : ''}`;
  }

  private async importFor(id: string, file?: File): Promise<void> {
    if (this.busy) return;
    const c = CHARACTERS.find((x) => x.id === id)!;
    const save = async (slot: 'eyes' | 'face', bytes: Uint8Array, name: string) => {
      try {
        await putImage(this.target, id, slot, bytes, name);
        return true;
      } catch (err) {
        this.say(`${c.name}${slot === 'eyes' ? '的睁眼特写' : '的头像'}没存成：${err instanceof Error ? err.message : ''}`);
        return false;
      }
    };
    this.busy = true;
    let done: ('eyes' | 'face')[] = [];
    try {
      done = await importEyes(id, this.target, save, file);
    } finally {
      this.busy = false;
      this.allActs();
    }
    if (!done.length) return;
    this.paint(id);
    const off = this.target === 'mine' && !mineEnabled() ? '。素材导入页上「用我导入的素材」关着，打开才在牌局里看得到' : '';
    this.say(`${c.name}${done.includes('face') ? '的睁眼特写和头像都' : '的睁眼特写'}换上了，点一下上面的眼睛放一次看看${off}。`);
  }

  private async reset(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const c = CHARACTERS.find((x) => x.id === id)!;
    try {
      await removeImage(this.target, id, 'eyes');
      this.say(`${c.name}换回游戏现画的眼睛了。`);
    } catch (err) {
      this.say(`没删成：${err instanceof Error ? err.message : ''}`);
    }
    this.busy = false;
    this.paint(id);
    this.allActs();
  }

  private allActs(): void {
    for (const c of CHARACTERS) this.acts(c.id);
  }
}
