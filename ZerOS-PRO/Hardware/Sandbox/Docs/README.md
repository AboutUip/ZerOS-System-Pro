# 官方沙盒

协议是 `Documents/Protocol/PhysicalHardware/Sandbox/ZSP1.md`。本文只描述这一份参考实现。

插头标识：`ZerOS-Reference-Sandbox`，厂商 `ZerOS-Team`，`ActiveProtocol` 为 `ZXD1`，`DeviceProtocol` 为 `ZSP1`。替换实现只换 `Hardware/Sandbox/ActiveProvider/`，导出名保持 `ActiveSandboxProvider`。

官方上电时，主板把这份插头 `Bind` 到扩展口 `1`。口 `0` 是键盘。客程序在核心 `1` 上执行，核心 `0` 留给引导循环。核心正忙时这一次记成失败，不打断已经在跑的那段。

程序文本按行交给与引导相同的标号展开，再作为客程序提交。通过或失败写回状态 `3` 或 `4`。寄存器取低 64 位。故障说明最长 256 个字符。
