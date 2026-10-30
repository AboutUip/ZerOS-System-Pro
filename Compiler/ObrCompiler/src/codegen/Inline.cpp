#include "Generator.hpp"

#include <cstdint>
#include <algorithm>
#include <cstring>

namespace obr {
namespace {
// 只扩展无调用、无循环、无地址逃逸的小叶函数，避免递归和嵌套内联放大。
bool smallExpr(const Expr& expr) {
  if (expr.kind == Expr::Kind::Call || expr.kind == Expr::Kind::New
      || expr.kind == Expr::Kind::Await
      || (expr.kind == Expr::Kind::Unary && expr.op == Tok::BitAnd)) return false;
  for (const Expr& kid : expr.kids) if (!smallExpr(kid)) return false;
  return true;
}
int smallCost(const std::vector<Stmt>& body) {
  int cost = 0;
  for (const Stmt& stmt : body) {
    if (stmt.kind == Stmt::Kind::While || stmt.kind == Stmt::Kind::For
        || stmt.kind == Stmt::Kind::Goto || stmt.kind == Stmt::Kind::Label
        || stmt.kind == Stmt::Kind::Zap || stmt.isStatic || !smallExpr(stmt.expr)) return 1000000;
    cost += 1 + smallCost(stmt.body) + smallCost(stmt.other);
    if (cost > 8) return 1000000;
  }
  return cost;
}
int expressionCost(const Expr& expr) {
  int cost = 1 + (expr.kind == Expr::Kind::LitString ? static_cast<int>(std::min<std::size_t>(expr.text.size(), 1000000)) : 0);
  for (const Expr& kid : expr.kids) {
    cost += expressionCost(kid);
    if (cost > 1000000) return 1000000;
  }
  return cost;
}
int bodyCost(const std::vector<Stmt>& body) {
  int cost = 0;
  for (const Stmt& stmt : body) {
    cost += std::max(1, stmt.words) + expressionCost(stmt.expr) + bodyCost(stmt.body) + bodyCost(stmt.other);
    if (cost > 1000000) return 1000000;
  }
  return cost;
}
}  // namespace


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
      if (seenZap || (*functions_)[static_cast<std::size_t>(index)].imported || !(*functions_)[static_cast<std::size_t>(index)].opcode.empty()) zap[static_cast<std::size_t>(index)] = 1;
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
    const bool multiInline = options_.level >= 2 && options_.inlineSmall;
    int totalCost = 0;
    if (multiInline) for (const Function& function : *functions_) totalCost = std::min(1000000, totalCost + bodyCost(function.body));
    // 成本包含表达式节点、字符串长度和结构体字数。新增重复体最多总成本的 20%，且至多 512 单位。
    int growthBudget = inlineGrowthBudget(totalCost);
    for (int index = 0; index < count; index += 1) {
      const auto at = static_cast<std::size_t>(index);
      if (multiInline && zap[at] == 0 && cyclic[at] == 0 && !(*functions_)[at].exported && sites[at] > 1 && sites[at] <= 96) {
        const int cost = smallCost((*functions_)[at].body);
        const int nodes = bodyCost((*functions_)[at].body);
        const int growth = cost <= 8 && nodes <= 64 ? (sites[at] - 1) * nodes : 1000000;
        if (growth <= 128 && growth <= growthBudget) {
          inlineOk_[at] = 1;
          growthBudget -= growth;
        }
      }
      if (zap[static_cast<std::size_t>(index)] == 0 && cyclic[static_cast<std::size_t>(index)] == 0 && sites[static_cast<std::size_t>(index)] == 1) {
        inlineOk_[static_cast<std::size_t>(index)] = 1;
      }
    }
  }

bool Generator::standalone(const Function& function) {
    if (!function.opcode.empty() || function.imported) return false;
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
    DebugSite next = site_;
    next.file = target.origin;
    next.function = target.name;
    next.line = target.line;
    {
      const SiteGuard guard(*this, next);
      for (const Stmt& stmt : target.body) emitStmt(stmt, target.ret);
      emit(end + ":");
    }
    inlineReturn_ = savedReturn;
    bias_ = savedBias;
    userWords_ = savedUser;
  }

}  // namespace obr
