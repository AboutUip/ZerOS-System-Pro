# 官方键盘

协议是 `Documents/Protocol/PhysicalHardware/Keyboard/ZKP1.md`。本文只描述这一份参考实现。

插头标识：`ZerOS-Reference-Keyboard`，厂商 `ZerOS-Team`，`ActiveProtocol` 为 `ZXD1`，`DeviceProtocol` 为 `ZKP1`。替换实现只换 `Hardware/Keyboard/ActiveProvider/`，导出名保持 `ActiveKeyboardProvider`。

官方上电时，主板把这份插头 `Bind` 到扩展口 `0`。口的加载和引导仍走 ZXP1。事件只在 `Exchange` 里按 6 个字装配。设备不读显示器，也不画像素。
