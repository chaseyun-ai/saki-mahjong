import { CHARACTERS } from '../abilities/characters';
import { SkinSlot, cutinArt, defaultCutinArt, defaultPortraitUrl, portraitUrl, setSkins } from '../ui3d/looks';

// 素材页：页面主人在试玩页里给每个角色换头像、切入图、结算图，不用改代码。
// 图存在试玩页自己的存储里（assets），哪个格子用哪张图记在 db 的 skins/<角色 id> 里：
//   { face: { id, w, h }, riichi: { id, w, h }, ... }
// 所有人打开试玩页都读这些记录；只有能编辑这个页面的人（页面主人）能上传、换回默认。
// 不在试玩页里（本地开发）时 window.claude 不存在，全部用默认图。

interface Stored {
  id: string;
  w: number;
  h: number;
}
type Doc = Partial<Record<SkinSlot, Stored>>;

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Runtime {
  use(name: string): Promise<any>;
}
const runtime = (): Runtime | null => (window as unknown as { claude?: Runtime }).claude ?? null;

export const SLOTS: { slot: SkinSlot; label: string; hint: string }[] = [
  { slot: 'face', label: '头像', hint: '头像框里平时的样子，竖图（宽:高 约 3:4）' },
  { slot: 'blank', label: '懵逼', hint: '放铳、终局没拿第一时的头像，竖图' },
  { slot: 'riichi', label: '立直切入', hint: '立直时滑进来的图，透明背景最好' },
  { slot: 'call', label: '鸣牌切入', hint: '吃碰杠时滑进来的图，不换就用“和牌切入”' },
  { slot: 'win', label: '和牌切入', hint: '荣和、自摸时滑进来的图' },
  { slot: 'ability', label: '能力发动切入', hint: '发动能力时滑进来的图（比如岭上开花、宝牌聚集、一巡先见）' },
  { slot: 'result', label: '结算图', hint: '结算画面左边的图，不换就用“和牌切入”' },
];

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

let docs: Record<string, Doc> = {};
const listeners = new Set<() => void>();
let started: Promise<any> | null = null;

function apply(): void {
  const out: Parameters<typeof setSkins>[0] = {};
  for (const [id, doc] of Object.entries(docs)) {
    out[id] = {};
    for (const [slot, v] of Object.entries(doc)) if (v?.id) out[id][slot as SkinSlot] = { url: '/_blob/' + v.id, w: v.w, h: v.h };
  }
  setSkins(out);
  for (const f of listeners) f();
}

// 开始读 skins 记录（只读一次，之后有人改了会自动推过来）。返回 db，用不了时是 null
function connect(): Promise<any> {
  started ??= (async () => {
    const db = await runtime()
      ?.use('db')
      .catch(() => null);
    if (!db) return null;
    db.collection('skins').onSnapshot(
      (snap: { docs: { id: string; data(): Doc | undefined }[] }) => {
        docs = {};
        for (const d of snap.docs) docs[d.id] = d.data() ?? {};
        apply();
      },
      () => {},
    );
    return db;
  })();
  return started;
}

// 换了图就通知一下（牌局里重画头像框）
export function onSkinsChange(f: () => void): void {
  listeners.add(f);
  void connect();
}

// 这个人能不能换素材（页面主人、编辑者能；其他人、本地开发不能）
let editable: Promise<any> | null = null;
function assetsApi(): Promise<any> {
  editable ??= runtime()?.use('assets').catch(() => null) ?? Promise.resolve(null);
  return editable;
}
export async function canEditSkins(): Promise<boolean> {
  return !!(await assetsApi()) && !!(await connect());
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// 素材页
export class SkinEditor {
  private status = '';
  private busy = false;

  constructor(
    private root: HTMLElement,
    private back: () => void,
  ) {
    listeners.add(this.render);
    root.addEventListener('click', this.onClick);
    root.addEventListener('change', this.onChange);
    this.render();
  }

  private close(): void {
    listeners.delete(this.render);
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('change', this.onChange);
    this.back();
  }

  // 这个格子现在显示哪张图
  private current(id: string, slot: SkinSlot): string {
    if (slot === 'face') return portraitUrl(id, 'neutral');
    if (slot === 'blank') return portraitUrl(id, 'surprised');
    return cutinArt(id, slot).url;
  }

  private fallback(id: string, slot: SkinSlot): string {
    if (slot === 'face') return defaultPortraitUrl(id, 'neutral');
    if (slot === 'blank') return defaultPortraitUrl(id, 'surprised');
    return defaultCutinArt(id, slot).url;
  }

  private render = (): void => {
    const rows = CHARACTERS.map((c) => {
      const cells = SLOTS.map(({ slot, label, hint }) => {
        const own = !!docs[c.id]?.[slot];
        const shown = this.current(c.id, slot);
        const tall = slot === 'face' || slot === 'blank';
        return `
          <div class="skin-slot${own ? ' own' : ''}">
            <div class="skin-img${tall ? ' tall' : ''}"><img src="${shown}" alt="" onerror="this.src='${this.fallback(c.id, slot)}'" /></div>
            <div class="skin-label">${label}${own ? '<span class="skin-mark">已换</span>' : ''}</div>
            <div class="skin-hint">${esc(hint)}</div>
            <div class="skin-btns">
              <label class="skin-btn">换图<input type="file" accept="${TYPES.join(',')}" data-skin-char="${c.id}" data-skin-slot="${slot}" ${this.busy ? 'disabled' : ''} /></label>
              ${own ? `<button class="skin-btn ghost" data-skin-reset="${c.id}:${slot}" ${this.busy ? 'disabled' : ''}>恢复默认</button>` : ''}
            </div>
          </div>`;
      }).join('');
      return `<div class="skin-row" style="--c:${c.color}"><div class="skin-name">${c.name}</div><div class="skin-cells">${cells}</div></div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="skin-screen">
        <div class="skin-head">
          <button class="lab-entry" data-skin-back>← 返回</button>
          <h1>素材</h1>
        </div>
        <p class="subtitle">点“换图”选一张图（PNG、JPG、WebP、GIF，透明背景用 PNG），马上生效，所有打开试玩页的人都会看到。“恢复默认”换回原来的图。</p>
        <p class="skin-status">${esc(this.status)}</p>
        ${rows}
      </div>`;
  };

  private onClick = (e: Event): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-skin-back],[data-skin-reset]');
    if (!el) return;
    if (el.dataset.skinBack !== undefined) {
      this.close();
      return;
    }
    const [id, slot] = el.dataset.skinReset!.split(':') as [string, SkinSlot];
    void this.save(id, slot, null);
  };

  private onChange = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    if (!input.dataset.skinChar || !input.files?.[0]) return;
    void this.save(input.dataset.skinChar, input.dataset.skinSlot as SkinSlot, input.files[0]);
  };

  // 换图（file）或换回默认（null）
  private async save(id: string, slot: SkinSlot, file: File | null): Promise<void> {
    const name = CHARACTERS.find((c) => c.id === id)?.name ?? id;
    const label = SLOTS.find((s) => s.slot === slot)?.label ?? slot;
    const assets = await assetsApi();
    const db = await connect();
    if (!assets || !db) {
      this.status = '这里换不了素材：只有页面主人在试玩页里能换。';
      this.render();
      return;
    }
    this.busy = true;
    this.status = file ? `正在上传 ${name} 的${label}……` : `正在把 ${name} 的${label}换回默认……`;
    this.render();
    const old = docs[id]?.[slot]?.id;
    try {
      const next: Doc = { ...(docs[id] ?? {}) };
      if (file) {
        const type = TYPES.includes(file.type) ? file.type : 'image/png';
        const bmp = await createImageBitmap(file);
        const { w, h } = { w: bmp.width, h: bmp.height };
        bmp.close();
        const up = await assets.upload(file, { type });
        next[slot] = { id: up.id, w, h };
      } else delete next[slot];
      await db.doc('skins/' + id).set(next);
      // 旧图已经没人用了，删掉省空间
      if (old) await assets.delete(old).catch(() => {});
      this.status = file ? `${name} 的${label}换好了。` : `${name} 的${label}已换回默认。`;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      this.status =
        code === 'too_large'
          ? '图太大了（最多 20 MB），压缩一下再试。'
          : code === 'unsupported_type'
            ? '这个格式用不了，换成 PNG、JPG、WebP 或 GIF。'
            : code === 'quota_or_state'
              ? '试玩页的存储满了，先把不用的图换回默认再试。'
              : `没换成功（${code ?? '图片打不开'}），过一会儿再试一次。`;
    }
    this.busy = false;
    this.render();
  }
}
