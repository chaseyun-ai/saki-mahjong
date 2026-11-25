import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, matchPanelHtml, visualPanelHtml } from '../src/ui/matchSetup';

// 设置面板列出来的每一项都得在 ROWS 里有一行。拿掉一行（比如出牌动作）却忘了从面板的清单里删，
// 整个视觉页就画不出来，点「视觉」没反应
describe('设置面板', () => {
  it('视觉页画得出来，动画那几项都在，出牌动作不再出现', () => {
    const html = visualPanelHtml({ ...DEFAULT_SETTINGS }, 'broadcast', '25d', false, 'skin');
    for (const name of ['过场动画', '摸牌路径', '微变化', '立直宣言', '牌河摆放', '和牌聚光灯', '和牌转镜头', '淡的连招特写']) {
      expect(html).toContain(`<span class="setup-name">${name}`);
    }
    expect(html).not.toContain('data-k="discardFx"');
  });

  it('改良布局多出来的几项也画得出来', () => {
    const html = visualPanelHtml({ ...DEFAULT_SETTINGS, layout: 'improved' }, 'classic', '25d', true, 'wood');
    for (const name of ['2.5D 布局', '改良布局的手牌', '自摸动作', '通用自摸', '自摸顺序', '结算画面']) {
      expect(html).toContain(`<span class="setup-name">${name}`);
    }
  });

  // 只在 2.5D（改良）有用的几项，换到别的视角就不列出来，免得选了没反应
  it('别的视角不列 2.5D 改良专属的几项', () => {
    const only25 = ['2.5D 布局', '改良布局的手牌', '自摸动作', '通用自摸', '自摸顺序'];
    const top = ['俯视 2D 的手牌', '俯视 2D 手牌倾斜', '俯视 2D 手牌透明度'];
    const s = { ...DEFAULT_SETTINGS, layout: 'improved' as const };
    const has = (html: string, name: string) => html.includes(`<span class="setup-name">${name}`);
    const in3d = visualPanelHtml(s, 'classic', '3d', true, 'wood');
    expect(only25.concat(top).filter((n) => has(in3d, n))).toEqual([]);
    expect(has(in3d, '结算画面')).toBe(true);
    const inTop = visualPanelHtml(s, 'classic', 'top', true, 'wood');
    expect(only25.filter((n) => has(inTop, n))).toEqual([]);
    expect(top.filter((n) => !has(inTop, n))).toEqual([]);
    const in2d = visualPanelHtml(s, 'classic', '2d', true, 'wood');
    expect(only25.concat(top, ['结算画面']).filter((n) => has(in2d, n))).toEqual([]);
    const plain25 = visualPanelHtml({ ...DEFAULT_SETTINGS, layout: 'classic' as never }, 'classic', '25d', true, 'wood');
    expect(has(plain25, '2.5D 布局')).toBe(true);
    expect(has(plain25, '改良布局的手牌')).toBe(false);
  });

  it('对局页画得出来', () => {
    const html = matchPanelHtml({ ...DEFAULT_SETTINGS });
    for (const name of ['局数', '起始点数', '一位必要点数', '击飞', '赤宝牌', '食断', '番缚', '公开手牌']) {
      expect(html).toContain(`<span class="setup-name">${name}`);
    }
  });
});
