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

/** 析构记录：带析构的所有权变量（new 直接初始化）。perIteration 预留——for-in 循环变量
    是集合元素的别名，按所有权规则不析构（见 Lower 的 ForIn 注释）。
    recordSlot 是 M2 触发点 (d) 的影子记录槽（3 个字：对象/析构标签/前一条），-1 = 没有。 */
struct DtorEntry {
  int slot = -1;
  std::string typeName;
  bool isInterface = false;
  bool perIteration = false;
  int recordSlot = -1;
};

/** 析构作用域帧：与 Sema 的作用域一一对应（函数/块/if 分支/循环/switch）。 */
struct DtorFrame {
  std::vector<DtorEntry> entries;
  bool loop = false;
  bool isSwitch = false;
};

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
  /** 析构作用域栈（Plan 2 M2）：作用域退出/return 按 LIFO 调析构；无析构类型零代码。 */
  std::vector<DtorFrame> dtorFrames_;
  /* 内联边界：return/失败清扫只扫到这一层（被调方自己的帧），
     不许越过它去扫调用方的帧——被调方的 return 不是调用方的析构触发点。 */
  std::size_t dtorBarrier_ = 0;
  /** 失败传播（Plan 2 M3）：最近的 try（catch 标签 + try 帧下标）；空 = 走 @Fails 通道或未接住。 */
  std::vector<std::pair<std::string, std::size_t>> failTargets_;
  bool currentFails_ = false;
  int failClassId_ = 0;
  /** 当前函数是可失败构造时的基类名：失败路径销毁已建成的基类链（自类不析构）。 */
  std::string ctorDtorBase_;
  int ctorThisSlot_ = -1;
  /** 当前函数的结构体返回隐藏目的槽（>= 0 = 返回结构体）。 */
  int retSlot_ = -1;
  /** 当前 case 的 fallthrough 目标；空表示不在 switch 里。 */
  std::string fallthrough_;
  bool needString_ = false;
  bool needFrom_ = false;
  bool needCollect_ = false;
  /** 原生映像支持 switch.table；链接程序和 ZPB1 回退仍用比较链。 */
  bool jumpTables_ = false;
  /** 原生映像支持 itable.call；链接程序和 ZPB1 回退仍用 class ID 比较链。 */
  bool itables_ = false;
  /** M3 失败值：版本 2 起集合例程出错返回 fail 对象（r1），调用点发检查；版本 1 保持停机。 */
  bool failChecks_ = false;
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
  /* M-C：正在发射的函数（out/ref 形参槽的间接读写按它判定；内联展开期是被调方）。 */
  const Function* currentFn_ = nullptr;
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
  /* M-C：变量槽的左值地址（帧/静态区）→ r0；out/ref 形参槽另走地址字（见 outModeOf）。 */
  void emitSlotAddress(int slot);
  /* M-C：out/ref 实参的位置发射（变量/字段/下标/*指针，复用 emitAddress 管道）；
     下标形状（集合元素/ span 元素）地址走元素地址发射。 */
  void emitArgAddress(const Expr& expr);
  /* M-C：经形参槽里地址字的读写（ABI 与 `T*` + `&x` 逐位同形）。 */
  void emitIndirectLoad(int paramSlot, TypeKind type);
  void emitIndirectStore(int paramSlot, TypeKind type);
  /* 槽号是当前函数的 out/ref 形参槽时返回修饰词（内联展开时按被调方查，恒 None）。 */
  ParamMode outModeOf(int slot) const;
  int structWords(const std::string& name) const;
  /* M-B：多字值类型的字数：struct = 字段数、span = 2（元素位地址 + 元素个数），其余一槽。 */
  int valueWordsOf(const Expr& expr) const {
    if (expr.type == TypeKind::Struct) return structWords(expr.typeName);
    return expr.type == TypeKind::Span ? 2 : 1;
  }
  void emitStore(TypeKind type, bool volatileAccess = false);
  void emitLoad(TypeKind type, bool volatileAccess = false);
  /* M-E：obr::atomic::* / memory::fence 的发射（LowerAtomic.cpp）：load/store 发 volatile
     访存面，cas/fetchAdd/fence 的运行时动作本轮是余量，先发停机桩（不可恢复停机）。 */
  void emitAtomic(const Expr& expr, const Function& target);
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
  /* 集合运行时例程的发射任务域（Collect.cpp）：每个例程族一个发射方法，collectJump 是无条件跳。 */
  void collectJump(const std::string& label);
  void collectFinishMut(const std::string& growLabel, int stride, bool writeValue);
  void emitCollectFailRoutines();
  void emitCollectHeapRoutine();
  void emitCollectHashRoutines();
  void emitCollectSeqRoutine();
  void emitCollectFindRoutine();
  void emitCollectGrowRoutine();
  void emitCollectAllocRoutines();
  void emitCollectListRoutines();
  void emitCollectQueryRoutines();
  const InterfaceDecl* findInterface(const std::string& name) const;
  bool classImplements(const std::string& className, const std::string& interfaceName) const;
  bool classDerivesFrom(const std::string& child, const std::string& parent) const;
  const Function* findDtor(const std::string& className) const;
  bool destructibleLocal(TypeKind type, const std::string& typeName) const;
  void emitDtorCall(const struct DtorEntry& entry);
  void emitFrameEndDtors(struct DtorFrame& frame);
  void emitAllFrameDtors();
  void emitDtorsAbove(std::size_t frameIndex, bool withTargetPerIteration);
  void emitDtorsThrough(std::size_t frameIndex);
  bool anyDtorsPending() const;
  void emitFailAlloc();
  void emitFailWrap();
  void emitFailCheck(bool noObjectChain = false);
  void emitFailureSite(int failSlot, bool noObjectChain, bool wrap);
  void emitStructCopyFrom(int count, int dstAddrSlot);
  void emitStructBox(int count);
  void emitStructBoxValue(const Expr& arg);
  void emitStructValueTo(const Expr& expr, int dstAddrSlot);
  void pushStructArgWords(const Expr& arg, std::vector<int>& slots, std::vector<TypeKind>& kinds);
  /* ===== M-B：span[T] 切片降级（LowerSpan.cpp）=====
     两字值（元素位地址 + 元素个数），按结构体值语义走 retSlot/字展平；
     元素按八位组密度访问（步长 = M-A alignof 的值宽度），下标/子切片越界
     造 Plan 2 失败值（code 1）进 emitFailCheck 的归宿链，不 halt、不另设停机。 */
  void emitSpanCtorTo(const Expr& expr, int dstAddrSlot);
  void emitSpanSubTo(const Expr& expr, int dstAddrSlot);
  /* span 对象的两字取进两个已持有的槽（dataSlot/lenSlot）；构造/子切片/调用结果先落临时块。 */
  void emitSpanObjectWords(const Expr& object, int dataSlot, int lenSlot);
  /* 下标元素地址（含越界检查）：出来时元素位地址在 r0。 */
  void emitSpanIndexAddress(const Expr& object, const Expr& index);
  /* 越界失败块收尾：r1 = fail（code 1）或 0，走 emitFailCheck 归宿链。 */
  void emitSpanBoundsEnd(const std::string& mkfail, const std::string& checked);
  /* 元素按值宽度访问：地址在 r5，读进 r0 / 把 r0 写出（byte 读出压回 0..255）。 */
  void emitSpanLoad(TypeKind type);
  void emitSpanStore(TypeKind type);
  static int spanStride(TypeKind elem);
  /** M2 触发点 (d)：影子析构记录链（任务栈私有区的固定槽链根）。 */
  void emitRecordPush(int recordSlot, const std::string& dtorLabel);
  void emitRecordUnlink(int recordSlot);
  void emitDtorSweepRoutines();
  bool hasDtorRecords_ = false;
  /** 结构体返回值的直写目的（>= 0 时调用发射把它当第一字参数传入）。 */
  int structDestSlot_ = -1;
  int structDestWords_ = 0;
  int findMethodIndex(const std::string& className, const Function& method) const;
  void emitDispatchCall(const std::string& interfaceName, int methodIndex, int object, const std::vector<int>& args, const std::vector<TypeKind>& argKinds);
  void emitVirtualCallTarget(int functionIndex, const std::string& receiverClass, int object, const std::vector<int>& args, const std::vector<TypeKind>& argKinds);
  void emitDispatch(const Expr& expr);
  void asFloat();
  void truth(TypeKind type);
  void narrow(TypeKind type);
  void truncate(TypeKind type);
  void floatToInteger();
  void castValue(TypeKind from, TypeKind to);
  void gen(const Expr& expr);
  /* 表达式降级的任务域拆分（LowerExpr.cpp）：Call 的特殊形态先分派，普通调用收尾在 genCall。 */
  void genCallDeref(const Expr& expr);
  void genCallFailOf(const Expr& expr);
  void genCallStruct(const Expr& expr, const Function& target);
  void genCall(const Expr& expr);
  void genNew(const Expr& expr);
  void genCast(const Expr& expr);
  void genUnary(const Expr& expr);
  void genUpdate(const Expr& expr);
  void genAssign(const Expr& expr);
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
  /* UI 共享辅助（UiUtil.cpp）：调用点与例程共用的参数种植、栈释放、通道色与故障原语。 */
  std::string uiCellText(int index) const;
  int uiKeep(const Expr& expr, std::size_t index);
  void uiDrop(int count);
  void uiAccel(int op);
  void uiGpuAccel();
  void uiZeroFrom(int from);
  void uiFault();
  void uiLoadAdvance(int sizeSlot);
  void uiPlant(const Expr& expr, std::size_t kid, int arg);
  void uiPlantImm(int value, int arg);
  void uiChannel(int mode);
  /* UI 调用点收成（UiLayout/UiValue/UiDraw/UiState.cpp）：按任务域一个方法收一个函数。 */
  void emitUiPad(const Expr& expr);
  void emitUiSpan(const Expr& expr);
  void emitUiAlignStart(const Expr& expr);
  void emitUiAlignEdge(const Expr& expr, const std::string& name);
  void emitUiAlign(const Expr& expr);
  void emitUiAdvance(const Expr& expr);
  void emitUiTextWidthTracked(const Expr& expr);
  void emitUiTextWidth(const Expr& expr);
  void emitUiTitleBelow(const Expr& expr, const std::string& name);
  void emitUiHit(const Expr& expr);
  void emitUiLerp(const Expr& expr);
  void emitUiEase(const Expr& expr);
  void emitUiRgb(const Expr& expr);
  void emitUiMeter(const Expr& expr);
  void emitUiShape(const Expr& expr, const std::string& name);
  void emitUiBar(const Expr& expr);
  void emitUiGlyph(const Expr& expr);
  void emitUiText(const Expr& expr);
  void emitUiClear(const Expr& expr);
  void emitUiClip(const Expr& expr);
  void emitUiUnclip();
  void emitUiShift(const Expr& expr);
  void emitUiPresent();
  void emitUiSave();
  void emitUiTranslate(const Expr& expr);
  void emitUiRestore();
  void emitUiFrame();
  void emitUiKey(const std::string& name);
  void emitUiQuery(const std::string& name);
  void emitUiShadow(const Expr& expr);
  void emitUiNoShadow();
  /* UI 运行时例程发射（UiRoutineDraw/UiRoutineState.cpp）：按例程族一个方法印一个例程体。 */
  void emitUiRoutineChan();
  void emitUiRoutineInk();
  void emitUiRoutineBox();
  void emitUiRoutineMeter();
  void emitUiRoutineBar();
  void emitUiRoutineGlyphPlain();
  void emitUiRoutineTextPlain();
  void emitUiRoutineGlyphShadow();
  void emitUiRoutineTextShadow();
  void emitUiRoutineClip();
  void emitUiRoutineClear();
  void emitUiRoutineKey();
  void emitUiRoutineEnter();
  void emitUiRoutineSave();
  void emitUiRoutineTranslate();
  void emitUiRoutineRestore();
  void emitUiRoutineFrame();
  void emitUiRoutineFault();
  void emitFunction(Function& function);
  bool endsWithReturn(const std::vector<Stmt>& body);
  void emitReturn();
  void emitIntegerCall(const std::string& label, const std::vector<int>& slots, const std::vector<TypeKind>& kinds);
  void emitStmt(const Stmt& stmt, TypeKind ret);
  /* 语句降级的任务域拆分（LowerStmt.cpp）：每个语句域一个收成方法。 */
  void emitStmtDecl(const Stmt& stmt, TypeKind ret);
  void emitStmtSwitch(const Stmt& stmt, TypeKind ret);
  void emitStmtForIn(const Stmt& stmt, TypeKind ret);
  void emitStmtWhile(const Stmt& stmt, TypeKind ret);
  void emitStmtFor(const Stmt& stmt, TypeKind ret);
  void emitStmtReturn(const Stmt& stmt, TypeKind ret);
  void emitStmtTry(const Stmt& stmt, TypeKind ret);

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
