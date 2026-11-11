import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { CALL_LINES, GENERIC_ABILITY, VOICE_ABILITY_CHARS, abilityLinesOf, cueKeys, isCallKey, matchVoiceFile, voiceSlotsOf } from '../src/ui/voiceLines';
import { base64ToBytes, bytesToBase64, emptyPack, encodeWav, packLines, packText, parsePack, soundSpan, withClip } from '../src/ui/voicePack';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

describe('角色语音：台词表', () => {
  it('每个角色都有喊牌六句；有能力的再加她单独的几句和通用的那一句，格子的名字不重复', () => {
    for (const c of CHARACTERS) {
      const slots = voiceSlotsOf(c);
      const keys = slots.map((l) => l.key);
      expect(keys.slice(0, 6), c.name).toEqual(['riichi', 'pon', 'chi', 'kan', 'ron', 'tsumo']);
      expect(new Set(keys).size, c.name).toBe(keys.length);
      expect(keys.includes(GENERIC_ABILITY.key), c.name).toBe(!!c.ability);
      if (!c.ability) expect(keys.length, c.name).toBe(6);
      for (const l of slots) expect(l.label && l.hint, `${c.name} ${l.key}`).toBeTruthy();
    }
  });

  it('有单独能力台词的都是现有的、有能力的角色', () => {
    for (const id of VOICE_ABILITY_CHARS) {
      const c = byId(id);
      expect(c, id).toBeTruthy();
      expect(c.ability, id).toBeTruthy();
      for (const l of abilityLinesOf(id)) {
        expect(isCallKey(l.key), `${id} ${l.key}`).toBe(false);
        expect(l.key, `${id} ${l.key}`).not.toBe(GENERIC_ABILITY.key);
        expect(l.texts?.length || l.match, `${id} ${l.key}`).toBeTruthy();
      }
    }
  });

  it('台词表里写的能力提示字都是代码里真有的（能力改了名字这里会报）', () => {
    const dir = join(__dirname, '../src/abilities');
    const source = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    for (const id of VOICE_ABILITY_CHARS) {
      for (const l of abilityLinesOf(id)) {
        for (const t of l.texts ?? []) expect(source.includes(`'${t}'`) || source.includes(`'${t}·`) || source.includes(`\`${t}·`), `${id}：${t}`).toBe(true);
      }
    }
  });

  it('喊牌：立直、碰、吃、三种杠、荣和、自摸各找各的那一句', () => {
    expect(cueKeys('saki', { kind: 'riichi' })).toEqual(['riichi']);
    expect(cueKeys('saki', { kind: 'call', call: '碰' })).toEqual(['pon']);
    expect(cueKeys('saki', { kind: 'call', call: '吃' })).toEqual(['chi']);
    for (const call of ['杠', '暗杠', '加杠']) expect(cueKeys('saki', { kind: 'call', call })).toEqual(['kan']);
    expect(cueKeys('saki', { kind: 'win', tsumo: true })).toEqual(['tsumo']);
    expect(cueKeys('saki', { kind: 'win', tsumo: false })).toEqual(['ron']);
    for (const l of CALL_LINES) expect(isCallKey(l.key)).toBe(true);
    expect(isCallKey('ability')).toBe(false);
  });

  it('能力：先找这个能力单独的那句，没有就用通用的', () => {
    expect(cueKeys('saki', { kind: 'ability', text: '岭上开花' })).toEqual(['rinshan', 'ability']);
    expect(cueKeys('saki', { kind: 'ability', text: '没有这个能力' })).toEqual(['ability']);
    // 带后缀的提示字：绝一门·万子、运势·X
    expect(cueKeys('kasumi', { kind: 'ability', text: '绝一门·万子' })[0]).toBe('void-suit');
    expect(cueKeys('nelly', { kind: 'ability', text: '运势·大吉' })[0]).toBe('luck');
    // 名字像但不是同一个：里鬼门不是鬼门，破碎的钥匙不是钥匙
    expect(cueKeys('hatsumi', { kind: 'ability', text: '里鬼门' })[0]).toBe('ura-kimon');
    expect(cueKeys('hatsumi', { kind: 'ability', text: '鬼门·杠' })[0]).toBe('kimon');
    expect(cueKeys('himeko', { kind: 'ability', text: '破碎的钥匙' })[0]).toBe('broken');
    expect(cueKeys('himeko', { kind: 'ability', text: '钥匙' })[0]).toBe('key');
    // 爽的每朵云、每个神威各共用一句
    for (const t of ['红云', '白云', '红云→原村和']) expect(cueKeys('sawaya', { kind: 'ability', text: t })[0]).toBe('cloud');
    for (const t of ['瘟神威', '海神威']) expect(cueKeys('sawaya', { kind: 'ability', text: t })[0]).toBe('kamui');
    // 没有单独台词的角色只有通用的
    expect(cueKeys('toki', { kind: 'ability', text: '一巡先见' })).toEqual(['ability']);
  });

  it('一次放多个文件：照文件名对上是哪一句', () => {
    const saki = byId('saki');
    expect(matchVoiceFile(saki, '立直.mp3')).toBe('riichi');
    expect(matchVoiceFile(saki, 'Riichi.WAV')).toBe('riichi');
    expect(matchVoiceFile(saki, 'リーチ.ogg')).toBe('riichi');
    expect(matchVoiceFile(saki, '宫永咲-自摸.mp3')).toBe('tsumo');
    expect(matchVoiceFile(saki, 'saki_kan.m4a')).toBe('kan');
    expect(matchVoiceFile(saki, '岭上开花.mp3')).toBe('rinshan');
    expect(matchVoiceFile(saki, '能力发动.mp3')).toBe('ability');
    expect(matchVoiceFile(saki, '随便什么.mp3')).toBeNull();
    // 一格管两个能力的，两个名字都认
    expect(matchVoiceFile(byId('koromo'), '海底自摸.mp3')).toBe('haitei');
    expect(matchVoiceFile(byId('awai'), '杠里.mp3')).toBe('kan-ura');
    // 没有能力的角色没有能力那几格
    const plain = CHARACTERS.find((c) => !c.ability)!;
    expect(matchVoiceFile(plain, '能力发动.mp3')).toBeNull();
    expect(matchVoiceFile(plain, '荣和.mp3')).toBe('ron');
  });
});

describe('角色语音：语音包', () => {
  it('base64 来回不变（长的也行）', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 31 + 7) % 256);
    expect([...base64ToBytes(bytesToBase64(bytes)).slice(0, 2000)]).toEqual([...bytes.slice(0, 2000)]);
    expect(base64ToBytes(bytesToBase64(bytes)).length).toBe(bytes.length);
  });

  it('放一句、换一句、拿掉一句，存成文字再读回来一样', () => {
    let pack = emptyPack();
    pack = withClip(pack, 'riichi', { type: 'audio/mpeg', data: 'AAAA' });
    pack = withClip(pack, 'pon', { type: 'audio/wav', data: 'BBBB' });
    expect(packLines(pack)).toEqual(['pon', 'riichi']);
    const next = withClip(pack, 'riichi', { type: 'audio/wav', data: 'CCCC' });
    expect(pack.clips.riichi.data).toBe('AAAA');
    expect(next.clips.riichi.data).toBe('CCCC');
    expect(packLines(withClip(next, 'pon', null))).toEqual(['riichi']);
    expect(parsePack(packText(next))).toEqual(next);
  });

  it('坏的包读成空的，坏的片段丢掉', () => {
    expect(parsePack('不是 JSON')).toEqual(emptyPack());
    expect(parsePack('null')).toEqual(emptyPack());
    expect(parsePack('{"clips":[]}')).toEqual(emptyPack());
    expect(parsePack('{"v":1,"clips":{"a":{"type":"audio/mpeg","data":"QQ=="},"b":{"data":""},"c":null,"d":{"data":5}}}')).toEqual({ v: 1, clips: { a: { type: 'audio/mpeg', data: 'QQ==' } } });
  });

  it('WAV：文件头对、长度对', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 32000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    expect(wav.length).toBe(44 + 8);
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(32000);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32767);
  });

  it('有声的那一截：跳过前后的空白，量出最响处；全是静音时没有', () => {
    const rate = 1000;
    const data = new Float32Array(3000);
    for (let i = 1000; i < 2000; i++) data[i] = 0.5 * Math.sin(i);
    data[1500] = 0.5;
    const span = soundSpan(data, rate)!;
    expect(span.peak).toBeCloseTo(0.5, 5);
    expect(span.start).toBeGreaterThan(0.95);
    expect(span.start).toBeLessThanOrEqual(1.01);
    expect(span.end).toBeGreaterThanOrEqual(1.99);
    expect(span.end).toBeLessThan(2.1);
    expect(soundSpan(new Float32Array(1000), rate)).toBeNull();
  });
});
