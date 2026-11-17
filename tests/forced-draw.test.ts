import { describe, expect, it } from 'vitest';
import { newStats, playBrawl } from './brawl/harness';
import { brawlPool } from './brawl/probes';

// 涅莉的七姐妹会把被封的人自己锁好的和了牌强行换掉（Wall.forceNext），锁跟着位置转到换上来的那张牌上。
// 她换的时候只看自己的规矩：换上来的牌要是别人的规矩（霞的绝一门）不许摸的，规则引擎最后对账时要照强行的换法再换一次，
// 不能因为那张牌“锁着”就放过去。
// 这一局是大乱斗里抽到过的：霞、爱丽丝、涅莉、池田同桌，东2局 1本场爱丽丝画好的和了牌被七姐妹换成了绝一门禁的那一门
describe('强行换上来的牌也要守别人的规矩', () => {
  it('七姐妹换掉爱丽丝锁好的和了牌：换上来的牌绝一门也得许', () => {
    const pool = brawlPool();
    const chars = pool.filter((c) => ['kasumi', 'aislinn', 'nelly', 'kana'].includes(c.id));
    expect(chars.length).toBe(4);
    const stats = newStats();
    playBrawl(chars, 229002, stats);
    expect(stats.problems).toEqual([]);
    expect(stats.games).toBe(1);
    expect(stats.ruleChecks).toBeGreaterThan(0);
  }, 120000);
});
