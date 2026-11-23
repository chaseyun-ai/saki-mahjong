import './importer.css';
import { CHARACTERS } from '../abilities/characters';
import { SCHOOLS, membersOf } from '../ui/schools';
import { portraitUrl } from '../ui3d/looks';
import { audio } from '../ui/audioBus';
import { VOICE_MAX_SECONDS, previewVoiceBytes, stopVoices } from '../ui/voice';
import { clearCustomTrack, customTrack, setCustomTrack, slotMeta } from '../ui/musicStore';
import { MUSIC_SLOTS } from '../ui/musicTracks';
import { type Sniffed, sizeLabel, sniff } from './sniff';
import { guessSlot } from './match';
import { GLOBAL, MAX_BYTES, MAX_VOICE_BYTES, MEDIA_LABEL, MUSIC, type Entry, type SlotDef, fileOf, slotDef, slotsFor } from './slots';
import { type PackFile, buildPack, downloadZip, isZip, packName, readPack } from './pack';
import { clearMine, deleteMine, mineAvailable, mineEnabled, putMine, setMineEnabled } from './store';
import { type Placed, mineAssets, mineRecords, onCustomAssets, projectAssets, reloadMine, reloadProject } from './layers';
import { devAvailable, devDelete, devPut } from './devApi';

// 素材导入页：把图片、视频、模型、音频（一个个、整个文件夹、素材包）拖进来，照文件名对上是谁的哪一格，
// 先列一张对照表给人看、能改，确认了再存。存到哪里两种：
//   这个浏览器（store.ts，人人都能用，只影响自己）；
//   项目文件夹（只在本地开发时有，devApi.ts → scripts/vite-custom-assets.ts，写进 public/custom/）。
// 下面列出那边已经有的，能删、能整个导出成素材包。用不用全看玩家：不打开这一页，游戏照原样。

type Target = 'mine' | 'project';

interface Pending {
  n: number;
  path: string;
  size: number;
  s: Sniffed | null;
  owner: string | null;
  slot: string | null;
  why: string;
  fromPack: boolean;
  thumb: string | null;
  seconds?: number; // 音频有声的长度（只量语音、提示音）
  include: boolean;
}

interface Check {
  level: 'ok' | 'warn' | 'bad';
  text: string;
}

const WHO = CHARACTERS;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TARGET_KEY = 'saki-import-target';
const SHRINK_MAX = 2048;
const SHRINK_BYTES = 1.5 * (1 << 20);

const ownerName = (owner: string): string => (owner === GLOBAL ? '通用' : owner === MUSIC ? '背景音乐' : (WHO.find((c) => c.id === owner)?.name ?? owner));
const ownerColor = (owner: string): string => WHO.find((c) => c.id === owner)?.color ?? '#9aa7b0';
const ownerOrder = (): string[] => [GLOBAL, MUSIC, ...SCHOOLS.flatMap((s) => membersOf(s.name).map((c) => c.id))];

function loadTarget(): Target | null {
  try {
    const v = localStorage.getItem(TARGET_KEY);
    return v === 'mine' || v === 'project' ? v : null;
  } catch {
    return null;
  }
}
function saveTarget(t: Target): void {
  try {
    localStorage.setItem(TARGET_KEY, t);
  } catch {
    // 存不了就不存
  }
}

// 视频的宽高（读不出来当竖图）
function videoSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => resolve({ w: v.videoWidth || 3, h: v.videoHeight || 4 });
    v.onerror = () => resolve({ w: 3, h: 4 });
    v.src = url;
  });
}

// 音频解得出来吗、有声的那一截多长（秒）。解不出来是 null
async function audioSeconds(bytes: Uint8Array): Promise<number | null> {
  const a = audio();
  if (!a) return null;
  try {
    const buf = await a.decodeAudioData(bytes.slice().buffer);
    return buf.duration;
  } catch {
    return null;
  }
}

// 大图缩小、转成 WebP。GIF、动图不动；转出来没变小就用原图
async function shrinkImage(s: Sniffed): Promise<Sniffed> {
  if (s.media !== 'image' || s.mime === 'image/gif' || s.animated || !s.w || !s.h) return s;
  if (s.bytes.length <= SHRINK_BYTES && Math.max(s.w, s.h) <= SHRINK_MAX) return s;
  try {
    const bmp = await createImageBitmap(new Blob([s.bytes as BlobPart], { type: s.mime }));
    const k = Math.min(1, SHRINK_MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.9));
    if (!blob || blob.type !== 'image/webp' || blob.size >= s.bytes.length) return s;
    return { ...s, mime: 'image/webp', ext: 'webp', bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
  } catch {
    return s;
  }
}

// 拖进来的东西摊平成文件（文件夹一层层往下找）
type Picked = { path: string; file: File };
async function walk(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)).catch(() => null);
    if (file) out.push({ path: entry.fullPath.replace(/^\//, ''), file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej)).catch(() => [] as FileSystemEntry[]);
    if (!batch.length) break;
    for (const e of batch) await walk(e, out);
  }
}

export class AssetImporter {
  private target: Target = loadTarget() ?? 'mine';
  private dev = false;
  private canStore = true;
  private pending: Pending[] = [];
  private seq = 0;
  private busy = false;
  private shrink = true;
  private armedClear = 0;
  private off: () => void;
  private events: [string, (e: Event) => void][] = [
    ['click', (e) => this.onClick(e)],
    ['change', (e) => this.onChange(e)],
    ['dragover', (e) => this.onDrag(e as DragEvent)],
    ['dragleave', (e) => this.onDragLeave(e as DragEvent)],
    ['drop', (e) => void this.onDrop(e as DragEvent)],
  ];

  constructor(
    private root: HTMLElement,
    private back: () => void,
  ) {
    for (const [type, f] of this.events) root.addEventListener(type, f);
    this.off = onCustomAssets(() => this.renderHave());
    root.innerHTML = `
      <div class="skin-screen imp-screen">
        <header class="skin-head">
          <button class="lab-entry" data-imp-back>← 返回</button>
          <h1>素材导入</h1>
          <p class="skin-status" role="status"></p>
        </header>
        <div class="imp-body">
          <section class="imp-where"></section>
          <section class="imp-drop" data-imp-drop>
            <p class="imp-drop-title">把文件、整个文件夹或素材包（.zip）拖到这里</p>
            <p class="imp-drop-sub">头像、切入图（PNG、JPG、WebP、GIF），技能动画（GIF、MP4、WebM），3D 模型（.vrm），手模（.glb），语音、提示音、背景音乐（MP3、OGG、WAV、M4A）。
              文件名里写上角色和格子就自动对上，不用改名：比如「宫永咲-立直.png」「awai.vrm」「saki/荣和.mp3」「落桌.wav」，整个文件夹按角色分好也行。试玩页的 <code>.glb.txt</code> 也认。</p>
            <div class="imp-pick">
              <label class="skin-btn">选文件<input type="file" multiple data-imp-files /></label>
              <label class="skin-btn">选文件夹<input type="file" multiple webkitdirectory data-imp-files /></label>
              <label class="skin-btn">导入素材包<input type="file" accept=".zip,application/zip" data-imp-files /></label>
            </div>
            <label class="imp-opt"><input type="checkbox" data-imp-shrink checked /> 大图自动缩小到 ${SHRINK_MAX} 像素以内、转成 WebP（省空间；GIF 动图不动）</label>
          </section>
          <section class="imp-review" hidden></section>
          <section class="imp-have"></section>
        </div>
      </div>`;
    this.renderWhere();
    this.renderHave();
    void Promise.all([devAvailable(), mineAvailable()]).then(([dev, store]) => {
      this.dev = dev;
      this.canStore = store;
      // 第一次用：本地开发时默认写进项目，别的时候存进浏览器
      if (!loadTarget()) this.target = dev ? 'project' : 'mine';
      if (this.target === 'project' && !dev) this.target = 'mine';
      this.renderWhere();
      this.renderReview();
      this.renderHave();
    });
    void reloadProject();
  }

  private close(): void {
    for (const [type, f] of this.events) this.root.removeEventListener(type, f);
    this.off();
    stopVoices();
    for (const p of this.pending) if (p.thumb) URL.revokeObjectURL(p.thumb);
    this.back();
  }

  private say(text: string): void {
    const el = this.root.querySelector('.skin-status');
    if (el) el.textContent = text;
  }

  // ---------- 放到哪里 ----------

  private renderWhere(): void {
    const box = this.root.querySelector('.imp-where');
    if (!box) return;
    const on = mineEnabled();
    const t = (id: Target, title: string, note: string, disabled = false) =>
      `<label class="imp-target${this.target === id ? ' on' : ''}${disabled ? ' disabled' : ''}">
        <input type="radio" name="imp-where" value="${id}" data-imp-target${this.target === id ? ' checked' : ''}${disabled ? ' disabled' : ''} />
        <b>${title}</b><small>${note}</small>
      </label>`;
    box.innerHTML = `
      <h2>放到哪里</h2>
      <div class="imp-targets">
        ${t('mine', '这个浏览器', this.canStore ? '只有你在这台电脑、这个浏览器里看得到，不改游戏文件，不影响别人。清掉浏览器数据会一起清掉，换电脑前「导出素材包」带走。' : '这个浏览器不让存（无痕模式、空间不够或者被禁用了），换个窗口再试。', !this.canStore)}
        ${t('project', '项目文件夹', this.dev ? '写进项目的 <code>public/custom/</code>，提交到 Git 以后，打包、发布的游戏里人人都有。背景音乐写成 <code>public/music/</code>（不进 Git）。' : '只在本地开发时能用：在项目文件夹里双击「素材导入.bat」（或者 <code>npm run assets</code>）打开这一页。', !this.dev)}
      </div>
      ${this.target === 'mine' ? `<label class="imp-switch"><input type="checkbox" data-imp-on${on ? ' checked' : ''} /> <b>用我导入的素材</b><small>${on ? '开着：牌局里用你导入的' : '关着：牌局里是原版，导入的东西还留着，再打开就回来'}</small></label>` : ''}`;
  }

  // ---------- 读文件 ----------

  private async addFiles(files: Picked[]): Promise<void> {
    if (!files.length) return;
    this.busy = true;
    this.say(`正在读 ${files.length} 个文件……`);
    let added = 0;
    let skipped = 0;
    for (const { path, file } of files) {
      // 系统自己生成的垃圾文件
      if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path) || /(^|\/)__MACOSX\//.test(path)) continue;
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        skipped++;
        continue;
      }
      if (isZip(bytes)) {
        added += await this.addZip(path, bytes);
        continue;
      }
      await this.addOne(path, bytes);
      added++;
    }
    this.busy = false;
    this.say(added ? `读了 ${added} 个文件，看一下下面的对照表，没问题就点「导入」。${skipped ? `另有 ${skipped} 个读不出来。` : ''}` : '没读到能用的文件。');
    this.renderReview();
  }

  private async addZip(path: string, bytes: Uint8Array): Promise<number> {
    try {
      const pack = await readPack(bytes);
      for (const f of pack.files) await this.addOne(`${path} › ${f.entry.name ?? f.entry.file}`, f.data, { owner: f.owner, slot: f.slot });
      for (const e of pack.loose) await this.addOne(`${path} › ${e.name}`, e.data);
      if (pack.missing.length) this.say(`素材包里少了 ${pack.missing.length} 个文件：${pack.missing.slice(0, 3).join('、')}`);
      return pack.files.length + pack.loose.length;
    } catch (err) {
      this.say(`${path} 打不开：${err instanceof Error ? err.message : '不是能用的 zip'}`);
      return 0;
    }
  }

  private async addOne(path: string, bytes: Uint8Array, known?: { owner: string; slot: string }): Promise<void> {
    const s = sniff(bytes);
    const name = path.split(' › ').pop() ?? path;
    const guess = known ? { owner: known.owner, slot: known.slot, why: '素材包里写好的' } : s ? guessSlot(name, s.media, WHO, { vrm: s.model?.vrm != null }) : { owner: null, slot: null, why: '' };
    const p: Pending = { n: ++this.seq, path, size: bytes.length, s, owner: guess.owner, slot: guess.slot, why: guess.why, fromPack: !!known, thumb: null, include: !!s };
    if (s && (s.media === 'image' || s.media === 'video')) {
      p.thumb = URL.createObjectURL(new Blob([s.bytes as BlobPart], { type: s.mime }));
      if (s.media === 'video') Object.assign(s, await videoSize(p.thumb));
    }
    // 语音、提示音量一下多长（背景音乐太大，不解）
    if (s?.media === 'audio' && s.bytes.length <= MAX_VOICE_BYTES * 2) p.seconds = (await audioSeconds(s.bytes)) ?? undefined;
    this.pending.push(p);
  }

  // ---------- 对照表 ----------

  private checks(p: Pending): Check[] {
    const out: Check[] = [];
    const s = p.s;
    if (!s) return [{ level: 'bad', text: '认不出这个文件：不是图片、视频、模型或音频' }];
    if (!p.owner || !p.slot) return [{ level: 'warn', text: '选一下是谁的哪一格' }];
    const def = slotDef(p.owner, p.slot, WHO);
    if (!def) return [{ level: 'bad', text: '没有这一格' }];
    if (!def.media.includes(s.media)) return [{ level: 'bad', text: `「${def.label}」放不了${MEDIA_LABEL[s.media]}` }];
    if (s.bytes.length > MAX_BYTES[s.media]) out.push({ level: 'bad', text: `太大了（${MEDIA_LABEL[s.media]}最多 ${MAX_BYTES[s.media] >> 20} MB）` });
    if (def.slot === 'model' && s.model?.vrm == null) out.push({ level: 'bad', text: '不是 VRM 模型（VRoid Studio 里「导出 VRM」）' });
    if (def.slot === 'model' && s.model && s.model.vrm != null && s.model.bones < 15) out.push({ level: 'bad', text: '模型里没有人形骨骼，坐不到牌桌边' });
    if (def.slot === 'hand' && s.model?.vrm != null) out.push({ level: 'warn', text: '这是整个人的 VRM 模型，当手模多半不对' });
    if (def.group === 'voice') {
      if (p.seconds === undefined) out.push({ level: 'bad', text: '这段音频浏览器解不出来，换成 MP3 或 WAV' });
      else if (p.seconds > VOICE_MAX_SECONDS + 2) out.push({ level: 'bad', text: `太长了，一句最多 ${VOICE_MAX_SECONDS} 秒` });
    }
    if (def.group === 'sfx' && p.seconds !== undefined && p.seconds > 4) out.push({ level: 'warn', text: '提示音一般一两秒，这段有点长' });
    if (def.group === 'portrait' && s.w && s.h && s.w > s.h * 1.2) out.push({ level: 'warn', text: '头像最好是竖图，横图会被裁掉两边' });
    const dup = this.pending.find((o) => o !== p && o.include && o.owner === p.owner && o.slot === p.slot);
    if (dup && p.include) out.push({ level: 'warn', text: dup.n > p.n ? `和第 ${dup.n} 行是同一格，后面那个会盖过这个` : `和第 ${dup.n} 行是同一格，这个会盖过那个` });
    if (this.has(p.owner, p.slot)) out.push({ level: 'ok', text: '会换掉现在的' });
    if (this.target === 'project' && p.owner === MUSIC) out.push({ level: 'ok', text: `写成 public/music/${p.slot}.mp3，不进 Git` });
    if (!out.length) out.push({ level: 'ok', text: p.why || '可以导入' });
    return out;
  }

  private ready = (p: Pending): boolean => p.include && this.checks(p).every((c) => c.level !== 'bad') && !!p.owner && !!p.slot;

  private ownerOptions(p: Pending): string {
    const opt = (id: string, name: string) => `<option value="${id}"${p.owner === id ? ' selected' : ''}>${esc(name)}</option>`;
    const media = p.s?.media;
    const groups: string[] = [];
    // 不分角色的格子：手模（模型）、提示音和背景音乐（音频）
    if (media === 'model' || media === 'audio') groups.push(`<optgroup label="不分角色">${media === 'model' ? opt(GLOBAL, '通用（手模）') : opt(GLOBAL, '通用（提示音）') + opt(MUSIC, '背景音乐')}</optgroup>`);
    for (const s of SCHOOLS) groups.push(`<optgroup label="${esc(s.short)}">${membersOf(s.name).map((c) => opt(c.id, c.name)).join('')}</optgroup>`);
    return `<option value=""${p.owner ? '' : ' selected'}>选角色……</option>${groups.join('')}`;
  }

  private slotOptions(p: Pending): string {
    if (!p.owner || !p.s) return '<option value="">先选角色</option>';
    const media = p.s.media;
    const defs = slotsFor(p.owner, WHO).filter((d: SlotDef) => d.media.includes(media));
    if (!defs.length) return `<option value="">这个角色没有放${MEDIA_LABEL[media]}的格子</option>`;
    return `<option value=""${p.slot ? '' : ' selected'}>选格子……</option>${defs.map((d) => `<option value="${d.slot}"${p.slot === d.slot ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}`;
  }

  private renderReview(): void {
    const box = this.root.querySelector<HTMLElement>('.imp-review');
    if (!box) return;
    box.hidden = !this.pending.length;
    if (!this.pending.length) {
      box.innerHTML = '';
      return;
    }
    const n = this.pending.filter(this.ready).length;
    const rows = this.pending
      .map((p) => {
        const checks = this.checks(p);
        const level = !p.include ? 'skip' : checks.some((c) => c.level === 'bad') ? 'bad' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
        const s = p.s;
        const thumb = s?.media === 'video' ? `<video src="${p.thumb}" muted autoplay loop playsinline></video>` : s?.media === 'image' ? `<img src="${p.thumb}" alt="" />` : `<span class="imp-icon">${s?.media === 'model' ? '3D' : s?.media === 'audio' ? '♪' : '?'}</span>`;
        const facts = [sizeLabel(p.size), s ? `${MEDIA_LABEL[s.media]} ${s.ext.toUpperCase()}` : '', s?.w && s.h ? `${s.w}×${s.h}` : '', p.seconds !== undefined ? `${p.seconds.toFixed(1)} 秒` : '', s?.decoded ? '从 .txt 解码' : ''].filter(Boolean).join(' · ');
        const meta = s?.model && (s.model.title || s.model.author || s.model.license) ? `<div class="imp-meta">${esc([s.model.title, s.model.author && `作者 ${s.model.author}`, s.model.license && `许可 ${s.model.license}`].filter(Boolean).join(' · '))}</div>` : '';
        return `
          <div class="imp-row ${level}" data-imp-row="${p.n}" style="--c:${p.owner ? ownerColor(p.owner) : '#9aa7b0'}">
            <label class="imp-use" title="导入这一个"><input type="checkbox" data-imp-use="${p.n}"${p.include ? ' checked' : ''}${s ? '' : ' disabled'} /><span>${p.n}</span></label>
            <div class="imp-thumb">${thumb}</div>
            <div class="imp-file"><div class="imp-name" title="${esc(p.path)}">${esc(p.path)}</div><div class="imp-facts">${esc(facts)}</div>${meta}</div>
            <select data-imp-owner="${p.n}" aria-label="是谁的"${s ? '' : ' disabled'}>${this.ownerOptions(p)}</select>
            <select data-imp-slot="${p.n}" aria-label="哪一格"${s && p.owner ? '' : ' disabled'}>${this.slotOptions(p)}</select>
            <ul class="imp-checks">${checks.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join('')}</ul>
            <button class="imp-x" data-imp-drop-row="${p.n}" aria-label="从列表里拿掉" title="从列表里拿掉">×</button>
          </div>`;
      })
      .join('');
    box.innerHTML = `
      <h2>对照表 <small>${this.pending.length} 个文件，${n} 个可以导入 · 导入到${this.target === 'mine' ? '这个浏览器' : '项目文件夹'}</small></h2>
      <div class="imp-rows">${rows}</div>
      <div class="imp-actions">
        <button class="skin-btn" data-imp-go${n && !this.busy ? '' : ' disabled'}>导入 ${n} 个</button>
        <button class="skin-btn ghost" data-imp-cancel${this.busy ? ' disabled' : ''}>清空列表</button>
      </div>`;
  }

  // ---------- 存 ----------

  private has(owner: string, slot: string): boolean {
    if (owner === MUSIC) return this.target === 'mine' && !!slotMeta(slot as never)?.custom;
    return (this.target === 'mine' ? mineAssets() : projectAssets()).some((a) => a.owner === owner && a.slot === slot);
  }

  private async importAll(): Promise<void> {
    const todo = this.pending.filter(this.ready);
    if (!todo.length || this.busy) return;
    this.busy = true;
    this.renderReview();
    let ok = 0;
    const failed: string[] = [];
    for (const [i, p] of todo.entries()) {
      this.say(`正在导入 ${i + 1} / ${todo.length}：${p.path}`);
      let s = p.s!;
      if (this.shrink && s.media === 'image') s = await shrinkImage(s);
      const owner = p.owner!;
      const slot = p.slot!;
      const entry: Entry = {
        file: fileOf(owner, slot, s.ext),
        mime: s.mime,
        media: s.media,
        size: s.bytes.length,
        ...(s.w && s.h ? { w: s.w, h: s.h } : {}),
        ...(s.model?.vrm != null ? { vrm: s.model.vrm } : {}),
        name: p.path.split(/[\\/]| › /).pop(),
      };
      try {
        if (this.target === 'project') await devPut(owner, slot, entry, s.bytes);
        else if (owner === MUSIC) await setCustomTrack(slot as never, entry.name ?? '', s.bytes.slice().buffer);
        else if (!(await putMine({ owner, slot, entry, data: s.bytes.slice().buffer }))) throw new Error('浏览器不让存（空间不够？）');
        ok++;
        p.include = false;
      } catch (err) {
        failed.push(`${p.path}（${err instanceof Error ? err.message : '没存成'}）`);
      }
    }
    // 导入好的从列表里拿掉，没成的留着
    for (const p of this.pending) if (!p.include && p.thumb && todo.includes(p)) URL.revokeObjectURL(p.thumb);
    this.pending = this.pending.filter((p) => !todo.includes(p) || p.include);
    if (this.target === 'project') await reloadProject();
    else await reloadMine();
    this.busy = false;
    const where = this.target === 'mine' ? '这个浏览器' : '项目的 public/custom/';
    this.say(`${ok ? `导入了 ${ok} 个，存在${where}。${this.target === 'project' ? '提交到 Git 以后别人也有。' : ''}` : ''}${failed.length ? `没导入成：${failed.join('；')}` : ''}${this.target === 'mine' && ok && !mineEnabled() ? '（「用我导入的素材」关着，打开才看得到）' : ''}`);
    this.renderReview();
    this.renderHave();
  }

  private async remove(owner: string, slot: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.target === 'project') {
        await devDelete(owner, slot);
        await reloadProject();
      } else if (owner === MUSIC) {
        await clearCustomTrack(slot as never);
      } else {
        await deleteMine(owner, slot);
        await reloadMine();
      }
      this.say(`删掉了${ownerName(owner)}的${slotDef(owner, slot, WHO)?.label ?? slot}，换回原来的。`);
    } catch (err) {
      this.say(`没删成：${err instanceof Error ? err.message : ''}`);
    }
    this.busy = false;
    this.renderHave();
  }

  private async clearAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const list = this.haveList();
    try {
      if (this.target === 'mine') {
        await clearMine();
        for (const m of MUSIC_SLOTS) if (slotMeta(m.id).custom) await clearCustomTrack(m.id);
        await reloadMine();
      } else {
        for (const a of list) await devDelete(a.owner, a.slot);
        await reloadProject();
      }
      this.say(`${list.length} 个都删掉了，全部换回原来的。`);
    } catch (err) {
      this.say(`没删完：${err instanceof Error ? err.message : ''}`);
    }
    this.busy = false;
    this.renderHave();
  }

  // 整个导出成素材包：换电脑、换浏览器、放进项目都用它
  private async exportPack(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.say('正在打包……');
    try {
      const files: PackFile[] = [];
      if (this.target === 'mine') {
        for (const m of mineRecords()) files.push({ owner: m.owner, slot: m.slot, entry: m.entry, data: new Uint8Array(m.data) });
        for (const { id } of MUSIC_SLOTS) {
          const buf = slotMeta(id).custom ? await customTrack(id) : null;
          const s = buf ? sniff(new Uint8Array(buf)) : null;
          if (s) files.push({ owner: MUSIC, slot: id, entry: { file: fileOf(MUSIC, id, s.ext), mime: s.mime, media: 'audio', size: s.bytes.length, name: slotMeta(id).custom ?? undefined }, data: s.bytes });
        }
      } else {
        for (const a of projectAssets()) {
          const r = await fetch(a.url, { cache: 'no-store' });
          if (r.ok) files.push({ owner: a.owner, slot: a.slot, entry: a.entry, data: new Uint8Array(await r.arrayBuffer()) });
        }
      }
      if (!files.length) {
        this.say('还没有导入过东西，没什么可导出的。');
      } else {
        downloadZip(buildPack(files), packName());
        this.say(`导出了 ${files.length} 个，存成了一个 zip。在别的电脑、浏览器上用「导入素材包」放回来。`);
      }
    } catch (err) {
      this.say(`没导出成：${err instanceof Error ? err.message : ''}`);
    }
    this.busy = false;
  }

  // ---------- 已经有的 ----------

  private haveList(): Placed[] {
    const list = this.target === 'mine' ? mineAssets() : projectAssets();
    if (this.target === 'mine') {
      for (const m of MUSIC_SLOTS) {
        const meta = slotMeta(m.id);
        if (meta.custom) list.push({ owner: MUSIC, slot: m.id, entry: { file: '', mime: 'audio/*', media: 'audio', size: 0, name: meta.custom }, url: '' });
      }
    }
    return list;
  }

  private renderHave(): void {
    const box = this.root.querySelector('.imp-have');
    if (!box) return;
    const list = this.haveList();
    const where = this.target === 'mine' ? '这个浏览器里' : '项目的 public/custom/ 里';
    const by = new Map<string, Placed[]>();
    for (const a of list) by.set(a.owner, [...(by.get(a.owner) ?? []), a]);
    const count = (pred: (a: Placed) => boolean) => new Set(list.filter(pred).map((a) => a.owner)).size;
    const cover = list.length
      ? `<p class="imp-cover">3D 模型 <b>${count((a) => a.slot === 'model')}</b> / ${WHO.length} 人 · 头像 <b>${count((a) => a.slot === 'face')}</b> 人 · 切入、动画 <b>${list.filter((a) => a.entry.media !== 'audio' && a.entry.media !== 'model' && a.slot !== 'face').length}</b> 张 · 语音 <b>${list.filter((a) => a.slot.startsWith('voice-')).length}</b> 句（${count((a) => a.slot.startsWith('voice-'))} 人）</p>`
      : '';
    const cards = ownerOrder()
      .filter((o) => by.has(o))
      .map((owner) => {
        const items = by
          .get(owner)!
          .map((a) => {
            const def = slotDef(owner, a.slot, WHO);
            const media = a.entry.media === 'image' ? `<img src="${a.url}" alt="" />` : a.entry.media === 'video' ? `<video src="${a.url}" muted autoplay loop playsinline></video>` : `<span class="imp-icon">${a.entry.media === 'model' ? '3D' : '♪'}</span>`;
            const play = a.entry.media === 'audio' && a.url && owner !== MUSIC ? `<button class="imp-mini" data-imp-play="${esc(a.url)}" title="试听">▶</button>` : '';
            return `<div class="imp-item">
                <div class="imp-thumb">${media}</div>
                <div class="imp-file"><div class="imp-name">${esc(def?.label ?? a.slot)}</div><div class="imp-facts" title="${esc(a.entry.name ?? '')}">${esc([a.entry.size ? sizeLabel(a.entry.size) : '', a.entry.name ?? ''].filter(Boolean).join(' · '))}</div></div>
                ${play}<button class="imp-x" data-imp-del="${owner}:${a.slot}"${this.busy ? ' disabled' : ''} title="删掉，换回原来的" aria-label="删掉">×</button>
              </div>`;
          })
          .join('');
        const face = WHO.some((c) => c.id === owner) ? `<span class="imp-face"><img src="${portraitUrl(owner, 'neutral')}" alt="" onerror="this.remove()" /></span>` : '';
        return `<div class="imp-card" style="--c:${ownerColor(owner)}"><h3>${face}${esc(ownerName(owner))}<small>${by.get(owner)!.length}</small></h3><div class="imp-items">${items}</div></div>`;
      })
      .join('');
    box.innerHTML = `
      <h2>已导入 <small>${where}${list.length ? ` · ${list.length} 个` : ''}</small></h2>
      ${list.length ? cover + `<div class="imp-cards">${cards}</div>` : `<p class="imp-empty">${where}还没有导入的素材，游戏用的都是原来的。</p>`}
      <div class="imp-actions">
        <button class="skin-btn" data-imp-export${this.busy ? ' disabled' : ''}>导出素材包</button>
        ${list.length ? `<button class="skin-btn ghost" data-imp-clear${this.busy ? ' disabled' : ''}>${this.armedClear > Date.now() ? '再点一次，全部删掉' : '全部删掉'}</button>` : ''}
      </div>`;
  }

  // ---------- 操作 ----------

  private find(n: string | undefined): Pending | undefined {
    return this.pending.find((p) => String(p.n) === n);
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-imp-back],[data-imp-go],[data-imp-cancel],[data-imp-drop-row],[data-imp-del],[data-imp-export],[data-imp-clear],[data-imp-play]');
    if (!el) return;
    const d = el.dataset;
    if (d.impBack !== undefined) this.close();
    else if (d.impGo !== undefined) void this.importAll();
    else if (d.impCancel !== undefined) {
      for (const p of this.pending) if (p.thumb) URL.revokeObjectURL(p.thumb);
      this.pending = [];
      this.say('');
      this.renderReview();
    } else if (d.impDropRow) {
      const p = this.find(d.impDropRow);
      if (p?.thumb) URL.revokeObjectURL(p.thumb);
      this.pending = this.pending.filter((x) => x !== p);
      this.renderReview();
    } else if (d.impDel) {
      const [owner, slot] = d.impDel.split(':');
      void this.remove(owner, slot);
    } else if (d.impExport !== undefined) void this.exportPack();
    else if (d.impClear !== undefined) {
      // 点两下才删：第一下按钮变成“再点一次”，三秒内再点才真删
      if (this.armedClear > Date.now()) {
        this.armedClear = 0;
        void this.clearAll();
      } else {
        this.armedClear = Date.now() + 3000;
        this.renderHave();
        setTimeout(() => this.renderHave(), 3100);
      }
    } else if (d.impPlay) {
      void fetch(d.impPlay)
        .then((r) => r.arrayBuffer())
        .then((b) => previewVoiceBytes(new Uint8Array(b)))
        .then((ok) => ok === null && this.say('这一段放不出来。'));
    }
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement & HTMLSelectElement;
    const d = el.dataset;
    if (d.impFiles !== undefined && el.files?.length) {
      void this.addFiles([...el.files].map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file })));
      el.value = '';
    } else if (d.impTarget !== undefined) {
      this.target = el.value as Target;
      saveTarget(this.target);
      this.renderWhere();
      this.renderReview();
      this.renderHave();
    } else if (d.impOn !== undefined) {
      setMineEnabled(el.checked);
      this.renderWhere();
      void reloadMine();
      this.say(el.checked ? '牌局里用你导入的素材。' : '牌局里换回原版了，导入的东西还留着。');
    } else if (d.impShrink !== undefined) {
      this.shrink = el.checked;
    } else if (d.impUse) {
      const p = this.find(d.impUse);
      if (p) p.include = el.checked;
      this.renderReview();
    } else if (d.impOwner) {
      const p = this.find(d.impOwner);
      if (!p) return;
      p.owner = el.value || null;
      // 换了人：原来的格子新的人也有就留着，没有就照文件名重新猜一格
      if (!p.owner || !p.slot || !slotDef(p.owner, p.slot, WHO)) p.slot = p.owner && p.s ? (guessSlot(`${p.owner}/${p.path.split(' › ').pop()}`, p.s.media, WHO, { vrm: p.s.model?.vrm != null }).slot ?? null) : null;
      if (p.owner && p.slot && !slotDef(p.owner, p.slot, WHO)) p.slot = null;
      p.include = true;
      this.renderReview();
    } else if (d.impSlot) {
      const p = this.find(d.impSlot);
      if (!p) return;
      p.slot = el.value || null;
      p.include = true;
      this.renderReview();
    }
  }

  private dragging(e: DragEvent): boolean {
    return !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  }

  private onDrag(e: DragEvent): void {
    if (!this.dragging(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = this.busy ? 'none' : 'copy';
    this.root.querySelector('.imp-drop')?.classList.add('drop');
  }

  private onDragLeave(e: DragEvent): void {
    const zone = this.root.querySelector('.imp-screen');
    if (zone && !zone.contains(e.relatedTarget as Node | null)) this.root.querySelector('.imp-drop')?.classList.remove('drop');
  }

  // 整页哪里都能放：文件夹也认（一层层找下去）
  private async onDrop(e: DragEvent): Promise<void> {
    if (!this.dragging(e)) return;
    e.preventDefault();
    this.root.querySelector('.imp-drop')?.classList.remove('drop');
    if (this.busy) return;
    const items = [...(e.dataTransfer?.items ?? [])];
    const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null);
    const out: Picked[] = [];
    if (entries.length && entries.every(Boolean)) {
      for (const en of entries) await walk(en!, out);
    } else {
      for (const file of [...(e.dataTransfer?.files ?? [])]) out.push({ path: file.name, file });
    }
    await this.addFiles(out);
  }
}
