import { CHARACTERS, type Character } from '../abilities/characters';

// 选人页按学校分页：一个学校一页，上面一排标签切换。顺序照原作出场，长野三校在前
export interface School {
  name: string; // 和 Character.school 一样
  short: string; // 标签上的简称
  region: string; // 代表哪里出场
  color: string;
}

const KNOWN: School[] = [
  { name: '清澄高中', short: '清澄', region: '长野', color: '#e2667a' },
  { name: '龙门渊高中', short: '龙门渊', region: '长野', color: '#c7a14a' },
  { name: '风越女子', short: '风越', region: '长野', color: '#5aa0d8' },
  { name: '阿知贺女子学院', short: '阿知贺', region: '奈良', color: '#e89a4c' },
  { name: '千里山女子', short: '千里山', region: '北大阪', color: '#8c6fd1' },
  { name: '白糸台高中', short: '白糸台', region: '西东京', color: '#d9dde6' },
  { name: '姬松高中', short: '姬松', region: '南大阪', color: '#d96aa8' },
  { name: '永水女子', short: '永水', region: '鹿儿岛', color: '#7fbf8a' },
  { name: '临海女子', short: '临海', region: '东东京', color: '#4fc0c0' },
  { name: '有珠山高中', short: '有珠山', region: '北海道', color: '#9fc4e8' },
];

// 有角色的学校；新角色的学校还没登记时排在最后，简称用全名
export const SCHOOLS: School[] = (() => {
  const used = new Set(CHARACTERS.map((c) => c.school));
  const out = KNOWN.filter((s) => used.has(s.name));
  for (const name of used) if (!out.some((s) => s.name === name)) out.push({ name, short: name, region: '', color: '#9aa7b0' });
  return out;
})();

export const membersOf = (school: string): Character[] => CHARACTERS.filter((c) => c.school === school);

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
