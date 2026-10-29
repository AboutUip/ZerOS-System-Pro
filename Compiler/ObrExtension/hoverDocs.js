/**
 * 悬停文案。Obr 来自 docs/obr；ZAP 来自 ZCP1 指令表。
 * chars / icall / iret / 裸 call / 裸 ret 是汇编展开，提交前改写成 link 或 jmp。
 */

const OBR = {
  deRfun: "声明或定义一个函数。`.mr` 以分号结束，`.obr` 写函数体。",
  export: "导出这个函数。名字须是字母开头的标识符，才能作为 ZAP 的 `call` 标号。",
  import: "引入一个模块。模块名是头文件名去掉 `.mr`。",
  namespace: "把后面的声明放进命名空间，调用时写成 `名字::函数`。",
  return: "从当前函数返回。返回值写在后面；`void` 函数只写 `return`。",
  if: "条件为真时执行后面的语句或块。条件按 ToBoolean 转成真假。",
  else: "配最近一个还没有 else 的 if。`else if` 是 else 后面再接一个 if。",
  while: "条件为真时重复执行循环体。",
  for: "`for (初始; 条件; 步进)`。空条件当作真。`continue` 先做步进再回到条件。",
  async: "标在 `deRfun` 前面。只有这种函数里才能写 `await`。",
  await: "操作数必须是调用。现在就是一次普通调用，不挂起核心。",
  struct: "值类型。字段按 64 位槽排开。`变量.字段` 读写。不能当参数或返回值。",
  enum: "整数常量。不写底层类型时是 `int`，`: long` 时是 `long`。使用时写成 `名字::值`。",
  class: "引用类型。`class 派生 : 基类`。方法的第一个参数是 `this`。没有虚函数表。",
  new: "`new 类名(参数)` 在堆上分配，字段清零，再调用同名构造。",
  break: "离开最近一层循环。",
  continue: "回到最近一层循环的条件。",
  goto: "跳到本函数里同名的标号。标号写成 `名字:`。",
  var: "声明一个变量。",
  public: "公开可见。",
  private: "仅本模块可见。",
  static: "静态存储。函数之间保留这份值。",
  "#VERSION": "语言版本。当前只接受版本 1。",
  "#LINK": "项目链接范围。列出本程序要一起编译的路径。",
  "#DYN": "本文件要动态装入头文件里声明的函数。不写参数。真正的函数体在 .lib 里，装入时再接上。",
  void: "无返回值。只能作函数返回类型，不能用来声明变量。",
  boolean: "布尔类型。字面量是 true 和 false。",
  byte: "只能是 0 或 1。不能和其他数值类型混算。",
  short: "短整型。",
  int: "整型。能加宽成 long。",
  long: "长整型。十六进制若放得进 int，字面量仍是 int。",
  float: "单精度浮点。",
  double: "双精度浮点。浮点运算按二进制 64。",
  char: "单个字符，用单引号。可以加宽成 int 或 long。",
  string: "字符串，用双引号。`==` 比的是引用，`+` 是拼接。",
  true: "布尔真。",
  false: "布尔假。",
  null: "空引用。",
  undefined: "未定义值。",
  __zap__: "嵌入一段 ZAP。花括号里的行原样进入指令流，不按 Obr 解析。",
  array: "`array[元素]`。`new array[long](长度)` 在堆上分配。长度是负数时运行时停机。引用类型，没有下标越界检查以外的回收。",
  list: "`list[元素]`。`new list[元素]()`。`push` / `pop`。引用类型，没有垃圾回收。",
  set: "`set[元素]`。`new set[元素]()`。`has` / `add` / `remove`。不能用下标。",
  map: "`map[键, 值]`。`new map[键, 值]()`。`has` / `put` / `get` / `remove`。没有这个键时 `get` 停机。"
};

const ZAP = {
  place: "`place rN, 整数` — 把整数写入寄存器。",
  add: "`add rD, rL, rR` — 精确整数相加。",
  sub: "`sub rD, rL, rR` — 精确整数相减。",
  mul: "`mul rD, rL, rR` — 精确整数相乘。",
  div: "`div rD, rL, rR` — 向 0 取商。除数为 0 时失败。",
  mod: "`mod rD, rL, rR` — 向 0 取余。除数为 0 时失败。",
  udiv: "`udiv rD, rL, rR` — 非负整数相除。除数为 0 时失败。",
  umod: "`umod rD, rL, rR` — 非负整数取余。除数为 0 时失败。",
  eq: "`eq rD, rL, rR` — 相等则为 1，否则为 0。",
  lt: "`lt rD, rL, rR` — 按数学整数比较小于。",
  le: "`le rD, rL, rR` — 小于或等于。",
  gt: "`gt rD, rL, rR` — 大于。",
  ge: "`ge rD, rL, rR` — 大于或等于。",
  and: "`and rD, rL, rR` — 无限补码按位与。",
  or: "`or rD, rL, rR` — 无限补码按位或。`or r, r, r` 即寄存器复制。",
  xor: "`xor rD, rL, rR` — 无限补码按位异或。",
  not: "`not rD, rS` — 按位取反，结果是 −rS−1。",
  shl: "`shl rD, rL, rR` — 左移。计数须在 0 至 63。",
  shr: "`shr rD, rL, rR` — 算术右移，保留符号。计数须在 0 至 63。",
  itof: "`itof rD, rS` — 整数换成最接近的有限二进制 64。",
  feq: "`feq rD, rL, rR` — 按二进制 64 判断相等。NaN 不相等，+0 与 −0 相等。",
  fadd: "`fadd rD, rL, rR` — 二进制 64 相加。非有限则失败。",
  fsub: "`fsub rD, rL, rR` — 二进制 64 相减。",
  fmul: "`fmul rD, rL, rR` — 二进制 64 相乘。",
  fdiv: "`fdiv rD, rL, rR` — 二进制 64 相除。除数位型为 0 时失败。",
  fpow: "`fpow rD, rL, rR` — 二进制 64 的幂。",
  fmod: "`fmod rD, rL, rR` — 二进制 64 取余，向零截断。",
  jz: "`jz rC, 编号` — rC 为 0 时跳到这段文本里的该编号。",
  jnz: "`jnz rC, 编号` — rC 不为 0 时跳转。",
  jmp: "`jmp rD` — 跳到 rD 里的编号。",
  link: "`link rD, 编号` — 把下一条编号写入 rD，再跳到该编号。",
  call: "汇编：裸 `call 名字` 展开成 `link r7`。`call rD, 编号` 与 link 相同。",
  ret: "汇编：裸 `ret` 展开成 `jmp r7`。`ret rD` 与 jmp 相同。",
  icall: "汇编：`icall 名字` 展开成 `link r6`。",
  iret: "汇编：`iret` 展开成 `jmp r6`。",
  halt: "该核心进入停止，不再取下一条。",
  inbox: "`inbox rF, rV` — 从入站队列取一个整数到 rV。取到则 rF 为 1，空则两者都为 0。",
  xchg: "`xchg rP, rD, rV` — 用 rV 的 8 个八位组，与扩展口 rP 按方向 rD 交换一次，结果写回 rV。",
  query: "`query rD, rS, rF, rI` — 把座位 rS 的字段 rF、下标 rI 读进 rD。",
  hertz: "`hertz rN, rH` — 把 rH 设为 rN 所指核心的 Hz。",
  metric: "`metric rD, rN, rK` — 读核心指标。0 是 Hz，1 是已完成条数。",
  chars: "汇编：把引号里的字符逐个写成字形。改写 r0，字形进入 r1 里已有的文本节点。",
  dwell: "`dwell rT` — 按毫秒等待。0 马上继续，最大 1000。等待时核心仍在执行。",
  mmap: "`mmap rD, rP, rH, rN` — 把扩展口句柄按页映射进线性位元，起始位地址写入 rD。客核心不能调用。",
  munmap: "`munmap rA, rN` — 卸下 mmap 返回的那一段。地址和长度必须与当时一致。",
  admit: "`admit rC, rA, rN` — 让一颗已停止的核心进入兼容任务。描述符 32 个八位组。",
  install: "`install rC, rA, rN` — 把一段程序映像装到另一颗已停止的核心。",
  schedule: "`schedule rC` — 请求调度一颗已停止、并且已经装入程序的核心。",
  slice: "`slice rN` — 本核心这一轮最多再执行 rN 条。0 表示直到 halt。",
  pass: "`pass rC, rV` — 把整数放进目标核心的空保持位。",
  take: "`take rF, rV` — 取出本核心的保持位。",
  svc: "`svc rS, rD` — 把服务号交给监督核，停在下一条。",
  bound: "`bound rC, rA, rN` — 划定目标核心可访问的位元范围。",
  gate: "`gate` — 当前核心成为监督核。",
  release: "`release rC` — 卸下另一颗已停止的核心。",
  yield: "`yield` — 停在下一条，寄存器保留。",
  core: "`core rD` — 正在执行的核心编号写入 rD。",
  fill: "`fill rD, rA, rN, rV` — 按页填写一段线性位元。",
  carry: "`carry rD, rA, rN, rB, rM, rV` — 在两段线性位元之间搬运。",
  capture: "`capture rC, rS` — 把已停止核心抄进槽。",
  restore: "`restore rC, rS` — 把槽放回已停止的核心。",
  attach: "`attach rD, rC, rA, rN` — 把动态库接到已停止核心的指令末尾。",
  lea: "`lea rD, rB, rI, 比例, 位移` — 有效地址。比例是 1、2、4、8，位移是 8 位。",
  "load.scale": "`load.scale rD, rB, rI, 比例, 位移` — 按比例从位地址读 64 位。基址低 3 位不是 0 时停机。",
  "store.scale": "`store.scale rS, rB, rI, 比例, 位移` — 按比例写 64 位。",
  "rsp.bias": "`rsp.bias` — 调用前把硬件栈减 8，使 rsp 按 16 个八位组对齐。只出现在原生映像里。",
  "rsp.restore": "`rsp.restore` — 返回前把硬件栈加 8。只出现在原生映像里。",
  "gpu.accel": "`gpu.accel rD, rOp, rA, rB, rC, rE` — 一条加速命令。rOp 是整数操作码，后四个寄存器是二进制 64。结果在 rD。",
  "gpu.clear": "`gpu.clear rP` — 把寄存器里的像素交给显卡 Clear。",
  "gpu.plot": "`gpu.plot rX, rY, rP` — 交给显卡 Plot。",
  "gpu.character": "`gpu.character rX, rY, rC, rF, rB` — 交给显卡 Character。",
  "gpu.box": "`gpu.box rD, rP, rX, rY, rW, rH, rF` — SpawnBox，新编号写入 rD。",
  "gpu.text": "`gpu.text rD, rP, rX, rY, rW, rH` — SpawnText，新编号写入 rD。",
  "gpu.align": "`gpu.align rN, rX, rY` — Align。",
  "gpu.paint": "`gpu.paint rN, rF, rB` — Paint。",
  "gpu.glyph": "`gpu.glyph rN, rC` — Glyph。",
  "gpu.drop": "`gpu.drop rN` — Drop。",
  "gpu.compose": "`gpu.compose` — Compose。",
  "gpu.present": "`gpu.present` — 交给显卡 Present。",
  "gpu.hertz": "`gpu.hertz rH` — 把 rH 设为显卡 Hz。",
  "gpu.metric": "`gpu.metric rD, rK` — 读显卡指标。0 是 Hz，1 是已完成条数。",
  "gpu.load": "`gpu.load rD, rA` — 把显存地址 rA 上的一个字节写入 rD。",
  "gpu.store": "`gpu.store rA, rV` — 把 rV 的低 8 位写到显存地址 rA。",
  "port.state": "`port.state rD, rP` — 把扩展口 rP 的状态写入 rD。",
  "port.char": "`port.char rD, rP, rI` — 读扩展口协议名的第 rI 个字符码。",
  "port.byte": "`port.byte rD, rP, rF, rI` — 读字段 rF 的第 rI 个字符码。0 协议，1 提供者，2 厂商。",
  "mem.hertz": "`mem.hertz rH` — 把 rH 设为内存 Hz。",
  "mem.metric": "`mem.metric rD, rK` — 读内存指标。0 是 Hz，1 是已完成条数。"
};

const LOAD = {
  bit: "1 位",
  octet: "8 位",
  16: "16 位",
  32: "32 位",
  64: "64 位",
  f32: "二进制 32 的补码",
  f64: "二进制 64 的补码"
};

for (const [width, label] of Object.entries(LOAD)) {
  ZAP[`load.${width}`] = `\`load.${width} rN, 地址\` — 按立即位地址读 ${label}进寄存器。`;
  ZAP[`store.${width}`] = `\`store.${width} rN, 地址\` — 把寄存器按 ${label}写到立即位地址。`;
  if (width !== "bit") {
    ZAP[`ldi.${width}`] = `\`ldi.${width} rD, rA\` — 按 rA 里的位地址读 ${label}进 rD。`;
    ZAP[`sti.${width}`] = `\`sti.${width} rS, rA\` — 把 rS 按 ${label}写到 rA 里的位地址。`;
  }
}

function lookupObr(word) {
  return OBR[word] || null;
}

function lookupZap(word) {
  if (/^r[0-7]$/.test(word)) {
    const hardware = ["rax", "rdi", "rsi", "rdx", "rcx", "r8", "r9", "r10"][Number(word[1])];
    const role = ["返回值", "第 1 个整数参数", "第 2 个整数参数", "第 3 个整数参数", "第 4 个整数参数", "第 5 个整数参数", "第 6 个整数参数", "链接寄存器。第 7 个及以后的整数参数在软件栈上"];
    return `\`${word}\` 在原生映像里是 \`${hardware}\`，用作${role[Number(word[1])]}。ZAP 文本里仍只是 8 个通用寄存器之一。`;
  }
  if (word === "rsp") return "`rsp` — 硬件栈指针。原生映像入口把它设到界面区，调用时按 16 个八位组对齐。";
  if (word === "r11") return "`r11` — 原生映像的临时寄存器。绝对地址访存会先把地址放在这里。不对应 r0 至 r7。";
  return ZAP[word] || null;
}

const LIBRARY = {
  "obr::os::schedule": "`schedule(core)` — 请求调度一颗已停止、并且已经装入程序的核心。",
  "obr::os::slice": "`slice(count)` — 本核心每一轮最多执行这么多条。0 表示直到 halt。",
  "obr::os::pass": "`pass(core, value)` — 把整数放进目标核心的空保持位。",
  "obr::os::take": "`take(value)` — 取出本核心的保持位。取到返回 1，空则返回 0。",
  "obr::os::svc": "`svc(service)` — 把服务号交给监督核，停在下一条。回复写回返回值。",
  "obr::os::bound": "`bound(core, origin, length)` — 划定目标核心可访问的位元范围。监督核自己不受限制。",
  "obr::os::gate": "`gate()` — 当前核心成为监督核。",
  "obr::os::release": "`release(core)` — 卸下另一颗已停止的核心。",
  "obr::os::yield": "`yield()` — 停在下一条，寄存器保留。",
  "obr::os::dwell": "`dwell(milliseconds)` — 按毫秒等待。0 马上继续，最大 1000。",
  "obr::os::mmap": "`mmap(port, handle, length)` — 把扩展口上的句柄按页映射进线性位元。返回起始位地址。客核心不能调用。",
  "obr::os::munmap": "`munmap(address, length)` — 卸下 mmap 返回的那一段。",
  "obr::os::core": "`core()` — 正在执行的核心编号。",
  "obr::os::install": "`install(core, address, length)` — 把一段程序映像装到另一颗已停止的核心。",
  "obr::os::admit": "`admit(core, address, length)` — 让一颗已停止的核心进入兼容任务。描述符 32 个八位组。",
  "obr::os::hertz": "`hertz(core, hz)` — 设置另一颗核心的 Hz。",
  "obr::os::capture": "`capture(core, slot)` — 把已停止核心抄进 0 至 7 号槽。",
  "obr::os::restore": "`restore(core, slot)` — 把槽放回已停止的核心。不启动它。",
  "obr::os::attach": "`attach(core, address, length)` — 把动态库接到已停止核心的指令末尾。返回第一个导出的指令编号。",
  "obr::ui::present": "`present()` — 把已经画好的帧交给显卡。",
  "obr::ui::width": "`width()` — 已经发布的帧宽。",
  "obr::ui::height": "`height()` — 已经发布的帧高。",
  "obr::ui::text": "`text(...)` — 六参或七参。七参在字号步进上再加字距。",
  "obr::ui::rect": "`rect(x, y, w, h, fill, color)` — 画矩形。宽高为负由显卡拒绝。",
  "obr::font::draw": "`draw(color, text)` — 用已经选定的字体画一串字。",
  "obr::font::face": "`face(address, length, slot)` — 从内存里的字体文件打开一张脸。",
  "obr::math::abs": "`abs(n)` — 整数绝对值。参数和返回值同为 int 或 long。",
  "obr::math::min": "`min(a, b)` — 较小的整数。",
  "obr::math::max": "`max(a, b)` — 较大的整数。",
  "obr::math::clamp": "`clamp(n, lo, hi)` — 把整数夹进闭区间。",
  "memory::load64": "`load64(address)` — 按位地址读 64 位。",
  "memory::store64": "`store64(value, address)` — 按位地址写 64 位。",
  "memory::loadOctet": "`loadOctet(address)` — 按位地址读 8 位，结果是有符号扩展前的字节。比较前要与 255 相与。",
  "memory::storeOctet": "`storeOctet(value, address)` — 按位地址写 8 位。"
};

function lookupLibrary(word) {
  return LIBRARY[word] || null;
}

function inZapBlock(document, line) {
  if (document.languageId === "zap") return true;
  let inside = false;
  for (let i = 0; i <= line; i += 1) {
    const text = document.lineAt(i).text;
    if (!inside && /^\s*__zap__\b/.test(text)) {
      if (i === line) return false;
      inside = true;
      continue;
    }
    if (inside && text.trim() === "}") {
      if (i === line) return false;
      inside = false;
    }
  }
  return inside;
}

module.exports = {
  lookupObr,
  lookupZap,
  lookupLibrary,
  inZapBlock
};
