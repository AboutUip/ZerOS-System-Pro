#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

bool scaleOf(long long bits, int& scale) {
  if (bits == 8) scale = 1;
  else if (bits == 16) scale = 2;
  else if (bits == 32) scale = 4;
  else if (bits == 64) scale = 8;
  else return false;
  return true;
}
bool matchScaled(const Expr& address, const Expr*& base, const Expr*& index, int& scale, int& disp) {
  if (address.kind == Expr::Kind::Cast) {
    if (address.kids.empty()) return false;
    return matchScaled(address.kids[0], base, index, scale, disp);
  }
  const Expr* node = &address;
  disp = 0;
  if (node->kind == Expr::Kind::Binary && node->op == Tok::Plus && node->kids.size() == 2) {
    const Expr* lit = nullptr;
    const Expr* rest = nullptr;
    if (node->kids[1].kind == Expr::Kind::LitInt && node->kids[0].kind == Expr::Kind::Binary) {
      lit = &node->kids[1];
      rest = &node->kids[0];
    } else if (node->kids[0].kind == Expr::Kind::LitInt && node->kids[1].kind == Expr::Kind::Binary) {
      lit = &node->kids[0];
      rest = &node->kids[1];
    }
    if (lit != nullptr) {
      const long long bits = lit->integer;
      if (bits % 8 != 0) return false;
      const long long octets = bits / 8;
      if (octets < -128 || octets > 127) return false;
      disp = static_cast<int>(octets);
      node = rest;
    }
  }
  if (node->kind != Expr::Kind::Binary || node->op != Tok::Plus || node->kids.size() != 2) return false;
  const Expr* mul = nullptr;
  const Expr* baseExpr = nullptr;
  if (node->kids[1].kind == Expr::Kind::Binary && node->kids[1].op == Tok::Star && node->kids[1].kids.size() == 2) {
    baseExpr = &node->kids[0];
    mul = &node->kids[1];
  } else if (node->kids[0].kind == Expr::Kind::Binary && node->kids[0].op == Tok::Star && node->kids[0].kids.size() == 2) {
    baseExpr = &node->kids[1];
    mul = &node->kids[0];
  } else {
    return false;
  }
  const Expr* indexExpr = nullptr;
  long long stride = 0;
  if (mul->kids[1].kind == Expr::Kind::LitInt) {
    indexExpr = &mul->kids[0];
    stride = mul->kids[1].integer;
  } else if (mul->kids[0].kind == Expr::Kind::LitInt) {
    indexExpr = &mul->kids[1];
    stride = mul->kids[0].integer;
  } else {
    return false;
  }
  int found = 0;
  if (!scaleOf(stride, found)) return false;
  base = baseExpr;
  index = indexExpr;
  scale = found;
  return true;
}

bool Generator::tryScaled(const Expr& address, const Expr* value, TypeKind type) {
  /* M-D：volatile 解引用不收带比例访存（load.scale/store.scale 是普通面）。 */
  if (address.volatilePointee) return false;
  if (type != TypeKind::Long && type != TypeKind::Ptr) return false;
  const Expr* base = nullptr;
  const Expr* index = nullptr;
  int scale = 0;
  int disp = 0;
  if (!matchScaled(address, base, index, scale, disp)) return false;
  int valueSlot = -1;
  if (value != nullptr) {
    gen(*value);
    if ((type == TypeKind::Float || type == TypeKind::Double) && value->type != TypeKind::Float && value->type != TypeKind::Double) {
      emit("itof r0, r0");
    }
    valueSlot = words_ + temp_;
    hold();
    storeSlot(valueSlot, TypeKind::Long);
  }
  gen(*base);
  emit("place r1, 7");
  emit("and r1, r0, r1");
  const std::string aligned = fresh("a");
  emit("jz r1, " + aligned);
  emit("halt");
  emit(aligned + ":");
  emit("place r1, 3");
  emit("shr r0, r0, r1");
  const int baseSlot = words_ + temp_;
  hold();
  storeSlot(baseSlot, TypeKind::Long);
  gen(*index);
  copy(2, 0);
  loadSlot(baseSlot, TypeKind::Long);
  copy(1, 0);
  const std::string line = std::string(value == nullptr ? "load.scale" : "store.scale") + " r0, r1, r2, " + std::to_string(scale) + ", " + std::to_string(disp);
  if (value != nullptr) loadSlot(valueSlot, TypeKind::Long);
  emit(line);
  release();
  if (value != nullptr) release();
  frameHeld_ = false;
  return true;
}

void Generator::emitAddress(const Expr& expr) {
  if (expr.kind == Expr::Kind::StructConst) {
    if (expr.integer < 0 || expr.integer >= static_cast<long long>(structAddresses_.size())) fail("结构体常量编号越界");
    emit("place r0, " + std::to_string(structAddresses_[static_cast<std::size_t>(expr.integer)]));
    return;
  }
  if (expr.kind == Expr::Kind::ClassConst) {
    if (expr.integer < 0 || expr.integer >= static_cast<long long>(classAddresses_.size())) fail("类常量编号越界");
    emit("place r0, " + std::to_string(classAddresses_[static_cast<std::size_t>(expr.integer)]));
    return;
  }
  if (expr.kind == Expr::Kind::Member) {
    if (expr.prefix) emitAddress(expr.kids[0]);
    else gen(expr.kids[0]);
    emit("place r5, " + std::to_string(expr.integer));
    emit("add r0, r0, r5");
    return;
  }
  if (expr.kind == Expr::Kind::Name) {
    /* M-C：out/ref 形参槽里存的就是地址字（ABI 与 `T*` + `&x` 逐位同形）。 */
    if (outModeOf(static_cast<int>(expr.integer)) != ParamMode::None) {
      loadSlot(static_cast<int>(expr.integer), TypeKind::Long);
      return;
    }
    if (expr.type == TypeKind::Struct || expr.type == TypeKind::Span) {
      /* 结构体/span 两字值的地址就是字块地址（值语义由拷贝点完成）。 */
      address(static_cast<int>(expr.integer));
      copy(0, 5);
      return;
    }
    /* 标量/类引用变量的值就是它指向的对象地址（this.字段 等成员链的基址）。 */
    gen(expr);
    return;
  }
  if (expr.kind == Expr::Kind::Unary && expr.op == Tok::Star) {
    gen(expr.kids[0]);
    return;
  }
  gen(expr);
}

/* M-C：out/ref 形参槽判定（内联展开期 currentFn_ 是被调方——out/ref 函数禁内联，恒 None）。 */

ParamMode Generator::outModeOf(int slot) const {
  if (currentFn_ == nullptr || slot < 0) return ParamMode::None;
  for (const Param& param : currentFn_->params) {
    if (param.slot == slot && param.mode != ParamMode::None) return param.mode;
  }
  return ParamMode::None;
}

/* 变量槽的左值地址 → r0（静态槽给静态区地址，普通槽给帧地址）。 */

void Generator::emitSlotAddress(int slot) {
  const int at = locate(slot);
  if (at < 0) {
    emit("place r0, " + std::to_string(kStatic + (-at - 1) * 128 + 64));
    return;
  }
  if (!frameHeld_) frameBase();
  emit("place r5, " + std::to_string(at * 64));
  emit("add r0, r4, r5");
  frameHeld_ = true;
}

/* M-C：out/ref 实参的位置发射。变量给槽地址（out/ref 形参转发槽里的地址字）、
   字段/*指针复用 emitAddress；下标形状给元素地址（集合元素槽 / span 元素位地址，
   span 越界照走失败值归宿链）。 */

void Generator::emitArgAddress(const Expr& expr) {
  /* 位置一旦交给被调方，根变量的内容就可能被写掉——清掉窥孔的常量地址记忆。 */
  const Expr* root = &expr;
  while (root->kind == Expr::Kind::Member || (root->kind == Expr::Kind::Binary && root->op == Tok::LBracket)) {
    root = &root->kids[0];
  }
  if (root->kind == Expr::Kind::Unary && root->op == Tok::Star) root = &root->kids[0];
  if (root->kind == Expr::Kind::Name) knownAddr_.erase(locate(static_cast<int>(root->integer)));
  if (expr.kind == Expr::Kind::Binary && expr.op == Tok::LBracket) {
    if (expr.kids[0].type == TypeKind::Span) emitSpanIndexAddress(expr.kids[0], expr.kids[1]);
    else emitElementAddress(expr.kids[0], expr.kids[1]);
    return;
  }
  if (expr.kind == Expr::Kind::Name && outModeOf(static_cast<int>(expr.integer)) == ParamMode::None) {
    emitSlotAddress(static_cast<int>(expr.integer));
    return;
  }
  emitAddress(expr);
}

/* M-C：经形参槽地址字取值（ref 形参读、out 防御同形）。结构体/span 的「值」是块地址。 */

void Generator::emitIndirectLoad(int paramSlot, TypeKind type) {
  loadSlot(paramSlot, TypeKind::Long);
  if (type == TypeKind::Struct || type == TypeKind::Span) return;
  copy(5, 0);
  emitLoad(type);
}

/* M-C：把 r0 的值经形参槽地址字写出（与 `*p = v` 同一指令形状）。 */

void Generator::emitIndirectStore(int paramSlot, TypeKind type) {
  const int saved = words_ + temp_;
  hold();
  storeSlot(saved, TypeKind::Long);
  loadSlot(paramSlot, TypeKind::Long);
  copy(1, 0);
  loadSlot(saved, TypeKind::Long);
  release();
  copy(5, 1);
  emitStore(type);
}

int Generator::structWords(const std::string& name) const {
  if (structs_ != nullptr) {
    for (const StructDecl& decl : *structs_) {
      if (decl.name == name) return decl.words;
    }
  }
  fail("没有结构体 " + name);
}

const InterfaceDecl* Generator::findInterface(const std::string& name) const {
    if (interfaces_ == nullptr) return nullptr;
    for (const InterfaceDecl& decl : *interfaces_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

/* 类引用沿基类链向上可当基类用；强转检查按同一链收集目标类及其派生类的 class ID。 */

bool Generator::classDerivesFrom(const std::string& child, const std::string& parent) const {
  if (classes_ == nullptr || child.empty() || parent.empty() || child == parent) return false;
  const ClassDecl* decl = nullptr;
  for (const ClassDecl& item : *classes_) {
    if (item.name == child) {
      decl = &item;
      break;
    }
  }
  while (decl != nullptr) {
    if (decl->base == parent) return true;
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

/* 析构（Plan 2 M2）：类链上最近的 @Destruct，名字可以各不相同。 */

const Function* Generator::findDtor(const std::string& className) const {
  if (functions_ == nullptr || classes_ == nullptr) return nullptr;
  std::string cursor = className;
  while (!cursor.empty()) {
    for (const Function& fn : *functions_) {
      if (fn.destruct && fn.owner == cursor) return &fn;
    }
    const ClassDecl* next = nullptr;
    for (const ClassDecl& decl : *classes_) {
      if (decl.name == cursor) {
        next = &decl;
        break;
      }
    }
    cursor = next == nullptr || next->base.empty() ? std::string() : next->base;
  }
  return nullptr;
}

/* 带析构的类型：类引用看类子树，接口引用看实现类；集合元素不析构。 */

bool Generator::destructibleLocal(TypeKind type, const std::string& typeName) const {
  if (typeName.empty() || classes_ == nullptr) return false;
  if (type == TypeKind::Ptr) {
    for (const ClassDecl& decl : *classes_) {
      if ((decl.name == typeName || classDerivesFrom(decl.name, typeName)) && findDtor(decl.name) != nullptr) return true;
    }
    return false;
  }
  if (type == TypeKind::Interface) {
    for (const ClassDecl& decl : *classes_) {
      if (classImplements(decl.name, typeName) && findDtor(decl.name) != nullptr) return true;
    }
    return false;
  }
  return false;
}

/* 一次所有权析构：按对象头 class ID 找运行时类最近的析构（基类链由析构自动链跑完）。
   统一用 class ID 比较链（原生/链接/PIE 同形）；没命中 = 运行时类没有析构，什么都不跑。 */

}  // namespace obr
