import { CHARACTERS, type Character } from '../abilities/characters';

// 选人页按学校分页：一个学校一页，上面一排标签切换。
// 学校的顺序照原作（动画）里比赛出场的先后：
// 长野县预选决赛（清澄、龙门渊、风越、鹤贺）→ 阿知贺篇的全国二回战（阿知贺、千里山）和准决赛（新道寺、白糸台）
// → 全国篇清澄的二回战（永水、宫守、姬松）→ 清澄的准决赛（临海、有珠山）
// 每个学校里照比赛的出场顺序：先锋、次锋、中坚、副将、大将（LINEUP）
export interface School {
  name: string; // 和 Character.school 一样
  short: string; // 标签上的简称
  region: string; // 代表哪里出场
  color: string;
  // 先锋到大将的角色 id；没写进去的新角色排在后面
  lineup: string[];
}

const KNOWN: School[] = [
  { name: '清澄高中', short: '清澄', region: '长野', color: '#e2667a', lineup: ['yuuki', 'mako', 'hisa', 'nodoka', 'saki'] },
  { name: '龙门渊高中', short: '龙门渊', region: '长野', color: '#c7a14a', lineup: ['jun', 'tomoki', 'hajime', 'toka', 'koromo'] },
  { name: '风越女子', short: '风越', region: '长野', color: '#5aa0d8', lineup: ['mihoko', 'miharu', 'seika', 'sumiyo', 'kana'] },
  { name: '鹤贺学园', short: '鹤贺', region: '长野', color: '#8fa0b8', lineup: ['mutsuki', 'kaori', 'satomi', 'momo', 'yumi'] },
  { name: '阿知贺女子学院', short: '阿知贺', region: '奈良', color: '#e89a4c', lineup: ['kuro', 'yu', 'ako', 'arata', 'shizuno'] },
  { name: '千里山女子', short: '千里山', region: '北大阪', color: '#8c6fd1', lineup: ['toki', 'izumi', 'sera', 'hiroko', 'ryuuka'] },
  { name: '新道寺女子', short: '新道寺', region: '福冈', color: '#c8a2d8', lineup: ['kirame', 'mieko', 'hitomi', 'rii', 'himeko'] },
  { name: '白糸台高中', short: '白糸台', region: '西东京', color: '#d9dde6', lineup: ['teru', 'sumire', 'takami', 'seiko', 'awai'] },
  { name: '永水女子', short: '永水', region: '鹿儿岛', color: '#7fbf8a', lineup: ['komaki', 'tomoe', 'haru', 'hatsumi', 'kasumi'] },
  { name: '宫守女子', short: '宫守', region: '岩手', color: '#8a8fc8', lineup: ['shiromi', 'aislinn', 'kurumi', 'sae', 'toyone'] },
  { name: '姬松高中', short: '姬松', region: '南大阪', color: '#d96aa8', lineup: ['suzu', 'yuuko', 'hiroe', 'kinue', 'kyouko'] },
  { name: '临海女子', short: '临海', region: '东东京', color: '#4fc0c0', lineup: ['huiyu', 'nelly'] },
  { name: '有珠山高中', short: '有珠山', region: '北海道', color: '#9fc4e8', lineup: ['sawaya'] },
];

// 有角色的学校；新角色的学校还没登记时排在最后，简称用全名
export const SCHOOLS: School[] = (() => {
  const used = new Set(CHARACTERS.map((c) => c.school));
  const out = KNOWN.filter((s) => used.has(s.name));
  for (const name of used) if (!out.some((s) => s.name === name)) out.push({ name, short: name, region: '', color: '#9aa7b0', lineup: [] });
  return out;
})();

// 这个学校的角色，先锋到大将排好（没写进 lineup 的排在后面，按角色表的顺序）
export const membersOf = (school: string): Character[] => {
  const lineup = SCHOOLS.find((s) => s.name === school)?.lineup ?? [];
  const at = (c: Character) => (lineup.includes(c.id) ? lineup.indexOf(c.id) : lineup.length);
  return CHARACTERS.filter((c) => c.school === school).sort((a, b) => at(a) - at(b));
};

// 全部角色按出场顺序排成一列：学校按 SCHOOLS，学校里先锋到大将
export const APPEARANCE: Character[] = SCHOOLS.flatMap((s) => membersOf(s.name));

// 上次看的是哪一页
const KEY = 'saki.selSchool';
export function savedSchool(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && SCHOOLS.some((s) => s.name === v)) return v;
  } catch {
    // 无痕模式之类读不到，就从第一页开始
  }
  return SCHOOLS[0].name;
}
export function saveSchool(name: string): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // 存不下就算了
  }
}
