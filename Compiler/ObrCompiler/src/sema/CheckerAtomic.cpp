#include "Checker.hpp"

#include "../Diagnostic.hpp"
#include "../type/Type.hpp"

#include <string>
#include <vector>

namespace obr {
namespace sema {

  /* M-D：调用实参里只差 volatile 位的指针流转 = 隐式互转，给专门诊断
     （与 rejectOutArgShapes 同口径：没有匹配时先说真原因再报没有函数）。 */
  void Checker::rejectVolatileArgShapes(const std::string& name, const std::vector<Expr>& args) const {
    for (const Function& function : *functions_) {
      if (function.name != name || function.params.size() != args.size()) continue;
      for (std::size_t index = 0; index < args.size(); index += 1) {
        const Param& want = function.params[index];
        if (want.mode != ParamMode::None) continue;
        if (volatileOnlyMismatch(args[index], want.type, want.typeName, want.pointee, want.volatilePointee)) {
          fail("volatile 指针和普通指针不能隐式互转，要显式转换");
        }
      }
    }
  }

  namespace {

  /* 常量位址（`(volatile long*)字面量` 或字面量本身）。非常量位址返回假——
     运行时对齐校验随信箱服务落地（余量清单）。 */
  bool constantAddress(const Expr& expr, long long& value) {
    if (expr.kind == Expr::Kind::LitInt) {
      value = expr.integer;
      return true;
    }
    if (expr.kind == Expr::Kind::Cast && expr.kids.size() == 1
      && expr.kids[0].kind == Expr::Kind::LitInt) {
      value = expr.kids[0].integer;
      return true;
    }
    return false;
  }

  }  // namespace

  /* M-E：obr::atomic::* / memory::fence 的编译期校验。
     - 地址参数必须是 `volatile long*`（签名面由 fits/identicalArg 逐位把关）；
     - 常量位址必须 64 位对齐（非对齐编译拒绝）；非常量位址本轮不查（余量）；
     - 内存序是编译期标注参数：必须写 MemoryOrder 的枚举常量（Acquire/Release/SeqCst，
       没有 relaxed——枚举里没有这个值，写出来就是「没有枚举值」）；
     - 运行时动作（丢读缓存/发布、信箱服务序列化、fence 的 svc 下限）本轮不发射，
       见 README「运行时余量清单」。 */
  void Checker::checkAtomicCall(const Function& target, const Expr& expr) {
    if (!expr.kids.empty()) {
      const Expr& address = expr.kids[0];
      long long value = 0;
      if (constantAddress(address, value) && value % 64 != 0) fail("原子地址必须 64 位对齐");
    }
    if (target.name == "memory::fence") return;
    if (expr.kids.empty()) return;
    const Expr& order = expr.kids[expr.kids.size() - 1];
    if (order.kind != Expr::Kind::LitInt || order.typeName != "obr::atomic::MemoryOrder") {
      fail("内存序必须写 MemoryOrder 的常量（Acquire/Release/SeqCst）");
    }
  }

}  // namespace sema
}  // namespace obr
