// 界面皮肤：选人页上切换，记在浏览器里。CSS 按 <html data-theme> 换样式（src/ui/themes.css，新加的四套在 themes2.css），
// 3D/2.5D 牌桌的桌布、牌背、桌框颜色在建牌桌时从这里取（tableColors）。
// 牌桌风格：桌面和中央仪表盘配成一套，跟皮肤分开选（视觉设置里的「牌桌风格」）；默认跟皮肤走，就是原来的样子。
// 2D 牌桌按 <html data-table> 换桌布和中间那块（src/ui/tableStyles.css）
// 像素（方块世界那种画法）：既是一套皮肤（界面是石头按钮、像素字，主页、特效都换成像素画，src/pixel/pixel.css），
// 也是一套牌桌风格（别的皮肤也能配像素牌桌）。用像素牌桌时 3D、2.5D 的桌子是一个个方块搭的（src/ui3d/blockTable.ts），
// 桌布、桌框、牌身贴 16×16 的方块小图（src/pixel/blocks.ts），牌面换成一格格画的像素牌面（src/pixel/faces.ts）

export type ThemeId = 'classic' | 'broadcast' | 'washi' | 'awaken' | 'porcelain' | 'neon' | 'manga' | 'arcade' | 'pixel';

export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'broadcast', name: '大赛转播' },
  { id: 'washi', name: '和风雀庄' },
  { id: 'awaken', name: '能力觉醒' },
  { id: 'porcelain', name: '白瓷简约' },
  { id: 'neon', name: '赛博霓虹' },
  { id: 'manga', name: '漫画分镜' },
  { id: 'arcade', name: '复古街机' },
  { id: 'pixel', name: '像素' },
  { id: 'classic', name: '经典' },
];

export interface TableColors {
  // 桌布的径向渐变：中心、中间、边缘
  felt: [string, string, string];
  // 桌布上那一圈细线
  feltLine: string;
  back: string;
  frame: string;
  trim: string;
  // 背景和地板
  room: string;
  // 中央仪表盘：底色（中心、边缘）、描边、主字色、次要字色、强调色（局数、轮到谁），局数用的字体
  console: { bg: [string, string]; line: string; ink: string; dim: string; accent: string; title: string };
  // 下面几项只有牌桌风格里有；皮肤自带的牌桌不写，就是布纹桌布、原来那种仪表盘
  // 桌面的材质：布纹、绿呢、木纹、哑光、亚麻、细沙、青草
  pattern?: FeltPattern;
  // 仪表盘的画法（consoleLooks.ts）
  look?: ConsoleLook;
  // 桌框、包边的粗糙度和金属感
  frameFinish?: [number, number];
  trimFinish?: [number, number];
  // 仪表盘侧面的颜色，顶面自己发光的强度
  consoleBody?: string;
  consoleGlow?: number;
  // 款式（形状）：桌框、包边、仪表盘做成什么样子
  form?: TableForm;
  // 全自动麻将机（只有自动麻将机这套有）：每局开始中间那块抬起来把旧牌收进去，四块升降板托着新码好的牌山从桌面里升上来；
  // 机器里两副牌轮流用，两副的牌背颜色不一样（backs，第一副就是 back），一局换一副
  machine?: { backs: [string, string] };
  // 实际用的仪表盘形状（tableColors() 照视觉设置里的「仪表盘形状」填：跟牌桌走时是牌桌风格自己的，跟皮肤走是方盒）
  shape?: ConsoleForm;
  // 牌本身的样子（只有沙滩、草甸、原木、翻转、深夜有）：牌身什么颜色、什么质地，牌背上压什么花样。没写就是原来的象牙白牌身
  tile?: TileLook;
  // 换局的演法（只有沙滩、草甸、原木、翻转、深夜有）：tide 一个浪打过来把牌冲散、退潮后沙子聚成新牌山；gust 一阵风把牌吹散、下一局再聚拢；
  // shuffle 手搓洗牌：牌扣过来摊在中间四周，四家用手一把一把推着洗，四家各自码好牌山往前一推；
  // flip 像车站的翻牌屏换一屏：桌上的牌一排排翻下去，桌面的翻板跟着翻个面，新牌山一墩墩翻上来；
  // lamp 熄灯：黑里只剩牌背上的夜光月牙，旧牌被收走、新牌山码好，日光灯闪两下亮起来
  changeover?: 'tide' | 'gust' | 'shuffle' | 'flip' | 'lamp';
  // 仪表盘上记每家这个半庄和了几局（只有原木有）：谁和一局，那家旁边多盖一个小朱印
  seals?: boolean;
  // 仪表盘中间是一块表盘，一圈刻度上两根指针头指着现在几点（只有深夜有）
  clock?: boolean;
  // 像素牌桌（只有像素有）：方块搭的桌子、16×16 小图贴的桌布和地板、直角方块牌，牌面是像素牌面
  pixel?: boolean;
}

export interface TileLook {
  // 牌身（牌面那半）的颜色
  body: string;
  // 牌身、牌背上的细纹理：sand 一粒粒的沙（沙滩），fiber 一丝丝花瓣的纹路（草甸）；不写就是光面
  grain?: 'sand' | 'fiber' | 'block';
  // 牌背单独的纹理：bamboo 顺着牌长的一丝丝竹纤维（原木的竹背牌，牌身是光面的骨白）；不写就和牌身一样
  backGrain?: 'bamboo';
  // 牌身、牌背的粗糙度（沙子一点都不反光，花瓣有一点点光泽）
  rough?: number;
  // 牌背正中压出来的花样：贝壳（沙滩）、叶子（草甸）、翻牌中间那道缝（翻转：上半亮、下半暗，缝两头各一颗轴）、
  // 一弯夜光月牙（深夜：平时是浅一点的青色，熄了灯发出淡淡的青绿光）、一颗像素菱形宝石（像素）
  mark?: 'shell' | 'leaf' | 'seam' | 'moon' | 'pixel';
}

export type FeltPattern = 'cloth' | 'baize' | 'wood' | 'matte' | 'linen' | 'sand' | 'grass' | 'pixel';
export type ConsoleLook = 'skin' | 'led' | 'plaque' | 'flat' | 'flap' | 'tide' | 'linen' | 'pixel';
// 仪表盘的形状：圆角方盒（原来的）、矮木牌、圆盘、切角方盒、软包（大圆角、边上鼓起来，顶上一圈包边）
export type ConsoleForm = 'box' | 'plate' | 'disc' | 'chamfer' | 'cushion';

// 牌桌的款式。只有牌桌风格里有；皮肤自带的牌桌不写，就是原来的圆角桌框、金属包边、圆角方仪表盘
export interface TableForm {
  // 桌框外圈的四个角：圆角（原来的）、直角（四块木板拼的，角上一道斜拼缝）、大圆角、切角
  corner: 'round' | 'square' | 'pill' | 'chamfer';
  // 桌框上下边倒圆多大：大的像一圈软包、木桌的圆边，小的利落
  bevel: number;
  // 桌框内侧：金属包边条（原来的）、桌框面上嵌一道铜线、没有、低一级的铝台阶、一圈麻绳
  trim: 'strip' | 'inlay' | 'none' | 'step' | 'rope';
  // 桌框面上一排小件：铆钉
  studs?: 'rivet';
  // 这套牌桌自己的仪表盘形状（视觉设置里「仪表盘形状」选「跟牌桌走」时用这个）
  console: ConsoleForm;
  // 桌布上那圈线：一道（原来的）、两道、只在四个角上画一截、不画
  line: 'single' | 'double' | 'corners' | 'none';
}

// 像素牌桌（方块世界那种）：皮肤自带的和牌桌风格里的是同一套。桌子是一个个方块搭的（ui3d/blockTable.ts）：
// 木板方块的桌框、四根方块桌腿、一块块绿色羊毛毡拼的桌布、深色木板地面，天是浅蓝的；牌是直角的小方块，
// 牌身、牌背上一格格的颗粒，牌背正中一颗像素菱形宝石；仪表盘是一块石头方块。贴图都是 16×16 的小图（pixel/blocks.ts）
const PIXEL_TABLE: TableColors = {
  felt: ['#4fa35a', '#3f8f4a', '#2f6e38'],
  feltLine: '#f4d35e',
  back: '#d0603a',
  tile: { body: '#f6f1e4', grain: 'block', mark: 'pixel', rough: 1 },
  frame: '#a8743f',
  trim: '#f4d35e',
  room: '#8fbfee',
  console: { bg: ['#4a4845', '#232220'], line: '#9c9890', ink: '#ffffff', dim: '#c9c5bd', accent: '#ffd83d', title: "400 1em 'Saki Pixel 12','Noto Sans SC',sans-serif" },
  pattern: 'pixel',
  look: 'pixel',
  frameFinish: [1, 0],
  trimFinish: [0.6, 0.2],
  consoleBody: '#4d4b49',
  consoleGlow: 0.3,
  form: { corner: 'square', bevel: 0, trim: 'none', console: 'box', line: 'none' },
  pixel: true,
};

const TABLES: Record<ThemeId, TableColors> = {
  classic: {
    felt: ['#2c7079', '#1e525a', '#12363c'],
    feltLine: 'rgba(240,195,90,0.25)',
    back: '#2f78a8',
    frame: '#1d2023',
    trim: '#b9a477',
    room: '#0d2024',
    console: { bg: ['#1a1e21', '#07090a'], line: 'rgba(200,180,130,0.55)', ink: '#f2ead6', dim: '#98a2a6', accent: '#ffc861', title: "700 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
  broadcast: {
    felt: ['#285488', '#1a3c69', '#0e2346'],
    feltLine: 'rgba(255,211,77,0.3)',
    back: '#d9a03a',
    frame: '#141a2a',
    trim: '#b9a477',
    room: '#0a1226',
    console: { bg: ['#13244a', '#050b1a'], line: '#ffd34d', ink: '#ffffff', dim: '#9fb0d0', accent: '#ffd34d', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
  washi: {
    felt: ['#3f7650', '#2a573a', '#183823'],
    feltLine: 'rgba(233,199,122,0.3)',
    back: '#9a3524',
    frame: '#3b2414',
    trim: '#c9a256',
    room: '#1a0f08',
    console: { bg: ['#3d2414', '#160b04'], line: '#c9a256', ink: '#f3ead7', dim: '#c9b08a', accent: '#e9c77a', title: "400 1em 'Ma Shan Zheng','Noto Serif SC',serif" },
  },
  awaken: {
    felt: ['#56459a', '#352a6e', '#1d1646'],
    feltLine: 'rgba(216,200,255,0.3)',
    back: '#e0679a',
    frame: '#1a1230',
    trim: '#d8c8ff',
    room: '#100a24',
    console: { bg: ['#2e1866', '#0e0626'], line: '#a98bff', ink: '#ffffff', dim: '#c9b8ff', accent: '#ff9ad1', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
  // 白瓷简约：浅色，青瓷色桌布、靛蓝牌背、米白桌框
  porcelain: {
    felt: ['#d3e5da', '#b7d2c3', '#93b5a3'],
    feltLine: 'rgba(61,90,128,0.28)',
    back: '#3d5a80',
    frame: '#ebe6dc',
    trim: '#b9b0a2',
    room: '#efeae0',
    console: { bg: ['#ffffff', '#ebe6dc'], line: '#c9c1b2', ink: '#1d232a', dim: '#5b636d', accent: '#a83f29', title: "700 1em 'Noto Serif SC','Noto Sans SC','PingFang SC',serif" },
  },
  // 赛博霓虹：近黑的桌布配青色细线，青蓝牌背（品红只留给和牌、立直这些要紧的字）
  neon: {
    felt: ['#121d33', '#0c1424', '#070b14'],
    feltLine: 'rgba(63,224,255,0.45)',
    back: '#1e7fa6',
    frame: '#070b14',
    trim: '#3fe0ff',
    room: '#04070e',
    console: { bg: ['#0a1630', '#02040a'], line: '#3fe0ff', ink: '#eaf4ff', dim: '#9db1c7', accent: '#ff5cc8', title: "900 1em 'Orbitron','Noto Sans SC','PingFang SC',sans-serif" },
  },
  // 漫画分镜：浅灰纸色桌布、黑牌背、黑桌框
  manga: {
    felt: ['#f3f1eb', '#e2dfd6', '#c9c5ba'],
    feltLine: 'rgba(18,18,18,0.4)',
    back: '#1a1a1a',
    frame: '#121212',
    trim: '#f5f5f5',
    room: '#e9e6dd',
    console: { bg: ['#ffffff', '#e7e3d9'], line: '#141414', ink: '#141414', dim: '#555555', accent: '#c2141f', title: "400 1em 'ZCOOL KuaiLe','Noto Sans SC','PingFang SC',sans-serif" },
  },
  // 复古街机：靛蓝桌布配黄线，金黄牌背
  arcade: {
    felt: ['#2a2670', '#221e52', '#17143a'],
    feltLine: 'rgba(255,210,63,0.5)',
    back: '#e0a82e',
    frame: '#0d0b1e',
    trim: '#ffd23f',
    room: '#0d0b1e',
    console: { bg: ['#221d5a', '#0d0b1e'], line: '#ffd23f', ink: '#f6f5ff', dim: '#b0abe0', accent: '#ff7fa3', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
  pixel: PIXEL_TABLE,
};

// ---------- 牌桌风格 ----------

export type TableStyleId = 'skin' | 'auto' | 'wood' | 'night' | 'flap' | 'beach' | 'meadow' | 'pixel';

// 每套只用一个桌面色、一个仪表盘底色、一个强调色；仪表盘上的字和底色都量过对比度（正文 4.5:1 以上）
const STYLE_TABLES: Record<Exclude<TableStyleId, 'skin'>, TableColors> = {
  // 自动麻将机：绿呢桌布、黑色亮面机身，点数是琥珀色数码管。蓝、黄两副牌轮流用
  auto: {
    felt: ['#2a6d4f', '#215b44', '#163f30'],
    feltLine: 'rgba(255,255,255,0.16)',
    back: '#2f6fb0',
    machine: { backs: ['#2f6fb0', '#d99a1e'] },
    frame: '#151617',
    trim: '#9aa0a6',
    room: '#0c1411',
    console: { bg: ['#1a1b1d', '#070708'], line: '#3a2a20', ink: '#ffb02e', dim: '#d6cabc', accent: '#ffb02e', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'baize',
    look: 'led',
    frameFinish: [0.28, 0.3],
    trimFinish: [0.32, 0.85],
    consoleBody: '#0d0e10',
    consoleGlow: 0.55,
    // 雀庄的全自动麻将桌：就是原来的样子，圆角桌框、金属包边、圆角方盒
    form: { corner: 'round', bevel: 0.14, trim: 'strip', console: 'box', line: 'single' },
  },
  // 原木：深色胡桃木桌面、铜色包边，仪表盘是一块浅色木牌，墨色字，轮到谁盖一个朱红印。
  // 牌是老式的竹背牌：骨白的牌面接一层竹子的牌背。换局是手搓洗牌（shuffle.ts）；谁和一局，仪表盘上那家旁边多盖一个小朱印
  wood: {
    felt: ['#5f412a', '#4e3522', '#3a2718'],
    feltLine: 'rgba(240,210,160,0.2)',
    back: '#c99b52',
    tile: { body: '#f3ebd9', backGrain: 'bamboo', rough: 0.42 },
    changeover: 'shuffle',
    seals: true,
    frame: '#2c1d12',
    trim: '#b58e4f',
    room: '#140d08',
    console: { bg: ['#efdfbd', '#e4cc9f'], line: '#7d5d3a', ink: '#2b1b0e', dim: '#5a4029', accent: '#9b2c17', title: "900 1em 'Noto Serif SC','STSong',serif" },
    pattern: 'wood',
    look: 'plaque',
    frameFinish: [0.55, 0],
    trimFinish: [0.35, 0.7],
    consoleBody: '#3a2717',
    consoleGlow: 0.12,
    // 木桌：直角桌框、圆边，四块木板拼起来，框面上嵌一道铜线；仪表盘是一块矮矮的木牌；桌布上两道线
    form: { corner: 'square', bevel: 0.22, trim: 'inlay', console: 'plate', line: 'double' },
  },
  // 深夜：炭灰哑光桌布，仪表盘只有灰白两色加一点青，不发光、没花纹，适合长时间打。
  // 牌背正中一弯夜光月牙；仪表盘中间是一块表盘，指着现在几点。换局时熄灯（lamp.ts）：黑里只剩月牙和仪表盘亮着一点，
  // 旧牌一张张被收走、新牌山一墩墩码好，日光灯闪两下亮起来
  night: {
    felt: ['#2d3239', '#252a30', '#1b1f24'],
    feltLine: 'rgba(255,255,255,0.1)',
    back: '#3d7f86',
    tile: { body: '#f6f1e3', mark: 'moon' },
    changeover: 'lamp',
    clock: true,
    frame: '#1a1d21',
    trim: '#4d555e',
    room: '#0d0f12',
    console: { bg: ['#1d2126', '#181b1f'], line: '#353b44', ink: '#eef1f5', dim: '#a9b1bc', accent: '#5fd3c6', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'matte',
    look: 'flat',
    frameFinish: [0.5, 0.15],
    trimFinish: [0.4, 0.6],
    consoleBody: '#121417',
    consoleGlow: 0.3,
    // 什么都收着：大圆角的薄桌框、没有包边，仪表盘是一块薄圆盘，桌布上不画线
    form: { corner: 'pill', bevel: 0.06, trim: 'none', console: 'disc', line: 'none' },
  },
  // 翻转（原来叫翻牌屏，id 还是 flap）：藏青亚麻桌布、铝框，点数像车站的翻牌显示屏，一位数一块牌。
  // 牌背是一块橙色的翻牌（中间一道缝，上半亮下半暗；牌背不用藏青，不然牌山和藏青桌布分不开）。
  // 换局像翻牌屏换一屏，牌翻下去、桌面的翻板跟着翻个面（flip.ts）；仪表盘上的字变了，一块块翻牌像真的翻牌屏一页页翻到新字（flapBoard.ts）
  flap: {
    felt: ['#2b4763', '#22394f', '#182a3b'],
    feltLine: 'rgba(255,255,255,0.16)',
    back: '#d0612a',
    tile: { body: '#f6f1e3', mark: 'seam' },
    changeover: 'flip',
    frame: '#9aa3ab',
    trim: '#dfe3e7',
    room: '#0e1620',
    console: { bg: ['#d3d8dd', '#b9c0c7'], line: '#6c747c', ink: '#f5f5f2', dim: '#1f262d', accent: '#ff8a1f', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'linen',
    look: 'flap',
    frameFinish: [0.35, 0.75],
    trimFinish: [0.25, 0.9],
    consoleBody: '#8b939b',
    consoleGlow: 0.18,
    // 车站的铝件：切角桌框、平顶一排铆钉，内侧低一级的亮铝台阶；仪表盘是高一点的切角铝盒；桌布上只在四个角画一截
    form: { corner: 'chamfer', bevel: 0.04, trim: 'step', studs: 'rivet', console: 'chamfer', line: 'corners' },
  },
  // 沙滩：浅色的细沙桌面（只有细细的沙粒和一点深浅，不画花纹），海水色的桌框绕一圈白色船绳，像沙滩四周是海；
  // 牌是沙子捏的：牌身是晒干的浅沙，牌背是湿一点的深沙、正中压一个贝壳印。仪表盘是一汪深海水，白字，轮到谁亮一块阳光黄。
  // 换局时一个浪打过来把牌冲散，退潮后沙子聚成新的牌山（tide.ts）
  beach: {
    felt: ['#efd9b2', '#e4c9a0', '#d2b387'],
    feltLine: 'rgba(120,96,60,0.25)',
    back: '#bc9d72',
    tile: { body: '#f5e8cd', grain: 'sand', rough: 0.92, mark: 'shell' },
    changeover: 'tide',
    frame: '#0b6a72',
    trim: '#efe9dc',
    room: '#0a2830',
    console: { bg: ['#0f6670', '#0a4a52'], line: '#d9f2ee', ink: '#f7fcfb', dim: '#cfe8e4', accent: '#ffd166', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'sand',
    look: 'tide',
    frameFinish: [0.3, 0],
    trimFinish: [0.9, 0],
    consoleBody: '#0b3f46',
    consoleGlow: 0.25,
    // 大圆角、圆边的桌框，和桌布接缝的地方一圈白色船绳；仪表盘是一块圆盘（一汪海水）；桌布上不画线
    form: { corner: 'pill', bevel: 0.26, trim: 'rope', console: 'disc', line: 'none' },
  },
  // 草甸：灰绿的草地桌面（只有顺着风倒的细草和几片云影，不画花）、浅橡木桌框；仪表盘是一块米白亚麻布，四边一圈缝线，深绿字，轮到谁亮一块叶绿。
  // 牌是花瓣捏的：牌身花瓣白，牌背是叶子的绿、正中斜躺着一片叶子（叶脉浅色）。换局时一阵风把牌吹成花瓣、草叶飘走，花瓣再飘回来落成新的牌山（gust.ts）
  meadow: {
    felt: ['#a8bc84', '#9ab077', '#859c63'],
    feltLine: 'rgba(40,62,30,0.2)',
    back: '#4f7f45',
    tile: { body: '#fbfaf3', grain: 'fiber', rough: 0.55, mark: 'leaf' },
    changeover: 'gust',
    frame: '#a97c4f',
    trim: '#e9dfc6',
    room: '#14231a',
    console: { bg: ['#f7f2e4', '#ebe2ca'], line: '#93a57d', ink: '#1f3424', dim: '#45573f', accent: '#2f6a2c', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'grass',
    look: 'linen',
    frameFinish: [0.6, 0],
    trimFinish: [0.6, 0],
    consoleBody: '#8d6a43',
    consoleGlow: 0.12,
    // 橡木桌：圆角、圆边，没有包边；仪表盘是软包那种大圆角的木盒，顶上一圈浅色木边，里面镶一块亚麻布；桌布上不画线
    form: { corner: 'round', bevel: 0.3, trim: 'none', console: 'cushion', line: 'none' },
  },
  // 像素：和像素皮肤自带的牌桌是同一套，别的皮肤也能配
  pixel: PIXEL_TABLE,
};

export const TABLE_STYLES: { id: TableStyleId; name: string; note: string }[] = [
  { id: 'skin', name: '跟皮肤走', note: '桌布、牌背、仪表盘用界面皮肤自带的那套' },
  { id: 'auto', name: '自动麻将机', note: '绿呢桌布、黑色机身、圆角方盒仪表盘，点数是琥珀色数码管。每局开始中间那块抬起来把旧牌收进去，四块升降板托着新牌山从桌面里升上来；蓝、黄两副牌一局换一副' },
  { id: 'wood', name: '原木', note: '胡桃木桌面、直角木框嵌一道铜线；牌是骨白牌面接竹子牌背的老式竹背牌；仪表盘是一块矮矮的浅色木牌，墨色字，轮到谁盖一个朱红印，谁和一局，那家点数旁边“嗒”地再盖一个小朱印。换局时手搓洗牌：牌扣过来摊一桌，四家用手一把一把推着洗，码好牌山往前一推' },
  { id: 'night', name: '深夜', note: '炭灰哑光桌布、大圆角薄框；仪表盘是一块圆盘，只有灰白两色加一点青，不发光、没花纹，适合长时间打；中间一圈表盘指着现在几点。牌背一弯夜光月牙。换局时熄灯：黑里只剩月牙亮着，旧牌被收走、新牌山码好，日光灯闪两下亮起来' },
  { id: 'flap', name: '翻转', note: '藏青亚麻桌布、切角铝框钉一排铆钉；仪表盘是切角铝盒，点数像车站的翻牌显示屏，一位数一块牌，字变了就一页页翻过去；牌背是一块橙色翻牌。换局时整张桌子像翻牌屏换一屏：桌上的牌一排排翻下去，桌面的翻板跟着一块块翻个面，新牌山再一墩墩翻上来' },
  { id: 'beach', name: '沙滩', note: '浅色细沙桌面、海水色桌框绕一圈白船绳；牌是沙子捏的，牌背压一个贝壳印；仪表盘是一汪深海水，白字，轮到谁亮一块阳光黄。换局时一个浪打过来把牌冲散，退潮后沙子聚成新牌山' },
  { id: 'meadow', name: '草甸', note: '灰绿草地桌面、浅橡木桌框；牌是花瓣捏的，叶绿牌背上斜躺着一片叶子；仪表盘是一块米白亚麻布，深绿字，轮到谁亮一块叶绿。换局时一阵风把牌吹成花瓣飘走，花瓣再飘回来落成新牌山' },
  { id: 'pixel', name: '像素', note: '方块世界那种：桌子是一个个木板方块搭的，桌布是一块块绿色羊毛毡，地上铺木板，天是浅蓝的；牌是直角的小方块，牌面一格格画的，橘红牌背上一颗宝石；贴图都是 16×16 的小图，放大不糊' },
];

const STYLE_KEY = 'saki-table-style';

function isTableStyle(v: unknown): v is TableStyleId {
  return TABLE_STYLES.some((t) => t.id === v);
}

let currentStyle: TableStyleId = (() => {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    // 选过已经去掉的酒红皮革：换成顶替它的沙滩
    if (v === 'club') return 'beach';
    return isTableStyle(v) ? v : 'skin';
  } catch {
    return 'skin';
  }
})();

export function currentTableStyle(): TableStyleId {
  return currentStyle;
}

export function setTableStyle(id: TableStyleId): void {
  currentStyle = id;
  try {
    localStorage.setItem(STYLE_KEY, id);
  } catch {
    // 存不下来就只管这一次
  }
  applyTheme();
}

// 仪表盘形状：可以跟着牌桌风格走，也可以单独选，哪套牌桌、哪个皮肤都能配哪种形状
export type ConsoleShapeId = 'auto' | ConsoleForm;

export const CONSOLE_SHAPES: { id: ConsoleShapeId; name: string; note: string }[] = [
  { id: 'auto', name: '跟牌桌走', note: '用牌桌风格自己的形状（自动麻将机方盒、原木矮牌、深夜圆盘、翻转切角、沙滩圆盘、草甸软包），跟皮肤走时是方盒' },
  { id: 'box', name: '方盒', note: '圆角方盒，原来的样子' },
  { id: 'plate', name: '矮牌', note: '矮矮的一块方牌，直角' },
  { id: 'disc', name: '圆盘', note: '一块薄圆盘，四家的点数往中间收一点' },
  { id: 'chamfer', name: '切角', note: '四个角切掉的方盒，高一点' },
  { id: 'cushion', name: '软包', note: '大圆角，边上鼓起来，顶上一圈包边' },
];

// 每种形状的仪表盘有多高（原来方盒的几倍）
export const CONSOLE_SCALE: Record<ConsoleForm, number> = { box: 1, plate: 0.55, disc: 0.8, chamfer: 1.35, cushion: 1.1 };

const SHAPE_KEY = 'saki-console-shape';

function isConsoleShape(v: unknown): v is ConsoleShapeId {
  return CONSOLE_SHAPES.some((t) => t.id === v);
}

let currentShape: ConsoleShapeId = (() => {
  try {
    const v = localStorage.getItem(SHAPE_KEY);
    return isConsoleShape(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
})();

export function currentConsoleShape(): ConsoleShapeId {
  return currentShape;
}

export function setConsoleShape(id: ConsoleShapeId): void {
  currentShape = id;
  try {
    localStorage.setItem(SHAPE_KEY, id);
  } catch {
    // 存不下来就只管这一次
  }
  applyTheme();
}

// 实际用哪种形状：跟牌桌走时用牌桌风格自己的，跟皮肤走是原来的方盒
export function consoleShapeOf(style: TableStyleId = currentStyle, shape: ConsoleShapeId = currentShape): ConsoleForm {
  if (shape !== 'auto') return shape;
  return style === 'skin' ? 'box' : (STYLE_TABLES[style].form?.console ?? 'box');
}

const KEY = 'saki-theme';
const DEFAULT: ThemeId = 'broadcast';

function isTheme(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

let current: ThemeId = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : DEFAULT;
  } catch {
    // 有的地方不让用本地存储，用默认皮肤
    return DEFAULT;
  }
})();

export function currentTheme(): ThemeId {
  return current;
}

export function setTheme(id: ThemeId): void {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 存不下来就只管这一次
  }
  applyTheme();
}

export function applyTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = current;
  // 2D 牌桌的桌布和中间那块按这个换；跟皮肤走时不挂（像素皮肤自带的是像素牌桌，挂 pixel）
  const table = currentStyle === 'skin' && current === 'pixel' ? 'pixel' : currentStyle;
  if (table === 'skin') delete root.dataset.table;
  else root.dataset.table = table;
  // 2D 中间那块的形状：单独选了才挂（跟牌桌走时照牌桌风格、皮肤自己的）
  if (currentShape === 'auto') delete root.dataset.console;
  else root.dataset.console = currentShape;
}

// 现在用不用像素牌桌（皮肤是像素、跟皮肤走，或者牌桌风格选了像素）
export function pixelTableOn(id: ThemeId = current, style: TableStyleId = currentStyle): boolean {
  return !!tableColors(id, style).pixel;
}

// 用不用像素的那一套（2D 的牌、结算、图鉴里的牌换像素牌面，立直、和牌这些放像素特效）：像素皮肤、像素牌桌都用
export function pixelOn(): boolean {
  return current === 'pixel' || pixelTableOn();
}

// 皮肤自带的牌桌（视觉设置里皮肤按钮上的小色样用这个）
export function skinTableColors(id: ThemeId = current): TableColors {
  return TABLES[id];
}

// 对局里实际用的牌桌：选了牌桌风格就用那套，跟皮肤走就用皮肤自带的
export function tableColors(id: ThemeId = current, style: TableStyleId = currentStyle, shape: ConsoleShapeId = currentShape): TableColors {
  return { ...(style === 'skin' ? TABLES[id] : STYLE_TABLES[style]), shape: consoleShapeOf(style, shape) };
}
