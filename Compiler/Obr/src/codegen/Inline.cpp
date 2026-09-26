#include "Generator.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

bool Generator::calm(const Expr& expr) const {
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar || expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined || expr.kind == Expr::Kind::Name) return true;
    if (expr.kind == Expr::Kind::Cast) return calm(expr.kids[0]);
    if (expr.kind == Expr::Kind::Unary && expr.op == Tok::Plus) return calm(expr.kids[0]);
    if (expr.kind == Expr::Kind::Unary && expr.op == Tok::Star) return calm(expr.kids[0]);
    if (expr.kind == Expr::Kind::Unary && expr.op == Tok::BitAnd) return expr.kids[0].kind == Expr::Kind::Name;
    return false;
  }

void Generator::collectExpr(const Expr& expr, std::vector<int>& calls, bool& zap) const {
    if (expr.kind == Expr::Kind::Call && expr.integer >= 0) calls.push_back(static_cast<int>(expr.integer));
    for (const Expr& kid : expr.kids) collectExpr(kid, calls, zap);
  }

void Generator::collectStmt(const Stmt& stmt, std::vector<int>& calls, bool& zap) const {
    if (stmt.kind == Stmt::Kind::Zap) zap = true;
    collectExpr(stmt.expr, calls, zap);
    for (const Stmt& inner : stmt.body) collectStmt(inner, calls, zap);
    for (const Stmt& inner : stmt.other) collectStmt(inner, calls, zap);
  }

void Generator::collectStmtList(const std::vector<Stmt>& body, std::vector<int>& calls, bool& zap) const {
    for (const Stmt& stmt : body) collectStmt(stmt, calls, zap);
  }

int Generator::functionIndex(const Function& function) const {
    for (int index = 0; index < static_cast<int>(functions_->size()); index += 1) {
      if (&(*functions_)[static_cast<std::size_t>(index)] == &function) return index;
    }
    return -1;
  }

void Generator::markCycle(int index, std::vector<int>& color, std::vector<int>& stack, const std::vector<std::vector<int>>& calls, std::vector<int>& cyclic) {
    color[static_cast<std::size_t>(index)] = 1;
    stack.push_back(index);
    for (const int callee : calls[static_cast<std::size_t>(index)]) {
      if (color[static_cast<std::size_t>(callee)] == 1) {
        for (int cursor = static_cast<int>(stack.size()) - 1; cursor >= 0; cursor -= 1) {
          cyclic[static_cast<std::size_t>(stack[static_cast<std::size_t>(cursor)])] = 1;
          if (stack[static_cast<std::size_t>(cursor)] == callee) break;
        }
      } else if (color[static_cast<std::size_t>(callee)] == 0) {
        markCycle(callee, color, stack, calls, cyclic);
      }
    }
    stack.pop_back();
    color[static_cast<std::size_t>(index)] = 2;
  }

void Generator::prepareInline() {
    if (!inlineOk_.empty()) return;
    const int count = static_cast<int>(functions_->size());
    inlineOk_.assign(static_cast<std::size_t>(count), 0);
    extraMemo_.assign(static_cast<std::size_t>(count), -2);
    std::vector<std::vector<int>> calls(static_cast<std::size_t>(count));
    std::vector<int> zap(static_cast<std::size_t>(count), 0);
    for (int index = 0; index < count; index += 1) {
      bool seenZap = false;
      collectStmtList((*functions_)[static_cast<std::size_t>(index)].body, calls[static_cast<std::size_t>(index)], seenZap);
      if (seenZap || !(*functions_)[static_cast<std::size_t>(index)].opcode.empty()) zap[static_cast<std::size_t>(index)] = 1;
    }
    std::vector<int> color(static_cast<std::size_t>(count), 0);
    std::vector<int> stack;
    std::vector<int> cyclic(static_cast<std::size_t>(count), 0);
    std::vector<int> sites(static_cast<std::size_t>(count), 0);
    for (int index = 0; index < count; index += 1) {
      if (color[static_cast<std::size_t>(index)] == 0) markCycle(index, color, stack, calls, cyclic);
      for (const int callee : calls[static_cast<std::size_t>(index)]) {
        if (callee >= 0 && callee < count) sites[static_cast<std::size_t>(callee)] += 1;
      }
    }
    for (int index = 0; index < count; index += 1) {
      if (zap[static_cast<std::size_t>(index)] == 0 && cyclic[static_cast<std::size_t>(index)] == 0 && sites[static_cast<std::size_t>(index)] == 1) {
        inlineOk_[static_cast<std::size_t>(index)] = 1;
      }
    }
  }

bool Generator::standalone(const Function& function) {
    if (!function.opcode.empty()) return false;
    prepareInline();
    if (function.name == "main" || function.exported) return true;
    const int index = functionIndex(function);
    if (index < 0) return true;
    return !inlineable(index);
  }

bool Generator::inlineable(int index) {
    prepareInline();
    return inlineOk_[static_cast<std::size_t>(index)] == 1;
  }

int Generator::extraWords(int index) {
    prepareInline();
    if (extraMemo_[static_cast<std::size_t>(index)] != -2) return extraMemo_[static_cast<std::size_t>(index)] < 0 ? 0 : extraMemo_[static_cast<std::size_t>(index)];
    extraMemo_[static_cast<std::size_t>(index)] = -1;
    int best = 0;
    std::vector<int> calls;
    bool zap = false;
    collectStmtList((*functions_)[static_cast<std::size_t>(index)].body, calls, zap);
    for (const int callee : calls) {
      if (inlineOk_[static_cast<std::size_t>(callee)] != 1) continue;
      const int need = (*functions_)[static_cast<std::size_t>(callee)].words + extraWords(callee);
      if (need > best) best = need;
    }
    extraMemo_[static_cast<std::size_t>(index)] = best;
    return best;
  }

void Generator::emitInline(const Expr& expr, const Function& target) {
    std::vector<int> held;
    std::vector<TypeKind> kinds;
    std::vector<int> knownFlag(expr.kids.size(), 0);
    std::vector<long long> knownVal(expr.kids.size(), 0);
    for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
      const Expr& argument = expr.kids[index];
      gen(argument);
      const TypeKind want = target.params[index].type;
      if ((want == TypeKind::Float || want == TypeKind::Double) && argument.type != TypeKind::Float && argument.type != TypeKind::Double) {
        emit("itof r0, r0");
      }
      const int saved = words_ + temp_;
      const TypeKind kept = want == TypeKind::Float || want == TypeKind::Double ? want : TypeKind::Long;
      hold();
      storeSlot(saved, kept);
      held.push_back(saved);
      kinds.push_back(kept);
      long long addr = 0;
      if (constantPtr(argument, addr)) {
        knownFlag[index] = 1;
        knownVal[index] = addr;
      }
    }
    const int savedBias = bias_;
    const int savedUser = userWords_;
    const std::string savedReturn = inlineReturn_;
    bias_ = savedBias + savedUser;
    userWords_ = target.words;
    for (int slot = 0; slot < target.words; slot += 1) knownAddr_.erase(locate(slot));
    for (std::size_t index = 0; index < held.size(); index += 1) {
      loadSlot(held[index], kinds[index]);
      release();
      storeSlot(target.params[index].slot, target.params[index].type);
      const int located = locate(target.params[index].slot);
      if (knownFlag[index] == 1) knownAddr_[located] = knownVal[index];
      else knownAddr_.erase(located);
    }
    const std::string end = fresh("e");
    inlineReturn_ = end;
    for (const Stmt& stmt : target.body) emitStmt(stmt, target.ret);
    emit(end + ":");
    inlineReturn_ = savedReturn;
    bias_ = savedBias;
    userWords_ = savedUser;
  }

}  // namespace obr
