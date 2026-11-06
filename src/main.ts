import './ui/style.css';
import './ui/themes.css';
import { App } from './ui/app';
import { DiscardLab } from './lab/discardLab';
import { BracketPreview } from './story/bracketPreview';
import { applyTheme } from './ui/theme';

applyTheme();

let root = document.getElementById('app')!;

// 游戏和出牌动作调试场景来回切换：换一个新的 #app，旧的连同上面的点击监听一起扔掉，两边互不干扰。
// 不靠改网址再刷新页面，嵌在别的页面里（比如试玩页）也能切
type Page = 'game' | 'lab' | 'bracket';
const pageOf = (hash: string): Page => (hash === '#lab' ? 'lab' : hash === '#bracket' ? 'bracket' : 'game');

function show(page: Page): void {
  const fresh = root.cloneNode(false) as HTMLElement;
  root.replaceWith(fresh);
  root = fresh;
  try {
    // 记在网址上，刷新后还在同一个地方；用 replaceState 不会触发下面的 hashchange
    history.replaceState(null, '', page === 'game' ? location.pathname + location.search : `#${page}`);
  } catch {
    // 有的地方不让改网址，不影响切换
  }
  if (page === 'lab') new DiscardLab(root, () => show('game'));
  // 晋级表预览：剧情模式接上之前，网址加 #bracket 单独看
  else if (page === 'bracket') new BracketPreview(root, () => show('game'));
  else new App(root, () => show('lab'));
}

show(pageOf(location.hash));
// 手动改网址进出调试场景时，整页重新加载
window.addEventListener('hashchange', () => location.reload());
