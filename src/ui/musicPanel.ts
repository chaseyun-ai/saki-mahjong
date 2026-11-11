import { liveAudio } from './audioBus';
import { rowHtml, section } from './matchSetup';
import { hasBuiltin, musicState, onMusic, previewMusic } from './music';
import { MAX_SLOT_VOL, MAX_TRACK_BYTES, clearCustomTrack, onMusicStore, setCustomTrack, setSlotVol, slotMeta } from './musicStore';
import { BUILTIN, MUSIC_SLOTS, MusicSlot } from './musicTracks';

// 声音设置面板里的「曲目」：五个格子各放哪首曲子。每格能试听、换成自己的文件、清掉换回内置的、调单曲音量。
// 换上的曲子只记在这个浏览器里（musicStore.ts）。面板本身、开关都在 soundPanel.ts，这里只出这一段和它的操作。

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isSlot = (v: string | undefined): v is MusicSlot => MUSIC_SLOTS.some((s) => s.id === v);

// 内置曲子的文件在不在：开面板时问一遍，问到了重画
const builtin = new Map<MusicSlot, boolean>();
// 换曲时的提示（文件太大、放不了）
let message = '';
let rerender: () => void = () => {};
let dragging = false;
let fileInput: HTMLInputElement | null = null;
let picking: MusicSlot | null = null;

function probe(): void {
  for (const { id } of MUSIC_SLOTS) {
    if (builtin.has(id)) continue;
    void hasBuiltin(id).then((ok) => {
      builtin.set(id, ok);
      rerender();
    });
  }
}

// 这一格现在放的是什么
function slotLabel(slot: MusicSlot): { text: string; empty: boolean } {
  const m = slotMeta(slot);
  if (m.custom) return { text: `自己的：${esc(m.custom)}`, empty: false };
  const has = builtin.get(slot);
  if (has === undefined) return { text: '…', empty: true };
  if (!has) return { text: '空', empty: true };
  const info = BUILTIN[slot];
  return { text: info ? `${esc(info.title)} · ${esc(info.by)}` : '内置曲', empty: false };
}

function slotHtml(slot: MusicSlot, name: string): string {
  const m = slotMeta(slot);
  const label = slotLabel(slot);
  const on = musicState().preview === slot;
  const v = Math.round(m.vol * 100);
  const max = Math.round(MAX_SLOT_VOL * 100);
  const top =
    `<span class="mus-name${label.empty ? ' empty' : ''}">${label.text}</span>` +
    `<button class="${on ? 'on' : ''}" aria-pressed="${on}" data-ui="mus-play" data-v="${slot}"${label.empty ? ' disabled' : ''}>${on ? '停' : '试听'}</button>` +
    `<button data-ui="mus-pick" data-v="${slot}">换曲</button>` +
    (m.custom ? `<button data-ui="mus-clear" data-v="${slot}">清除</button>` : '');
  const vol = `<input class="snd-range" type="range" min="0" max="${max}" step="5" value="${v}" data-ui="mus-vol" data-v="${slot}" aria-label="${name} 单曲音量" style="--v:${(v / max) * 100}%" /><output class="snd-val" data-mus-val="${slot}">${v}</output>`;
  return `<div class="mus-top">${top}</div><div class="mus-vol">${vol}</div>`;
}

// 内置曲子的署名（有的站要求写明出处）
function creditsHtml(): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const { id } of MUSIC_SLOTS) {
    const info = BUILTIN[id];
    if (!info || !builtin.get(id)) continue;
    const key = `${info.title}|${info.by}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = `《${esc(info.title)}》${esc(info.by)}`;
    items.push(info.url ? `<a href="${esc(info.url)}" target="_blank" rel="noopener">${text}</a>` : text);
  }
  return items.length ? `<p class="mus-credit">内置音乐：${items.join('、')}</p>` : '';
}

export function musicRowsHtml(): string {
  probe();
  const rows = MUSIC_SLOTS.map((s) => rowHtml(s.name, slotHtml(s.id, s.name), s.note, 'mus-row')).join('');
  const tip = `<p class="mus-tip" role="status">${message ? esc(message) : '换上的曲子只记在这个浏览器里。滑杆是这一首自己的音量，100 是原样。'}</p>`;
  return section('曲目') + rows + tip + creditsHtml();
}

// 面板关了：试听停掉，回到场景本来在放的
export function stopMusicPreview(): void {
  previewMusic(null);
  message = '';
}

async function pick(slot: MusicSlot, file: File): Promise<void> {
  const say = (text: string) => {
    message = text;
    rerender();
  };
  if (file.size > MAX_TRACK_BYTES) return say(`「${file.name}」有 ${(file.size / 1024 / 1024).toFixed(1)} MB，太大了：一首最多 ${MAX_TRACK_BYTES / 1024 / 1024} MB。`);
  try {
    const data = await file.arrayBuffer();
    // 先解码一遍：放不了的文件不收
    const a = liveAudio();
    if (a) await a.decodeAudioData(data.slice(0));
    message = '';
    await setCustomTrack(slot, file.name, data);
  } catch {
    say(`「${file.name}」放不了，换一个 mp3、ogg、m4a 或 wav 试试。`);
  }
}

let installed = false;

// 接上点击、拖动、选文件（整页只接一次）。redraw 是重画面板
export function installMusicPanel(redraw: () => void): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  rerender = () => {
    if (!dragging) redraw();
  };
  // 选文件的输入框放在面板外面：面板重画的时候它不会被换掉
  fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*,.mp3,.ogg,.m4a,.wav';
  fileInput.hidden = true;
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', () => {
    const file = fileInput?.files?.[0];
    const slot = picking;
    picking = null;
    if (fileInput) fileInput.value = '';
    if (file && slot) void pick(slot, file);
  });
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest?.<HTMLElement>('.snd-host [data-ui^="mus-"]');
    const slot = el?.dataset.v;
    if (!el || !isSlot(slot)) return;
    const ui = el.dataset.ui;
    if (ui === 'mus-play') previewMusic(musicState().preview === slot ? null : slot);
    else if (ui === 'mus-pick') {
      picking = slot;
      fileInput?.click();
    } else if (ui === 'mus-clear') {
      message = '';
      void clearCustomTrack(slot);
    }
  });
  // 拖单曲音量：边拖边改，不重画面板
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const slot = el.dataset?.v;
    if (el.dataset?.ui !== 'mus-vol' || !isSlot(slot) || !el.closest('.snd-host')) return;
    dragging = true;
    setSlotVol(slot, Number(el.value) / 100);
    dragging = false;
    el.style.setProperty('--v', `${(Number(el.value) / Number(el.max)) * 100}%`);
    const out = el.parentElement?.querySelector<HTMLElement>(`[data-mus-val="${slot}"]`);
    if (out) out.textContent = el.value;
  });
  onMusicStore(() => rerender());
  onMusic(() => rerender());
}
