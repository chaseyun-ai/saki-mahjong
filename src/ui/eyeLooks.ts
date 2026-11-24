import { LOOKS } from '../ui3d/looks';

// 能力发动时的睁眼特写（eyeShot.ts）用的眼睛参数。
// 天麻的画风很统一，所以所有人共用一个眼睛模板（eyeDraw.ts），每人只换这几样：
// 瞳色、发色（前发和眉毛）、肤色、瞳孔、高光、眼型、发动时的光和光尾。
// 瞳色、发色默认取 3D 模型染色用的那一份（looks.ts 的 LOOKS），这里只写和默认不一样的。

// 瞳孔：round 圆、slit 竖瞳、ring 瞳孔外一圈光环、star 星形、reticle 准星、spiral 漩涡、none 没有瞳孔（被神附身那种空洞的眼）
export type Pupil = 'round' | 'slit' | 'ring' | 'star' | 'reticle' | 'spiral' | 'none';
// 高光：twin 一大一小、single 一个大的、star 四角星、moon 月牙、sparkle 大高光加小星星、flower 小花、dull 暗淡的小点、none 没有
export type Glint = 'twin' | 'single' | 'star' | 'moon' | 'sparkle' | 'flower' | 'dull' | 'none';
// 眼型：round 圆眼、sharp 吊眼（眼尾上挑）、droopy 垂眼、narrow 细长
export type EyeShape = 'round' | 'sharp' | 'droopy' | 'narrow';

export interface EyeLook {
  iris: string;
  hair: string;
  skin: string;
  pupil: Pupil;
  glint: Glint;
  shape: EyeShape;
  // 睁眼那一下瞳孔周围亮起来的光、眼尾拖出来的光尾的颜色
  glow: string;
  // 眼尾拖一道光（“怪物”级的人才有）
  trail: boolean;
  // 只睁一只眼（福路美穗子：平时闭着，发动时睁开蓝色的右眼）。left / right 是角色自己的左右，画面上是反的
  only?: 'left' | 'right';
  // 戴眼镜：发动时镜片反一道白光（染谷真子、船久保浩子、辻垣内智叶）
  glasses?: boolean;
}

const SKIN = '#f6e0d2';

// 和默认不一样的地方。想调哪个人的眼睛就改这里（打开网址后面加 #eyes 的预览页对着看）
const OVERRIDES: Record<string, Partial<EyeLook>> = {
  // 宫永咲：岭上开花，高光是一朵小花
  saki: { glint: 'flower', glow: '#ffb3c8', trail: true },
  // 宫永照：照魔镜、连和的龙卷风，瞳孔里一个漩涡，眼尾上挑
  teru: { pupil: 'spiral', shape: 'sharp', glow: '#ff7a45', trail: true },
  // 大星淡：星星
  awai: { pupil: 'star', glint: 'star', glow: '#ffe27a', trail: true },
  // 天江衣：满月，红眼睛亮起来、高光是月牙
  koromo: { pupil: 'ring', glint: 'moon', glow: '#ff4a4a', trail: true },
  // 园城寺怜：一巡先见
  toki: { pupil: 'ring', glow: '#8fd8ff', trail: true },
  // 福路美穗子：平时眯着眼，发动时睁开右眼（蓝色）
  mihoko: { only: 'right', shape: 'droopy', glow: '#7ab8ff' },
  // 原村和：天使和
  nodoka: { glint: 'sparkle', glow: '#ffc4e4' },
  // 石户霞：降神
  kasumi: { pupil: 'slit', shape: 'droopy', glow: '#b48cff', trail: true },
  // 神代小莳：神降下来时眼睛是空的
  komaki: { pupil: 'none', glint: 'none', glow: '#e9f2ff', trail: true },
  // 薄墨初美：里鬼门
  hatsumi: { pupil: 'slit', shape: 'sharp', glow: '#a24bff' },
  // 弘世堇：狙击
  sumire: { pupil: 'reticle', shape: 'sharp', glow: '#7fb4ff' },
  // 臼泽塞：镜片
  sae: { pupil: 'reticle', glow: '#9fe2ff' },
  // 梅根·达文：决斗
  megan: { pupil: 'reticle', shape: 'sharp', glow: '#ffb347', skin: '#d9a682', trail: true },
  // 辻垣内智叶：居合，细长的眼睛、戴眼镜
  satoha: { shape: 'narrow', glint: 'single', glow: '#c8d6ff', glasses: true, trail: true },
  // 染谷真子、船久保浩子：戴眼镜
  mako: { glasses: true, glow: '#9fe0b0' },
  hiroko: { glasses: true, shape: 'narrow', glow: '#ffd27a' },
  // 小濑川白望：懒洋洋的垂眼
  shiromi: { shape: 'droopy', glint: 'dull', glow: '#c9d6ee' },
  // 东横桃子：隐身，高光淡淡的
  momo: { glint: 'dull', glow: '#9fb6dc' },
  // 姊带丰音：先负
  toyone: { pupil: 'ring', glow: '#c6a4ff', trail: true },
  // 涅莉·维尔萨拉泽：运势
  nelly: { pupil: 'ring', glint: 'star', glow: '#ffd36b', trail: true },
  // 雀明华：风神，垂眼
  myeonghwa: { shape: 'droopy', glow: '#ffd2e2', trail: true },
  // 龙门渊透华：治水
  toka: { shape: 'sharp', glint: 'sparkle', glow: '#8fd0ff' },
  // 竹井久、爱宕洋榎：吊眼
  hisa: { shape: 'sharp' },
  hiroe: { shape: 'sharp' },
  // 片冈优希、池田华菜：圆眼睛闪闪的
  yuuki: { glint: 'sparkle' },
  kana: { pupil: 'slit', glint: 'sparkle', glow: '#ffcf6b' },
  // 松实玄：宝牌聚集
  kuro: { glow: '#ff8a5c' },
  // 高鸭穏乃：深山
  shizuno: { glow: '#a8dc8c' },
  // 郝慧宇：国标（不在 LOOKS 里，颜色写在这）
  huiyu: { iris: '#3a2a26', hair: '#1c1a1e', shape: 'sharp', glow: '#ffcf5a' },
};

const hexOk = (s: string | undefined): s is string => !!s && /^#[0-9a-f]{6}$/i.test(s);

// 这个角色的眼睛。color 是角色的主题色：LOOKS 里没有的人拿它当瞳色
export function eyeLookOf(id: string, color: string): EyeLook {
  const look = LOOKS[id];
  const o = OVERRIDES[id] ?? {};
  const iris = o.iris ?? (hexOk(look?.eyes) ? look.eyes : hexOk(color) ? color : '#7a5a3a');
  const hair = o.hair ?? (hexOk(look?.hair) ? look.hair : '#3a2c26');
  return {
    skin: SKIN,
    pupil: 'round',
    glint: 'twin',
    shape: 'round',
    glow: hexOk(color) ? color : '#ffd27a',
    trail: false,
    ...o,
    iris,
    hair,
  };
}
