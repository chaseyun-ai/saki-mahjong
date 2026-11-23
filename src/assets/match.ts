import type { Media } from './sniff';
import { GLOBAL, GLOBAL_SLOTS, MUSIC, MUSIC_DEFS, type SlotDef, type Who, slotsFor } from './slots';

// 按文件名（连同所在文件夹）猜是谁的哪个格子，不用手动改名。
// 认角色：角色 id（saki）、中文名（宫永咲）、日文写法（宮永咲）、名字（咲）、罗马字（Miyanaga Saki、yuki/yuuki 都行）；
// 认格子：格子的关键词（face、头像、立直、和牌……）和技能名、台词名（天使和、治水……），选最长的那个词。
// 不是 VRM 的 GLB 是手模，没写角色名的音频看是不是提示音、背景音乐。猜不出来的留空，界面上让人在下拉框里选。

export interface Guess {
  owner: string | null; // 角色 id，或者 GLOBAL、MUSIC
  slot: string | null;
  // 为什么这么认（给人看的一小句），猜不出来时说缺什么
  why: string;
}

// 日文、繁体字写法换成简体，好和角色表里的名字比
const VARIANTS: Record<string, string> = Object.fromEntries(
  [
    '宮宫', '実实', '實实', '園园', '愛爱', '穂穗', '獅狮', '岡冈', '優优', '誠诚', '渋涉', '澁涉', '尭尧', '堯尧', '菫堇', '竜龙', '龍龙', '蒔莳', '姉姊',
    '帯带', '帶带', '豊丰', '豐丰', '瀬濑', '瀨濑', '倉仓', '東东', '鶴鹤', '姫姬', '鴨鸭', '穏稳', '穩稳', '鷺鹭', '沢泽', '澤泽', '滝泷', '瀧泷', '門门',
    '渕渊', '淵渊', '華华', '純纯', '紀纪', '広广', '廣广', '戸户', '戶户', '織织', '見见', '條条', '絵绘', '繪绘', '頭头', '鳴鸣', '結结', '動动', '發发',
    '発发', '榮荣', '槓杠', '驚惊', '覺觉', '態态', '畫画', '鏡镜', '雲云', '運运', '勢势', '闘斗', '鬥斗', '圧压', '淺浅', '歳岁', '嶺岭', '開开', '寶宝',
    '測测', '語语', '聲声', '効效', '絹绢', '恵惠', '紧紧', '緊紧', '選选', '場场', '樂乐', '楽乐', '曲曲', '視视', '頁页', '戦战', '戰战',
  ].map((p) => [p[0], p[1]]),
);

// 角色表里的名字以外，再认这些写法（假名名字、换了字的日文名、罗马字姓）
const ALIASES: Record<string, string[]> = {
  saki: ['miyanagasaki'],
  teru: ['miyanagateru'],
  nodoka: ['haramura', 'nodocchi', 'のどっち'],
  toki: ['onjouji', 'onjoji'],
  kuro: ['matsumikuro'],
  yu: ['matsumiyu'],
  awai: ['oohoshi', 'ohoshi'],
  kasumi: ['iwato'],
  koromo: ['amae'],
  hiroe: ['atagohiroe'],
  kinue: ['atagokinue', '绢恵', '絹恵', '绢惠'],
  mihoko: ['fukuji'],
  nelly: ['vilsaladze', 'virsaladze', 'ネリー', '涅莉'],
  sawaya: ['shishihara'],
  yuuki: ['kataoka', 'taco'],
  ako: ['atarashi'],
  seiko: ['watano'],
  mako: ['someya', 'まこ'],
  hisa: ['takei'],
  kyouko: ['suehara'],
  takami: ['shibuya'],
  izumi: ['nijou', 'nijo'],
  sumire: ['hirose'],
  sera: ['eguchi', 'セーラ'],
  ryuuka: ['shimizudani'],
  komaki: ['jindai'],
  toyone: ['anetai'],
  shiromi: ['kosegawa'],
  kurumi: ['kakura'],
  aislinn: ['wishart', 'エイスリン', '艾斯琳'],
  suzu: ['kamishige'],
  momo: ['momoko', 'touyoko', 'toyoko'],
  rii: ['shirouzu', 'shirozu'],
  himeko: ['tsuruta'],
  shizuno: ['takakamo', 'shizu'],
  arata: ['sagimori'],
  kirame: ['hanada', 'sugoi'],
  sae: ['usuzawa'],
  tomoe: ['karijuku'],
  haru: ['takimi'],
  hatsumi: ['usuzumi'],
  toka: ['touka', 'ryuumonbuchi', 'ryumonbuchi'],
  jun: ['inoue'],
  tomoki: ['sawamura'],
  hajime: ['kunihiro'],
  yumi: ['kajiki', 'ゆみ'],
  kana: ['ikeda'],
  hiroko: ['funakubo'],
};

// 长音写不写都认：yuuki = yuki，kyouko = kyoko，touka = toka
const romaji = (s: string): string => s.replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u').replace(/ii(?=.)/g, 'i');

function normalize(s: string): string {
  // 全角英数字换成半角
  const half = s.normalize('NFKC').toLowerCase();
  let out = '';
  for (const ch of half) out += VARIANTS[ch] ?? ch;
  return out;
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
const isCjk = (s: string) => CJK.test(s);

// 切成词：分隔符切开，中文和英文接在一起的也切开（saki立直 → saki、立直）
function tokens(s: string): string[] {
  return s
    .split(/[\s_\-.·・,，、()（）[\]【】{}「」『』+&=~～#@!！]+/)
    .flatMap((t) => t.match(/[぀-ヿ㐀-鿿豈-﫿]+|[^぀-ヿ㐀-鿿豈-﫿]+/g) ?? [])
    .filter(Boolean);
}

// 去掉扩展名（.glb.txt 两层都去）
const stem = (name: string): string => name.replace(/(\.(glb|vrm))?\.[a-z0-9]{1,5}$/i, '');

interface Hit {
  id: string;
  score: number;
  text: string; // 认出来的那几个字，认格子前从文件名里去掉
}

function findOwner(segments: string[][], raw: string[], who: Who[]): Hit[] {
  const hits: Hit[] = [];
  // 越靠近文件名的越算数：文件名本身 +0.5
  segments.forEach((toks, si) => {
    const bonus = si === segments.length - 1 ? 0.5 : 0;
    const joined = raw[si];
    const latin = toks.filter((t) => !isCjk(t)).map(romaji);
    const glued = romaji(latin.join(''));
    for (const c of who) {
      const name = normalize(c.name);
      const full = name.replace(/[·・]/g, '');
      const aliases = (ALIASES[c.id] ?? []).map(normalize);
      const id = romaji(c.id.toLowerCase());
      // 中文全名出现在名字里
      if (joined.includes(full) || (name.includes('·') && joined.includes(name.split('·')[0]))) hits.push({ id: c.id, score: 4 + bonus, text: joined.includes(full) ? full : name.split('·')[0] });
      // 角色 id 或罗马字是单独的一个词，或者姓名连写（miyanagasaki）
      if (latin.includes(id)) hits.push({ id: c.id, score: 3 + bonus, text: c.id });
      for (const a of aliases) {
        if (isCjk(a) ? joined.includes(a) : latin.includes(romaji(a)) || (a.length >= 6 && glued.includes(romaji(a)))) hits.push({ id: c.id, score: 3 + bonus, text: a });
      }
      // 单独写的名字（咲、淡、衣）或姓（天江）：只有一个人对得上才算
      for (const t of toks.filter(isCjk)) {
        if (t.length < full.length && full.endsWith(t) && who.filter((o) => normalize(o.name).replace(/[·・]/g, '').endsWith(t)).length === 1) hits.push({ id: c.id, score: 2 + bonus, text: t });
        if (t.length >= 2 && t.length < full.length && full.startsWith(t) && who.filter((o) => normalize(o.name).startsWith(t)).length === 1) hits.push({ id: c.id, score: 1 + bonus, text: t });
      }
    }
  });
  return hits;
}

// 关键词 word 有没有出现在 toks 里：英文要整词（可以是连着的几个词，比如 angel-win），中文看包含
function hasWord(toks: string[], text: string, word: string): boolean {
  const w = normalize(word);
  if (isCjk(w)) return text.includes(w);
  const parts = tokens(w);
  if (parts.length === 0) return false;
  for (let i = 0; i + parts.length <= toks.length; i++) if (parts.every((p, k) => toks[i + k] === p)) return true;
  return false;
}

function findSlot(defs: SlotDef[], toks: string[], text: string): { def: SlotDef; word: string } | null {
  let best: { def: SlotDef; word: string } | null = null;
  for (const def of defs) {
    for (const word of [def.slot, ...def.words]) {
      if (!hasWord(toks, text, word)) continue;
      // 技能名比通用词优先（同样长时），比如“天使和和牌”认成天使形态和牌动画而不是和牌切入
      const len = [...normalize(word)].length + (def.group === 'skill' ? 0.5 : 0);
      const bestLen = best ? [...normalize(best.word)].length + (best.def.group === 'skill' ? 0.5 : 0) : 0;
      if (len > bestLen) best = { def, word };
    }
  }
  return best;
}

// path：相对路径（拖进来的文件夹里的位置），比如 “素材/咲/立直.png”；只有文件名也行
export function guessSlot(path: string, media: Media, who: Who[], opts: { vrm?: boolean } = {}): Guess {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return { owner: null, slot: null, why: '没有文件名' };
  parts[parts.length - 1] = stem(parts[parts.length - 1]);
  const raw = parts.map(normalize);
  const segments = raw.map(tokens);
  const hits = findOwner(segments, raw, who);
  let owner: string | null = null;
  let ownerText = '';
  let why = '';
  if (hits.length) {
    const top = Math.max(...hits.map((h) => h.score));
    const ids = [...new Set(hits.filter((h) => h.score === top).map((h) => h.id))];
    if (ids.length === 1) {
      owner = ids[0];
      ownerText = hits.find((h) => h.id === owner && h.score === top)!.text;
    } else why = `分不清是谁（${ids.map((id) => who.find((c) => c.id === id)?.name ?? id).join('、')}都对得上）`;
  }

  // 认格子只看文件名（文件夹名可能是“立直切入”这样的分类，也算上，但文件名优先）
  const file = segments[segments.length - 1];
  const fileText = raw[raw.length - 1];
  // 认出来的中文名先去掉，免得名字里的字被当成格子的关键词
  const strip = (toks: string[], text: string): [string[], string] => {
    if (!ownerText || !isCjk(ownerText)) return [toks, text];
    const t = text.split(ownerText).join(' ');
    return [tokens(t), t];
  };
  const [fToks, fText] = strip(file, fileText);
  const dirToks = segments.slice(0, -1).flat();
  const dirText = raw.slice(0, -1).join(' ');

  const pick = (defs: SlotDef[]): SlotDef | null => {
    const usable = defs.filter((d) => d.media.includes(media));
    return (findSlot(usable, fToks, fText) ?? findSlot(usable, dirToks, dirText))?.def ?? null;
  };

  // 模型：VRM 是这个角色的 3D 模型；不是 VRM 的 GLB 只能是手模（手模不分角色）
  if (media === 'model') {
    if (!opts.vrm) return { owner: GLOBAL, slot: 'hand', why: '手模（不是 VRM 的 GLB）' };
    if (!owner) return { owner: null, slot: 'model', why: why || 'VRM 模型：文件名里没认出是哪个角色' };
    const c = who.find((x) => x.id === owner)!;
    return { owner, slot: 'model', why: `${c.name} · 3D 模型` };
  }

  if (!owner) {
    // 没写角色名的音频：提示音或者背景音乐
    if (media === 'audio') {
      const def = pick([...MUSIC_DEFS, ...GLOBAL_SLOTS]);
      if (def) return { owner: def.group === 'music' ? MUSIC : GLOBAL, slot: def.slot, why: def.label };
    }
    return { owner: null, slot: null, why: why || '文件名里没认出是哪个角色' };
  }
  const c = who.find((x) => x.id === owner)!;
  const defs = slotsFor(owner, who);
  let def = pick(defs);
  if (!def && media === 'video') {
    // 视频只能放技能动画：这个角色只有一个技能动画格就是它
    const skills = defs.filter((d) => d.group === 'skill');
    if (skills.length === 1) def = skills[0];
  }
  if (!def) return { owner, slot: null, why: `${c.name}：没认出是哪个格子` };
  return { owner, slot: def.slot, why: `${c.name} · ${def.label}` };
}
