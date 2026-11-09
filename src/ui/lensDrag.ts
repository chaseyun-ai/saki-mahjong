// 臼泽塞的镜片：技能框里的几枚镜片可以拖。拖出技能框就变成狙击镜（准星 + 四周变暗），
// 停在能盯的人的头像上准星变红，松手就盯住那个人。头像元素带 data-seat（2D、3D 的名牌，2.5D 的头像框）。
// 牌桌每次重画会换掉 HUD 的内容，所以拖着的那枚镜片挂在 document.body 上，不跟着重画。

export interface LensSlots {
  max: number;
  left: number;
  target: number | null;
  targets: number[];
}

// 准星（狙击镜里的十字线和刻度）
const reticle = (cls: string) =>
  `<svg class="${cls}" viewBox="-50 -50 100 100" aria-hidden="true"><circle r="46" fill="none" stroke="currentColor" stroke-width="2.2"/><circle r="3" fill="currentColor"/>` +
  `<path d="M-46 0H-10M10 0H46M0 -46V-10M0 10V46" stroke="currentColor" stroke-width="2"/>` +
  `<path d="M-30 -4V4M-20 -3V3M20 -3V3M30 -4V4M-4 -30H4M-3 -20H3M-3 20H3M-4 30H4" stroke="currentColor" stroke-width="1.6"/></svg>`;

// 头像上的标记：这一局被镜片盯上了
export const lensMarkHtml = (by: string) => `<span class="lens-mark" title="被${by}的镜片盯上：这一局摸不到和了牌">${reticle('lm-svg')}</span>`;

// 技能框里的镜片：还剩的亮着，用过的碎了；能拖的那几枚带 ready
export function lensSlotsHtml(l: LensSlots, note: string, dragging: boolean): string {
  const ready = l.targets.length > 0;
  let lifted = false;
  const slots = Array.from({ length: l.max }, (_, i) => {
    const spent = i >= l.left;
    let cls = spent ? 'spent' : ready ? 'ready' : 'idle';
    // 拖着的那一枚（最后一枚还在的）从框里拿走
    if (!spent && ready && dragging && !lifted && i === l.left - 1) {
      cls += ' lifted';
      lifted = true;
    }
    return `<span class="lens ${cls}" ${!spent && ready ? 'data-lens="1" title="拖到别人头像上：这一局那个人摸不到和了牌"' : ''}><i class="lens-glint"></i>${spent ? '<i class="lens-crack"></i>' : ''}</span>`;
  }).join('');
  return `<div class="lens-row">${slots}</div><div class="fs-note skill-state">${note}</div>`;
}

interface DragOpts {
  // 现在能盯这一家吗
  canDrop(seat: number): boolean;
  // 头像上要显示的名字
  nameOf(seat: number): string;
  onDrop(seat: number): void;
  // 开始、结束拖动（界面重画，把框里那一枚藏起来 / 放回去）
  onLift(dragging: boolean): void;
}

// 头像框、名牌多半不接鼠标（pointer-events: none），直接按位置找；外面留一圈好对准
const seatAt = (x: number, y: number): HTMLElement | null => {
  const pad = 14;
  for (const el of document.querySelectorAll<HTMLElement>('[data-seat]')) {
    const r = el.getBoundingClientRect();
    if (r.width && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return el;
  }
  return null;
};

export function initLensDrag(root: HTMLElement, opts: DragOpts): void {
  root.addEventListener('pointerdown', (e) => {
    const src = (e.target as HTMLElement).closest<HTMLElement>('[data-lens]');
    if (!src || e.button > 0) return;
    e.preventDefault();
    const box = src.closest<HTMLElement>('.foresight.skill') ?? src;
    const ghost = document.createElement('div');
    ghost.className = 'lens-drag';
    ghost.innerHTML = `<span class="ld-glass"><i class="lens-glint"></i></span>${reticle('ld-reticle')}<span class="ld-label"></span>`;
    document.body.appendChild(ghost);
    const label = ghost.querySelector<HTMLElement>('.ld-label')!;
    let hover: HTMLElement | null = null;
    let seat: number | null = null;
    const move = (x: number, y: number) => {
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
      // 离开技能框就变成狙击镜（框会重画，每次重新找）
      const r = (document.querySelector<HTMLElement>('.foresight.skill') ?? box).getBoundingClientRect();
      const out = x < r.left || x > r.right || y < r.top || y > r.bottom;
      ghost.classList.toggle('scope', out);
      const hit = out ? seatAt(x, y) : null;
      const s = hit ? Number(hit.dataset.seat) : null;
      seat = s !== null && opts.canDrop(s) ? s : null;
      if (hover !== hit) {
        hover?.classList.remove('lens-hover', 'lens-no');
        hover = hit;
      }
      hover?.classList.toggle('lens-hover', seat !== null);
      hover?.classList.toggle('lens-no', !!hit && seat === null);
      ghost.classList.toggle('locked', seat !== null);
      label.textContent = seat !== null ? `盯住 ${opts.nameOf(seat)}` : hit ? '盯不住' : '';
    };
    const end = (ev: PointerEvent, cancel: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      move(ev.clientX, ev.clientY);
      const s = cancel ? null : seat;
      hover?.classList.remove('lens-hover', 'lens-no');
      if (s !== null) {
        ghost.classList.add('fire');
        setTimeout(() => ghost.remove(), 450);
        opts.onLift(false);
        opts.onDrop(s);
        return;
      }
      // 没盯上：镜片飞回框里
      const back = document.querySelector<HTMLElement>('.lens.lifted') ?? src;
      const r = back.getBoundingClientRect();
      ghost.classList.remove('scope', 'locked');
      ghost.classList.add('return');
      ghost.style.left = `${r.left + r.width / 2}px`;
      ghost.style.top = `${r.top + r.height / 2}px`;
      setTimeout(() => {
        ghost.remove();
        opts.onLift(false);
      }, 260);
    };
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = (ev: PointerEvent) => end(ev, false);
    const onCancel = (ev: PointerEvent) => end(ev, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    move(e.clientX, e.clientY);
    opts.onLift(true);
  });
}

// 盯住的那一下：狙击镜从大缩到头像上，闪一下（谁都看得见）
export function playLensShot(seat: number): void {
  const el = document.querySelector<HTMLElement>(`[data-seat="${seat}"] .portrait, [data-seat="${seat}"] .avatar`) ?? document.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const fx = document.createElement('div');
  fx.className = 'lens-shot';
  fx.style.left = `${r.left + r.width / 2}px`;
  fx.style.top = `${r.top + r.height / 2}px`;
  fx.innerHTML = reticle('ls-reticle');
  document.body.appendChild(fx);
  fx.addEventListener('animationend', () => fx.remove());
  setTimeout(() => fx.remove(), 1600);
}
