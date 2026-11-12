#pragma once

namespace obr {

enum class TypeKind { Byte, Short, Int, Long, Float, Double, Boolean, Char, String, Ptr, Interface, Struct, Array, List, Set, Map, Span, Void, Undefined, None };

/* M-C：`out` / `ref` 形参修饰词。out = 只写出参（调用前不必初始化），ref = 读写
   （调用前必须已初始化）。ABI 逐位等于 `T*` + `&x`（同一地址字槽）。 */
enum class ParamMode { None, Out, Ref };

}  // namespace obr
