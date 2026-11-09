import { optsHtml, panelHtml, rowHtml, section } from './matchSetup';
import { RiiLookProfile, lookChoices, riiLook } from './riiLook';

// 白水哩番缚的局外设置（选人页上她头像右上角的齿轮）：锁链、头像锁、音效，只列留下来的几种；
// 「白水哩 · 姬子测试」窗口（右上角「更多」里）：全部样子都能挑，另外记一份，下面直接开测试对局。

export type RiiTestStart = 'rii' | 'riichi' | 'pair' | 'himeko-key' | 'himeko-broken';

function looksHtml(p: RiiLookProfile): string {
  const c = lookChoices(p);
  const opts = (k: 'proj' | 'chain' | 'plock' | 'sfx', list: { id: string; name: string }[]) =>
    optsHtml(
      'rii-opt',
      k,
      list.map((x) => ({ label: x.name, value: x.id })),
      riiLook[k],
    );
  const tries = [
    ['lock', '锁上'],
    ['key', '拿到钥匙'],
    ['broken', '没和成'],
  ]
    .map(([v, label]) => `<button class="rii-try" data-ui="rii-try" data-v="${v}">▶ ${label}</button>`)
    .join('');
  return (
    (c.proj.length > 1 ? rowHtml('投影', opts('proj', c.proj), '手牌扣下去以后，上方投影的牌面朝哪边') : '') +
    rowHtml('锁链', opts('chain', c.chain)) +
    rowHtml('头像锁', opts('plock', c.plock), '锁上以后挂在她头像上的那把锁') +
    rowHtml('音效', opts('sfx', c.sfx)) +
    rowHtml('试听', tries)
  );
}

// 局外设置：平常的对局照这里
export function riiSetPanelHtml(): string {
  return panelHtml('rii', '番缚设置', '白水哩 · 改了马上生效，下一次番缚照这里', looksHtml('main'), '');
}

// 测试窗口：全部样子 + 开测试对局
export function riiTestPanelHtml(): string {
  const go = (v: RiiTestStart, label: string) => `<button class="rii-go" data-ui="rii-test-go" data-v="${v}">${label}</button>`;
  const body =
    section('番缚的样子（全部，只用在这里开的测试对局）') +
    looksHtml('test') +
    section('开一局测试') +
    rowHtml('白水哩', go('rii', '自己打白水哩') + go('pair', '白水哩，姬子同桌'), '对局里选番面板、技能框也能换样子，缚上以后可以直接试结算') +
    rowHtml('立直就能自摸', go('riichi', '自己打白水哩'), '每局配牌听牌，第一张字牌打出去立直，下一张自摸（没人鸣牌时两立直、一发、自摸、平和 5 番）') +
    rowHtml('鹤田姬子', go('himeko-key', '每局都是钥匙局') + go('himeko-broken', '每局都是破碎的钥匙'), '自己是姬子，开局就是那一局');
  return panelHtml('rii-test', '白水哩 · 姬子测试', '对局规则照「对局设置」', body, '');
}
