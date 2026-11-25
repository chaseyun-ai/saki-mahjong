import './importer.css';
import { CHARACTERS } from '../abilities/characters';
import { SCHOOLS, membersOf } from '../ui/schools';
import { defaultCutinArt, defaultPortraitUrl, defaultPowerPortraitUrl, portraitUrl } from '../ui3d/looks';
import { audio } from '../ui/audioBus';
import { VOICE_MAX_SECONDS, previewVoiceBytes, stopVoices } from '../ui/voice';
import { clearCustomTrack, customTrack, setCustomTrack, slotMeta } from '../ui/musicStore';
import { MUSIC_SLOTS, type MusicSlot, builtinUrl } from '../ui/musicTracks';
import { hasBuiltin } from '../ui/music';
import { playCall, playChime, playClick, playRiichi, playWin } from '../ui/sound';
import { type SfxName, withSynthSfx } from '../ui/customSfx';
import { type Sniffed, sizeLabel, sniff } from './sniff';
import { guessSlot } from './match';
import { eyeTemplateUrl } from '../ui/eyeShot';
import { GLOBAL, MAX_BYTES, MAX_VOICE_BYTES, MEDIA_LABEL, MUSIC, type Entry, type SlotDef, fileOf, slotDef, slotsFor } from './slots';
import { type PackFile, buildPack, downloadZip, isZip, packName, readPack } from './pack';
import { clearMine, deleteMine, mineAvailable, mineEnabled, putMine, setMineEnabled } from './store';
import { type Placed, mineAssets, mineRecords, onCustomAssets, projectAssets, reloadMine, reloadProject } from './layers';
import { devAvailable, devDelete, devMusic, devPut } from './devApi';
import { type CropSpec, KINDS, type Kind, PLAIN_CROP, checklistCsv, cropOf, kindAmount, kindCount, kindInfo, kindOf, ownersOfKind, ratioWarn, slotGuide, slotsOfKind, summary } from './guide';
import { type CropOptions, type CropResult, type CropSource, canCrop, cropImage, croppedName } from './cropper';
import { importEyes } from './eyeImport';
import { avatarSources, entryOf } from './quickPut';

// 素材导入页。从上到下：
//   放到哪里：这个浏览器（store.ts，人人都能用，只影响自己），或者项目文件夹（只在本地开发时有，devApi.ts →
//            scripts/vite-custom-assets.ts，写进 public/custom/）；
//   一共能换这些：八类素材各一张卡片，写着用在哪、要几个、什么规格、已经换了几个（说明的字在 guide.ts）；
//   逐个格子看：左边角色名单（带进度），右边这个角色的每一格，现在用的是什么（原版的图能看、声音能试听），
//              点「放进来」或者把文件拖到格子上就换上；图先弹出裁剪框（cropper.ts）按格子的比例裁，也可以不裁；
//              换上的图能再裁；「睁眼特写」那格能直接拿头像图框住眼睛裁（eyeImport.ts）；
//   一次放很多：文件、整个文件夹、素材包拖进来，照文件名对上是谁的哪一格，先列一张对照表给人看、能改（图能裁），确认了再存。
// 用不用全看玩家：不打开这一页，游戏照原样。

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
  cropped?: boolean; // 在对照表里裁过
}

interface Check {
  level: 'ok' | 'warn' | 'bad';
  text: string;
}

const WHO = CHARACTERS;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TARGET_KEY = 'saki-import-target';
const SEL_KEY = 'saki-import-sel';
const KIND_KEY = 'saki-import-kind';
const SHRINK_MAX = 2048;
const SHRINK_BYTES = 1.5 * (1 << 20);

const ownerName = (owner: string): string => (owner === GLOBAL ? '通用' : owner === MUSIC ? '背景音乐' : (WHO.find((c) => c.id === owner)?.name ?? owner));
const ownerColor = (owner: string): string => WHO.find((c) => c.id === owner)?.color ?? '#9aa7b0';
const ownerOrder = (): string[] => [GLOBAL, MUSIC, ...SCHOOLS.flatMap((s) => membersOf(s.name).map((c) => c.id))];
const keyOf = (owner: string, slot: string) => `${owner}:${slot}`;
// 状态栏上说哪一格：宫永咲「头像」、背景音乐「对局 · 东场」、落桌声
function slotName(owner: string, slot: string): string {
  if (owner === MUSIC) return `背景音乐「${MUSIC_SLOTS.find((m) => m.id === slot)?.name ?? slot}」`;
  const label = slotDef(owner, slot, WHO)?.label ?? slot;
  return owner === GLOBAL ? label : `${ownerName(owner)}「${label}」`;
}
const UNIT: Record<Kind, string> = { portrait: '张', cutin: '张', skill: '段', model: '个', voice: '句', sfx: '个', music: '首', hand: '个' };
const SFX_SYNTH: Record<SfxName, () => void> = { click: () => playClick(), call: () => playCall(), riichi: () => playRiichi(), win: () => playWin(), chime: () => playChime() };

function loadKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function saveKey(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 存不了就不存
  }
}
function loadTarget(): Target | null {
  const v = loadKey(TARGET_KEY);
  return v === 'mine' || v === 'project' ? v : null;
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

function downloadText(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
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
  // 逐个格子看：选中的是谁（角色 id、GLOBAL、MUSIC），只看哪一类（null 是全部）
  private sel: string = ownerOrder().includes(loadKey(SEL_KEY) ?? '') ? loadKey(SEL_KEY)! : ownerOrder()[2];
  private kind: Kind | null = KINDS.some((k) => k.id === loadKey(KIND_KEY)) ? (loadKey(KIND_KEY) as Kind) : null;
  private lastChar = this.sel;
  // 格子上放文件以后的那一句（换上了 / 为什么没放进去）
  private slotMsg = new Map<string, Check>();
  // 背景音乐：项目的 public/music 里有哪几首（本地开发时问开发服务器）、发布的网页里自带的有哪几首
  private projectMusic = new Set<string>();
  private builtinMusic = new Set<string>();
  // 背景音乐试听（一次只放一首）
  private player: { el: HTMLAudioElement; key: string; url: string | null } | null = null;
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
          <p class="imp-intro">不导入任何东西，游戏照样能玩。这一页先列出能换的八类素材：<b>用在哪、要几个、什么规格</b>；再往下一个角色一个角色地看每一格<b>现在用的是什么</b>，
            点格子上的「放进来」或者把文件拖到格子上就换上。手上已经有一大堆文件，拖到最下面「一次放很多」。</p>
          <section class="imp-where"></section>
          <section class="imp-kinds"></section>
          <section class="imp-browse"></section>
          <section class="imp-bulk">
            <h2>一次放很多 <small>文件、整个文件夹、素材包（.zip）</small></h2>
            <div class="imp-drop" data-imp-drop>
              <p class="imp-drop-title">拖到这里（拖到这一页哪里都行）</p>
              <div class="imp-pick">
                <label class="skin-btn">选文件<input type="file" multiple data-imp-files /></label>
                <label class="skin-btn">选文件夹<input type="file" multiple webkitdirectory data-imp-files /></label>
                <label class="skin-btn">导入素材包<input type="file" accept=".zip,application/zip" data-imp-files /></label>
              </div>
              <label class="imp-opt"><input type="checkbox" data-imp-shrink checked /> 大图自动缩小到 ${SHRINK_MAX} 像素以内、转成 WebP（省空间；GIF 动图不动）</label>
            </div>
            <div class="imp-naming">
              <p><b>文件名怎么起：</b>写上<b>角色名</b>和<b>格子名</b>就自动对上，不用一模一样。最省事的是按角色分文件夹，文件名照每一格上灰色的那行写（「下载完整清单」里每一格都列了）：</p>
              <ul>
                <li><code>大星淡/头像.png</code>、<code>大星淡/和牌切入.png</code>、<code>大星淡/3D模型.vrm</code>、<code>大星淡/语音-立直.mp3</code></li>
                <li><code>提示音/落桌声.wav</code>、<code>背景音乐/对局-东场.mp3</code>、<code>手模.glb</code></li>
                <li>也认 <code>awai-face.png</code>、<code>宫永咲_立直.png</code> 这样的写法，和试玩页导出的 <code>.glb.txt</code></li>
              </ul>
              <p>放进来以后先出一张对照表，认错了可以在下拉框里改，确认了再点「导入」。</p>
            </div>
          </section>
          <section class="imp-review" hidden></section>
        </div>
      </div>`;
    this.renderWhere();
    this.renderHave();
    void Promise.all([devAvailable(), mineAvailable()]).then(async ([dev, store]) => {
      this.dev = dev;
      this.canStore = store;
      // 第一次用：本地开发时默认写进项目，别的时候存进浏览器
      if (!loadTarget()) this.target = dev ? 'project' : 'mine';
      if (this.target === 'project' && !dev) this.target = 'mine';
      this.renderWhere();
      this.renderReview();
      this.renderHave();
      await this.loadMusic();
    });
    void reloadProject();
  }

  private close(): void {
    for (const [type, f] of this.events) this.root.removeEventListener(type, f);
    this.off();
    stopVoices();
    this.stopPlayer();
    for (const p of this.pending) if (p.thumb) URL.revokeObjectURL(p.thumb);
    this.back();
  }

  private say(text: string): void {
    const el = this.root.querySelector('.skin-status');
    if (el) el.textContent = text;
  }

  // 背景音乐现在有哪几首：本地开发时问开发服务器 public/music 里有什么，发布的网页里一首首问在不在
  private async loadMusic(): Promise<void> {
    if (this.dev) this.projectMusic = new Set(await devMusic());
    else this.builtinMusic = new Set((await Promise.all(MUSIC_SLOTS.map(async (m) => ((await hasBuiltin(m.id)) ? m.id : null)))).filter((x): x is MusicSlot => !!x));
    this.renderHave();
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
      <h2>放到哪里 <small>下面的进度、「已换」都是说这里的</small></h2>
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
    if (added) this.root.querySelector('.imp-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  private async makePending(path: string, bytes: Uint8Array, known?: { owner: string; slot: string; why?: string }): Promise<Pending> {
    const s = sniff(bytes);
    const name = path.split(' › ').pop() ?? path;
    const guess = known ? { owner: known.owner, slot: known.slot, why: known.why ?? '素材包里写好的' } : s ? guessSlot(name, s.media, WHO, { vrm: s.model?.vrm != null }) : { owner: null, slot: null, why: '' };
    const p: Pending = { n: ++this.seq, path, size: bytes.length, s, owner: guess.owner, slot: guess.slot, why: guess.why, fromPack: !!known, thumb: null, include: !!s };
    if (s && (s.media === 'image' || s.media === 'video')) {
      p.thumb = URL.createObjectURL(new Blob([s.bytes as BlobPart], { type: s.mime }));
      if (s.media === 'video') Object.assign(s, await videoSize(p.thumb));
    }
    // 语音、提示音量一下多长（背景音乐太大，不解）
    if (s?.media === 'audio' && s.bytes.length <= MAX_VOICE_BYTES * 2) p.seconds = (await audioSeconds(s.bytes)) ?? undefined;
    return p;
  }

  private async addOne(path: string, bytes: Uint8Array, known?: { owner: string; slot: string }): Promise<void> {
    this.pending.push(await this.makePending(path, bytes, known));
  }

  // 格子上那一句（换上了 / 为什么没放进去）
  private tell(key: string, c: Check): void {
    this.slotMsg.set(key, c);
    this.renderHave();
  }

  // 裁剪框：比例、大小照这一格（cropOf）
  private crop(owner: string, d: SlotDef, sources: CropSource[], more: Partial<CropOptions> = {}): Promise<CropResult | null> {
    const spec: CropSpec = cropOf(d) ?? PLAIN_CROP;
    return cropImage({
      title: `裁一下：${slotName(owner, d.slot)}`,
      hint: spec.hint,
      sources,
      ratios: spec.ratios,
      long: spec.long,
      focusY: spec.focusY,
      look: spec.look,
      color: ownerColor(owner),
      ...more,
    });
  }

  // 点格子上的「放进来」、或者把文件拖到格子上：静态图先裁（可以不裁），再放进这一格（有问题就在格子上说，不放）
  private async putOne(owner: string, slot: string, file: File): Promise<void> {
    if (this.busy) return;
    const key = keyOf(owner, slot);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return this.tell(key, { level: 'bad', text: '读不出这个文件' });
    }
    if (isZip(bytes)) return this.tell(key, { level: 'bad', text: '这是素材包（zip），拖到最下面「一次放很多」那里' });
    let name = file.name;
    const def = slotDef(owner, slot, WHO);
    const s = sniff(bytes);
    if (def && cropOf(def) && s?.media === 'image' && canCrop(s.mime, s.animated)) {
      const url = URL.createObjectURL(file);
      // 睁眼特写：下面一排还列上这个人现有的头像、立绘，可以改用它们
      const sources: CropSource[] = [{ label: '你选的图', url, name, file }, ...(slot === 'eyes' ? avatarSources(owner, this.target) : [])];
      const r = await this.crop(owner, def, sources, { skip: '不裁，原图放进去' });
      URL.revokeObjectURL(url);
      if (!r) return this.say(`${slotName(owner, slot)}没换：裁剪取消了。`);
      const got = await this.bytesOf(r);
      if (!got) return;
      ({ bytes, name } = got);
    }
    await this.putBytes(owner, slot, bytes, name);
  }

  private async bytesOf(r: CropResult): Promise<{ bytes: Uint8Array; name: string } | null> {
    if (r.kind === 'crop') return { bytes: new Uint8Array(await r.blob.arrayBuffer()), name: r.name };
    return r.from.file ? { bytes: new Uint8Array(await r.from.file.arrayBuffer()), name: r.from.file.name } : null;
  }

  // 换上的图再裁一下：在现在换上的那张上重新挑，存回同一格
  private async recrop(owner: string, slot: string): Promise<void> {
    const d = slotDef(owner, slot, WHO);
    const p = this.placed().get(keyOf(owner, slot));
    if (this.busy || !d || !p || p.entry.media !== 'image') return;
    const r = await this.crop(owner, d, [{ label: '现在换上的', url: p.url, name: p.entry.name ?? p.entry.file }], { ok: '裁好了，存回去' });
    if (r?.kind !== 'crop') return;
    await this.putBytes(owner, slot, new Uint8Array(await r.blob.arrayBuffer()), r.name);
  }

  // 睁眼特写「用头像图裁」：现有的头像、立绘，或者换一张图，框住眼睛（eyeImport.ts）
  private async eyesFromAvatar(owner: string): Promise<void> {
    if (this.busy) return;
    const done = await importEyes(owner, this.target, (slot, bytes, name) => this.putBytes(owner, slot, bytes, name));
    if (done.length > 1) this.say(`${ownerName(owner)}的睁眼特写和头像都换上了。`);
  }

  // 放进这一格（格子上放、裁好的都走这里）。返回存成了没有
  private async putBytes(owner: string, slot: string, bytes: Uint8Array, name: string): Promise<boolean> {
    const key = keyOf(owner, slot);
    const p = await this.makePending(name, bytes, { owner, slot, why: '放进这一格' });
    const checks = this.checks(p);
    const bad = checks.find((c) => c.level === 'bad');
    if (bad) {
      if (p.thumb) URL.revokeObjectURL(p.thumb);
      this.say(`${slotName(owner, slot)}没放进去：${bad.text}`);
      this.tell(key, bad);
      return false;
    }
    const warn = checks.find((c) => c.level === 'warn');
    const { ok, failed } = await this.store([p]);
    if (p.thumb) URL.revokeObjectURL(p.thumb);
    // 存的时候对照表的按钮暂时停用了，放好了恢复
    this.renderReview();
    const where = this.target === 'mine' ? '这个浏览器' : '项目文件夹';
    this.say(ok ? `${slotName(owner, slot)}换上了：${name}（存在${where}）${this.target === 'mine' && !mineEnabled() ? '。「用我导入的素材」关着，打开才看得到' : ''}` : `没放进去：${failed.join('；')}`);
    // 换上了不用再说（格子上已经写着换上的文件），只留要注意的
    if (ok && !warn) this.slotMsg.delete(key);
    this.tell(key, ok ? (warn ?? { level: 'ok', text: '' }) : { level: 'bad', text: failed[0] ?? '没存成' });
    return !!ok;
  }

  // 对照表里裁一张：裁好的换掉这一行的文件（还没导入）
  private async cropRow(n: string): Promise<void> {
    const p = this.find(n);
    if (this.busy || !p?.s || !p.thumb) return;
    const d = p.owner && p.slot ? slotDef(p.owner, p.slot, WHO) : undefined;
    const spec = (d && cropOf(d)) ?? PLAIN_CROP;
    const base = p.path.split(' › ').pop()?.split(/[\\/]/).pop() ?? p.path;
    const r = await cropImage({
      title: `裁一下：${d && p.owner ? slotName(p.owner, d.slot) : base}`,
      hint: spec.hint,
      sources: [{ label: '这一张', url: p.thumb, name: base }],
      ratios: spec.ratios,
      long: spec.long,
      focusY: spec.focusY,
      look: spec.look,
      color: p.owner ? ownerColor(p.owner) : undefined,
      ok: '裁好了',
    });
    if (r?.kind !== 'crop' || !this.pending.includes(p)) return;
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    const s = sniff(bytes);
    if (!s) return;
    URL.revokeObjectURL(p.thumb);
    p.s = s;
    p.size = bytes.length;
    p.thumb = URL.createObjectURL(r.blob);
    p.cropped = true;
    p.include = true;
    this.renderReview();
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
    const off = s.media === 'image' && s.w && s.h ? ratioWarn(def, s.w, s.h) : null;
    if (off) out.push({ level: 'warn', text: canCrop(s.mime, s.animated) ? `${off}，点「裁剪」自己挑裁哪里` : off });
    if ((def.group === 'portrait' || def.group === 'cutin') && s.w && s.h && Math.max(s.w, s.h) < (def.group === 'portrait' ? 300 : 700)) out.push({ level: 'warn', text: `图有点小（${s.w}×${s.h}），放大了会糊` });
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
        const facts = [sizeLabel(p.size), s ? `${MEDIA_LABEL[s.media]} ${s.ext.toUpperCase()}` : '', s?.w && s.h ? `${s.w}×${s.h}` : '', p.cropped ? '裁过' : '', p.seconds !== undefined ? `${p.seconds.toFixed(1)} 秒` : '', s?.decoded ? '从 .txt 解码' : ''].filter(Boolean).join(' · ');
        // 静态图能裁：比例照对上的那一格
        const cut = s?.media === 'image' && canCrop(s.mime, s.animated) ? `<button class="imp-cut" data-imp-crop-row="${p.n}"${this.busy ? ' disabled' : ''} title="在这张图上框出要的部分">裁剪</button>` : '';
        const meta = s?.model && (s.model.title || s.model.author || s.model.license) ? `<div class="imp-meta">${esc([s.model.title, s.model.author && `作者 ${s.model.author}`, s.model.license && `许可 ${s.model.license}`].filter(Boolean).join(' · '))}</div>` : '';
        return `
          <div class="imp-row ${level}" data-imp-row="${p.n}" style="--c:${p.owner ? ownerColor(p.owner) : '#9aa7b0'}">
            <label class="imp-use" title="导入这一个"><input type="checkbox" data-imp-use="${p.n}"${p.include ? ' checked' : ''}${s ? '' : ' disabled'} /><span>${p.n}</span></label>
            <div class="imp-thumb">${thumb}${cut}</div>
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

  // 现在选的那一层（这个浏览器 / 项目文件夹）里换过的，照“主人:格子”查。背景音乐不在里面，另外看
  private placed(): Map<string, Placed> {
    return new Map((this.target === 'mine' ? mineAssets() : projectAssets()).map((a) => [keyOf(a.owner, a.slot), a]));
  }

  private musicHas(slot: string, target = this.target): boolean {
    return target === 'mine' ? !!slotMeta(slot as MusicSlot)?.custom : this.projectMusic.has(slot);
  }

  private has(owner: string, slot: string, map?: Map<string, Placed>): boolean {
    if (owner === MUSIC) return this.musicHas(slot);
    return (map ?? this.placed()).has(keyOf(owner, slot));
  }

  // 一批存进去（对照表的「导入」、格子上放一个都走这里）
  private async store(todo: Pending[]): Promise<{ ok: number; failed: string[] }> {
    this.busy = true;
    this.renderReview();
    let ok = 0;
    let music = false;
    const failed: string[] = [];
    for (const [i, p] of todo.entries()) {
      if (todo.length > 1) this.say(`正在导入 ${i + 1} / ${todo.length}：${p.path}`);
      let s = p.s!;
      if (this.shrink && s.media === 'image') s = await shrinkImage(s);
      const owner = p.owner!;
      const slot = p.slot!;
      const base = p.path.split(/[\\/]| › /).pop() ?? '';
      const entry: Entry = entryOf(owner, slot, s, p.cropped ? croppedName(base, s.ext) : base);
      try {
        if (this.target === 'project') await devPut(owner, slot, entry, s.bytes);
        else if (owner === MUSIC) await setCustomTrack(slot as MusicSlot, entry.name ?? '', s.bytes.slice().buffer);
        else if (!(await putMine({ owner, slot, entry, data: s.bytes.slice().buffer }))) throw new Error('浏览器不让存（空间不够？）');
        ok++;
        if (owner === MUSIC) music = true;
        p.include = false;
      } catch (err) {
        failed.push(`${p.path}（${err instanceof Error ? err.message : '没存成'}）`);
      }
    }
    if (this.target === 'project') await reloadProject();
    else await reloadMine();
    if (music && this.target === 'project') this.projectMusic = new Set(await devMusic());
    this.busy = false;
    return { ok, failed };
  }

  private async importAll(): Promise<void> {
    const todo = this.pending.filter(this.ready);
    if (!todo.length || this.busy) return;
    const { ok, failed } = await this.store(todo);
    // 导入好的从列表里拿掉，没成的留着
    for (const p of this.pending) if (!p.include && p.thumb && todo.includes(p)) URL.revokeObjectURL(p.thumb);
    this.pending = this.pending.filter((p) => !todo.includes(p) || p.include);
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
        if (owner === MUSIC) this.projectMusic = new Set(await devMusic());
        else await reloadProject();
      } else if (owner === MUSIC) {
        await clearCustomTrack(slot as MusicSlot);
      } else {
        await deleteMine(owner, slot);
        await reloadMine();
      }
      this.slotMsg.delete(keyOf(owner, slot));
      this.say(`${slotName(owner, slot)}换回原版了。`);
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
      this.slotMsg.clear();
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

  // ---------- 一共能换这些、逐个格子看 ----------

  private renderHave(): void {
    const map = this.placed();
    this.renderKinds(map);
    this.renderBrowse(map);
  }

  // 这个主人在这一类（null 是全部）里换了几格、一共几格
  private progress(owner: string, kind: Kind | null, map: Map<string, Placed>): { done: number; total: number } {
    const defs = slotsOfKind(owner, kind, WHO);
    return { done: defs.filter((d) => this.has(owner, d.slot, map)).length, total: defs.length };
  }

  private renderKinds(map: Map<string, Placed>): void {
    const box = this.root.querySelector('.imp-kinds');
    if (!box) return;
    let allDone = 0;
    let allTotal = 0;
    const cards = KINDS.map((k) => {
      let done = 0;
      for (const o of ownersOfKind(k.id, WHO)) done += this.progress(o, k.id, map).done;
      const total = kindCount(k.id, WHO).total;
      allDone += done;
      allTotal += total;
      return `<button class="imp-kind${this.kind === k.id ? ' on' : ''}${done ? ' some' : ''}" data-imp-kind="${k.id}" aria-pressed="${this.kind === k.id}">
          <span class="imp-kind-head"><b>${k.name}</b><em>${esc(kindAmount(k.id, WHO))}</em></span>
          <span class="imp-kind-line"><i>用在</i>${esc(k.where)}</span>
          <span class="imp-kind-line"><i>规格</i>${esc(k.spec)}</span>
          <span class="imp-bar"><i style="width:${total ? Math.max(done ? 2 : 0, (done / total) * 100) : 0}%"></i></span>
          <span class="imp-kind-done">已换 <b>${done}</b> / ${total}${k.global ? '' : `（${kindCount(k.id, WHO).owners} 人）`}</span>
        </button>`;
    }).join('');
    const where = this.target === 'mine' ? '这个浏览器里' : '项目文件夹里';
    box.innerHTML = `
      <h2>一共能换这些 <small>${where}已换 ${allDone} / ${allTotal} 格 · 一格都不换也能玩 · 点卡片只看那一类</small></h2>
      <p class="imp-sum">${esc(summary(WHO))}</p>
      <div class="imp-kind-grid">${cards}</div>
      <div class="imp-actions">
        <button class="skin-btn" data-imp-csv title="每个角色、每一格一行：用在哪、规格、建议文件名、换了没有。Excel 能打开，可以直接发给画师、配音">下载完整清单（表格）</button>
        <button class="skin-btn ghost" data-imp-jump>一次放很多文件 ↓</button>
        <button class="skin-btn ghost" data-imp-export${this.busy ? ' disabled' : ''}>导出素材包</button>
        ${allDone ? `<button class="skin-btn ghost" data-imp-clear${this.busy ? ' disabled' : ''}>${this.armedClear > Date.now() ? '再点一次，全部删掉' : '全部删掉'}</button>` : ''}
      </div>`;
  }

  // 左边名单上的一个人（或者“通用”“背景音乐”）
  private ownerButton(owner: string, map: Map<string, Placed>): string {
    const { done, total } = this.progress(owner, this.kind, map);
    if (!total) return '';
    const face =
      owner === MUSIC
        ? '<span class="imp-face"><b>♪</b></span>'
        : owner === GLOBAL
          ? '<span class="imp-face"><b>◎</b></span>'
          : `<span class="imp-face"><b>${esc(ownerName(owner).slice(-1))}</b><img src="${portraitUrl(owner, 'neutral')}" alt="" loading="lazy" onerror="this.remove()" /></span>`;
    const name = owner === GLOBAL ? '提示音、手模' : ownerName(owner);
    return `<button class="imp-owner${owner === this.sel ? ' on' : ''}${done ? ' some' : ''}${done === total ? ' full' : ''}" data-imp-sel="${owner}" style="--c:${ownerColor(owner)}">${face}<span class="imp-owner-name">${esc(name)}</span><small>${done}/${total}</small></button>`;
  }

  private renderBrowse(map: Map<string, Placed>): void {
    const box = this.root.querySelector('.imp-browse');
    if (!box) return;
    // 只看某一类时，选中的人没有这一类（比如没有技能动画）就换成第一个有的
    const visible = ownerOrder().filter((o) => slotsOfKind(o, this.kind, WHO).length);
    // （从“背景音乐”这些不分角色的类回来时，回到上次看的那个人）
    if (!visible.includes(this.sel)) this.sel = (visible.includes(this.lastChar) ? this.lastChar : visible.find((o) => o !== GLOBAL && o !== MUSIC)) ?? visible[0];
    if (this.sel !== GLOBAL && this.sel !== MUSIC) this.lastChar = this.sel;
    const groups = [
      `<div class="imp-og"><h4>不分角色</h4>${[MUSIC, GLOBAL].map((o) => this.ownerButton(o, map)).join('')}</div>`,
      ...SCHOOLS.map((s) => {
        const items = membersOf(s.name)
          .map((c) => this.ownerButton(c.id, map))
          .join('');
        return items ? `<div class="imp-og"><h4>${esc(s.short)}</h4>${items}</div>` : '';
      }),
    ]
      .filter((g) => !/<h4>[^<]*<\/h4><\/div>$/.test(g))
      .join('');
    const k = this.kind ? kindInfo(this.kind) : null;
    const filter = k ? `<span class="imp-chip">只看「${k.name}」<button data-imp-kind="" title="看全部" aria-label="看全部">×</button></span>` : '';
    // 重画以后名单的滚动位置照旧
    const was = box.querySelector('.imp-owners')?.scrollTop ?? null;
    box.innerHTML = `
      <h2>逐个格子看 <small>左边选人，右边是每一格：现在用的是什么、不换会怎样、照什么文件名起名</small>${filter}</h2>
      <div class="imp-browse-grid">
        <nav class="imp-owners" aria-label="角色">${groups}</nav>
        <div class="imp-slots">${this.slotsHtml(this.sel, map)}</div>
      </div>`;
    // 选中的人不在名单看得见的地方就滚过去（只滚名单自己，不动整页）
    const nav = box.querySelector<HTMLElement>('.imp-owners');
    const on = box.querySelector<HTMLElement>('.imp-owner.on');
    if (nav && was !== null) nav.scrollTop = was;
    if (nav && on && (on.offsetTop < nav.scrollTop || on.offsetTop + on.offsetHeight > nav.scrollTop + nav.clientHeight)) nav.scrollTop = on.offsetTop - nav.clientHeight / 3;
  }

  private slotsHtml(owner: string, map: Map<string, Placed>): string {
    const c = WHO.find((x) => x.id === owner);
    const school = c ? SCHOOLS.find((s) => s.name === c.school)?.short : '';
    const all = this.progress(owner, null, map);
    const head = `<header class="imp-slots-head" style="--c:${ownerColor(owner)}">
        <div><h3>${esc(owner === GLOBAL ? '提示音、手模' : ownerName(owner))}${school ? `<small>${esc(school)}</small>` : ''}</h3>
        <p>${owner === MUSIC || owner === GLOBAL ? '不分角色，全场共用' : `一共 ${all.total} 格`} · ${this.target === 'mine' ? '这个浏览器里' : '项目文件夹里'}已换 <b>${all.done}</b> 格</p></div>
      </header>`;
    const kinds = KINDS.filter((k) => (!this.kind || k.id === this.kind) && slotsOfKind(owner, k.id, WHO).length);
    const sections = kinds
      .map((k) => {
        const defs = slotsOfKind(owner, k.id, WHO);
        const done = defs.filter((d) => this.has(owner, d.slot, map)).length;
        const audioKind = k.id === 'voice' || k.id === 'sfx' || k.id === 'music';
        return `<section class="imp-group">
            <h4>${k.name} <small>${defs.length} ${UNIT[k.id]} · 已换 ${done}</small></h4>
            <p class="imp-group-note"><b>规格</b>${esc(k.spec)}${k.tip ? `<br /><b>先换</b>${esc(k.tip)}` : ''}</p>
            <div class="imp-grid${audioKind ? ' audio' : ''}">${defs.map((d) => this.slotCard(owner, d, map)).join('')}</div>
          </section>`;
      })
      .join('');
    return head + sections;
  }

  // 没换时这一格游戏里用的图（看得出“原版”是什么样）；没有是空字符串
  private defaultArt(owner: string, d: SlotDef): string {
    if (d.slot === 'face') return defaultPortraitUrl(owner, 'neutral');
    if (d.slot === 'blank') return defaultPortraitUrl(owner, 'surprised');
    if (d.slot === 'power') return defaultPowerPortraitUrl(owner);
    if (d.slot === 'eyes') return eyeTemplateUrl(owner, CHARACTERS.find((c) => c.id === owner)?.color ?? '');
    if (d.group === 'cutin') return defaultCutinArt(owner, d.slot).url;
    if (d.group === 'skill') return defaultCutinArt(owner, d.slot.endsWith('-win') ? 'win' : 'ability').url;
    return '';
  }

  // 没换的这一格游戏里实际放什么：同一个人换过的别的格子能顶上就用它（吃惊、能力头像用头像，鸣牌、结算用和牌切入，
  // 技能动画用能力发动切入），不然是原版的图
  private standIn(owner: string, d: SlotDef, map: Map<string, Placed>): { url: string; via: string } {
    const own = (slot: string) => map.get(keyOf(owner, slot));
    const by = (slot: string, via: string) => (own(slot)?.entry.media === 'image' ? { url: own(slot)!.url, via } : null);
    const hit =
      d.slot === 'blank' || d.slot === 'power'
        ? by('face', '用头像')
        : d.slot === 'call' || d.slot === 'result'
          ? by('win', '用和牌切入')
          : d.group === 'skill'
            ? d.slot.endsWith('-win')
              ? by('win', '用和牌切入')
              : by('ability', '用能力切入')
            : null;
    return hit ?? { url: this.defaultArt(owner, d), via: '' };
  }

  private slotCard(owner: string, d: SlotDef, map: Map<string, Placed>): string {
    const key = keyOf(owner, d.slot);
    const k = kindOf(d);
    const g = slotGuide(owner, d, WHO);
    const mine = this.target === 'mine';
    const done = this.has(owner, d.slot, map);
    const p = map.get(key);
    // 另一层也换过：说一声（浏览器里的会盖过项目里的）
    const otherHas = owner === MUSIC ? this.musicHas(d.slot, mine ? 'project' : 'mine') : (mine ? projectAssets() : mineAssets()).some((a) => a.owner === owner && a.slot === d.slot);
    const other = otherHas ? (mine ? '项目文件夹里也换过（这里的盖过它）' : '这个浏览器里也换过，在这台电脑上会盖过项目里的') : '';
    const msg = this.slotMsg.get(key);
    const audioKind = k === 'voice' || k === 'sfx' || k === 'music';
    const musicDefault = owner === MUSIC && (this.dev ? this.projectMusic.has(d.slot) : this.builtinMusic.has(d.slot));
    const stand = audioKind || k === 'model' || k === 'hand' ? { url: '', via: '' } : this.standIn(owner, d, map);
    const status = done ? '已换' : stand.via ? stand.via : (audioKind && k !== 'sfx' && !(mine && musicDefault)) || (!audioKind && k !== 'model' && k !== 'hand' && !stand.url) ? '空着' : '原版';
    const what = done ? `换上的：${p?.entry.name ?? (owner === MUSIC && mine ? (slotMeta(d.slot as MusicSlot).custom ?? '') : `public/music/${d.slot}.mp3`)}${p?.entry.size ? ` · ${sizeLabel(p.entry.size)}` : ''}` : `不换：${g.fallback}`;
    const label = d.group === 'music' ? (MUSIC_SLOTS.find((m) => m.id === d.slot)?.name ?? d.label) : d.group === 'voice' ? d.label.replace(/^语音 · /, '') : d.label;
    const accept = d.media.includes('video') && !kindInfo(k).accept.includes('video') ? `${kindInfo(k).accept},video/*` : kindInfo(k).accept;
    const put = `<label class="skin-btn imp-put"${this.busy ? ' aria-disabled="true"' : ''}>${done ? '换一个' : '放进来'}<input type="file" accept="${accept}" data-imp-put="${key}"${this.busy ? ' disabled' : ''} /></label>`;
    const del = done ? `<button class="skin-btn ghost" data-imp-del="${key}"${this.busy ? ' disabled' : ''} title="删掉换上的，回到原版">换回原版</button>` : '';
    // 换上的静态图能再裁；睁眼特写能拿头像图裁
    const cut = done && p?.entry.media === 'image' && canCrop(p.entry.mime) ? `<button class="skin-btn ghost" data-imp-recrop="${key}"${this.busy ? ' disabled' : ''} title="在换上的图上重新挑裁哪里">裁剪</button>` : '';
    const eyes = d.slot === 'eyes' ? `<button class="skin-btn" data-imp-eyes="${owner}"${this.busy ? ' disabled' : ''} title="拿这个人的头像、立绘（或者再选一张头像图）框住眼睛裁一条">导入头像图</button>` : '';
    const peek = d.slot === 'eyes' ? `<a class="imp-peek" href="#eyes" title="去睁眼特写预览页，点一下放一次">看效果 ›</a>` : '';
    // 试听：换上的；没换的提示音放合成的；背景音乐放项目、网页自带的那首
    const playable = audioKind && (done || k === 'sfx' || (owner === MUSIC && musicDefault));
    const playing = this.player?.key === key;
    const play = playable ? `<button class="imp-play${playing ? ' on' : ''}" data-imp-listen="${key}" title="${done ? '试听换上的' : k === 'sfx' ? '试听合成的原版' : '试听原版'}" aria-label="试听">${playing ? '■' : '▶'}</button>` : '';
    const note = `${other ? `<p class="imp-other">${esc(other)}</p>` : ''}${msg?.text ? `<p class="imp-msg ${msg.level}">${esc(msg.text)}</p>` : ''}`;
    if (audioKind) {
      return `<div class="imp-slot audio${done ? ' done' : ''}" data-imp-card="${key}">
          <div class="imp-slot-play">${play || '<span class="imp-play none" title="现在没有声音">—</span>'}</div>
          <div class="imp-slot-body">
            <div class="imp-slot-title"><b>${esc(label)}</b><span class="imp-badge ${done ? 'done' : status === '空着' ? 'none' : ''}">${status}</span>${g.key ? '<span class="imp-key">先换</span>' : ''}</div>
            <p class="imp-when">${esc(g.when)}</p>
            <p class="imp-what">${esc(what)}</p>
            <code class="imp-fname" title="照这个起名，拖进来会自动对上这一格">${esc(g.file)}</code>
            ${note}
          </div>
          <div class="imp-slot-acts">${put}${del}</div>
        </div>`;
    }
    const url = done ? (p?.url ?? '') : stand.url;
    const glyph = esc(ownerName(owner).slice(-1));
    const media =
      k === 'model' || k === 'hand'
        ? `<span class="imp-icon">3D</span>`
        : // 没有图（或者图读不出来）才露出名字的字，和牌桌上一样
          `<span class="imp-ph"${url ? ' hidden' : ''}>${glyph}</span>${url ? (done && p?.entry.media === 'video' ? `<video src="${url}" muted autoplay loop playsinline></video>` : `<img src="${url}" alt="" loading="lazy" onerror="this.previousElementSibling.hidden=false;this.remove()" />`) : ''}`;
    return `<div class="imp-slot${done ? ' done' : ''}" data-imp-card="${key}" style="--c:${ownerColor(owner)}">
        <div class="imp-prev${k === 'portrait' ? ' face' : ''}${!done && (d.group === 'skill' || stand.via) ? ' dim' : ''}">${media}<span class="imp-badge ${done ? 'done' : status === '空着' ? 'none' : ''}">${status}</span></div>
        <div class="imp-slot-body">
          <div class="imp-slot-title"><b>${esc(label)}</b>${g.key ? '<span class="imp-key">先换</span>' : ''}</div>
          <p class="imp-when">${esc(g.when)}</p>
          <p class="imp-what">${esc(what)}</p>
          <code class="imp-fname" title="照这个起名，拖进来会自动对上这一格">${esc(g.file)}</code>
          ${note}
          <div class="imp-slot-acts">${eyes}${put}${cut}${del}${peek}</div>
        </div>
      </div>`;
  }

  // ---------- 试听 ----------

  private stopPlayer(): void {
    if (!this.player) return;
    this.player.el.pause();
    if (this.player.url) URL.revokeObjectURL(this.player.url);
    this.player = null;
  }

  private async listen(owner: string, slot: string): Promise<void> {
    const key = keyOf(owner, slot);
    const done = this.has(owner, slot);
    if (owner === MUSIC) {
      // 再点一下停
      if (this.player?.key === key) {
        this.stopPlayer();
        this.renderHave();
        return;
      }
      this.stopPlayer();
      stopVoices();
      let src = builtinUrl(slot as MusicSlot);
      let blob: string | null = null;
      if (done && this.target === 'mine') {
        const buf = await customTrack(slot as MusicSlot);
        if (!buf) return this.say('这首读不出来了（浏览器可能把它清掉了）。');
        blob = URL.createObjectURL(new Blob([buf]));
        src = blob;
      }
      const el = new Audio(src);
      el.volume = 0.8;
      el.onended = () => {
        if (this.player?.el === el) {
          this.stopPlayer();
          this.renderHave();
        }
      };
      this.player = { el, key, url: blob };
      el.play().catch(() => {
        this.say('这首放不出来。');
        this.stopPlayer();
        this.renderHave();
      });
      this.renderHave();
      return;
    }
    this.stopPlayer();
    const p = this.placed().get(key);
    if (p?.url) {
      const r = await fetch(p.url).catch(() => null);
      const ok = r?.ok ? await previewVoiceBytes(new Uint8Array(await r.arrayBuffer())) : null;
      if (ok === null) this.say('这一段放不出来。');
      return;
    }
    // 没换的提示音：放合成的原版
    const name = slot.startsWith('sfx-') ? (slot.slice(4) as SfxName) : null;
    if (owner === GLOBAL && name && SFX_SYNTH[name]) withSynthSfx(SFX_SYNTH[name]);
  }

  // ---------- 操作 ----------

  private find(n: string | undefined): Pending | undefined {
    return this.pending.find((p) => String(p.n) === n);
  }

  private setKind(k: Kind | null): void {
    this.kind = this.kind === k ? null : k;
    saveKey(KIND_KEY, this.kind ?? '');
    // 不分角色的几类直接跳到那个主人
    if (this.kind === 'music') this.sel = MUSIC;
    else if (this.kind === 'sfx' || this.kind === 'hand') this.sel = GLOBAL;
    saveKey(SEL_KEY, this.sel);
    this.renderHave();
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-imp-back],[data-imp-go],[data-imp-cancel],[data-imp-drop-row],[data-imp-del],[data-imp-export],[data-imp-clear],[data-imp-kind],[data-imp-sel],[data-imp-listen],[data-imp-csv],[data-imp-jump],[data-imp-crop-row],[data-imp-recrop],[data-imp-eyes]',
    );
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
    } else if (d.impCropRow) {
      void this.cropRow(d.impCropRow);
    } else if (d.impRecrop) {
      const [owner, slot] = d.impRecrop.split(':');
      void this.recrop(owner, slot);
    } else if (d.impEyes) {
      void this.eyesFromAvatar(d.impEyes);
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
    } else if (d.impKind !== undefined) {
      this.setKind((d.impKind || null) as Kind | null);
    } else if (d.impSel) {
      this.sel = d.impSel;
      saveKey(SEL_KEY, this.sel);
      this.renderHave();
    } else if (d.impListen) {
      const [owner, slot] = d.impListen.split(':');
      void this.listen(owner, slot);
    } else if (d.impCsv !== undefined) {
      // 文件名用英文：有的系统、浏览器下载时会把中文文件名换成 download
      downloadText(checklistCsv(WHO, ownerOrder(), (o, s) => this.has(o, s)), 'saki-mahjong-asset-list.csv', 'text/csv;charset=utf-8');
      this.say('下载了素材清单（saki-mahjong-asset-list.csv）：每个角色、每一格一行，Excel 能打开。');
    } else if (d.impJump !== undefined) {
      this.root.querySelector('.imp-bulk')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement & HTMLSelectElement;
    const d = el.dataset;
    if (d.impPut && el.files?.[0]) {
      const [owner, slot] = d.impPut.split(':');
      void this.putOne(owner, slot, el.files[0]);
      el.value = '';
    } else if (d.impFiles !== undefined && el.files?.length) {
      void this.addFiles([...el.files].map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file })));
      el.value = '';
    } else if (d.impTarget !== undefined) {
      this.target = el.value as Target;
      saveKey(TARGET_KEY, this.target);
      this.slotMsg.clear();
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

  private cardAt(e: Event): HTMLElement | null {
    return (e.target as HTMLElement).closest?.<HTMLElement>('[data-imp-card]') ?? null;
  }

  private onDrag(e: DragEvent): void {
    if (!this.dragging(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = this.busy ? 'none' : 'copy';
    // 拖到某一格上就只放进那一格，别的时候是一次放很多
    const card = this.cardAt(e);
    for (const c of this.root.querySelectorAll('.imp-slot.drop')) if (c !== card) c.classList.remove('drop');
    card?.classList.add('drop');
    this.root.querySelector('.imp-drop')?.classList.toggle('drop', !card);
  }

  private onDragLeave(e: DragEvent): void {
    const zone = this.root.querySelector('.imp-screen');
    if (zone && !zone.contains(e.relatedTarget as Node | null)) {
      this.root.querySelector('.imp-drop')?.classList.remove('drop');
      for (const c of this.root.querySelectorAll('.imp-slot.drop')) c.classList.remove('drop');
    }
  }

  // 整页哪里都能放：文件夹也认（一层层找下去）。放在某一格上就直接放进那一格
  private async onDrop(e: DragEvent): Promise<void> {
    if (!this.dragging(e)) return;
    e.preventDefault();
    this.root.querySelector('.imp-drop')?.classList.remove('drop');
    for (const c of this.root.querySelectorAll('.imp-slot.drop')) c.classList.remove('drop');
    if (this.busy) return;
    const card = this.cardAt(e);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (card?.dataset.impCard && files.length) {
      const [owner, slot] = card.dataset.impCard.split(':');
      if (files.length > 1) this.say('一格只放一个文件，用了第一个。');
      await this.putOne(owner, slot, files[0]);
      return;
    }
    const items = [...(e.dataTransfer?.items ?? [])];
    const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null);
    const out: Picked[] = [];
    if (entries.length && entries.every(Boolean)) {
      for (const en of entries) await walk(en!, out);
    } else {
      for (const file of files) out.push({ path: file.name, file });
    }
    await this.addFiles(out);
  }
}
