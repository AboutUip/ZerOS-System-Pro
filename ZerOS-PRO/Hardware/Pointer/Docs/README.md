# 官方鼠标

协议见 `Documents/Protocol/PhysicalHardware/Pointer/ZPP1.md`。本文只描述这一份参考实现。

插头标识：`ZerOS-Reference-Pointer`，厂商 `ZerOS-Team`，`ActiveProtocol` 是 `ZXD1`，`DeviceProtocol` 是 `ZPP1`。替换实现只换 `Hardware/Pointer/ActiveProvider/`，导出名保持 `ActivePointerProvider`。

官方上电时，主板把这份插头 `Bind` 到扩展口 `3`。口的加载和引导仍走 ZXP1。事件只在 `Exchange` 里按 7 个字装配：前 6 个是语义字，第 7 个是关联号。设备不读显示器，也不画像素。

浏览器里的指针移动、按下、松开和滚轮由显示器收成这 7 个字，交给主板，再写进口 `3`。页面光标藏在 `index.html` 里，固件自己画指针。未读队列至少 32 次。固件先读最旧的一次，处理完再移出，按下不会被紧接着的松开盖掉。固件和驱动用方向 `1` 读回，不自己解释浏览器事件。
