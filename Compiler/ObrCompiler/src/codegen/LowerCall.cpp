#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

bool Generator::classImplements(const std::string& className, const std::string& interfaceName) const {
    if (classes_ == nullptr) return false;
    const ClassDecl* decl = nullptr;
    for (const ClassDecl& item : *classes_) {
      if (item.name == className) {
        decl = &item;
        break;
      }
    }
    while (decl != nullptr) {
      for (const std::string& item : decl->interfaces) {
        if (item == interfaceName) return true;
      }
      if (decl->base.empty()) return false;
      const std::string base = decl->base;
      decl = nullptr;
      for (const ClassDecl& item : *classes_) {
        if (item.name == base) {
          decl = &item;
          break;
        }
      }
    }
    return false;
  }

int Generator::findMethodIndex(const std::string& className, const Function& method) const {
    if (classes_ == nullptr || functions_ == nullptr) return -1;
    const std::string wanted = shortFunctionName(method.name);
    const ClassDecl* decl = nullptr;
    for (const ClassDecl& item : *classes_) {
      if (item.name == className) {
        decl = &item;
        break;
      }
    }
    while (decl != nullptr) {
      for (std::size_t index = 0; index < functions_->size(); index += 1) {
        const Function& function = (*functions_)[index];
        if (function.owner != decl->name) continue;
        if (shortFunctionName(function.name) != wanted) continue;
        if (function.params.size() != method.params.size() + 1) continue;
        if (function.ret != method.ret || function.retName != method.retName || function.retPointee != method.retPointee) continue;
        bool same = true;
        for (std::size_t param = 0; param < method.params.size(); param += 1) {
          const Param& left = function.params[param + 1];
          const Param& right = method.params[param];
          /* M-C：out/ref 修饰词参与接口/覆盖派发的签名比对（与 Checker::sameMethodSignature 同口径）。 */
          if (left.type != right.type || left.typeName != right.typeName || left.pointee != right.pointee || left.mode != right.mode) {
            same = false;
            break;
          }
        }
        if (same) return static_cast<int>(index);
      }
      if (decl->base.empty()) return -1;
      const std::string base = decl->base;
      decl = nullptr;
      for (const ClassDecl& item : *classes_) {
        if (item.name == base) {
          decl = &item;
          break;
        }
      }
    }
    return -1;
  }

void Generator::emitDispatchCall(const std::string& interfaceName, int methodIndex, int object, const std::vector<int>& args, const std::vector<TypeKind>& argKinds) {
    const InterfaceDecl* iface = findInterface(interfaceName);
    if (iface == nullptr) fail("没有接口 " + interfaceName);
    if (methodIndex < 0 || methodIndex >= static_cast<int>(iface->methods.size())) fail("接口方法编号越界");
    const Function& method = iface->methods[static_cast<std::size_t>(methodIndex)];
    if (itables_) {
      if (args.size() > 5) fail("接口方法参数超过 5 个还没接");
      const int maxId = classes_ == nullptr ? 0 : static_cast<int>(classes_->size());
      if (maxId < 1) fail("接口派发没有类");
      std::vector<int> entries(static_cast<std::size_t>(maxId) + 1, -1);
      bool emitted = false;
      for (const ClassDecl& decl : *classes_) {
        if (decl.id < 1 || decl.id > maxId) continue;
        if (!classImplements(decl.name, iface->name)) continue;
        const int index = findMethodIndex(decl.name, method);
        if (index < 0) continue;
        entries[static_cast<std::size_t>(decl.id)] = index;
        emitted = true;
      }
      if (!emitted) fail("没有类实现接口 " + iface->name);
      loadSlot(object, TypeKind::Long);
      copy(1, 0);
      for (std::size_t index = 0; index < args.size(); index += 1) {
        loadSlot(args[index], argKinds[index]);
        copy(static_cast<int>(index) + 2, 0);
      }
      loadSlot(object, TypeKind::Long);
      emit("ldi.64 r0, r0");
      std::string line = "itable.call r0, 1, " + std::to_string(maxId);
      for (int id = 1; id <= maxId; id += 1) {
        const int index = entries[static_cast<std::size_t>(id)];
        line += ", " + (index < 0 ? std::string("-1") : (*functions_)[static_cast<std::size_t>(index)].label);
      }
      emit(line);
      /* 被调方会把 kFrame 改成自己的帧；返回后恢复调用方的帧。 */
      emit("load.64 r4, " + std::to_string(kSp));
      emit("place r5, " + std::to_string(frameBits()));
      emit("sub r4, r4, r5");
      emit("store.64 r4, " + std::to_string(kFrame));
      frameHeld_ = true;
      return;
    }
    loadSlot(object, TypeKind::Long);
    emit("ldi.64 r0, r0");
    const int classSlot = words_ + temp_;
    hold();
    storeSlot(classSlot, TypeKind::Long);
    const std::string done = fresh("e");
    bool emitted = false;
    for (const ClassDecl& decl : *classes_) {
      if (!classImplements(decl.name, iface->name)) continue;
      const int index = findMethodIndex(decl.name, method);
      if (index < 0) continue;
      loadSlot(classSlot, TypeKind::Long);
      emit("place r1, " + std::to_string(decl.id));
      emit("eq r0, r0, r1");
      const std::string next = fresh("e");
      emit("jz r0, " + next);
      std::vector<int> slots;
      slots.push_back(object);
      for (const int slot : args) slots.push_back(slot);
      std::vector<TypeKind> kinds(1, TypeKind::Long);
      for (const TypeKind kind : argKinds) kinds.push_back(kind);
      emitIntegerCall((*functions_)[static_cast<std::size_t>(index)].label, slots, kinds);
      emit("place r1, 1");
      emit("jnz r1, " + done);
      emit(next + ":");
      emitted = true;
    }
    if (!emitted) fail("没有类实现接口 " + iface->name);
    emit("halt");
    emit(done + ":");
    release();
    frameHeld_ = false;
  }

void Generator::emitDispatch(const Expr& expr) {
    gen(expr.kids[0]);
    const int object = words_ + temp_;
    hold();
    storeSlot(object, TypeKind::Long);
    /* M-C：实参按目标方法的形参修饰分流——out/ref 实参是一个地址字。 */
    const InterfaceDecl* iface = expr.kind == Expr::Kind::Dispatch ? findInterface(expr.text) : nullptr;
    const Function* method = nullptr;
    if (expr.kind == Expr::Kind::VirtualCall && functions_ != nullptr && expr.integer >= 0) {
      method = &(*functions_)[static_cast<std::size_t>(expr.integer)];
    } else if (iface != nullptr && expr.integer >= 0 && expr.integer < static_cast<int>(iface->methods.size())) {
      method = &iface->methods[static_cast<std::size_t>(expr.integer)];
    }
    const std::size_t skip = expr.kind == Expr::Kind::VirtualCall ? 1 : 0;
    std::vector<int> args;
    std::vector<TypeKind> argKinds;
    int argHeld = 0;
    for (std::size_t index = 1; index < expr.kids.size(); index += 1) {
      const Expr& argument = expr.kids[index];
      ParamMode mode = ParamMode::None;
      if (method != nullptr && index - 1 + skip < method->params.size()) mode = method->params[index - 1 + skip].mode;
      if (mode != ParamMode::None) {
        emitArgAddress(argument);
        const int slot = words_ + temp_;
        hold();
        storeSlot(slot, TypeKind::Long);
        args.push_back(slot);
        argKinds.push_back(TypeKind::Long);
        argHeld += 1;
        continue;
      }
      if (argument.type == TypeKind::Struct || argument.type == TypeKind::Span) {
        const std::size_t before = args.size();
        pushStructArgWords(argument, args, argKinds);
        argHeld += static_cast<int>(args.size() - before);
        continue;
      }
      gen(argument);
      const TypeKind kind = argument.type == TypeKind::Float || argument.type == TypeKind::Double ? argument.type : TypeKind::Long;
      const int slot = words_ + temp_;
      hold();
      storeSlot(slot, kind);
      args.push_back(slot);
      argKinds.push_back(kind);
      argHeld += 1;
    }
    if (expr.kind == Expr::Kind::VirtualCall) {
      emitVirtualCallTarget(static_cast<int>(expr.integer), expr.kids[0].typeName, object, args, argKinds);
      if ((*functions_)[static_cast<std::size_t>(expr.integer)].fails) emitFailCheck();
    } else {
      emitDispatchCall(expr.text, expr.integer, object, args, argKinds);
      /* 接口方法的 @Fails（M3 收口）：派发后按同一 r1 通道检查。 */
      const InterfaceDecl* iface = findInterface(expr.text);
      if (iface != nullptr && expr.integer >= 0 && expr.integer < static_cast<int>(iface->methods.size())
        && iface->methods[static_cast<std::size_t>(expr.integer)].fails) {
        emitFailCheck();
      }
    }
    for (std::size_t index = 0; index < argHeld; index += 1) release();
    release();
  }

/* 覆盖链方法表派发（@Overwrite）：与接口派发同一套 class ID → 实现的表。
   表项按接收者静态类型的类链收集，每类填最近实现（含未标注的同名方法，与
   C++ 虚函数一致）；原生映像发 itable.call，链接/PIE 回退 class ID 比较链。 */

void Generator::emitVirtualCallTarget(int functionIndex, const std::string& receiverClass, int object, const std::vector<int>& args, const std::vector<TypeKind>& argKinds) {
    if (functions_ == nullptr || classes_ == nullptr) fail("虚方法派发没有类");
    if (functionIndex < 0 || functionIndex >= static_cast<int>(functions_->size())) fail("虚方法派发目标越界");
    const Function& target = (*functions_)[static_cast<std::size_t>(functionIndex)];
    Function sig = target;
    if (!sig.params.empty()) sig.params.erase(sig.params.begin());
    if (args.size() > 5) fail("派发方法参数超过 5 个还没接");
    const int maxId = static_cast<int>(classes_->size());
    if (maxId < 1) fail("虚方法派发没有类");
    std::vector<int> entries(static_cast<std::size_t>(maxId) + 1, -1);
    bool emitted = false;
    for (const ClassDecl& decl : *classes_) {
      if (decl.id < 1 || decl.id > maxId) continue;
      if (!classDerivesFrom(decl.name, receiverClass) && decl.name != receiverClass) continue;
      const int index = findMethodIndex(decl.name, sig);
      if (index < 0) continue;
      entries[static_cast<std::size_t>(decl.id)] = index;
      emitted = true;
    }
    if (!emitted) fail("虚方法没有可派发的实现 " + target.name);
    if (itables_) {
      loadSlot(object, TypeKind::Long);
      copy(1, 0);
      for (std::size_t index = 0; index < args.size(); index += 1) {
        loadSlot(args[index], argKinds[index]);
        copy(static_cast<int>(index) + 2, 0);
      }
      loadSlot(object, TypeKind::Long);
      emit("ldi.64 r0, r0");
      std::string line = "itable.call r0, 1, " + std::to_string(maxId);
      for (int id = 1; id <= maxId; id += 1) {
        const int index = entries[static_cast<std::size_t>(id)];
        line += ", " + (index < 0 ? std::string("-1") : (*functions_)[static_cast<std::size_t>(index)].label);
      }
      emit(line);
      /* 被调方会把 kFrame 改成自己的帧；返回后恢复调用方的帧。 */
      emit("load.64 r4, " + std::to_string(kSp));
      emit("place r5, " + std::to_string(frameBits()));
      emit("sub r4, r4, r5");
      emit("store.64 r4, " + std::to_string(kFrame));
      frameHeld_ = true;
      return;
    }
    loadSlot(object, TypeKind::Long);
    emit("ldi.64 r0, r0");
    const int classSlot = words_ + temp_;
    hold();
    storeSlot(classSlot, TypeKind::Long);
    const std::string done = fresh("e");
    bool chain = false;
    for (const ClassDecl& decl : *classes_) {
      if (decl.id < 1 || decl.id > maxId) continue;
      const int index = entries[static_cast<std::size_t>(decl.id)];
      if (index < 0) continue;
      loadSlot(classSlot, TypeKind::Long);
      emit("place r1, " + std::to_string(decl.id));
      emit("eq r0, r0, r1");
      const std::string next = fresh("e");
      emit("jz r0, " + next);
      std::vector<int> slots;
      slots.push_back(object);
      for (const int slot : args) slots.push_back(slot);
      std::vector<TypeKind> kinds(1, TypeKind::Long);
      for (const TypeKind kind : argKinds) kinds.push_back(kind);
      emitIntegerCall((*functions_)[static_cast<std::size_t>(index)].label, slots, kinds);
      emit("place r1, 1");
      emit("jnz r1, " + done);
      emit(next + ":");
      chain = true;
    }
    if (!chain) fail("虚方法没有可派发的实现 " + target.name);
    emit("halt");
    emit(done + ":");
    release();
    frameHeld_ = false;
  }

void Generator::emitIntegerCall(const std::string& label, const std::vector<int>& slots, const std::vector<TypeKind>& kinds) {
  if (slots.size() != kinds.size()) fail("调用参数和类型对不上");
  const int count = static_cast<int>(slots.size());
  auto into = [&](int index, int dest) {
    const std::size_t at = static_cast<std::size_t>(index);
    loadSlot(slots[at], kinds[at]);
    copy(dest, 0);
  };
  /* r1 到 r3 是前三个参数，r6 是第六个。压栈会改 r4、r5，所以第六个要先放好。 */
  if (count > 0) into(0, 1);
  if (count > 1) into(1, 2);
  if (count > 2) into(2, 3);
  if (count > 5) into(5, 6);
  int extra = 0;
  for (int index = 6; index < count; index += 1) {
    const std::size_t at = static_cast<std::size_t>(index);
    loadSlot(slots[at], kinds[at]);
    emit("load.64 r4, " + std::to_string(kSp));
    emit("sti.64 r0, r4");
    emit("place r5, 64");
    emit("add r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kSp));
    extra += 1;
  }
  /* 第四个参数先停在栈上，腾出 r4、r5 去装第五个。 */
  if (count > 3) {
    const std::size_t at = 3;
    loadSlot(slots[at], kinds[at]);
    emit("load.64 r4, " + std::to_string(kSp));
    emit("sti.64 r0, r4");
    emit("place r5, 64");
    emit("add r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kSp));
  }
  if (count > 4) into(4, 5);
  if (count > 3) {
    emit("load.64 r4, " + std::to_string(kSp));
    emit("place r0, 64");
    emit("sub r4, r4, r0");
    emit("store.64 r4, " + std::to_string(kSp));
    emit("ldi.64 r0, r4");
    copy(4, 0);
  }
  emit("call " + label);
  if (extra > 0) {
    emit("load.64 r4, " + std::to_string(kSp));
    emit("place r5, " + std::to_string(extra * 64));
    emit("sub r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kSp));
  }
  emit("load.64 r4, " + std::to_string(kSp));
  emit("place r5, " + std::to_string(frameBits()));
  emit("sub r4, r4, r5");
  emit("store.64 r4, " + std::to_string(kFrame));
  frameHeld_ = true;
}

}  // namespace obr
