# 官方鼠标

协议是 `Documents/Protocol/PhysicalHardware/Pointer/ZPP1.md`。本文只描述这一份参考实现。

插头标识：`ZerOS-Reference-Pointer`，厂商 `ZerOS-Team`，`ActiveProtocol` 为 `ZXD1`，`DeviceProtocol` 为 `ZPP1`。替换实现只换 `Hardware/Pointer/ActiveProvider/`，导出名保持 `ActivePointerProvider`。

官方上电时，主板把这份插头 `Bind` 到扩展口 `3`。口的加载和引导仍走 ZXP1。事件只在 `Exchange` 里按 6 个字装配。设备不读显示器，也不画像素。

浏览器里的指针移动、按下、松开和滚轮由显示器收成这 6 个字，交给主板，再写进口 `3`。项目箭头保留原 BIOS 的形状与热点，以 `Hardware/Display/Assets/Pointer.svg` 作为画布的自定义光标图像，由浏览器专用光标通道跟随实际鼠标。它不再依赖 BIOS 整页重绘，也不使用系统默认箭头。输入仍走原坐标换算与设备交换，光标图像不替客机执行点击或滚动。未读队列至少 32 次。固件先读最旧的一次，处理完再移出，按下不会被紧接着的松开盖掉。固件和驱动用方向 `1` 读回，不自己解释浏览器事件。

BIOS 消费事件时先读种类；没有拖动滑块的普通移动按 FIFO 移出，不再为它读坐标或重画整页。有效点击、滚轮或拖动变化先交给界面，后续事件留到下一次处理。长页绘制每四行检查一次输入，状态改变则取消尚未提交的旧帧，最多重启一次；第二次绘制不再打断，持续输入时也能交出完整帧。设备仍遵守 ZPP1 的保留、读取与移出规则。
