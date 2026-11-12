#include "Generator.hpp"

#include "../Diagnostic.hpp"

#include <string>

namespace obr {

/* M-E：obr::atomic / memory::fence 的发射面（编译期签名与校验见 Checker::checkAtomicCall）。
   - atomic.load / atomic.store 本轮发 volatile 访存面（vld.64 / vst.64）：单字 64 位对齐
     store 原子是语义下限，acquire 的丢读缓存、release 的发布动作随固件缓存模型落地（余量）；
   - atomic.cas / atomic.fetchAdd 的信箱服务序列化、memory::fence 的 svc 下限本轮不发
     （信箱服务/fence svc = 运行时余量，见 README「运行时余量清单」）：调用先落停机桩，
     与 imported 函数「调用先跳 halt」同一约定，属「不可恢复停机」面（SKILL 边界表）。
   内存序参数是编译期标注（Checker::checkAtomicCall 校验），不进运行时、不占指令。 */
void Generator::emitAtomic(const Expr& expr, const Function& target) {
  const std::string& name = target.name;
  if (name == "obr::atomic::load") {
    gen(expr.kids[0]);
    copy(5, 0);
    emitLoad(TypeKind::Long, true);
    return;
  }
  if (name == "obr::atomic::store") {
    gen(expr.kids[1]);
    const int saved = words_ + temp_;
    hold();
    storeSlot(saved, TypeKind::Long);
    gen(expr.kids[0]);
    copy(1, 0);
    loadSlot(saved, TypeKind::Long);
    release();
    copy(5, 1);
    emitStore(TypeKind::Long, true);
    return;
  }
  /* cas / fetchAdd / memory::fence：实参照常求值（副作用不丢），动作未落地——停机桩。 */
  for (const Expr& argument : expr.kids) {
    if (argument.kind == Expr::Kind::LitInt) continue;
    gen(argument);
  }
  emit("halt");
}

}  // namespace obr
