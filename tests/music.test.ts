import { describe, expect, it, vi } from 'vitest';
import { Game, GameEvent } from '../src/engine/game';
import { musicDucked } from '../src/ui/audioBus';
import { loopPosition, musicState, playMusic } from '../src/ui/music';
import { MAX_SLOT_VOL, onMusicStore, setSlotVol, slotMeta } from '../src/ui/musicStore';
import { MUSIC_SLOTS, RESUMES } from '../src/ui/musicTracks';
import { Scene, gameMusic, menuMusic, promptCue, resultMusic, soundtrackEvent, stopMusic, tableScene } from '../src/ui/soundtrack';

// 配乐的规矩：什么场面放哪个格子的曲子。测试里没有浏览器的声音出口，真的出声那一半在浏览器里验
const game = (format: 'one' | 'east' | 'south' | 'team' = 'south') => new Game({ seed: 7, format, players: ['a', 'b', 'c', 'd'].map((name) => ({ name })) });
const scene = (over: Partial<Scene> = {}): Scene => ({ me: 0, quiet: false, finale: false, delay: 0, ...over });

describe('循环放到哪了', () => {
  it('没有循环点：整首循环', () => {
    expect(loopPosition(3, 10)).toBe(3);
    expect(loopPosition(13, 10)).toBeCloseTo(3);
    expect(loopPosition(25, 10)).toBeCloseTo(5);
  });

  it('有循环点：前奏只放一次，之后在循环段里转', () => {
    // 前奏 4 秒，循环段 4 到 12 秒
    expect(loopPosition(2, 14, 4, 12)).toBe(2);
    expect(loopPosition(11, 14, 4, 12)).toBe(11);
    expect(loopPosition(13, 14, 4, 12)).toBeCloseTo(5);
    expect(loopPosition(29, 14, 4, 12)).toBeCloseTo(5);
  });

  it('循环点写错了（超出曲子、终点在起点前面）：当没写', () => {
    expect(loopPosition(13, 10, 4, 12)).toBeCloseTo(3);
    expect(loopPosition(13, 10, 6, 5)).toBeCloseTo(3);
    expect(loopPosition(-1, 10)).toBe(0);
    expect(loopPosition(5, 0)).toBe(0);
  });
});

describe('牌桌上放哪首', () => {
  it('东场放东场的，南场放南场的，没有就放另一首', () => {
    const g = game();
    expect(tableScene(g, false, false)).toEqual(['east', 'south']);
    g.roundWind = 1;
    g.roundNumber = 0;
    expect(tableScene(g, false, false)).toEqual(['south', 'east']);
  });

  it('有人立直、最后一局、团体赛大将战：紧张的曲子排在前面', () => {
    const g = game();
    expect(tableScene(g, false, true)).toEqual(['tense', 'east', 'south']);
    expect(tableScene(g, true, false)).toEqual(['tense', 'east', 'south']);
    g.roundWind = 1;
    g.roundNumber = 3;
    expect(tableScene(g, false, false)).toEqual(['tense', 'south', 'east']);
  });

  it('东风战的东四局是最后一局；一局战不算', () => {
    const east = game('east');
    east.roundNumber = 3;
    expect(tableScene(east, false, false)[0]).toBe('tense');
    expect(tableScene(game('one'), false, false)).toEqual(['east', 'south']);
  });
});

describe('场景切换', () => {
  it('选人页、开局、不是游戏的页面', () => {
    menuMusic();
    expect(musicState().want).toEqual(['menu']);
    gameMusic(game(), false);
    expect(musicState().want).toEqual(['east', 'south']);
    stopMusic();
    expect(musicState().want).toEqual([]);
  });

  it('有人立直换成紧张的，下一局开始换回来', () => {
    const g = game();
    gameMusic(g, false);
    soundtrackEvent({ type: 'discard', seat: 2, tile: 0, riichi: true } as GameEvent, g, scene());
    expect(musicState().want).toEqual(['tense', 'east', 'south']);
    expect(musicDucked()).toBe(true);
    soundtrackEvent({ type: 'roundStart', label: '' }, g, scene());
    expect(musicState().want).toEqual(['east', 'south']);
  });

  it('隐身的人立直：音乐不变（不然就露馅了）', () => {
    const g = game();
    gameMusic(g, false);
    vi.spyOn(g, 'stealthed').mockReturnValue(true);
    soundtrackEvent({ type: 'discard', seat: 2, tile: 0, riichi: true } as GameEvent, g, scene());
    expect(musicState().want).toEqual(['east', 'south']);
  });

  it('整场打完放结算的；一局的结算不换曲子', () => {
    const g = game();
    gameMusic(g, false);
    resultMusic(g, scene(), false);
    expect(musicState().want).toEqual(['east', 'south']);
    g.phase = 'gameEnd';
    resultMusic(g, scene(), false);
    expect(musicState().want).toEqual(['result', 'east', 'south']);
  });

  it('同一个场景叫两次不重来；没有声音出口时提示音不出错', () => {
    playMusic('menu');
    const before = musicState();
    playMusic(['menu']);
    expect(musicState()).toEqual(before);
    const g = game();
    expect(() => {
      promptCue(g, 0);
      soundtrackEvent({ type: 'draw', seat: 0 } as GameEvent, g, scene());
      soundtrackEvent({ type: 'ability', seat: 1, ability: 'x', text: 'y' } as GameEvent, g, scene());
    }).not.toThrow();
  });
});

describe('曲目的格子', () => {
  it('五个格子；选人页和东、南场切走回来接着放，紧张和结算从头', () => {
    expect(MUSIC_SLOTS.map((s) => s.id)).toEqual(['menu', 'east', 'south', 'tense', 'result']);
    expect([...RESUMES].sort()).toEqual(['east', 'menu', 'south']);
  });

  it('单曲音量默认 100，夹在 0 到 150 之间，改了才通知', () => {
    expect(slotMeta('east')).toMatchObject({ vol: 1, custom: null });
    const cb = vi.fn();
    const off = onMusicStore(cb);
    setSlotVol('east', 9);
    expect(slotMeta('east').vol).toBe(MAX_SLOT_VOL);
    setSlotVol('east', MAX_SLOT_VOL);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('east');
    setSlotVol('east', -1);
    expect(slotMeta('east').vol).toBe(0);
    off();
    setSlotVol('east', 1);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
