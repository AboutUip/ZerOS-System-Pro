#include "Generator.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

int Generator::locate(int slot) const {
    if (slot < 0 || slot >= userWords_) return slot;
    return slot + bias_;
  }

bool Generator::constantPtr(const Expr& expr, long long& addr) const {
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
    if (constantPtr(value, addr)) knownAddr_[located] = addr;
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
