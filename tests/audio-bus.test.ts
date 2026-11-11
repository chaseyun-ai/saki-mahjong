import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUDIO, audio, audioSettings, bus, duckMusic, musicDucked, onAudioSettings, setAudioSetting, volumeGain } from '../src/ui/audioBus';

// 音量总线的设置和压低音乐的规矩。测试里没有浏览器的声音出口，出口那一半在浏览器里验
describe('声音设置', () => {
  it('默认：总音量 80、音乐 50、音效和语音 100，不静音，演出时压低音乐', () => {
    expect(audioSettings).toEqual(DEFAULT_AUDIO);
    expect(DEFAULT_AUDIO).toMatchObject({ master: 0.8, music: 0.5, sfx: 1, voice: 1, mute: false, duck: true, voiceMode: 'on' });
  });

  it('音量夹在 0 到 1 之间，乱写的当 0', () => {
    setAudioSetting('music', 3);
    expect(audioSettings.music).toBe(1);
    setAudioSetting('music', -2);
    expect(audioSettings.music).toBe(0);
    setAudioSetting('music', Number.NaN);
    expect(audioSettings.music).toBe(0);
    setAudioSetting('music', DEFAULT_AUDIO.music);
  });

  it('改了才通知，取消以后不再通知', () => {
    const cb = vi.fn();
    const off = onAudioSettings(cb);
    setAudioSetting('sfx', 0.4);
    setAudioSetting('sfx', 0.4);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setAudioSetting('sfx', 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('滑杆到增益是平方：一半约 -12 dB，两头不变', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBeCloseTo(0.25);
  });

  it('没有声音出口时不出错：audio() 和不带出口的 bus() 都是 null', () => {
    expect(audio()).toBeNull();
    expect(bus('music')).toBeNull();
  });
});

describe('压低音乐', () => {
  it('几处同时压着，全松开了才算松开；松开多叫几次没关系', () => {
    const a = duckMusic();
    const b = duckMusic();
    expect(musicDucked()).toBe(true);
    a();
    a();
    expect(musicDucked()).toBe(true);
    b();
    expect(musicDucked()).toBe(false);
  });

  it('给了秒数到点自己松开', () => {
    vi.useFakeTimers();
    duckMusic(0.5);
    expect(musicDucked()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(musicDucked()).toBe(false);
    vi.useRealTimers();
  });

  it('设置里关了就不压', () => {
    setAudioSetting('duck', false);
    const off = duckMusic();
    expect(musicDucked()).toBe(false);
    setAudioSetting('duck', true);
    expect(musicDucked()).toBe(true);
    off();
  });
});
