#pragma once

#include "Layout.hpp"
#include "../Ast.hpp"
#include "../Diagnostic.hpp"

#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace obr {

class Generator {
 public:
  std::string run(Unit& unit);

 private:
  std::ostringstream out_;
  int labels_ = 0;
  int words_ = 0;
  int temp_ = 0;
  std::vector<std::pair<std::string, std::string>> loops_;
  bool needString_ = false;
  bool uiInk_ = false;
  bool uiBox_ = false;
  bool uiGlyph_ = false;
  bool uiText_ = false;
  bool uiClip_ = false;
  bool uiClear_ = false;
  bool uiKey_ = false;
  bool uiEnter_ = false;
  bool uiSave_ = false;
  bool uiTranslate_ = false;
  bool uiRestore_ = false;
  bool uiFrame_ = false;
  bool uiBar_ = false;
  bool uiMeter_ = false;
  bool uiShadow_ = false;
  bool frameHeld_ = false;
  int userWords_ = 0;
  int bias_ = 0;
  std::string inlineReturn_;
  std::string jumpPrefix_;
  std::map<int, long long> knownAddr_;
  std::vector<int> inlineOk_;
  std::vector<int> extraMemo_;
  const std::vector<Function>* functions_ = nullptr;
  const std::vector<ClassDecl>* classes_ = nullptr;
  const std::vector<StructDecl>* structs_ = nullptr;

  void emit(const std::string& line);
  void write(const std::string& line);
  void expandLoad(int reg, int base);
  void expandStore(int reg, int base);
  void expandPlace(int reg, int base, int stride);
  void copy(int dest, int src);
  bool calm(const Expr& expr) const;
  std::string fresh(const std::string& prefix);
  int frameBits() const;
  void frameBase();
  int locate(int slot) const;
  bool constantPtr(const Expr& expr, long long& addr) const;
  void remember(int slot, const Expr& value);
  const char* loadAbs(TypeKind type) const;
  const char* storeAbs(TypeKind type) const;
  void address(int slot);
  void emitAddress(const Expr& expr);
  int structWords(const std::string& name) const;
  void emitStore(TypeKind type);
  void emitLoad(TypeKind type);
  void emitZap(const std::string& body);
  void storeSlot(int slot, TypeKind type);
  void loadSlot(int slot, TypeKind type);
  int spill();
  void hold();
  void release();
  std::string floatBits(double value);
  int keep(int reg);
  void bump();
  void emitString(const std::string& text);
  void boxChar();
  void concat();
  void emitConcatRoutine();
  void emitCopyRoutine();
  void asFloat();
  void truth(TypeKind type);
  void narrow(TypeKind type);
  void gen(const Expr& expr);
  void arith(Tok op, TypeKind left, TypeKind right, TypeKind result);
  void collectExpr(const Expr& expr, std::vector<int>& calls, bool& zap) const;
  void collectStmt(const Stmt& stmt, std::vector<int>& calls, bool& zap) const;
  int functionIndex(const Function& function) const;
  void markCycle(int index, std::vector<int>& color, std::vector<int>& stack, const std::vector<std::vector<int>>& calls, std::vector<int>& cyclic);
  void prepareInline();
  void collectStmtList(const std::vector<Stmt>& body, std::vector<int>& calls, bool& zap) const;
  bool inlineable(int index);
  bool standalone(const Function& function);
  int extraWords(int index);
  void emitInline(const Expr& expr, const Function& target);
  void emitLibrary(const Expr& expr, const Function& target);
  void emitUi(const Expr& expr, const Function& target);
  void emitUiRoutines();
  int uiAt(int index) const;
  void emitFunction(Function& function);
  bool endsWithReturn(const std::vector<Stmt>& body);
  void emitReturn();
  void emitStmt(const Stmt& stmt, TypeKind ret);
};

}  // namespace obr
