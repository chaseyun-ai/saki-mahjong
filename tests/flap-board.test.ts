import { describe, expect, it } from 'vitest';
import { FLAP_DOWN, FLAP_UP, FLAP_WINDS, FlapBoard, flapPages } from '../src/ui3d/flapBoard';

// 翻牌屏仪表盘上的翻牌（flapBoard.ts）：字变了一页页翻到新字，往近的那头翻
describe('翻牌屏的翻牌板', () => {
  it('第一次见到的翻牌直接是新字，不翻', () => {
    const b = new FlapBoard();
    b.now = 5;
    expect(b.face('p0:5:0', '2', FLAP_UP)).toEqual({ cur: '2', next: null, p: 0 });
    expect(b.busy).toBe(false);
  });

  it('字变了一页页翻过去，翻完就停', () => {
    const b = new FlapBoard();
    b.face('rw', '东', FLAP_WINDS);
    b.now = 1;
    const f = b.face('rw', '南', FLAP_WINDS);
    expect(f.cur).toBe('东');
    expect(f.next).toBe('南');
    expect(b.busy).toBe(true);
    b.now = 1.5;
    expect(b.face('rw', '南', FLAP_WINDS)).toEqual({ cur: '南', next: null, p: 0 });
    expect(b.busy).toBe(false);
    expect(b.takeFlips()).toBe(1);
  });

  it('往近的那头翻：跌了不会先翻成大数，余牌倒着数一页', () => {
    expect(flapPages('25000', '17000')).toEqual(['16000', '17000']);
    expect(flapPages('25000', '57000')).toEqual(['36000', '47000', '57000']);
    expect(flapPages('东', '北')).toEqual(['北']);
    const b = new FlapBoard();
    b.face('rm:2:1', '0', FLAP_DOWN, 0, true);
    b.now = 1;
    expect(b.face('rm:2:1', '9', FLAP_DOWN, 0, true).next).toBe('9');
    b.now = 2;
    b.face('rm:2:1', '9', FLAP_DOWN, 0, true);
    // 余牌翻的时候不出声
    expect(b.takeFlips()).toBe(0);
  });

  it('位数变了、字不在那一圈里：一页直接翻到', () => {
    expect(flapPages('8000', '12000')).toEqual(['12000']);
    expect(flapPages('西', '西!')).toEqual(['西!']);
    expect(flapPages('5', '5')).toEqual([]);
  });

  it('这一遍没画到的翻牌扔掉，再出现时直接是新字', () => {
    const b = new FlapBoard();
    b.face('p1:5:0', '2', FLAP_UP);
    b.endFrame();
    b.endFrame();
    b.now = 3;
    expect(b.face('p1:5:0', '7', FLAP_UP).next).toBeNull();
  });

  it('只记画得和上一遍不一样的翻牌（翻牌在翻时只把这几块传给显卡）', () => {
    const b = new FlapBoard();
    const at = (x: number) => ({ x, y: 0, w: 10, h: 10 });
    b.touch('a', '1|null|0.000', at(0));
    b.touch('b', '2|null|0.000', at(20));
    b.endFrame();
    expect(b.takeDirty()).toEqual([at(0), at(20)]);
    // 下一遍：a 在翻，b 没动
    b.touch('a', '1|2|0.400', at(0));
    b.touch('b', '2|null|0.000', at(20));
    b.endFrame();
    expect(b.takeDirty()).toEqual([at(0)]);
    // 取走以后清空；没画到的扔掉，再出现时算新的
    expect(b.takeDirty()).toEqual([]);
    b.touch('a', '1|2|0.400', at(0));
    b.endFrame();
    b.touch('b', '2|null|0.000', at(20));
    b.endFrame();
    expect(b.takeDirty()).toEqual([at(20)]);
  });
});
