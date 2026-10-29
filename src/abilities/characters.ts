import { awaiAbility } from './awai';
import { hiroeAbility } from './hiroe';
import { kasumiAbility } from './kasumi';
import { koromoAbility } from './koromo';
import { kuroAbility } from './kuro';
import { mihokoAbility } from './mihoko';
import { nellyAbility } from './nelly';
import { sakiAbility } from './saki';
import { SAWAYA_SKILLS, sawayaAbility } from './sawaya';
import { teruAbility } from './teru';
import { akoAbility } from './ako';
import { seikoAbility } from './seiko';
import { yuAbility } from './yu';
import { yuukiAbility } from './yuuki';
import { tokiAbility } from './toki';
import { makoAbility } from './mako';
import { hisaAbility } from './hisa';
import { kyoukoAbility } from './kyouko';
import { takamiAbility } from './takami';
import { nodokaAbility } from './nodoka';
import { momoAbility } from './momo';
import { setCosts } from './costs';
import { ryuukaAbility } from './ryuuka';
import { sumireAbility } from './sumire';
import { seraAbility } from './sera';
import { KOMAKI_GODS, komakiAbility } from './komaki';
import { ROKUYOU, toyoneAbility } from './toyone';
import { suzuAbility } from './suzu';
import { kirameAbility } from './kirame';
import type { Ability } from './types';

export interface AiStyle {
  mistakeRate: number; // 偶尔打出非最优牌的概率
  kanEager: boolean; // 能杠就杠
  keepDora: boolean; // 尽量不打宝牌
  useForesight: boolean; // 根据先见决定要不要鸣牌
  foresightRiichi: boolean; // 只在先见到下一巡自摸时才立直，否则默听
  cornerKan: boolean; // 大星淡：等转角暗杠，之前不荣和、不拆暗刻
  suitFocus: boolean; // 石户霞：请神后先打别的花色，做绝掉的那门和字牌
  defensive: boolean; // 别人立直、自己没听牌就弃和（霞请神以后不算）
  haitei: boolean; // 天江衣：听牌后靠吃碰把海底挪到自己，海底不是自己的就不立直
  reads: boolean; // 爱宕洋榎：读得出别人听什么，不打别人和得了的牌
  trapWait: boolean; // 爱宕洋榎：听牌时挑引っ掛け（自己打过的牌的筋）的听法
  damaMin: number; // 有役、默听荣和至少这么多就不立直（0 是不看）
  mirror: boolean; // 宫永照：照魔镜看过以后读得出别人听什么（和 reads 一样防守）
  streak: boolean; // 宫永照：天梯要正好和出下一层，比下一层小的先不和；默听、立直挑接得上的；要和 1 番、2 番时小牌快和
  eye: boolean; // 福路美穗子：睁眼后，立直的人手里没有的花色当安全牌
  waves: boolean; // 涅莉：负运势的局不做危险进攻（有人逼近时不打危险牌、不立直）；宣言局门清做大、不弃和，牌不够大先不和、不立直
  eastWind: boolean; // 片冈优希：东场（或吃了塔可饼）全力进攻，南场以防守为主；东场坐庄的烂听牌先默听等改良，不坐庄以和牌为先
  warm: boolean; // 松实宥：同样向听时留暖色牌，万子混一色能鸣
  speed: boolean; // 新子憧：能鸣就鸣；鸣过以后用距离感看谁听牌了
  fish: boolean; // 亦野诚子：能碰就碰，对子多时奔对对和；鸣满三次听牌了不弃和
  memory: boolean; // 染谷真子：读得出没有能力的人听什么，不打他们和得了的牌；留着染手的那门花色和字牌，染手能鸣
  badWait: boolean; // 竹井久：能听烂听牌（只等一种牌）就听烂的，听烂听牌时不因为听得窄就收
  disrupt: boolean; // 末原恭子：桌上有能力起作用的人时能鸣就鸣，打乱流向
  harvest: boolean; // 涉谷尧深：第一巡打三元牌（种下），最后一局（收获）留着种下的牌、不弃和
  clouds: boolean; // 狮子原爽：留住云、神威送来的牌，往混一色做、能鸣就鸣；发动的局牌小先默听等改良
  angel: boolean; // 原村和：变成天使和以后不再失误，读得出 8000 点以上的铳牌、不打它们
  sniper: boolean; // 弘世堇：听牌时挑听目标多余牌的打法；有役就默听，只和目标打的牌
  firepower: boolean; // 江口夕：从不默听、从不弃和，不到满贯先不和；不吃，只碰役牌；留着宝牌和役牌
  mugoku: boolean; // 清水谷龙华：无极天的局读得出别人听什么，不打放铳的牌；看得出谁听牌了
  gods: boolean; // 神代小莳：按附身的神打（木花咲耶姬能杠就杠、须佐之男能碰就碰、天照读得出铳牌）
  rokuyou: boolean; // 姊带丰音：先负还能发动时默听，先负发动后听牌就追立、不弃和；副露两次以上、有役时能鸣就鸣（奔友引）
  stealth: boolean; // 东横桃子：隐身之前听牌先默听，隐身以后再立直（别人不知道她立直了）
}

export interface Character {
  id: string;
  name: string;
  school: string;
  color: string;
  // 团体赛选人的费用档位（1–5）：每队每档选一人，正好 15 费。档位只在这里改
  cost: number;
  ability: Ability | null;
  ai: AiStyle;
  // 素材页给这几个技能各留一个动画槽，发动时放这一段（name 和能力发动时出的字一样）
  // label、hint 是素材页上格子的名字和说明，不写按 name 来
  skillArts?: { id: string; name: string; label?: string; hint?: string }[];
}

export const baseAi: AiStyle = { mistakeRate: 0.08, kanEager: false, keepDora: false, useForesight: false, foresightRiichi: false, cornerKan: false, suitFocus: false, defensive: false, haitei: false, reads: false, trapWait: false, damaMin: 0, mirror: false, streak: false, eye: false, waves: false, eastWind: false, warm: false, speed: false, fish: false, memory: false, badWait: false, disrupt: false, harvest: false, clouds: false, angel: false, sniper: false, firepower: false, mugoku: false, gods: false, rokuyou: false, stealth: false };

export const CHARACTERS: Character[] = [
  {
    id: 'saki',
    cost: 4,
    name: '宫永咲',
    school: '清澄高中',
    color: '#d97a8f',
    ability: sakiAbility,
    ai: { ...baseAi, kanEager: true },
  },
  {
    id: 'kuro',
    cost: 2,
    name: '松实玄',
    school: '阿知贺女子学院',
    color: '#c9873a',
    ability: kuroAbility,
    ai: { ...baseAi, keepDora: true },
  },
  {
    id: 'toki',
    cost: 3,
    name: '园城寺怜',
    school: '千里山女子',
    color: '#6f8fc9',
    ability: tokiAbility,
    // 原作里怜一立直就一发自摸：她看得见下一张，只在确定能和的时候才立直
    ai: { ...baseAi, useForesight: true, foresightRiichi: true },
  },
  {
    id: 'nodoka',
    cost: 2,
    name: '原村和',
    school: '清澄高中',
    color: '#9b7fc4',
    ability: nodokaAbility,
    skillArts: [
      { id: 'angel', name: '天使和', label: '天使形态动画', hint: '变身天使和的那一局开头放这一段。变身以后头像框换成“能力发动头像”。可以用 GIF 或视频（MP4、WebM，最长放 6 秒）' },
      { id: 'angel-win', name: '天使和和牌', label: '天使形态和牌动画', hint: '天使和荣和、自摸时放这一段，盖过“和牌切入”。可以用 GIF 或视频（MP4、WebM，最长放 6 秒）' },
    ],
    // 平时偶尔也会看漏，变成天使和以后不再失误
    ai: { ...baseAi, mistakeRate: 0.03, angel: true },
  },
  {
    id: 'awai',
    cost: 5,
    name: '大星淡',
    school: '白糸台高中',
    color: '#e3b23c',
    ability: awaiAbility,
    ai: { ...baseAi, cornerKan: true },
  },
  {
    id: 'kasumi',
    cost: 3,
    name: '石户霞',
    school: '永水女子',
    color: '#5a8f7b',
    ability: kasumiAbility,
    ai: { ...baseAi, suitFocus: true, defensive: true },
  },
  {
    id: 'koromo',
    cost: 5,
    name: '天江衣',
    school: '龙门渊高中',
    color: '#c0504d',
    ability: koromoAbility,
    ai: { ...baseAi, haitei: true },
  },
  {
    id: 'hiroe',
    cost: 2,
    name: '爱宕洋榎',
    school: '姬松高中',
    color: '#d9733f',
    ability: hiroeAbility,
    ai: { ...baseAi, reads: true, trapWait: true, damaMin: 3900 },
  },
  {
    id: 'teru',
    cost: 5,
    name: '宫永照',
    school: '白糸台高中',
    color: '#a8324a',
    ability: teruAbility,
    ai: { ...baseAi, mistakeRate: 0.03, mirror: true, streak: true },
  },
  {
    id: 'mihoko',
    cost: 3,
    name: '福路美穗子',
    school: '风越女子',
    color: '#3f9fb5',
    ability: mihokoAbility,
    ai: { ...baseAi, mistakeRate: 0.02, defensive: true, eye: true },
  },
  {
    id: 'nelly',
    cost: 4,
    name: '涅莉·薇萨拉兹',
    school: '临海女子',
    color: '#c2185b',
    ability: nellyAbility,
    ai: { ...baseAi, mistakeRate: 0.03, waves: true },
  },
  {
    id: 'sawaya',
    cost: 4,
    name: '狮子原爽',
    school: '有珠山高中',
    color: '#7a8fa6',
    ability: sawayaAbility,
    skillArts: SAWAYA_SKILLS.map(({ id, name }) => ({ id, name })),
    ai: { ...baseAi, clouds: true },
  },
  {
    id: 'yuuki',
    cost: 3,
    name: '片冈优希',
    school: '清澄高中',
    color: '#f0a020',
    ability: yuukiAbility,
    ai: { ...baseAi, eastWind: true },
  },
  {
    id: 'yu',
    cost: 2,
    name: '松实宥',
    school: '阿知贺女子学院',
    color: '#e0603a',
    ability: yuAbility,
    ai: { ...baseAi, mistakeRate: 0.05, warm: true },
  },
  {
    id: 'ako',
    cost: 1,
    name: '新子憧',
    school: '阿知贺女子学院',
    color: '#e86aa6',
    ability: akoAbility,
    ai: { ...baseAi, speed: true },
  },
  {
    id: 'seiko',
    cost: 2,
    name: '亦野诚子',
    school: '白糸台高中',
    color: '#3a8fd0',
    ability: seikoAbility,
    ai: { ...baseAi, fish: true },
  },
  {
    id: 'mako',
    cost: 1,
    name: '染谷真子',
    school: '清澄高中',
    color: '#3f8a5a',
    ability: makoAbility,
    ai: { ...baseAi, mistakeRate: 0.04, memory: true, damaMin: 3900 },
  },
  {
    id: 'hisa',
    cost: 3,
    name: '竹井久',
    school: '清澄高中',
    color: '#b5413f',
    ability: hisaAbility,
    ai: { ...baseAi, mistakeRate: 0.03, badWait: true },
  },
  {
    id: 'kyouko',
    cost: 1,
    name: '末原恭子',
    school: '姬松高中',
    color: '#5f6fa8',
    ability: kyoukoAbility,
    ai: { ...baseAi, mistakeRate: 0.02, disrupt: true, defensive: true },
  },
  {
    id: 'takami',
    cost: 2,
    name: '涉谷尧深',
    school: '白糸台高中',
    color: '#8a6fb0',
    ability: takamiAbility,
    ai: { ...baseAi, harvest: true },
  },
  {
    id: 'izumi',
    cost: 1,
    name: '二条泉',
    school: '千里山女子',
    color: '#4f7fc4',
    ability: null,
    ai: { ...baseAi },
  },
  {
    id: 'sumire',
    cost: 2,
    name: '弘世堇',
    school: '白糸台高中',
    color: '#3e5a96',
    ability: sumireAbility,
    skillArts: [{ id: 'snipe', name: '狙击' }],
    ai: { ...baseAi, mistakeRate: 0.03, sniper: true },
  },
  {
    id: 'sera',
    cost: 3,
    name: '江口夕',
    school: '千里山女子',
    color: '#c2552e',
    ability: seraAbility,
    ai: { ...baseAi, mistakeRate: 0.05, firepower: true },
  },
  {
    id: 'ryuuka',
    cost: 3,
    name: '清水谷龙华',
    school: '千里山女子',
    color: '#4c7a62',
    ability: ryuukaAbility,
    skillArts: [
      { id: 'pillow', name: '怜的膝枕' },
      { id: 'mugoku', name: '无极天' },
    ],
    ai: { ...baseAi, mistakeRate: 0.03, useForesight: true, mugoku: true },
  },
  {
    id: 'komaki',
    cost: 5,
    name: '神代小莳',
    school: '永水女子',
    color: '#b07ab8',
    ability: komakiAbility,
    // 神降下来、醒来、神乐各一格；天宇受卖命的那一格放神乐
    skillArts: [...KOMAKI_GODS.map(({ id, name }) => (id === 'uzume' ? { id, name: '神乐', label: '天宇受卖命·神乐' } : { id, name })), { id: 'wake', name: '醒来' }],
    ai: { ...baseAi, mistakeRate: 0.05, gods: true },
  },
  {
    id: 'toyone',
    cost: 4,
    name: '姊带丰音',
    school: '宫守女子',
    color: '#4a4a6a',
    ability: toyoneAbility,
    skillArts: ROKUYOU.map(({ id, name }) => ({ id, name })),
    ai: { ...baseAi, mistakeRate: 0.04, rokuyou: true },
  },
  {
    id: 'suzu',
    cost: 3,
    name: '上重漫',
    school: '姬松高中',
    color: '#e0892f',
    ability: suzuAbility,
    skillArts: [{ id: 'burst', name: '爆发' }],
    ai: { ...baseAi, mistakeRate: 0.06 },
  },
  {
    id: 'momo',
    cost: 3,
    name: '东横桃子',
    school: '鹤贺学园',
    color: '#8c9aa8',
    ability: momoAbility,
    ai: { ...baseAi, mistakeRate: 0.04, stealth: true },
  },
  {
    id: 'kirame',
    cost: 1,
    name: '花田煌',
    school: '新道寺女子',
    color: '#e0a23a',
    ability: kirameAbility,
    ai: { ...baseAi },
  },
];

setCosts(Object.fromEntries(CHARACTERS.map((c) => [c.id, c.cost])));

export const characterById = (id: string): Character => {
  const c = CHARACTERS.find((x) => x.id === id);
  if (!c) throw new Error(`没有这个角色: ${id}`);
  return c;
};
