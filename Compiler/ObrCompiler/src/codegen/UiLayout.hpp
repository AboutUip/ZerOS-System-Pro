#pragma once

/* UiLayout.hpp —— UI 例程的单元槽位（索引进 uiAt(kUi + 索引 × 64) 的单元块）。
   调用点收成与例程发射共用这一份索引，改一处即全同步。 */

namespace obr {

constexpr int UiArg = 9;
constexpr int UiOx = 17;
constexpr int UiOy = 18;
constexpr int UiDepth = 19;
constexpr int UiPrimed = 20;
constexpr int UiPort = 21;
constexpr int UiCount = 22;
constexpr int UiTick = 23;
constexpr int UiStack = 24;
constexpr int UiTempX = 88;
constexpr int UiTempI = 89;
constexpr int UiTempN = 90;
constexpr int UiTempS = 91;
constexpr int UiTempC = 92;
constexpr int UiSeen = 93;
constexpr int UiLinkInk = 0;
constexpr int UiLinkBox = 1;
constexpr int UiLinkGlyph = 2;
constexpr int UiLinkText = 3;
constexpr int UiLinkClear = 5;
constexpr int UiLinkEnter = 7;
constexpr int UiLinkBar = 4;
constexpr int UiLinkMeter = 8;
/* 94 到 104 是进度条。105 到 107 是填充宽度。108 到 112 是文字阴影，116 的位地址是 4611328，仍低于帧缓存。 */
constexpr int UiBar = 94;
constexpr int UiMeter = 105;
constexpr int UiShade = 108;
constexpr int UiPassX = 114;
constexpr int UiPassY = 115;
constexpr int UiLayer = 116;

}  // namespace obr
