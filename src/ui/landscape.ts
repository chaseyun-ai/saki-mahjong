// 手机竖着拿也能横屏玩。
// 试玩页嵌在 Claude App 里时，App 自己只支持竖屏，开了系统自动旋转页面也拿不到横的画面；网页也没法让 App 转过来。
// 所以点一下「横屏」按钮：能进全屏并锁定横屏（安卓浏览器）就用系统的；不行的话把整个 #app 顺时针转 90° 铺满屏幕，
// 手机向左横过来拿（顶部朝左）看到的就是正常的横屏画面。
// 转过来以后，CSS 里的尺寸都按 #app 算（style.css 里的 cqw/cqh 和 @container），
// 只有 getBoundingClientRect、clientX/clientY 这类屏幕坐标要用这里的 toLocal / localRect 换算回 #app 里的坐标。

const KEY = 'saki-landscape';

let want = false;
try {
  want = localStorage.getItem(KEY) === '1';
} catch {
  // 隐私模式下读不到，默认不转
}
let turned = false;
let button: HTMLButtonElement | null = null;

// 现在是不是用 CSS 转着
export function isTurned(): boolean {
  return turned;
}

// #app 里的画面宽高（转着时宽高互换）
export function viewW(): number {
  return turned ? window.innerHeight : window.innerWidth;
}
export function viewH(): number {
  return turned ? window.innerWidth : window.innerHeight;
}

// 屏幕坐标（clientX/clientY）换成 #app 里的坐标
export function toLocal(x: number, y: number): { x: number; y: number } {
  return turned ? { x: y, y: window.innerWidth - x } : { x, y };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// getBoundingClientRect 量出来的框换成 #app 里的框（转 90° 后框还是正的，只是边对调）
export function localRect(r: DOMRect | Box): Box {
  if (!turned) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  const W = window.innerWidth;
  return { left: r.top, top: W - r.right, right: r.bottom, bottom: W - r.left, width: r.height, height: r.width };
}

function portrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

// 只在手指操作的设备上给按钮；已经转着的时候也要能转回来
function touchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

function update(): void {
  const next = want && portrait();
  const root = document.documentElement;
  root.style.setProperty('--turn-w', `${window.innerWidth}px`);
  root.style.setProperty('--turn-h', `${window.innerHeight}px`);
  if (next !== turned) {
    turned = next;
    root.classList.toggle('turned', turned);
    // 2D 牌桌按窗口大小缩放、3D 牌桌按容器大小重算，都听 resize
    window.dispatchEvent(new Event('resize'));
  }
  if (button) {
    button.hidden = !(want || (touchDevice() && portrait()));
    button.textContent = want ? '竖屏' : '横屏';
    button.setAttribute('aria-pressed', String(want));
  }
}

async function toggle(): Promise<void> {
  want = !want;
  try {
    localStorage.setItem(KEY, want ? '1' : '0');
  } catch {
    // 记不住也照样转
  }
  if (want && portrait()) await tryNativeLock();
  else if (!want && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  update();
}

// 安卓浏览器：全屏后可以锁成横屏，画面就是真的横屏，不用 CSS 转。iPhone 和嵌在 App 里时一般会失败，失败就退出全屏
async function tryNativeLock(): Promise<void> {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  if (!document.fullscreenEnabled || !orientation?.lock) return;
  try {
    await document.documentElement.requestFullscreen();
    await orientation.lock('landscape');
  } catch {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }
}

export function setupLandscape(): void {
  button = document.createElement('button');
  button.className = 'turn-btn';
  button.type = 'button';
  button.title = '把画面转成横屏（手机向左横过来拿）';
  button.addEventListener('click', () => void toggle());
  document.body.append(button);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 200));
  // 退出全屏后如果还想横屏，就换成 CSS 转
  document.addEventListener('fullscreenchange', update);
  update();
}
