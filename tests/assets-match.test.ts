import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { guessSlot } from '../src/assets/match';
import { GLOBAL, MUSIC } from '../src/assets/slots';

// 素材导入：按文件名认出是谁的哪个格子
const g = (path: string, media: 'image' | 'video' | 'model' | 'audio' = 'image', vrm = true) => {
  const r = guessSlot(path, media, CHARACTERS, { vrm });
  return `${r.owner}/${r.slot}`;
};

describe('素材导入：按文件名认格子', () => {
  it('角色 id、中文名、日文写法、单名都认', () => {
    expect(g('saki-face.png')).toBe('saki/face');
    expect(g('宫永咲_立直.png')).toBe('saki/riichi');
    expect(g('宮永咲 和牌.webp')).toBe('saki/win');
    expect(g('咲-懵逼.png')).toBe('saki/blank');
    expect(g('园城寺怜头像.png')).toBe('toki/face');
    expect(g('園城寺怜 能力発動.png')).toBe('toki/ability');
    expect(g('Awai_result.jpg')).toBe('awai/result');
  });

  it('游戏里默认图的文件名原样认得回去', () => {
    expect(g('portraits/saki-neutral.webp')).toBe('saki/face');
    expect(g('portraits/saki-surprised.webp')).toBe('saki/blank');
    expect(g('portraits/saki-serious.webp')).toBe('saki/power');
    expect(g('portraits/saki-cutin-riichi.webp')).toBe('saki/riichi');
    expect(g('portraits/saki-cutin-win.webp')).toBe('saki/win');
    expect(g('portraits/awai-cutin.webp')).toBe('awai/win');
  });

  it('长音写不写都行，姓和名连写也行', () => {
    expect(g('yuki_face.png')).toBe('yuuki/face');
    expect(g('kyoko-riichi.png')).toBe('kyouko/riichi');
    expect(g('touka-face.png')).toBe('toka/face');
    expect(g('MiyanagaSaki_face.png')).toBe('saki/face');
  });

  it('角色在文件夹名上，格子在文件名上', () => {
    expect(g('素材/大星淡/头像.png')).toBe('awai/face');
    expect(g('pack/nodoka/riichi.png')).toBe('nodoka/riichi');
    expect(g('涅莉/和牌切入.png')).toBe('nelly/win');
  });

  it('名字对不上一个人时不乱猜', () => {
    // 宫永是两个人（咲、照），爱宕也是两个人
    expect(g('宫永_face.png')).toBe('null/null');
    expect(g('爱宕-立直.png')).toBe('null/null');
    expect(g('random.png')).toBe('null/null');
  });

  it('技能动画按技能名认，比通用的切入优先', () => {
    expect(g('原村和-天使和和牌.gif', 'image')).toBe('nodoka/skill-angel-win');
    expect(g('nodoka_angel.mp4', 'video')).toBe('nodoka/skill-angel');
    expect(g('透华 治水立直.webm', 'video')).toBe('toka/skill-chisui-riichi');
    // 只有一个技能动画格的角色，视频直接放进去
    expect(g('sumire.mp4', 'video')).toBe('sumire/skill-snipe');
  });

  it('模型：VRM 是角色的 3D 模型，普通 GLB 是手模', () => {
    expect(g('saki.vrm', 'model', true)).toBe('saki/model');
    expect(g('大星淡.vrm', 'model', true)).toBe('awai/model');
    expect(g('hand-awai.glb', 'model', false)).toBe(`${GLOBAL}/hand`);
    expect(g('hand-awai.glb.txt', 'model', false)).toBe(`${GLOBAL}/hand`);
  });

  it('音频：有角色名的是语音，没有的是提示音或背景音乐', () => {
    expect(g('saki/立直.mp3', 'audio')).toBe('saki/voice-riichi');
    expect(g('宫永咲-岭上开花.ogg', 'audio')).toBe('saki/voice-rinshan');
    expect(g('saki_tsumo.wav', 'audio')).toBe('saki/voice-tsumo');
    expect(g('awai 天听.mp3', 'audio')).toBe('awai/voice-tenpai');
    expect(g('落桌.wav', 'audio')).toBe(`${GLOBAL}/sfx-click`);
    expect(g('sfx/riichi.mp3', 'audio')).toBe(`${GLOBAL}/sfx-riichi`);
    expect(g('bgm/menu.mp3', 'audio')).toBe(`${MUSIC}/menu`);
    expect(g('南场.mp3', 'audio')).toBe(`${MUSIC}/south`);
  });
});
