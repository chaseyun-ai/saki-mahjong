import './soundPanel.css';
import { AudioSettings, DEFAULT_AUDIO, audioSettings, onAudioSettings, setAudioSetting } from './audioBus';
import { optsHtml, panelHtml, rowHtml, section } from './matchSetup';
import { playClick } from './sound';
import { sampleVoice } from './voice';

// 声音设置：总音量、音乐、音效、语音四条滑杆，一键静音，演出时压低音乐。
// 选人页顶栏的「声音设置」和对局里的喇叭按钮开的是同一个面板。面板挂在 <body> 上，不跟着牌桌重画，
// 点击也在这里自己接（[data-ui="open-sound"] 的按钮放在哪都能开），不用经过 App。

// 喇叭：有声两道弧，静音一个叉
const SPEAKER_BODY = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';
const SPEAKER_ON = '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const SPEAKER_OFF = '<path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
export const speakerSvg = (size = 16, muted = isSilent()) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${SPEAKER_BODY}${muted ? SPEAKER_OFF : SPEAKER_ON}</svg>`;

// 现在是不是一点声音都没有（静音，或者总音量拉到了 0）：喇叭画成带叉的
function isSilent(): boolean {
  return audioSettings.mute || audioSettings.master === 0;
}

// 选人页顶栏的入口（跟对局设置、视觉设置并排）
export function soundEntryHtml(): string {
  return `<button class="sel-set" data-ui="open-sound" aria-haspopup="dialog"><span class="snd-icon">${speakerSvg()}</span><span>声音设置</span></button>`;
}

// 对局里的喇叭按钮：放在理、和、鸣、切那一组里
export function soundButtonHtml(): string {
  return `<button class="sound-btn" data-ui="open-sound" title="声音设置" aria-label="声音设置" aria-haspopup="dialog"><span class="snd-icon">${speakerSvg(18)}</span></button>`;
}

type Volume = 'master' | 'music' | 'sfx' | 'voice';
const SLIDERS: { key: Volume; name: string; note?: string }[] = [
  { key: 'master', name: '总音量' },
  { key: 'music', name: '音乐', note: '拉到 0 就是关掉音乐' },
  { key: 'sfx', name: '音效', note: '打牌、吃碰杠、立直、和牌、能力演出' },
  { key: 'voice', name: '语音', note: '角色喊牌、发动能力时说的台词' },
];

const pct = (v: number) => Math.round(v * 100);

function sliderHtml(key: Volume, name: string): string {
  const v = pct(audioSettings[key]);
  const mute =
    key === 'master' ? `<button class="snd-mute${audioSettings.mute ? ' on' : ''}" aria-pressed="${audioSettings.mute}" data-ui="snd-mute">${speakerSvg(15, audioSettings.mute)}<span>静音</span></button>` : '';
  return `<input class="snd-range" type="range" min="0" max="100" step="1" value="${v}" data-snd="${key}" aria-label="${name}" style="--v:${v}%" /><output class="snd-val" data-snd-val="${key}">${v}</output>${mute}`;
}

// 角色语音放哪些（语音本身在素材页里放，见 voice.ts）
const VOICE_MODES = [
  { label: '全部', value: 'on' },
  { label: '只喊牌', value: 'calls' },
  { label: '关闭', value: 'off' },
];

const ON_OFF = [
  { label: '开启', value: 'true' },
  { label: '关闭', value: 'false' },
];

export function soundPanelHtml(): string {
  const sliders = SLIDERS.map((s) => rowHtml(s.name, sliderHtml(s.key, s.name), s.note, 'snd-row')).join('');
  const duck = rowHtml('演出时压低音乐', optsHtml('snd-opt', 'duck', ON_OFF, String(audioSettings.duck)), '能力演出、和牌、语音响的时候音乐自动小下去');
  const voice = rowHtml('角色语音', optsHtml('snd-opt', 'voiceMode', VOICE_MODES, audioSettings.voiceMode), '「只喊牌」只留立直、吃碰杠、荣和、自摸，不说能力台词');
  const body = section('音量') + sliders + section('语音') + voice + section('音乐') + duck;
  return panelHtml('sound', '声音设置', '改了马上生效', body, '<button data-ui="snd-reset">恢复默认</button>');
}

let host: HTMLElement | null = null;
let opener: HTMLElement | null = null;

export const soundPanelOpen = () => !!host;

export function openSoundPanel(from?: HTMLElement | null): void {
  if (host) return;
  opener = from ?? null;
  host = document.createElement('div');
  host.className = 'snd-host';
  document.body.appendChild(host);
  render();
  host.querySelector<HTMLElement>('.set-x')?.focus();
}

export function closeSoundPanel(): void {
  if (!host) return;
  host.remove();
  host = null;
  // 开面板的按钮可能已经被牌桌重画换掉了：还在页面上才把焦点还给它
  if (opener?.isConnected) opener.focus();
  opener = null;
}

// 面板重画：滚动位置、键盘焦点留在原处
function render(): void {
  if (!host) return;
  const top = host.querySelector<HTMLElement>('.set-panel')?.scrollTop ?? 0;
  const focus = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
  const key = focus?.dataset.snd ? `[data-snd="${focus.dataset.snd}"]` : focus?.dataset.ui ? `[data-ui="${focus.dataset.ui}"]${focus.dataset.v ? `[data-v="${focus.dataset.v}"]` : ''}` : null;
  host.innerHTML = soundPanelHtml();
  const panel = host.querySelector<HTMLElement>('.set-panel');
  if (panel) panel.scrollTop = top;
  if (key) host.querySelector<HTMLElement>(key)?.focus();
}

// 页面上所有喇叭图标跟着静音状态换（有声 / 带叉）
function refreshIcons(): void {
  document.querySelectorAll<HTMLElement>('.snd-icon').forEach((el) => {
    const size = el.closest('.sound-btn') ? 18 : 16;
    el.innerHTML = speakerSvg(size);
  });
}

let installed = false;

// 接上点击、拖动、键盘（整页只接一次）。main.ts 启动时叫
export function installSoundPanel(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const open = target.closest?.<HTMLElement>('[data-ui="open-sound"]');
    if (open) {
      openSoundPanel(open);
      return;
    }
    if (!host || !host.contains(target)) return;
    // 点面板外面的暗处：关上
    if (target.classList.contains('set-modal')) {
      closeSoundPanel();
      return;
    }
    const el = target.closest<HTMLElement>('[data-ui]');
    if (!el) return;
    const ui = el.dataset.ui;
    if (ui === 'panel-close') closeSoundPanel();
    else if (ui === 'snd-mute') setAudioSetting('mute', !audioSettings.mute);
    else if (ui === 'snd-opt' && el.dataset.k === 'duck') setAudioSetting('duck', el.dataset.v === 'true');
    else if (ui === 'snd-opt' && el.dataset.k === 'voiceMode') setAudioSetting('voiceMode', el.dataset.v as AudioSettings['voiceMode']);
    else if (ui === 'snd-reset') {
      for (const k of ['master', 'music', 'sfx', 'voice', 'mute', 'duck', 'voiceMode'] as const) setAudioSetting(k, DEFAULT_AUDIO[k] as AudioSettings[typeof k]);
    }
  });
  // 拖滑杆：边拖边改音量（不重画面板，不然滑杆会从手里掉）
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const key = el.dataset?.snd as Volume | undefined;
    if (!host || !key || !host.contains(el)) return;
    dragging = true;
    setAudioSetting(key, Number(el.value) / 100);
    dragging = false;
    el.style.setProperty('--v', `${el.value}%`);
    const out = host.querySelector<HTMLElement>(`[data-snd-val="${key}"]`);
    if (out) out.textContent = el.value;
    // 拖总音量：静音自动解开，不然拖了没声音
    if (key === 'master' && audioSettings.mute && Number(el.value) > 0) setAudioSetting('mute', false);
  });
  // 松手：响一声听听现在多大（音乐正放着，自己就听得到）
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const key = el.dataset?.snd;
    if (!host || !key || !host.contains(el)) return;
    if (key === 'master' || key === 'sfx') playClick();
    // 语音：有解码好的台词就说一句
    else if (key === 'voice') sampleVoice();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && host) {
      e.stopPropagation();
      closeSoundPanel();
    }
  });
  onAudioSettings(() => {
    refreshIcons();
    if (!dragging) render();
  });
}

let dragging = false;
