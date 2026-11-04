// 原村和变成天使和时，牌桌换成她脑子里的网络麻将：换之前放一段网麻客户端登录的过场。
// 浅青色的面板从上往下刷满屏幕（扫描线、进度条），刷满的那一刻 swap 换牌桌，再淡出去。
// 被平行宇宙打回原形时反过来放“登出”

const COVER_MS = 520;
const HOLD_MS = 420;
const FADE_MS = 520;

export function playNetWipe(login: boolean, swap: () => void): void {
  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (reduced) {
    swap();
    return;
  }
  const el = document.createElement("div");
  el.className = `net-wipe ${login ? "login" : "logout"}`;
  el.innerHTML = `
    <div class="nw-panel">
      <div class="nw-title">${login ? "ONLINE MAHJONG" : "LOG OUT"}</div>
      <div class="nw-sub">${login ? "のどっち ログイン中…" : "のどっち ログアウトしました"}</div>
      <div class="nw-bar"><i></i></div>
    </div>`;
  document.body.appendChild(el);
  window.setTimeout(() => {
    swap();
    el.classList.add("out");
    window.setTimeout(() => el.remove(), FADE_MS + 50);
  }, COVER_MS + HOLD_MS);
}
