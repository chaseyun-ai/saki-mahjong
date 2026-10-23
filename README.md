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

四位角色暂时用 VRoid 项目公开的示例模型改色而成（`src/ui3d/looks.ts` 里设置每个角色用哪个模型、头发和眼睛的颜色）：

| 角色 | 底模 | 文件 |
| --- | --- | --- |
| 宫永咲 | AvatarSample_E（ビビ） | `public/models/vroid-e.v2.glb` |
| 原村和 | AvatarSample_G（ヴィクトリア・ルービン） | `public/models/vroid-g.v2.glb` |
| 松实玄 | 千駄ヶ谷篠 | `public/models/vroid-shino.v2.glb` |
| 园城寺怜 | AvatarSample_F（ヴィータ） | `public/models/vroid-f.v2.glb` |

模型作者是 VRoid プロジェクト，许可写在模型里：任何人可用、可修改、可再分发、可商用，不需要署名（[VRoid Hub 许可条款](https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=everyone&corporate_commercial_use=allow&credit=unnecessary&modification=allow&personal_commercial_use=profit&redistribution=allow&sexual_expression=allow&version=1&violent_expression=allow)）。原始文件来自 [OpenGameArt 上的 VRoid Studio CC0 models](https://opengameart.org/content/vroid-studio-cc0-models)，用 `python3 scripts/shrink-vrm.py 原文件.vrm 输出.glb` 瘦身后放进项目：贴图缩小并转成 WebP，表情形变只存动了的顶点，四个模型一共约 8 MB。模型更新时换一个新文件名（`.v2`、`.v3`……），玩家浏览器里存的旧模型就不会被误用。

## 牌面字体

万子和字牌的字形取自 [霞鹜文楷 TC（LXGW WenKai TC）](https://github.com/lxgw/LxgwWenkaiTC) Bold，SIL Open Font License 1.1。`scripts/gen-glyphs.ts` 从 `scripts/fonts/` 里的字体子集生成 `src/ui/glyphs.ts`，游戏运行时不需要加载字体。
