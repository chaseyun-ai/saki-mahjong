import { DiscardPhase, Marker, MarkerName } from '../ui3d/discardMotion';

// 调试场景底部的时间轴：播放、暂停、逐帧、倍速、循环，拖动定位到任意时刻，
// 点标记直接跳到那一刻。只管界面，时间怎么走由调试场景决定。

export const SPEEDS = [0.1, 0.25, 0.5, 1];

export const MARKER_LABELS: Record<MarkerName, string> = {
  depart: '出发',
  grab: '抓住',
  land: '落桌',
  release: '松手',
  done: '收回',
};

export const PHASE_LABELS: Record<DiscardPhase, string> = {
  reach: '伸手',
  carry: '搬运',
  settle: '放下停顿',
  back: '收手',
  done: '结束',
};

// 时间轴上每段的颜色，和阶段一一对应
const PHASE_COLORS: Record<Exclude<DiscardPhase, 'done'>, string> = {
  reach: '#3f7f8a',
  carry: '#b98a2e',
  settle: '#8a5a8f',
  back: '#4f6f9a',
};

export interface TimelineHandlers {
  toggle(): void;
  step(dir: 1 | -1): void;
  replay(): void;
  seek(t: number): void;
  speed(v: number): void;
  loop(on: boolean): void;
}

const icon = (path: string) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
const ICONS = {
  play: icon('M8 5v14l11-7z'),
  pause: icon('M7 5h4v14H7zM13 5h4v14h-4z'),
  prev: icon('M6 5h2v14H6zM20 5v14L9 12z'),
  next: icon('M16 5h2v14h-2zM4 5v14l11-7z'),
  replay: icon('M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z'),
};

export class Timeline {
  private range: HTMLInputElement;
  private ms: HTMLElement;
  private phase: HTMLElement;
  private frame: HTMLElement;
  private toggleBtn: HTMLElement;
  private ticks: HTMLElement;
  private playing: boolean | null = null;
  // 正在拖时间轴时不要把滑块拉回去
  private dragging = false;

  constructor(
    private el: HTMLElement,
    private on: TimelineHandlers,
    speed: number,
    loop: boolean,
  ) {
    const speeds = SPEEDS.map((v) => `<button class="lab-speed${v === speed ? ' on' : ''}" data-tl="speed" data-v="${v}">${v}×</button>`).join('');
    el.innerHTML = `
      <div class="lab-transport">
        <button class="lab-icon" data-tl="replay" title="重放（R）">${ICONS.replay}</button>
        <button class="lab-icon" data-tl="prev" title="上一帧（←）">${ICONS.prev}</button>
        <button class="lab-icon lab-play" data-tl="toggle" title="播放 / 暂停（空格）"></button>
        <button class="lab-icon" data-tl="next" title="下一帧（→）">${ICONS.next}</button>
        <div class="lab-readout"><b data-r="ms">0</b> ms <span data-r="phase"></span><small data-r="frame"></small></div>
        <div class="lab-speeds">${speeds}</div>
        <label class="lab-check"><input type="checkbox" data-tl="loop" ${loop ? 'checked' : ''} /> 循环</label>
      </div>
      <div class="lab-track">
        <div class="lab-ticks"></div>
        <input type="range" min="0" max="1000" step="1" value="0" aria-label="动作时间" />
      </div>`;
    this.range = el.querySelector('input[type=range]')!;
    this.ms = el.querySelector('[data-r=ms]')!;
    this.phase = el.querySelector('[data-r=phase]')!;
    this.frame = el.querySelector('[data-r=frame]')!;
    this.toggleBtn = el.querySelector('[data-tl=toggle]')!;
    this.ticks = el.querySelector('.lab-ticks')!;
    this.range.addEventListener('input', () => this.on.seek(+this.range.value / 1000));
    this.range.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointercancel', () => (this.dragging = false));
    el.addEventListener('click', (e) => this.onClick(e));
  }

  // 换了动作参数：重新画各段颜色和标记
  setMarkers(markers: Marker[], duration: number): void {
    this.range.max = String(Math.round(duration * 1000));
    const pct = (t: number) => (t / duration) * 100;
    const phases: Exclude<DiscardPhase, 'done'>[] = ['reach', 'carry', 'settle', 'back'];
    const stops = phases.map((ph, i) => `${PHASE_COLORS[ph]} ${pct(markers[i].t)}% ${pct(markers[i + 1].t)}%`);
    const end = pct(markers[markers.length - 1].t);
    this.range.style.setProperty('--track', `linear-gradient(90deg, ${stops.join(', ')}, #2a3a3e ${end}% 100%)`);
    this.ticks.innerHTML = markers
      .map(
        (m) =>
          `<button class="lab-tick" data-tl="mark" data-v="${m.t}" data-name="${m.name}" style="--x:${pct(m.t)}" title="${MARKER_LABELS[m.name]} ${Math.round(m.t * 1000)} ms"><span>${MARKER_LABELS[m.name]}</span></button>`,
      )
      .join('');
  }

  show(t: number, phase: DiscardPhase, playing: boolean): void {
    const ms = Math.round(t * 1000);
    this.ms.textContent = String(ms);
    this.phase.textContent = PHASE_LABELS[phase];
    this.frame.textContent = `第 ${Math.floor(t * 60 + 1e-3)} 帧`;
    if (!this.dragging) this.range.value = String(ms);
    if (playing !== this.playing) {
      this.playing = playing;
      this.toggleBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    }
  }

  // 标记被经过时闪一下
  flash(name: MarkerName): void {
    const tick = this.ticks.querySelector<HTMLElement>(`[data-name=${name}]`);
    if (!tick) return;
    tick.classList.remove('hit');
    void tick.offsetWidth;
    tick.classList.add('hit');
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tl]');
    if (!el) return;
    const act = el.dataset.tl;
    if (act === 'toggle') this.on.toggle();
    else if (act === 'prev') this.on.step(-1);
    else if (act === 'next') this.on.step(1);
    else if (act === 'replay') this.on.replay();
    else if (act === 'mark') this.on.seek(+el.dataset.v!);
    else if (act === 'loop') this.on.loop((el as HTMLInputElement).checked);
    else if (act === 'speed') {
      for (const b of this.el.querySelectorAll('.lab-speed')) b.classList.toggle('on', b === el);
      this.on.speed(+el.dataset.v!);
    }
  }
}
