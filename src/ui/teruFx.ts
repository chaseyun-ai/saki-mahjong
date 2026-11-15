import './teruFx.css';

// 宫永照的两段演出，三种视角共用：都画在盖住整个页面的一层上（position: fixed），不跟着牌桌重画。
// - 照魔镜：镜子局开始时，另外三家的头像上各罩一面镜子，镜面扫过一道光（原作里对手背后升起的那面镜子）
// - 旋风自摸：连和中自摸，从她手边朝桌心卷出一道旋风（原作里卷在右手上的那股风），连和的次数越多越粗、越长

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// 镜子从出现到散掉多久（毫秒），三面镜子一面接一面，隔 MIRROR_GAP
export const MIRROR_MS = 2400;
const MIRROR_GAP = 180;

// 八瓣的镜缘：外圈一圈小珠，里面两道细线
function mirrorSvg(): string {
  const studs = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return `<circle cx="${(Math.cos(a) * 53).toFixed(2)}" cy="${(Math.sin(a) * 53).toFixed(2)}" r="${i % 2 ? 1.5 : 2.6}"/>`;
  }).join('');
  return `<svg viewBox="-60 -60 120 120" aria-hidden="true">
    <circle r="53" fill="none" stroke="currentColor" stroke-width="5.5"/>
    <circle r="47.5" fill="none" stroke="rgba(60,40,10,0.55)" stroke-width="1.2"/>
    <circle r="45.5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.8"/>
    <g fill="#fff8dc">${studs}</g>
  </svg>`;
}

// 照魔镜：spots 是三家头像在页面上的位置（getBoundingClientRect）
export function teruMirrors(spots: { left: number; top: number; width: number; height: number }[]): void {
  if (reduced()) return;
  spots.forEach((r, i) => {
    if (r.width <= 0) return;
    const el = document.createElement('div');
    el.className = 'teru-mirror';
    // 比头像大一圈；大头像框上不超过 200px（不然伸出画面）
    const d = Math.min(200, Math.max(96, Math.max(r.width, r.height) * 1.25));
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top + r.height / 2}px`;
    el.style.setProperty('--d', `${d.toFixed(0)}px`);
    el.style.setProperty('--delay', `${i * MIRROR_GAP}ms`);
    el.innerHTML = `<i class="tm-glass"><i class="tm-shine"></i></i>${mirrorSvg()}<i class="tm-glint"></i>`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), MIRROR_MS + i * MIRROR_GAP + 200);
  });
}

