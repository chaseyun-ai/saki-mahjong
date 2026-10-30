// 牌的表示：
// - 牌种 kind: 0-8 万子 1-9，9-17 筒子，18-26 索子，27-30 东南西北，31-33 白发中
// - 牌 id: 0-135，kind = id >> 2；赤宝牌见 RED_FIVES

export type TileId = number;
export type Kind = number;

export const KIND_COUNT = 34;
export const TILE_COUNT = 136;

// 赤宝牌：三赤是每种的第一张五（id 16、52、88），四赤再加一张筒子五（53），关闭就没有。
// 一桌牌局开始时由 Game 按规则设好（见 setRedFives），整个页面同时只打一桌
export const RED_FIVES: TileId[] = [16, 52, 88];
const RED_BY_COUNT: Record<number, TileId[]> = { 0: [], 3: [16, 52, 88], 4: [16, 52, 53, 88] };
export function setRedFives(count: 0 | 3 | 4): void {
  RED_FIVES.splice(0, RED_FIVES.length, ...RED_BY_COUNT[count]);
}

export const EAST = 27;
export const SOUTH = 28;
export const WEST = 29;
export const NORTH = 30;
export const HAKU = 31;
export const HATSU = 32;
export const CHUN = 33;

export const kindOf = (id: TileId): Kind => id >> 2;
export const isRed = (id: TileId): boolean => RED_FIVES.includes(id);

export const isHonor = (k: Kind): boolean => k >= 27;
export const isWind = (k: Kind): boolean => k >= 27 && k <= 30;
export const isDragon = (k: Kind): boolean => k >= 31;
export const suitOf = (k: Kind): number => (k < 27 ? Math.floor(k / 9) : 3);
export const numOf = (k: Kind): number => (k < 27 ? (k % 9) + 1 : 0);
export const isTerminal = (k: Kind): boolean => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isYaochu = (k: Kind): boolean => isHonor(k) || isTerminal(k);
export const isSimple = (k: Kind): boolean => !isYaochu(k);

export const YAOCHU_KINDS: readonly Kind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

// 宝牌指示牌指向的下一张牌
export function doraFromIndicator(k: Kind): Kind {
  if (k < 27) return Math.floor(k / 9) * 9 + ((k % 9) + 1) % 9;
  if (k <= 30) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}

export function toCounts(ids: readonly TileId[]): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0);
  for (const id of ids) c[kindOf(id)]++;
  return c;
}

const SUIT_CHARS = ['m', 'p', 's', 'z'];

// 调试和测试用的简写：kindName(4) === '5m'
export function kindName(k: Kind): string {
  if (k < 27) return `${numOf(k)}${SUIT_CHARS[suitOf(k)]}`;
  return `${k - 26}z`;
}

// 把 "123m456p77z" 这样的写法解析成牌种列表
export function parseKinds(s: string): Kind[] {
  const out: Kind[] = [];
  let digits: number[] = [];
  for (const ch of s.replace(/\s+/g, '')) {
    if (/[0-9]/.test(ch)) {
      digits.push(Number(ch));
      continue;
    }
    const suit = SUIT_CHARS.indexOf(ch);
    if (suit < 0) throw new Error(`无法解析的牌: ${s}`);
    for (const d of digits) {
      const n = d === 0 ? 5 : d;
      out.push(suit === 3 ? 26 + n : suit * 9 + n - 1);
    }
    digits = [];
  }
  return out;
}

// 把写法解析成牌 id，同种牌依次取不同的 id；"0m" 表示赤五万
export function parseTiles(s: string): TileId[] {
  const used = new Set<TileId>();
  const out: TileId[] = [];
  let digits: string[] = [];
  for (const ch of s.replace(/\s+/g, '')) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
      continue;
    }
    const suit = SUIT_CHARS.indexOf(ch);
    for (const d of digits) {
      const red = d === '0';
      const n = red ? 5 : Number(d);
      const k = suit === 3 ? 26 + n : suit * 9 + n - 1;
      let id = -1;
      for (let i = 0; i < 4; i++) {
        const cand = k * 4 + i;
        if (used.has(cand)) continue;
        if (red !== isRed(cand)) continue;
        id = cand;
        break;
      }
      if (id < 0) throw new Error(`牌不够: ${s}`);
      used.add(id);
      out.push(id);
    }
    digits = [];
  }
  return out;
}

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_CN = ['万', '筒', '索'];
const HONOR_CN = ['东', '南', '西', '北', '白', '发', '中'];

export function kindLabel(k: Kind): string {
  if (k < 27) return `${NUM_CN[numOf(k) - 1]}${SUIT_CN[suitOf(k)]}`;
  return HONOR_CN[k - 27];
}

export const WIND_CN = ['东', '南', '西', '北'];
