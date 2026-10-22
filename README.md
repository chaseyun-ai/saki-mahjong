# 超能力麻将

《天才麻将少女》角色能力的同人立直麻将，网页上直接玩。默认是 3D 牌桌，选角色界面可以切回 2D 牌桌。角色目前是占位模型，之后换成 VRM 二次元模型。

## 现在能玩什么

- 四人东风战，规则对标雀魂：赤宝牌 3 张、食断、标准役种和役满、番符计分、途中流局
- 选一个角色和三个电脑对局
- 三个能力：宫永咲「岭上开花」、松实玄「宝牌聚集」、园城寺怜「一巡先见」；原村和没有能力，作为对照

## 本地运行

```bash
npm install
npm run dev      # 打开终端里显示的地址
npm test         # 规则和整场模拟测试
npx vite-node scripts/balance.ts 300   # 让电脑打 300 场，统计各角色成绩
```

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `src/engine` | 规则引擎：牌、牌山、向听、和了拆分、役和点数、对局流程。不依赖画面 |
| `src/abilities` | 角色能力插件和角色列表。能力只能交换没公开的牌，不能凭空造牌 |
| `src/ai` | 规则型电脑对手：牌效、简单防守、会用自己的能力 |
| `src/ui` | 对局控制、按钮和结算界面，以及 2D 牌桌 |
| `src/ui3d` | Three.js 3D 牌桌：立体麻将牌、牌河、副露、控制台、占位人物 |
| `tests` | 算分、向听和整场模拟测试 |

能力的强度参数在各自文件顶部（比如 `src/abilities/saki.ts` 的 `RINSHAN_WIN_CHANCE`），改数字就能调平衡。

## 3D 人物模型

3D 牌桌上的对手暂时用免费的 VRM 示例模型，之后会换成自己做的角色模型（例如用 VRoid Studio 制作）。

- `public/models/seed-san.glb`：Seed-san，© VirtualCast, Inc.，[VRM Public License 1.0](https://vrm.dev/licenses/1.0/)，允许再分发和修改，需署名。游戏里隐藏了她背后的机械臂。
- `public/models/pixiv-sample.glb`：VRM1_Constraint_Twist_Sample，© 2022 pixiv Inc.，来自 [pixiv/three-vrm](https://github.com/pixiv/three-vrm) 的示例模型。

两个文件就是原始的 `.vrm`，只是改了扩展名，方便作为普通 glTF 文件发布。
