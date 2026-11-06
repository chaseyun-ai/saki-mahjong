import { CHARACTERS, type Character } from '../abilities/characters';
import { APPEARANCE, SCHOOLS, membersOf } from './schools';
import { SkinSlot, cutinArt, defaultCutinArt, defaultPortraitUrl, defaultPowerPortraitUrl, portraitUrl, powerPortraitUrl, setSkins, skinOf } from '../ui3d/looks';

// 素材页：页面主人在试玩页里给每个角色换头像、切入图、结算图，不用改代码。
// 图存在试玩页自己的存储里（assets），哪个格子用哪张图记在 db 的 skins/<角色 id> 里：
//   { face: { id, w, h }, riichi: { id, w, h }, ... }
// 所有人打开试玩页都读这些记录；只有能编辑这个页面的人（页面主人）能上传、换回默认。
// 不在试玩页里（本地开发）时 window.claude 不存在，全部用默认图。

interface Stored {
  id: string;
  w: number;
  h: number;
  video?: boolean;
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
  { slot: 'power', label: '能力发动头像', hint: '发动能力时的头像（比如怜演算时眼睛发光），竖图' },
  { slot: 'riichi', label: '立直切入', hint: '立直时滑进来的图，透明背景最好' },
  { slot: 'call', label: '鸣牌切入', hint: '吃碰杠时滑进来的图，不换就用“和牌切入”' },
  { slot: 'win', label: '和牌切入', hint: '荣和、自摸时滑进来的图' },
  { slot: 'ability', label: '能力发动切入', hint: '发动能力时滑进来的图（比如岭上开花、宝牌聚集、一巡先见）' },
  { slot: 'result', label: '结算图', hint: '结算画面左边的图，不换就用“和牌切入”' },
];

// 这个角色的全部格子：通用的几格，加上她单独的技能动画（Character.skillArts，比如爽的每朵云、每个神威）
function slotsOf(c: Character): { slot: SkinSlot; label: string; hint: string; skill?: boolean }[] {
  const skills = (c.skillArts ?? []).map((k) => ({
    slot: `skill-${k.id}` as SkinSlot,
    label: k.label ?? `${k.name}动画`,
    hint: k.hint ?? `发动${k.name}时放这一段，盖过“能力发动切入”。可以用 GIF 或视频（MP4、WebM，最长放 6 秒）`,
    skill: true,
  }));
  return [...SLOTS, ...skills];
}

// 技能动画格子没换图时显示的默认图：和牌的动画（天使和的和牌）用和牌切入，别的用能力发动切入
const skillKind = (slot: SkinSlot) => (slot.endsWith('-win') ? 'win' : 'ability');

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

// 视频的宽高（读不出来就当竖图）
function videoSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (w: number, h: number) => {
      URL.revokeObjectURL(url);
      resolve({ w, h });
    };
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(v.videoWidth || 3, v.videoHeight || 4);
    v.onerror = () => done(3, 4);
    v.src = url;
  });
}

let docs: Record<string, Doc> = {};
const listeners = new Set<() => void>();
let started: Promise<any> | null = null;

function apply(): void {
  const out: Parameters<typeof setSkins>[0] = {};
  for (const [id, doc] of Object.entries(docs)) {
    out[id] = {};
    for (const [slot, v] of Object.entries(doc)) if (v?.id) out[id][slot as SkinSlot] = { url: '/_blob/' + v.id, w: v.w, h: v.h, video: v.video };
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

// 上次在素材页看的是哪个角色（只是方便，存不了就算了）
const SEL_KEY = 'skin-editor-char';
function loadSel(): string | null {
  try {
    return localStorage.getItem(SEL_KEY);
  } catch {
    return null;
  }
}
function saveSel(id: string): void {
  try {
    localStorage.setItem(SEL_KEY, id);
  } catch {
    // 存不了就不存
  }
}

// 素材页：左边是按学校分组的角色名单（上面能搜名字），右边是选中角色的全部格子，两边各自滚动。
// 换了图、别人改了推过来时只重画名单和右边，名单的滚动位置、搜索框里的字都不动。电脑上可以直接把图拖到格子上
const ROLES = ['先锋', '次锋', '中坚', '副将', '大将'];
const ownCount = (c: Character) => slotsOf(c).filter(({ slot }) => docs[c.id]?.[slot]).length;
const faceImg = (id: string) => `<img src="${portraitUrl(id, 'neutral')}" alt="" onerror="this.remove()" />`;

export class SkinEditor {
  private status = '';
  private busy = false;
  private query = '';
  private sel = CHARACTERS.some((c) => c.id === loadSel()) ? loadSel()! : APPEARANCE[0].id;
  private events: [string, (e: Event) => void][] = [
    ['click', (e) => this.onClick(e)],
    ['change', (e) => this.onChange(e)],
    ['input', (e) => this.onInput(e)],
    ['dragover', (e) => this.onDrag(e as DragEvent)],
    ['dragleave', (e) => this.onDragLeave(e as DragEvent)],
    ['drop', (e) => this.onDrop(e as DragEvent)],
  ];

  constructor(
    private root: HTMLElement,
    private back: () => void,
  ) {
    listeners.add(this.refresh);
    for (const [type, f] of this.events) root.addEventListener(type, f);
    root.innerHTML = `
      <div class="skin-screen">
        <header class="skin-head">
          <button class="lab-entry" data-skin-back>← 返回</button>
          <h1>素材</h1>
          <p class="skin-status" role="status"></p>
        </header>
        <div class="skin-body">
          <nav class="skin-list" aria-label="角色">
            <div class="skin-search"><input type="search" placeholder="找角色、学校" aria-label="找角色、学校" /></div>
            <div class="skin-groups"></div>
          </nav>
          <main class="skin-detail"></main>
        </div>
      </div>`;
    this.refresh();
    // 上次看的人滚到名单里看得见的地方
    root.querySelector('.skin-item.on')?.scrollIntoView({ block: 'center', inline: 'center' });
  }

  private close(): void {
    listeners.delete(this.refresh);
    for (const [type, f] of this.events) this.root.removeEventListener(type, f);
    this.back();
  }

  private refresh = (): void => {
    this.renderList();
    this.renderDetail();
    this.renderStatus();
  };

  private renderStatus(): void {
    const el = this.root.querySelector('.skin-status');
    if (el) el.textContent = this.status;
  }

  // 左边的名单：学校一组，先锋到大将；搜索时只留名字、学校对得上的
  private renderList(): void {
    const box = this.root.querySelector('.skin-groups');
    if (!box) return;
    const q = this.query.trim().toLowerCase();
    const hit = (c: Character, school: string) => !q || c.name.includes(q) || c.id.includes(q) || school.includes(q);
    const groups = SCHOOLS.map((s) => {
      const all = membersOf(s.name);
      const shown = all.filter((c) => hit(c, s.name));
      if (!shown.length) return '';
      const n = all.reduce((sum, c) => sum + ownCount(c), 0);
      const items = shown
        .map((c) => {
          const k = ownCount(c);
          const on = c.id === this.sel;
          return `<button class="skin-item${on ? ' on' : ''}" data-skin-tab="${c.id}" style="--c:${c.color}"${on ? ' aria-current="true"' : ''}>
              <span class="skin-item-face">${faceImg(c.id)}</span>
              <span class="skin-item-name">${c.name}</span>${k ? `<span class="skin-count" title="已换 ${k} 张">${k}</span>` : ''}
            </button>`;
        })
        .join('');
      return `<section class="skin-group" style="--c:${s.color}">
          <h3 class="skin-group-head"><b>${s.short}</b><small>${s.region}</small>${n ? `<span class="skin-count" title="这个学校已换 ${n} 张">${n}</span>` : ''}</h3>
          ${items}
        </section>`;
    }).join('');
    box.innerHTML = groups || `<p class="skin-empty">没有对得上「${esc(this.query.trim())}」的角色</p>`;
  }

  // 右边：选中的人，上面是名字、学校、换了几张，下面每个格子一张图
  private renderDetail(): void {
    const box = this.root.querySelector<HTMLElement>('.skin-detail');
    const c = CHARACTERS.find((x) => x.id === this.sel);
    if (!box || !c) return;
    const school = SCHOOLS.find((s) => s.name === c.school);
    const at = school?.lineup.indexOf(c.id) ?? -1;
    const slots = slotsOf(c);
    const own = ownCount(c);
    const off = this.busy ? ' disabled' : '';
    const cells = slots
      .map(({ slot, label, hint, skill }) => {
        const mine = !!docs[c.id]?.[slot];
        const shown = this.current(c.id, slot);
        const tall = slot === 'face' || slot === 'blank' || slot === 'power';
        const media = docs[c.id]?.[slot]?.video
          ? `<video src="${shown}" muted autoplay loop playsinline></video>`
          : shown
            ? `<img src="${shown}" alt="" onerror="this.onerror=null;this.src='${this.fallback(c.id, slot)}'" />`
            : `<span class="skin-glyph">${c.name.slice(-1)}</span>`;
        const accept = skill ? [...TYPES, ...VIDEO_TYPES] : TYPES;
        return `
          <div class="skin-slot${mine ? ' own' : ''}${skill ? ' skill' : ''}" data-slot="${slot}">
            <div class="skin-img${tall ? ' tall' : ''}">${media}</div>
            <div class="skin-label">${label}${mine ? '<span class="skin-mark">已换</span>' : ''}</div>
            <div class="skin-hint">${esc(hint)}</div>
            <div class="skin-btns">
              <label class="skin-btn${this.busy ? ' off' : ''}">${skill ? '换动画' : '换图'}<input type="file" accept="${accept.join(',')}" data-skin-char="${c.id}" data-skin-slot="${slot}"${off} /></label>
              ${mine ? `<button class="skin-btn ghost" data-skin-reset="${c.id}:${slot}"${off}>恢复默认</button>` : ''}
            </div>
          </div>`;
      })
      .join('');
    const top = box.dataset.char === c.id ? box.scrollTop : 0;
    box.dataset.char = c.id;
    box.style.setProperty('--c', c.color);
    box.innerHTML = `
      <div class="skin-who">
        <span class="skin-who-face">${faceImg(c.id)}</span>
        <div class="skin-who-text">
          <h2>${c.name}</h2>
          <p>${school ? `${school.short}${at >= 0 ? ' · ' + ROLES[at] : ''} · ` : ''}${own ? `<b>已换 ${own}</b> / ${slots.length} 格` : `${slots.length} 格都是默认图`}</p>
        </div>
        <div class="skin-step">
          <button data-skin-step="-1" aria-label="上一位" title="上一位">‹</button>
          <button data-skin-step="1" aria-label="下一位" title="下一位">›</button>
        </div>
      </div>
      <p class="skin-tip">点「换图」<span class="skin-drag">或把图拖到格子上</span>就换，马上生效，打开试玩页的人都看得到；「恢复默认」换回原图。PNG、JPG、WebP、GIF 都行，透明背景用 PNG，技能动画格还能放 MP4、WebM。</p>
      <div class="skin-cells">${cells}</div>`;
    box.scrollTop = top;
  }

  private choose(id: string): void {
    if (id === this.sel) return;
    this.sel = id;
    saveSel(id);
    this.root.querySelectorAll('.skin-item.on').forEach((x) => {
      x.classList.remove('on');
      x.removeAttribute('aria-current');
    });
    const item = this.root.querySelector<HTMLElement>(`.skin-item[data-skin-tab="${id}"]`);
    item?.classList.add('on');
    item?.setAttribute('aria-current', 'true');
    item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.renderDetail();
  }

  // 这个格子现在显示哪张图
  private current(id: string, slot: SkinSlot): string {
    if (slot === 'face') return portraitUrl(id, 'neutral');
    if (slot === 'blank') return portraitUrl(id, 'surprised');
    if (slot === 'power') return powerPortraitUrl(id);
    if (slot.startsWith('skill-')) return skinOf(id, slot)?.url ?? cutinArt(id, skillKind(slot)).url;
    return cutinArt(id, slot).url;
  }

  private fallback(id: string, slot: SkinSlot): string {
    if (slot === 'face') return defaultPortraitUrl(id, 'neutral');
    if (slot === 'blank') return defaultPortraitUrl(id, 'surprised');
    if (slot === 'power') return defaultPowerPortraitUrl(id);
    return defaultCutinArt(id, slot.startsWith('skill-') ? skillKind(slot) : slot).url;
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-skin-back],[data-skin-reset],[data-skin-tab],[data-skin-step]');
    if (!el) return;
    if (el.dataset.skinBack !== undefined) {
      this.close();
      return;
    }
    if (el.dataset.skinTab) {
      this.choose(el.dataset.skinTab);
      return;
    }
    if (el.dataset.skinStep) {
      // 上一位、下一位：照名单的顺序（搜索时只在搜出来的人里走），到头了绕回去
      const shown = [...this.root.querySelectorAll<HTMLElement>('.skin-item')].map((x) => x.dataset.skinTab!);
      const list = shown.includes(this.sel) ? shown : APPEARANCE.map((c) => c.id);
      const i = list.indexOf(this.sel);
      const d = Number(el.dataset.skinStep) || 1;
      this.choose(list[(i + d + list.length) % list.length]);
      return;
    }
    const [id, slot] = el.dataset.skinReset!.split(':') as [string, SkinSlot];
    void this.save(id, slot, null);
  }

  private onChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (!input.dataset.skinChar || !input.files?.[0]) return;
    void this.save(input.dataset.skinChar, input.dataset.skinSlot as SkinSlot, input.files[0]);
  }

  private onInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (!input.closest('.skin-search')) return;
    this.query = input.value;
    this.renderList();
  }

  // 拖图进来：拖到格子上那一格亮起来，放下就换；拖到别处不让浏览器把图直接打开
  private dragging(e: DragEvent): boolean {
    return !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  }

  private onDrag(e: DragEvent): void {
    if (!this.dragging(e)) return;
    e.preventDefault();
    const slot = this.busy ? null : (e.target as HTMLElement).closest<HTMLElement>('.skin-slot');
    e.dataTransfer!.dropEffect = slot ? 'copy' : 'none';
    this.root.querySelectorAll('.skin-slot.drop').forEach((x) => x !== slot && x.classList.remove('drop'));
    slot?.classList.add('drop');
  }

  private onDragLeave(e: DragEvent): void {
    const slot = (e.target as HTMLElement).closest('.skin-slot');
    if (slot && !slot.contains(e.relatedTarget as Node | null)) slot.classList.remove('drop');
  }

  private onDrop(e: DragEvent): void {
    if (!this.dragging(e)) return;
    e.preventDefault();
    const slot = (e.target as HTMLElement).closest<HTMLElement>('.skin-slot');
    slot?.classList.remove('drop');
    const input = slot?.querySelector<HTMLInputElement>('input[type=file]');
    const file = e.dataTransfer!.files[0];
    if (!input || !file || this.busy) return;
    if (!input.accept.split(',').includes(file.type)) {
      this.status = input.accept.includes('video') ? '这一格只能放 PNG、JPG、WebP、GIF 图或 MP4、WebM 视频。' : '这一格只能放 PNG、JPG、WebP、GIF 图。';
      this.renderStatus();
      return;
    }
    void this.save(input.dataset.skinChar!, input.dataset.skinSlot as SkinSlot, file);
  }
  // 换图（file）或换回默认（null）
  private async save(id: string, slot: SkinSlot, file: File | null): Promise<void> {
    const name = CHARACTERS.find((c) => c.id === id)?.name ?? id;
    const c = CHARACTERS.find((x) => x.id === id);
    const label = (c ? slotsOf(c) : SLOTS).find((s) => s.slot === slot)?.label ?? slot;
    const assets = await assetsApi();
    const db = await connect();
    if (!assets || !db) {
      this.status = '这里换不了素材：只有页面主人在试玩页里能换。';
      this.renderStatus();
      return;
    }
    this.busy = true;
    this.status = file ? `正在上传 ${name} 的${label}……` : `正在把 ${name} 的${label}换回默认……`;
    this.refresh();
    const old = docs[id]?.[slot]?.id;
    try {
      const next: Doc = { ...(docs[id] ?? {}) };
      if (file) {
        const video = VIDEO_TYPES.includes(file.type);
        const type = video || TYPES.includes(file.type) ? file.type : 'image/png';
        let size: { w: number; h: number };
        if (video) size = await videoSize(file);
        else {
          const bmp = await createImageBitmap(file);
          size = { w: bmp.width, h: bmp.height };
          bmp.close();
        }
        const up = await assets.upload(file, { type });
        next[slot] = video ? { id: up.id, ...size, video: true } : { id: up.id, ...size };
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
            ? '这个格式用不了，图换成 PNG、JPG、WebP 或 GIF，视频换成 MP4 或 WebM。'
            : code === 'quota_or_state'
              ? '试玩页的存储满了，先把不用的图换回默认再试。'
              : `没换成功（${code ?? '图片打不开'}），过一会儿再试一次。`;
    }
    this.busy = false;
    this.refresh();
  }
}
