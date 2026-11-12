#include "Generator.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

int Generator::locate(int slot) const {
    if (slot < 0 || slot >= userWords_) return slot;
    return slot + bias_;
  }

bool Generator::constantPtr(const Expr& expr, long long& addr) const {
    /* M-D：volatile 指针不进常量折叠——MMIO/共享字的地址不能被 Peephole/Fold
       当成常量指针转发（takeLoad/holds/rememberStore/knownAddr 四面全关的前提）。 */
    if (expr.volatilePointee) return false;
    if (expr.kind == Expr::Kind::Cast && expr.type == TypeKind::Ptr && expr.kids[0].kind == Expr::Kind::LitInt) {
      addr = expr.kids[0].integer;
      return true;
    }
    if (expr.kind == Expr::Kind::Name && expr.type == TypeKind::Ptr) {
      const auto found = knownAddr_.find(locate(static_cast<int>(expr.integer)));
      if (found == knownAddr_.end()) return false;
      addr = found->second;
      return true;
    }
    return false;
  }

void Generator::remember(int slot, const Expr& value) {
    long long addr = 0;
    const int located = locate(slot);
    /* M-D：volatile 指针不进 remember（knownAddr_ 里永远没有 volatile 地址）。 */
    if (!value.volatilePointee && constantPtr(value, addr)) knownAddr_[located] = addr;
    else knownAddr_.erase(located);
  }

const char* Generator::loadAbs(TypeKind type) const {
    if (type == TypeKind::Float || type == TypeKind::Double) return "load.f64";
    if (type == TypeKind::Short) return "load.16";
    if (type == TypeKind::Int || type == TypeKind::Char) return "load.32";
    if (type == TypeKind::Byte) return "load.octet";
    return "load.64";
  }

const char* Generator::storeAbs(TypeKind type) const {
    if (type == TypeKind::Float || type == TypeKind::Double) return "store.f64";
    if (type == TypeKind::Short) return "store.16";
    if (type == TypeKind::Int || type == TypeKind::Char) return "store.32";
    if (type == TypeKind::Byte) return "store.octet";
    return "store.64";
  }

}  // namespace obr
