import { awaiAbility } from './awai';
import { kasumiAbility } from './kasumi';
import { kuroAbility } from './kuro';
import { sakiAbility } from './saki';
import { tokiAbility } from './toki';
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
}

export interface Character {
  id: string;
  name: string;
  school: string;
  color: string;
  ability: Ability | null;
  ai: AiStyle;
}

const baseAi: AiStyle = { mistakeRate: 0.08, kanEager: false, keepDora: false, useForesight: false, foresightRiichi: false, cornerKan: false, suitFocus: false, defensive: false };

export const CHARACTERS: Character[] = [
  {
    id: 'saki',
    name: '宫永咲',
    school: '清澄高中',
    color: '#d97a8f',
    ability: sakiAbility,
    ai: { ...baseAi, kanEager: true },
  },
  {
    id: 'kuro',
    name: '松实玄',
    school: '阿知贺女子学院',
    color: '#c9873a',
    ability: kuroAbility,
    ai: { ...baseAi, keepDora: true },
  },
  {
    id: 'toki',
    name: '园城寺怜',
    school: '千里山女子',
    color: '#6f8fc9',
    ability: tokiAbility,
    // 原作里怜一立直就一发自摸：她看得见下一张，只在确定能和的时候才立直
    ai: { ...baseAi, useForesight: true, foresightRiichi: true },
  },
  {
    id: 'nodoka',
    name: '原村和',
    school: '清澄高中',
    color: '#9b7fc4',
    ability: null,
    ai: { ...baseAi, mistakeRate: 0 },
  },
  {
    id: 'awai',
    name: '大星淡',
    school: '白糸台高中',
    color: '#e3b23c',
    ability: awaiAbility,
    ai: { ...baseAi, cornerKan: true },
  },
  {
    id: 'kasumi',
    name: '石户霞',
    school: '永水女子',
    color: '#5a8f7b',
    ability: kasumiAbility,
    ai: { ...baseAi, suitFocus: true, defensive: true },
  },
];

export const characterById = (id: string): Character => {
  const c = CHARACTERS.find((x) => x.id === id);
  if (!c) throw new Error(`没有这个角色: ${id}`);
  return c;
};
