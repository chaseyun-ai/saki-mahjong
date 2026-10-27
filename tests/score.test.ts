import { describe, expect, it } from 'vitest';
import { WinContext, evaluateWin, Meld } from '../src/engine/score';
import { EAST, SOUTH, parseKinds, parseTiles, kindOf } from '../src/engine/tiles';

function win(closed: string, winTile: string, opts: Partial<WinContext> = {}, melds: Meld[] = []) {
  const tiles = parseTiles(closed);
  const wk = parseKinds(winTile)[0];
  const winId = tiles.find((t) => kindOf(t) === wk)!;
  return evaluateWin({
    closed: tiles,
    melds,
    winTile: winId,
    tsumo: false,
    seatWind: SOUTH,
    roundWind: EAST,
    isDealer: false,
    doraIndicators: parseKinds('5z'), // 宝牌是发，下面的手牌都没有
    ...opts,
  });
}

describe('算分', () => {
  it('平和荣和 1 番 30 符 1000 点', () => {
    const r = win('123456m789p234s55s', '1m')!;
    expect(r.yaku.map((y) => y.name)).toEqual(['平和']);
    expect([r.han, r.fu, r.ron]).toEqual([1, 30, 1000]);
  });

  it('平和自摸 2 番 20 符 400/700', () => {
    const r = win('123456m789p234s55s', '1m', { tsumo: true })!;
    expect([r.han, r.fu, r.tsumoOtherPays, r.tsumoDealerPays]).toEqual([2, 20, 400, 700]);
  });

  it('没有役不能和', () => {
    expect(win('123456m789p234s55s', '2m')).toBeNull(); // 坎张，不是平和
  });

  it('七对子 2 番 25 符 1600', () => {
    const r = win('1133m2288p4466s77z', '7z')!;
    expect(r.yaku.map((y) => y.name)).toEqual(['七对子']);
    expect([r.han, r.fu, r.ron]).toEqual([2, 25, 1600]);
  });

  it('副露役牌 1 番 30 符', () => {
    const chun = parseTiles('777z');
    const r = win('234m567p789s55s', '9s', {}, [{ type: 'pon', tiles: chun }])!;
    expect(r.yaku.map((y) => y.name)).toEqual(['役牌 中']);
    expect([r.han, r.fu, r.ron]).toEqual([1, 30, 1000]);
  });

  it('同一手牌取最高的拆法：三暗刻优于一杯口', () => {
    const r = win('111222333m456p77s', '3m', { tsumo: true })!;
    expect(r.yaku.map((y) => y.name).sort()).toEqual(['三暗刻', '门前清自摸和'].sort());
    expect([r.han, r.fu, r.tsumoOtherPays, r.tsumoDealerPays]).toEqual([3, 40, 1300, 2600]);
  });

  it('国士无双 役满', () => {
    const r = win('19m19p19s12345677z', '7z')!;
    expect(r.yakuman).toBe(1);
    expect(r.ron).toBe(32000);
  });

  it('庄家清一色满贯以上', () => {
    const r = win('11123455678999m', '5m', { isDealer: true, seatWind: EAST })!;
    expect(r.yaku.some((y) => y.name === '九莲宝灯')).toBe(true);
    expect(r.ron).toBe(48000);
  });

  it('立直、一发、宝牌、赤宝牌、里宝牌', () => {
    const r = win('234m067p345678s22p', '2p', {
      riichi: true,
      ippatsu: true,
      doraIndicators: parseKinds('1m'), // 宝牌二万
      uraIndicators: parseKinds('1s'), // 里宝牌二索，没有
    })!;
    // 立直 一发 断幺九 + 宝牌1 + 赤1 = 5 番满贯
    expect([r.dora, r.aka, r.ura]).toEqual([1, 1, 0]);
    expect(r.han).toBe(5);
    expect(r.ron).toBe(8000);
  });

  it('岭上开花', () => {
    const kan = parseTiles('1111z');
    const r = win('234m567p789s55s', '9s', { tsumo: true, rinshan: true, seatWind: SOUTH }, [
      { type: 'ankan', tiles: kan },
    ])!;
    expect(r.yaku.map((y) => y.name)).toContain('岭上开花');
    expect(r.yaku.map((y) => y.name)).toContain('门前清自摸和');
  });
});
