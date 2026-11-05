import type { Game } from '../engine/game';
import { Kind, SOUTH, WEST, isHonor } from '../engine/tiles';
import { aislinnPlan } from './aislinn';
import { isPin } from './arata';
import { hatsumiOpen } from './hatsumi';
import { isDoraTile, kuroLost } from './kuro';
import { seraYakuhai } from './sera';
import { isHigh, suzuBurst } from './suzu';
import { warmKind } from './yu';

// 船久保浩子（千里山）：没有能力，是队里的数据分析担当。看过所有对手的牌谱，知道每个能力者靠什么和牌、怎么打断。
// 电脑的浩子（AiStyle.scout）照“经验”打：
// - 鸣牌打断：手绘板画着的爱丽丝（一鸣就碎）、立直一发巡的怜和龙华（错开先见到的那张）、立直的能力者（错开摸牌顺序），
//   不退向听就鸣；衣的海底每局都去错开（和咲、久她们一样）
// - 防守：知道能力者要的是什么牌，那家要防的时候，那些牌当成更危险的牌
// 只用桌上看得见的东西（谁坐在哪、手绘板、立直、副露、宝牌），不偷看手牌和牌山
export const HIROKO = {
  minWall: 8, // 牌山剩这么多以上才为了打断而鸣
};

// 资料本：每种能力的对策（玩家用浩子时，对手头像上的“资”能看到）
export const HIROKO_NOTES: Record<string, string> = {
  saki: '听牌前留着杠。她开过杠就当她听牌了',
  kuro: '宝牌全在她手里：她立直时宝牌别打',
  toki: '立直就是看到了一发自摸：一发巡里鸣一手错开',
  nodoka: '平时是数字派，天使和以后看得出大牌的铳牌',
  awai: '天听、两立直，开局后第二个转角暗杠自摸。照常打，别放铳',
  kasumi: '请神以后绝一门，染手那门和字牌危险',
  koromo: '海底归她时，最后几张里鸣一手把海底错开',
  hiroe: '读得出铳牌，不会给你点',
  teru: '连续和了一层比一层大，别人的能力动不了她',
  mihoko: '睁开右眼看得出花色，不会给你点',
  nelly: '押了运势的局会在固定的巡目和，挡不住三倍满',
  sawaya: '云和神威：云的颜色就是她要的牌',
  yuuki: '东场最强，南场没劲：东场别硬拼',
  yu: '万子、中、赤五和一三五七九筒、五七九索往她手里聚',
  ako: '鸣得越多摸得越顺，看得出谁离听牌近',
  seiko: '鸣满三次以后两巡内自摸：鸣到两次就防',
  mako: '记得住没有能力的人的打牌习惯',
  hisa: '专听烂听牌，筋、现物旁边也危险',
  kyouko: '凡人，靠鸣牌打乱流向',
  takami: '第一巡打的字牌，最后一局会收回来',
  sumire: '瞄准领先的人，只和目标打的牌',
  sera: '火力型，宝牌、役牌多，不到满贯不和',
  ryuuka: '借怜的膝枕时看得见下一张：一发巡里鸣一手错开',
  komaki: '神降下来以后才可怕：木花咲耶姬能杠，天照读得出铳牌',
  toyone: '先负时默听，有人立直以后追上来',
  shiromi: '迷途之家照算出来的打，不立直也会自摸',
  kurumi: '从不立直，默听时自摸多',
  aislinn: '手绘板画着时鸣一手就碎',
  suzu: '爆发以后六到九的数牌往她手里聚',
  momo: '第七巡以后看不见她，打牌照现物、安全牌',
  rii: '番缚和出来就拿到钥匙，交给后面的姬子',
  himeko: '拿到钥匙的那一局谁也挡不住，别放铳就好',
  shizuno: '局数越往后越强，深山的雾起来以后宝牌都是她的',
  arata: '听四、六、七、八、九饼：这些筒子危险',
  kirame: '不会被击飞，最后几千点也打不下来',
  sae: '镜片盯上谁，谁这一局就和不了',
  haru: '别人立直以后快和小牌',
  hatsumi: '坐北家时西风、南风留给她：东北鸣出来以后西南风一张都别打',
  toka: '点数变动大了以后治水：吃碰杠几乎不出现，自摸减半',
  jun: '鸣一次，别人到她下一次摸牌前都不进张',
  kana: '点数低于一万以后越打越顺',
  kaori: '新手，偶尔拿到役满听牌：她不鸣牌只摸切时当心',
  yumi: '比普通人顺一点，冷静不失误',
  kinue: '手里有一筒就更容易摸到一筒：一筒危险',
};

// 能力还在起作用的对手
const live = (g: Game, s: number, id: string) => g.active(s)?.id === id && !g.isSealed(s);

// 为了打断谁鸣牌：any 是不退向听就鸣（要有役），urgent 是没役也鸣（爱丽丝的手绘板、一发巡的先见）
export function hirokoDisrupt(g: Game, seat: number): { any: boolean; urgent: boolean } {
  if (g.wall.remaining < HIROKO.minWall) return { any: false, urgent: false };
  let any = false;
  let urgent = false;
  for (let s = 0; s < 4; s++) {
    if (s === seat || !g.active(s) || g.isSealed(s) || g.isImmune(s) || g.isAbsolute(s)) continue;
    const p = g.players[s];
    if (aislinnPlan(g, s)) urgent = true;
    const riichi = g.seesRiichi(s, seat);
    if (riichi) any = true;
    if (riichi && p.ippatsu && (live(g, s, 'toki') || (live(g, s, 'ryuuka') && !!g.active(s)?.foresightOn?.(g, s)))) urgent = true;
  }
  return { any: any || urgent, urgent };
}

// 防守：threat 要防时，她能力要的牌额外危险多少（加在危险度上）
export function hirokoBias(g: Game, seat: number, threat: number, k: Kind): number {
  const id = g.active(threat)?.id;
  if (!id || g.isSealed(threat) || threat === seat) return 0;
  switch (id) {
    case 'suzu':
      return suzuBurst(g, threat) && isHigh(k) ? 3 : 0;
    case 'arata':
      return isPin(k) && (k === 12 || k >= 14) ? 4 : 0;
    case 'yu':
      return warmKind(k) ? 2 : 0;
    case 'hatsumi':
      return hatsumiOpen(g, threat) && (k === SOUTH || k === WEST) ? 8 : 0;
    case 'kuro':
      return !kuroLost(g, threat) && doraKind(g, k) ? 4 : 0;
    case 'sera':
      return (isHonor(k) && seraYakuhai(g, threat, k)) || doraKind(g, k) ? 2 : 0;
    case 'kinue':
      return k === 9 ? 3 : 0;
    default:
      return 0;
  }
}

// 这种牌是不是宝牌（不看赤：id 是 4k+3 的那张从来不是赤五）
const doraKind = (g: Game, k: Kind) => isDoraTile(g, k * 4 + 3);
