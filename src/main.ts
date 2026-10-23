import './ui/style.css';
import { App } from './ui/app';
import { DiscardLab } from './lab/discardLab';

const root = document.getElementById('app')!;
// #lab 是出牌动作调试场景，其余是游戏
if (location.hash === '#lab') new DiscardLab(root);
else new App(root);
// 进出调试场景时整页重新加载，两边互不干扰
window.addEventListener('hashchange', () => location.reload());
