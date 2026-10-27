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
import type { Ability } from './types';

export interface AiStyle {
  mistakeRate: number; // 偶尔打出非最优牌的概率
  kanEager: boolean; // 能杠就杠
  keepDora: boolean; // 尽量不打宝牌
  useForesight: boolean; // 根据先见决定要不要鸣牌
  foresightRiichi: boolean; // 只在先见到下一巡自摸时才立直，否则默听
  cornerKan: boolean; // 大星淡：等转角暗杠，之前不荣和、不拆暗刻
  suitFocus: boolean; // 石户霞：请神后先打别的花色，做绝掉的那门和字牌
  defensive: boolean; // 别人立直、自己没听牌就弃和
  haitei: boolean; // 天江衣：听牌后靠吃碰把海底挪到自己，海底不是自己的就不立直
  reads: boolean; // 爱宕洋榎：读得出别人听什么，不打别人和得了的牌
  trapWait: boolean; // 爱宕洋榎：听牌时挑引っ掛け（自己打过的牌的筋）的听法
  damaMin: number; // 有役、默听荣和至少这么多就不立直（0 是不看）
  mirror: boolean; // 宫永照：照魔镜看过以后读得出别人听什么（和 reads 一样防守）
  streak: boolean; // 宫永照：连和中不够大的和了先不和，等更大的
  eye: boolean; // 福路美穗子：睁眼后，立直的人手里没有的花色当安全牌
  waves: boolean; // 涅莉：运势很差（-2 以下）的局以防守为主；宣言局门清做大、不弃和
  eastWind: boolean; // 片冈优希：东场（或吃了塔可饼）全力进攻，南场以防守为主
  warm: boolean; // 松实宥：同样向听时留暖色牌
  speed: boolean; // 新子憧：能鸣就鸣；鸣过以后用距离感看谁听牌了
  fish: boolean; // 亦野诚子：能碰就碰，对子多时奔对对和
  memory: boolean; // 染谷真子：读得出没有能力的人听什么，不打他们和得了的牌；留着染手的那门花色和字牌，染手能鸣
  badWait: boolean; // 竹井久：能听烂听牌（只等一种牌）就听烂的
  disrupt: boolean; // 末原恭子：桌上有能力起作用的人时能鸣就鸣，打乱流向
  harvest: boolean; // 涉谷尧深：第一巡打三元牌（种下），最后一局（收获）留着种下的牌
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
  skillArts?: { id: string; name: string }[];
}

export const baseAi: AiStyle = { mistakeRate: 0.08, kanEager: false, keepDora: false, useForesight: false, foresightRiichi: false, cornerKan: false, suitFocus: false, defensive: false, haitei: false, reads: false, trapWait: false, damaMin: 0, mirror: false, streak: false, eye: false, waves: false, eastWind: false, warm: false, speed: false, fish: false, memory: false, badWait: false, disrupt: false, harvest: false };

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
    cost: 1,
    name: '原村和',
    school: '清澄高中',
    color: '#9b7fc4',
    ability: null,
    ai: { ...baseAi, mistakeRate: 0 },
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
    skillArts: SAWAYA_SKILLS.filter((k) => k.ready).map(({ id, name }) => ({ id, name })),
    ai: { ...baseAi },
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
    ai: { ...baseAi, mistakeRate: 0.01, memory: true, damaMin: 3900 },
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
];

export const characterById = (id: string): Character => {
  const c = CHARACTERS.find((x) => x.id === id);
  if (!c) throw new Error(`没有这个角色: ${id}`);
  return c;
};
