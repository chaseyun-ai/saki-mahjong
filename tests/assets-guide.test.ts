import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { guessSlot } from '../src/assets/match';
import { GLOBAL, MUSIC, slotsFor } from '../src/assets/slots';
import { KINDS, checklistCsv, kindAmount, kindCount, kindOf, ownersOfKind, slotGuide, suggestedFile } from '../src/assets/guide';

const OWNERS = [GLOBAL, MUSIC, ...CHARACTERS.map((c) => c.id)];
const mediaOf = (file: string) => (/\.(png|gif)$/.test(file) ? 'image' : /\.(vrm|glb)$/.test(file) ? 'model' : 'audio');

// 素材导入页上的说明：每一类要几个、建议文件名
describe('素材导入：说明和建议文件名', () => {
  it('每个格子都归到八类里的一类，每一类都有格子', () => {
    const seen = new Set<string>();
    for (const o of OWNERS) for (const d of slotsFor(o, CHARACTERS)) seen.add(kindOf(d));
    expect([...seen].sort()).toEqual(KINDS.map((k) => k.id).sort());
    for (const k of KINDS) expect(kindCount(k.id, CHARACTERS).total).toBeGreaterThan(0);
  });

  it('要几个：头像每人 3 张、切入每人 6 张、提示音和背景音乐各 5 个', () => {
    expect(kindAmount('portrait', CHARACTERS)).toBe('每个角色 3 张');
    expect(kindAmount('cutin', CHARACTERS)).toBe('每个角色 6 张');
    expect(kindAmount('model', CHARACTERS)).toBe('每个角色 1 个');
    expect(kindAmount('sfx', CHARACTERS)).toBe('5 个');
    expect(kindAmount('music', CHARACTERS)).toBe('5 首');
    expect(kindAmount('hand', CHARACTERS)).toBe('1 个');
    expect(kindCount('portrait', CHARACTERS).total).toBe(CHARACTERS.length * 3);
    expect(ownersOfKind('music', CHARACTERS)).toEqual([MUSIC]);
  });

  it('照建议的文件名起名，拖进来自动对回同一个格子', () => {
    const wrong: string[] = [];
    for (const owner of OWNERS) {
      for (const d of slotsFor(owner, CHARACTERS)) {
        const file = suggestedFile(owner, d, CHARACTERS);
        const media = mediaOf(file);
        const g = guessSlot(file, media, CHARACTERS, { vrm: file.endsWith('.vrm') });
        if (g.owner !== owner || g.slot !== d.slot) wrong.push(`${file} → ${g.owner}/${g.slot}（应是 ${owner}/${d.slot}）`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('建议文件名举例', () => {
    const f = (owner: string, slot: string) => suggestedFile(owner, slotsFor(owner, CHARACTERS).find((d) => d.slot === slot)!, CHARACTERS);
    expect(f('awai', 'face')).toBe('大星淡/头像.png');
    expect(f('awai', 'riichi')).toBe('大星淡/立直切入.png');
    expect(f('awai', 'eyes')).toBe('大星淡/睁眼特写.png');
    expect(f('awai', 'voice-riichi')).toBe('大星淡/语音-立直.mp3');
    expect(f('awai', 'model')).toBe('大星淡/3D模型.vrm');
    expect(f(GLOBAL, 'sfx-click')).toBe('提示音/落桌声.wav');
    expect(f(GLOBAL, 'hand')).toBe('手模.glb');
    expect(f(MUSIC, 'east')).toBe('背景音乐/对局-东场.mp3');
  });

  it('不换会怎样：说得出来', () => {
    const face = slotsFor('awai', CHARACTERS).find((d) => d.slot === 'face')!;
    expect(slotGuide('awai', face, CHARACTERS).fallback).toBe('用自带的头像');
    expect(slotGuide('saki', slotsFor('saki', CHARACTERS).find((d) => d.slot === 'face')!, CHARACTERS).fallback).toBe('头像框里显示「咲」字');
    expect(slotGuide('saki', slotsFor('saki', CHARACTERS).find((d) => d.slot === 'call')!, CHARACTERS).fallback).toBe('用「和牌切入」');
  });

  it('完整清单：每格一行，带 BOM，换过的标出来', () => {
    const csv = checklistCsv(CHARACTERS, OWNERS, (o, s) => o === 'awai' && s === 'face');
    expect(csv.startsWith('﻿角色,类别,格子')).toBe(true);
    const lines = csv.trim().split('\r\n');
    const total = OWNERS.reduce((n, o) => n + slotsFor(o, CHARACTERS).length, 0);
    expect(lines.length).toBe(total + 1);
    expect(lines.find((l) => l.startsWith('大星淡,头像,头像,'))?.endsWith(',已换')).toBe(true);
  });
});

describe('只换一张头像：别的表情都用它', () => {
  it('吃惊、开心、能力发动都用换上的头像；没换头像时照旧用自带的', async () => {
    const { portraitUrl, powerPortraitUrl, setSkinLayer } = await import('../src/ui3d/looks');
    // 咲没有自带的头像：没换时是空的（头像框里显示名字的字）
    expect(portraitUrl('saki', 'surprised')).toBe('');
    setSkinLayer('mine', { saki: { face: { url: 'blob:face', w: 3, h: 4 } }, awai: { face: { url: 'blob:awai', w: 3, h: 4 }, blank: { url: 'blob:awai-blank', w: 3, h: 4 } } });
    expect(portraitUrl('saki', 'surprised')).toBe('blob:face');
    expect(portraitUrl('saki', 'happy')).toBe('blob:face');
    expect(powerPortraitUrl('saki')).toBe('blob:face');
    // 单独换了的还是用单独换的
    expect(portraitUrl('awai', 'surprised')).toBe('blob:awai-blank');
    expect(portraitUrl('awai', 'sad')).toBe('blob:awai');
    // 没换的人照旧
    expect(portraitUrl('kuro', 'happy')).toBe('portraits/kuro-happy.webp');
    setSkinLayer('mine', {});
    expect(portraitUrl('saki', 'happy')).toBe('');
  });
});
