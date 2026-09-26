/**
 * @module ZerOS.Boot.Bios
 * @description 固件设置画面的指令文本
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 指令正文在旁边的 Bios.obr 里。工具链编成无扩展名二进制，填进虚拟模块。
 * 标号和 call 在写出二进制之前已经展开。旁边的 Bios.zap 只用来对照调试，不交给 CPU。
 * 设置画面分三块：顶栏是类别，左侧是子类，右侧是内容。不改配置，也不进入内核。
 *
 * 4096 模式：0 等待 F12，1 空闲，2 设置画面。
 * 4160 当前子类。4224 盒子编号。4288 旧文字行的纵坐标，界面改走加速绘制后不再使用。
 * 4352 键盘已完成次数。4416 等待拍数。4480 键盘口，4 表示没有。
 * 4864 键位名。4928 修饰位。
 * 5184 焦点：0 顶栏，1 左侧，2 右侧。5248 类别：0 固件，1 关于。
 * 5312 右侧滚动。5376 扩展口是否进入了详情。5568 选中的口。
 * 5632 右侧还能往下滚多少。5696 空闲时隔多少次再重画。5760 行表是否已经写入。5824 写入行表时的游标。
 * 5888 进度条亮线的相位。每次重画只加一，所有横条共用，不再按条去问显卡。
 * 8192 起是 64 个字符串指针，每项 64 位。0 FIRMWARE，1 ABOUT，2 TOP，3 SIDE，4 MAIN，
 * 5 OVERVIEW，6 CPU，7 GPU，8 MEMORY，9 DISPLAY，10 PORTS，11 TAB，12 SYSTEM，13 PROTOCOLS，
 * 14 DRIVERS，15 HZ，16 RUN，17 ACCESS，18 BYTES，19 FRAME，20 ID，21 VENDOR，22 PROTOCOL，
 * 23 CORES，24 REGISTERS，25 STATE，26 EXEC，27 WIDTH，28 HEIGHT，29 HERTZ，30 PORT，31 EMPTY，
 * 32 BOOT，33 SHELL，34 GL，35 LOADED，36 DEVICE，37 MEM，38 XCHG，39 KEYBOARD ZKP1，40 PANEL，
 * 41 CORE，42 ENTER OPENS  ESC BACK，43 ESC RETURNS，44 HZ MAX，45 STOP，46 COMMANDS，47 INIT，
 * 48 MEMORYID，49 DISPLAY ZDP1。
 * 12288 起是 16 个页起点。13312 起是行，每行四个字、共 256 位：种类、甲、乙、丙。
 * 种类 0 结束。1 亮字，2 暗字，3 空档，4 查询数字，5 查询字符串，8 频率条，9 固定数字，
 * 10 到 11 按核心重复，12 到 13 按四个扩展口重复，14 口列表，15 运行数，16 协议名，
 * 17 两个字，18 宽乘高，19 显示器一行，20 核心标题，21 运行或停止，22 驱动口，
 * 23 到 25 是选中口的详情。这些地址只给固件用，不是查询字段。
 * r0 是返回值，r1 至 r5 是参数和临时，r7 只做 call 链接。
 * 找键盘口时 r0 至 r5 都占着，盒子编号已经写入 4224，所以借用 r6 当口编号。
 */

import { biosProgram } from "zeros-boot-firmware";

export namespace ZerOS {
  export namespace Boot {
    /** 编译好的固件循环。CPU 按二进制解码，不再解析助记符。 */
    export const BiosProgram: Uint8Array = Uint8Array.from(biosProgram);
  }
}
