#pragma once

#include "Layout.hpp"
#include "../Ast.hpp"
#include "../Diagnostic.hpp"
#include "../image/Debug.hpp"

#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace obr {

class Generator {
 public:
  Generated run(Unit& unit);

 private:
  std::ostringstream out_;
  DebugSite site_;
  std::vector<DebugSite> sites_;
  int labels_ = 0;
  int words_ = 0;
  int temp_ = 0;
  std::vector<std::pair<std::string, std::string>> loops_;
  /** break 的最近目标：循环或 switch。continue 仍只看 loops_。 */
  std::vector<std::string> breakTargets_;
  /** 当前 case 的 fallthrough 目标；空表示不在 switch 里。 */
  std::string fallthrough_;
  bool needString_ = false;
  bool needFrom_ = false;
  bool needCollect_ = false;
  /** 原生映像支持 switch.table；链接程序和 ZPB1 回退仍用比较链。 */
  bool jumpTables_ = false;
  /** 原生映像支持 itable.call；链接程序和 ZPB1 回退仍用 class ID 比较链。 */
  bool itables_ = false;
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
  const std::vector<InterfaceDecl>* interfaces_ = nullptr;
  const std::vector<std::string>* strings_ = nullptr;
  const std::vector<ConstStruct>* structConstants_ = nullptr;
  const std::vector<ConstClass>* classConstants_ = nullptr;
  std::vector<int> stringAddresses_;
  std::vector<int> structAddresses_;
  std::vector<int> classAddresses_;
  int stringHeapEnd_ = 0;
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
  /** 基址 + 变址 × 8/16/32/64 位收成一条带比例的访存。对不上时不写指令。 */
  bool tryScaled(const Expr& address, const Expr* value, TypeKind type);
  void emitZap(const std::string& body, int startLine);
  void storeSlot(int slot, TypeKind type);
  void loadSlot(int slot, TypeKind type);
  int spill();
  void hold();
  void release();
  std::string floatBits(double value);
  int keep(int reg);
  void bump();
  void emitString(const std::string& text);
  void layoutConstStrings();
  void emitConstStringInit();
  void emitConstValue(int address, TypeKind type, const Expr& value);
  void boxChar();
  void concat();
  void emitConcatRoutine();
  void emitCopyRoutine();
  void emitFrom(const Expr& expr);
  void emitFromRoutine();
  void markCollect();
  void restoreFrame();
  void emitCollectCall(const std::string& label);
  void emitCollectNew(const Expr& expr);
  void emitCollectMethod(const Expr& expr);
  void emitElementAddress(const Expr& box, const Expr& index);
  void emitCollectRoutines();
  const InterfaceDecl* findInterface(const std::string& name) const;
  bool classImplements(const std::string& className, const std::string& interfaceName) const;
  int findMethodIndex(const std::string& className, const Function& method) const;
  void emitDispatchCall(const std::string& interfaceName, int methodIndex, int object, const std::vector<int>& args, const std::vector<TypeKind>& argKinds);
  void emitDispatch(const Expr& expr);
  void asFloat();
  void truth(TypeKind type);
  void narrow(TypeKind type);
  void truncate(TypeKind type);
  void floatToInteger();
  void castValue(TypeKind from, TypeKind to);
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
  void emitFont(const Expr& expr, const Function& target);
  void emitUi(const Expr& expr, const Function& target);
  void emitUiRoutines();
  int uiAt(int index) const;
  void emitFunction(Function& function);
  bool endsWithReturn(const std::vector<Stmt>& body);
  void emitReturn();
  void emitIntegerCall(const std::string& label, const std::vector<int>& slots, const std::vector<TypeKind>& kinds);
  void emitStmt(const Stmt& stmt, TypeKind ret);

  /** 暂时把后面的指令记到这一行。行号不大于 0 时保持原行。 */
  class LineGuard {
   public:
    LineGuard(Generator& owner, int line) : owner_(owner), saved_(owner.site_.line) {
      if (line > 0) owner_.site_.line = line;
    }
    ~LineGuard() { owner_.site_.line = saved_; }
    LineGuard(const LineGuard&) = delete;
    LineGuard& operator=(const LineGuard&) = delete;

   private:
    Generator& owner_;
    int saved_;
  };

  /** 暂时换成另一处源位置。展开进调用处的函数体用被调用的函数，而不是调用方。 */
  class SiteGuard {
   public:
    SiteGuard(Generator& owner, DebugSite next) : owner_(owner), saved_(owner.site_) { owner.site_ = std::move(next); }
    ~SiteGuard() { owner_.site_ = saved_; }
    SiteGuard(const SiteGuard&) = delete;
    SiteGuard& operator=(const SiteGuard&) = delete;

   private:
    Generator& owner_;
    DebugSite saved_;
  };
};

}  // namespace obr
