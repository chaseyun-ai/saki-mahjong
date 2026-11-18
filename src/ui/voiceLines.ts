// 角色语音的台词表：每个角色有哪几句、每一句什么时候说。
// 游戏本身不带音频（素材页里一句句放，见 skins.ts、voice.ts），这里只定格子和触发。
//   喊牌六句（所有人都有）：立直、碰、吃、杠、荣和、自摸
//   能力台词：有能力演出的角色各有几句，照能力发动时牌桌上出的那行字（GameEvent 的 text）对上；
//            没有单独格子的能力都落到「能力发动（通用）」那一句
// hint 是建议的台词（日语喊牌），只是给配音的人参考，不影响触发。

export interface VoiceLine {
  key: string; // 存在语音包里的名字
  label: string; // 素材页格子上的字
  hint: string; // 建议台词、什么时候说
  texts?: string[]; // 对上哪些能力提示字：一样，或者以它开头再接「·」「→」（“绝一门·万子”“红云→原村和”）
  match?: RegExp; // 一组名字不好一个个列的（爽的每朵云、每个神威）
}

export const CALL_LINES: VoiceLine[] = [
  { key: 'riichi', label: '立直', hint: '「リーチ」。打出立直宣言牌时' },
  { key: 'pon', label: '碰', hint: '「ポン」' },
  { key: 'chi', label: '吃', hint: '「チー」' },
  { key: 'kan', label: '杠', hint: '「カン」。明杠、暗杠、加杠都是这一句' },
  { key: 'ron', label: '荣和', hint: '「ロン」' },
  { key: 'tsumo', label: '自摸', hint: '「ツモ」。砸牌动作开始前说' },
];

export const GENERIC_ABILITY: VoiceLine = { key: 'ability', label: '能力发动（通用）', hint: '发动没有单独格子的能力时说这一句；同一个能力一局只说第一次' };

const CALL_KEYS = new Set(CALL_LINES.map((l) => l.key));
export const isCallKey = (key: string): boolean => CALL_KEYS.has(key);

// 各角色的能力台词。key 只在这个角色里不重复就行
const ABILITY_LINES: Record<string, VoiceLine[]> = {
  saki: [
    { key: 'kan-sense', label: '杠的气息', hint: '「カン材…来てる」', texts: ['杠的气息'] },
    { key: 'rinshan', label: '岭上开花', hint: '「ツモ。嶺上開花」。说了这一句就不再补「自摸」', texts: ['岭上开花'] },
  ],
  nodoka: [{ key: 'angel', label: '天使和', hint: '「……集中します」。变成天使和的那一局', texts: ['天使和'] }],
  yuuki: [
    { key: 'east', label: '东风之神', hint: '「東場はあたしのものだじぇ！」', texts: ['东风之神'] },
    { key: 'taco', label: '塔可饼', hint: '「タコス、補給だじぇ！」', texts: ['塔可饼'] },
  ],
  hisa: [{ key: 'bad-wait', label: '恶待', hint: '「悪い待ちで、ごめんなさいね」', texts: ['恶待'] }],
  koromo: [
    { key: 'tide', label: '满潮', hint: '「月が、満ちた」', texts: ['满潮', '潮起潮落'] },
    { key: 'shift', label: '海底挪移', hint: '「海底は、衣のものだ」', texts: ['海底挪移'] },
    { key: 'haitei', label: '海底捞月', hint: '「ツモ。海底撈月」。说了这一句就不再补「自摸」', texts: ['海底捞月', '海底自摸'] },
  ],
  toka: [{ key: 'still', label: '静水', hint: '「……静まりなさい」', texts: ['静水'] }],
  jun: [{ key: 'flow', label: '错开流向', hint: '「流れ、変えさせてもらうぜ」', texts: ['错开流向'] }],
  mihoko: [{ key: 'eye', label: '睁开右眼', hint: '「……見せていただきます」', texts: ['睁开右眼'] }],
  kana: [{ key: 'back', label: '背水', hint: '「まだ終わってないし！」', texts: ['背水'] }],
  kaori: [{ key: 'beginner', label: '新手运', hint: '「えっと…これ、そろってますか？」', texts: ['新手运'] }],
  kuro: [{ key: 'dora-lost', label: '打出了宝牌', hint: '「ごめんね、ドラさん…」', texts: ['打出了宝牌，这一整场宝牌不再来'] }],
  yu: [{ key: 'warm', label: '暖色牌', hint: '「あったかい…」', texts: ['暖色牌'] }],
  shizuno: [
    { key: 'mountain', label: '深山', hint: '「山の奥は、わたしの場所だ！」', texts: ['深山'] },
    { key: 'mist', label: '雾更浓了', hint: '「もっと、深く！」', texts: ['雾更浓了'] },
  ],
  arata: [{ key: 'bowling', label: '保龄球', hint: '「ストライク」', texts: ['保龄球'] }],
  ryuuka: [
    { key: 'pillow', label: '怜的膝枕', hint: '「怜、力貸してな」', texts: ['怜的膝枕'] },
    { key: 'mugoku', label: '无极天', hint: '「……入った」', texts: ['无极天'] },
  ],
  himeko: [
    { key: 'key', label: '钥匙', hint: '「部長の鍵、受け取りました！」', texts: ['钥匙'] },
    { key: 'broken', label: '破碎的钥匙', hint: '「鍵が…割れとる」', texts: ['破碎的钥匙'] },
  ],
  teru: [
    { key: 'mirror', label: '照魔镜', hint: '「……見せてもらう」', texts: ['照魔镜'] },
    { key: 'streak', label: '连续和了', hint: '「まだ、続く」', texts: ['连续和了'] },
    { key: 'gigigi', label: '叽叽叽', hint: '原作里是一声门轴响，也可以空着', texts: ['叽叽叽'] },
  ],
  sumire: [{ key: 'snipe', label: '狙击', hint: '「射抜く」', texts: ['狙击'] }],
  takami: [{ key: 'harvest', label: '收获时期', hint: '「ハーベストタイム」', texts: ['收获时期'] }],
  seiko: [{ key: 'fish', label: '第四条鱼', hint: '「ヒット！」', texts: ['第四条鱼'] }],
  awai: [
    { key: 'tenpai', label: '天听', hint: '「ダブルリーチ！」', texts: ['天听', '天听配牌'] },
    { key: 'kan-ura', label: '高维领域、杠里', hint: '「カン！裏、乗るよ」', texts: ['高维领域', '杠里'] },
    { key: 'fate', label: '命运支配', hint: '「宇宙は、わたしの味方だもん」', texts: ['命运支配'] },
    { key: 'slow', label: '时间迟滞', hint: '「みんな、遅いよ」', texts: ['时间迟滞'] },
    { key: 'decohere', label: '退相干', hint: '「そっちの世界は、なし」', texts: ['退相干'] },
  ],
  komaki: [
    { key: 'descend', label: '降临', hint: '「……すぅ…」。睡着、神降下来', texts: ['降临'] },
    { key: 'wake', label: '醒来', hint: '「あれ…寝てました？」', texts: ['醒来'] },
  ],
  kasumi: [
    { key: 'summon', label: '请神', hint: '「……降ろします」', texts: ['请神'] },
    { key: 'void-suit', label: '绝一门', hint: '「あらあら、困ったわね」', texts: ['绝一门'] },
  ],
  hatsumi: [
    { key: 'kimon', label: '鬼门', hint: '「鬼門、開くですよー」', texts: ['鬼门'] },
    { key: 'ura-kimon', label: '里鬼门', hint: '「裏鬼門も、ですよー」', texts: ['里鬼门'] },
  ],
  haru: [{ key: 'quick', label: '快和', hint: '「……さくっと」', texts: ['快和'] }],
  toyone: [
    { key: 'chase', label: '先负、追立', hint: '「追っかけるけどー」', texts: ['先负', '追立'] },
    { key: 'tomobiki', label: '友引', hint: '「ぼっちじゃないよー」', texts: ['友引'] },
  ],
  aislinn: [
    { key: 'sketch', label: '手绘板', hint: '「描けた！」', texts: ['手绘板'] },
    { key: 'shatter', label: '画板破碎', hint: '「……描けない」', texts: ['画板破碎', '画不出来'] },
    { key: 'redraw', label: '重绘', hint: '「もう一回」', texts: ['重绘'] },
  ],
  sae: [{ key: 'lens', label: '镜片', hint: '「塞ぐ」', texts: ['镜片'] }],
  suzu: [{ key: 'burst', label: '爆发', hint: '「来た来た来たー！」', texts: ['爆发'] }],
  kyouko: [{ key: 'disrupt', label: '打乱流向', hint: '「凡人なりに、やらせてもらうで」', texts: ['打乱流向'] }],
  kinue: [{ key: 'pin1', label: '一筒', hint: '「このボールは、止めるで！」', texts: ['一筒'] }],
  nelly: [
    { key: 'luck', label: '运势', hint: '「波、来てる」', texts: ['运势'] },
    { key: 'sisters', label: '七姐妹', hint: '「星よ…」', texts: ['七姐妹'] },
  ],
  yukiko: [{ key: 'left', label: '左手', hint: '她换左手摸牌、手上亮起 𐤄 的时候', texts: ['左手'] }],
  megan: [
    { key: 'duel', label: '决斗', hint: '她立直向一家决斗时', texts: ['决斗'] },
    { key: 'blind', label: '伏牌', hint: '她把牌伏下时', texts: ['伏牌'] },
  ],
  myeonghwa: [
    { key: 'song', label: '开嗓', hint: '她开始唱歌时', texts: ['开嗓'] },
    { key: 'cut', label: '断风', hint: '她对一家断风时', texts: ['断风'] },
  ],
  satoha: [{ key: 'zan', label: '斬', hint: '她和牌结束别人的连庄时', texts: ['斬'] }],
  huiyu: [
    { key: 'fan', label: '番种', hint: '「中国麻将で、行く」', texts: ['番种'] },
    { key: 'cheng', label: '成', hint: '「……成了」', texts: ['成'] },
  ],
  sawaya: [
    { key: 'cloud', label: '五色云', hint: '「雲よ、来い！」。每朵云都是这一句', match: /云(→|$)/ },
    { key: 'kamui', label: '神威', hint: '「カムイ、頼むわ」。每个神威都是这一句', match: /神威(→|$)/ },
  ],
};

const hits = (line: VoiceLine, text: string): boolean =>
  !!line.match?.test(text) || !!line.texts?.some((t) => text === t || text.startsWith(t + '·') || text.startsWith(t + '→'));

// 有单独能力台词的角色
export const VOICE_ABILITY_CHARS = Object.keys(ABILITY_LINES);

// 这个角色单独的能力台词
export const abilityLinesOf = (charId: string): VoiceLine[] => ABILITY_LINES[charId] ?? [];

// 这个角色的全部语音格子：喊牌六句；有能力的再加她单独的几句和通用的那一句
export function voiceSlotsOf(c: { id: string; ability?: unknown }): VoiceLine[] {
  return c.ability ? [...CALL_LINES, ...abilityLinesOf(c.id), GENERIC_ABILITY] : [...CALL_LINES];
}

// 牌局里要说话的那一下
export type VoiceCue =
  | { kind: 'riichi' }
  | { kind: 'call'; call: string } // GameEvent 的 call：碰、吃、杠、暗杠、加杠
  | { kind: 'win'; tsumo: boolean }
  | { kind: 'ability'; text: string };

// 这一下该说哪一句：照先后顺序给出要找的台词（前面的没放音频就用后面的），没有可说的是空的
export function cueKeys(charId: string, cue: VoiceCue): string[] {
  if (cue.kind === 'riichi') return ['riichi'];
  if (cue.kind === 'call') return [cue.call.includes('杠') ? 'kan' : cue.call === '吃' ? 'chi' : 'pon'];
  if (cue.kind === 'win') return [cue.tsumo ? 'tsumo' : 'ron'];
  const own = abilityLinesOf(charId).find((l) => hits(l, cue.text));
  return own ? [own.key, GENERIC_ABILITY.key] : [GENERIC_ABILITY.key];
}

// 一次放多个文件时照文件名对上是哪一句：文件名（不算扩展名）是格子上的字、存的名字、能力提示字，
// 或喊牌的常见写法（riichi、リーチ……）；前面带着角色名、角色 id 再接 - _ 空格的也认（“宫永咲-立直.mp3”“saki_riichi.wav”）
const CALL_ALIASES: Record<string, string[]> = {
  riichi: ['riichi', 'reach', '立直', 'リーチ'],
  pon: ['pon', '碰', 'ポン'],
  chi: ['chi', 'chii', '吃', 'チー'],
  kan: ['kan', '杠', '槓', 'カン'],
  ron: ['ron', '荣和', '荣', 'ロン'],
  tsumo: ['tsumo', '自摸', 'ツモ'],
};

export function matchVoiceFile(c: { id: string; name: string; ability?: unknown }, filename: string): string | null {
  let stem = filename.replace(/\.[^.]+$/, '').trim().toLowerCase();
  for (const who of [c.name.toLowerCase(), c.id.toLowerCase()]) {
    if (stem.startsWith(who) && /^[-_ 　·]/.test(stem.slice(who.length))) stem = stem.slice(who.length).replace(/^[-_ 　·]+/, '');
  }
  for (const line of voiceSlotsOf(c)) {
    const names = [line.key, line.label, ...(line.texts ?? []), ...(CALL_ALIASES[line.key] ?? []), ...line.label.split('、')];
    if (line.key === GENERIC_ABILITY.key) names.push('能力', '能力发动');
    if (names.some((n) => n.toLowerCase() === stem)) return line.key;
  }
  return null;
}
