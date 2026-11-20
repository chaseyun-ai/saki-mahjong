// 全国大赛的两个页签：团体赛、个人赛（用户 2026-11-20：入口不动白板，进去以后顶上切换）。
// 两边各存各的档；上次看的是哪一边记在浏览器里，下次进全国大赛直接回到那一边

export type NationalTab = 'team' | 'solo';

const TAB_KEY = 'saki.nationalTab';

export function savedTab(): NationalTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'solo' ? 'solo' : 'team';
  } catch {
    return 'team';
  }
}

export function saveTab(t: NationalTab): void {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // 记不住就算了
  }
}

// attr：点击用的属性（团体赛 data-story、个人赛 data-solo），值是 tab，data-tab 写切到哪一边
export function tabsHtml(on: NationalTab, attr: string): string {
  const tab = (t: NationalTab, label: string) =>
    t === on ? `<span class="nt-tab on" aria-current="page">${label}</span>` : `<button class="nt-tab" ${attr}="tab" data-tab="${t}">${label}</button>`;
  return `<nav class="nt-tabs" aria-label="全国大赛">${tab('team', '团体赛')}${tab('solo', '个人赛')}</nav>`;
}
