import './ui/style.css';
import './ui/themes.css';
import './ui/themes2.css';
import './ui/tableStyles.css';
import './pixel/pixel.css';
import { App } from './ui/app';
import { DiscardLab } from './lab/discardLab';
import { NationalFlow } from './story/national';
import { IndividualFlow } from './story/individual';
import { applyTheme } from './ui/theme';
import { installPixelDefs } from './pixel/dom';
import { installSoundPanel } from './ui/soundPanel';
import { installSoundtrack, stopMusic } from './ui/soundtrack';
import { startCustomAssets } from './assets/layers';
import { AssetImporter } from './assets/importer';

applyTheme();
// 像素皮肤用的 SVG 滤镜（头像、主页纸上的字一块块取色）
installPixelDefs();
// 声音设置面板：选人页顶栏和对局里的喇叭按钮都开它
installSoundPanel();
// 背景音乐、按钮的点击声：等玩家第一次点了才出声
installSoundtrack();
// 素材导入换上的素材（项目里 public/custom 的、玩家存在浏览器里的）：都没有就什么都不做
void startCustomAssets();

let root = document.getElementById('app')!;

// 游戏和出牌动作调试场景来回切换：换一个新的 #app，旧的连同上面的点击监听一起扔掉，两边互不干扰。
// 不靠改网址再刷新页面，嵌在别的页面里（比如试玩页）也能切
type Page = 'game' | 'lab' | 'bracket' | 'solo' | 'assets';
const pageOf = (hash: string): Page => (hash === '#lab' ? 'lab' : hash === '#bracket' ? 'bracket' : hash === '#solo' ? 'solo' : hash === '#assets' ? 'assets' : 'game');

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
  // 调试场景、晋级表不放音乐（回到游戏时选人页自己会放）
  if (page !== 'game') stopMusic();
  if (page === 'lab') new DiscardLab(root, () => show('game'));
  // 全国大赛单独看（网址加 #bracket 是团体赛、#solo 是个人赛）：没有牌桌，玩家那桌只能交给电脑打
  else if (page === 'bracket') new NationalFlow(root, { exit: () => show('game'), switchTab: () => show('solo') });
  else if (page === 'solo') new IndividualFlow(root, { exit: () => show('game'), switchTab: () => show('bracket') });
  // 素材导入单独打开（网址加 #assets，素材导入.bat 就开这里）
  else if (page === 'assets') new AssetImporter(root, () => show('game'));
  else new App(root, () => show('lab'));
}

show(pageOf(location.hash));
// 手动改网址进出调试场景时，整页重新加载
window.addEventListener('hashchange', () => location.reload());
