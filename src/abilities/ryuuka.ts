import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { Kind, TileId, kindOf, toCounts } from '../engine/tiles';
import { akoDistance } from './ako';
import { dangerKinds } from './hiroe';
import type { Ability, PreDealOption } from './types';

// 清水谷龙华（千里山）：队长，怜的搭档。两个技能都在发牌前决定，各自用一次管一局：
// - 怜的膝枕（和怜同队时才有，一场 pillowUses 次）：这一局和怜一样看得见自己下一次摸到的牌（一巡先见）
// - 无极天（一场 mugokuUses 次）：感知别人的体温、心跳、呼吸——
//   看得出每家听没听牌；手里打出去会放铳的牌标红（玩家操作时）；摸牌有 draw 的概率换成进张
// 电脑的龙华：剩下的次数够把剩下的局都用上就每局用；不然坐庄、或者落后第一 behind 点以上时用
export const RYUUKA = {
  pillowUses: 4,
  mugokuUses: 3,
  draw: 0.3,
  behind: 8000,
};

interface RyuukaGameState {
  pillow?: number; // 用过几次
  mugoku?: number;
  want?: string[]; // 玩家发牌前选的
}
interface RyuukaState {
  pillow?: boolean;
  mugoku?: boolean;
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as RyuukaGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as RyuukaState;

// 怜和她同队（团体赛）
export const ryuukaWithToki = (g: Game, seat: number): boolean => g.allies[seat]?.includes('toki') ?? false;
export const ryuukaPillowLeft = (g: Game, seat: number): number => (ryuukaWithToki(g, seat) ? RYUUKA.pillowUses - (gameStateOf(g, seat).pillow ?? 0) : 0);
export const ryuukaMugokuLeft = (g: Game, seat: number): number => RYUUKA.mugokuUses - (gameStateOf(g, seat).mugoku ?? 0);

// 这一局借着怜的膝枕
export function ryuukaPillow(g: Game, seat: number): boolean {
  return g.active(seat)?.id === 'ryuuka' && !!stateOf(g, seat).pillow;
}

// 这一局在无极天里
export function ryuukaMugoku(g: Game, seat: number): boolean {
  return g.active(seat)?.id === 'ryuuka' && !!stateOf(g, seat).mugoku;
}

// 无极天感知到的：每家听没听牌（不看有没有役）
export function ryuukaSensesTenpai(g: Game, target: number): boolean {
  return akoDistance(g, target) === 0;
}

// 无极天标红的牌种：打出去会被别人荣和
export function ryuukaDanger(g: Game, seat: number): Set<Kind> {
  return dangerKinds(g, seat);
}

// 电脑：这一局用不用（left 是还剩几次）
function aiWants(g: Game, seat: number, left: number): boolean {
  if (left <= 0) return false;
  const last = g.fullHanchan ? 7 : 3;
  const slotsLeft = Math.max(1, last - (g.roundWind * 4 + g.roundNumber) + 1);
  if (left >= slotsLeft) return true;
  if (seat === g.dealer) return true;
  const top = Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score));
  return top - g.players[seat].score >= RYUUKA.behind;
}

const useful = (g: Game, seat: number) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t: TileId) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, p.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
};

export const ryuukaAbility: Ability = {
  id: 'ryuuka',
  name: '怜的膝枕·无极天',
  description: `发牌前决定这一局用不用，各用一次管一局。怜的膝枕（和怜同队时，一场 ${RYUUKA.pillowUses} 次）：看得见自己下一次摸到的牌。无极天（一场 ${RYUUKA.mugokuUses} 次）：看得出每家听没听牌，手里会放铳的牌标红，摸牌更容易是进张。`,
  foresight: { title: '怜的膝枕' },

  foresightOn(g, seat) {
    return ryuukaPillow(g, seat);
  },

  // 这一局用哪几样：玩家在发牌前选好了，电脑在这里自己决定（不定配牌的规矩）
  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    const want = g.manual[seat] ? (gs.want ?? []) : null;
    gs.want = [];
    const pillow = ryuukaPillowLeft(g, seat) > 0 && (want ? want.includes('pillow') : aiWants(g, seat, ryuukaPillowLeft(g, seat)));
    const mugoku = ryuukaMugokuLeft(g, seat) > 0 && (want ? want.includes('mugoku') : aiWants(g, seat, ryuukaMugokuLeft(g, seat)));
    if (pillow) {
      st.pillow = true;
      gs.pillow = (gs.pillow ?? 0) + 1;
    }
    if (mugoku) {
      st.mugoku = true;
      gs.mugoku = (gs.mugoku ?? 0) + 1;
    }
  },

  onRoundStart(g, seat) {
    const st = stateOf(g, seat);
    if (st.pillow) g.emit({ type: 'ability', seat, ability: 'ryuuka', text: '怜的膝枕' });
    if (st.mugoku) g.emit({ type: 'ability', seat, ability: 'ryuuka', text: '无极天' });
  },

  // 无极天：摸牌容易是进张
  beforeDraw(g, seat, rinshan) {
    if (rinshan || !stateOf(g, seat).mugoku || !g.rng.chance(RYUUKA.draw)) return;
    const good = useful(g, seat);
    if (!good(g.wall.live[0])) g.wall.bringToLive(0, good, g.rng);
  },

  preDeal(g, seat) {
    const pillow = ryuukaPillowLeft(g, seat);
    const mugoku = ryuukaMugokuLeft(g, seat);
    const out: PreDealOption[] = [];
    if (ryuukaWithToki(g, seat)) {
      out.push({ id: 'pillow', name: '怜的膝枕', desc: '这一局看得见自己下一次摸到的牌', enabled: pillow > 0, picked: false, note: pillow > 0 ? `还剩 ${pillow} 次` : '用完了' });
    }
    out.push({ id: 'mugoku', name: '无极天', desc: '这一局看得出每家听没听牌，会放铳的牌标红，摸牌更容易是进张', enabled: mugoku > 0, picked: false, note: mugoku > 0 ? `还剩 ${mugoku} 次` : '用完了' });
    return out;
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).want = picked;
  },

  skill(g, seat) {
    const st = stateOf(g, seat);
    const on = [st.pillow ? '怜的膝枕' : '', st.mugoku ? '无极天' : ''].filter(Boolean);
    const left = [ryuukaWithToki(g, seat) ? `膝枕剩 ${ryuukaPillowLeft(g, seat)} 次` : '', `无极天剩 ${ryuukaMugokuLeft(g, seat)} 次`].filter(Boolean).join('，');
    return { label: '', note: on.length ? `这一局：${on.join('、')}（${left}）` : `${left}，发牌前选`, enabled: false, active: on.length > 0 };
  },

  badge(g, seat) {
    const st = stateOf(g, seat);
    return [st.pillow ? '膝枕' : '', st.mugoku ? '无极天' : ''].filter(Boolean).join('·') || null;
  },

  insight(g, seat) {
    const st = stateOf(g, seat);
    return [
      st.pillow ? '这一局借着怜的膝枕，看得见自己下一张' : ryuukaWithToki(g, seat) ? `怜的膝枕还剩 ${ryuukaPillowLeft(g, seat)} 次` : '怜不在她队里，借不到膝枕',
      st.mugoku ? '这一局在无极天里：看得出谁听牌、哪张会放铳，摸牌更顺' : `无极天还剩 ${ryuukaMugokuLeft(g, seat)} 次`,
    ];
  },
};
