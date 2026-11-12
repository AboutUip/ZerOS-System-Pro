#pragma once

#include "../Ast.hpp"
#include "../Diagnostic.hpp"

#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace obr {

/* Sema 自由函数（定义在 Sema.cpp）：Checker 方法体分文件后仍要调用，先声明。 */
std::string paramSignature(const Function& function);
std::string signatureOf(const Function& function);
bool sameSignature(const Function& left, const Function& right);
bool alreadyVisible(const Function& function, int index);
bool linkAllows(const std::vector<std::string>& links, const std::string& caller);
bool findClassName(const Unit& unit, const std::string& name);
bool findStructName(const Unit& unit, const std::string& name);
bool findEnumName(const Unit& unit, const std::string& name);
bool findInterfaceName(const Unit& unit, const std::string& name);
bool typeTaken(const Unit& unit, const std::string& name);

namespace sema {

/* M-A：sizeof/offsetof/alignof 编译期内建调用（Call + 负标记 -8/-9，见 ParserExpr）。
   这类节点在 Sema 期一律折成 LitInt(long)，不会走到代码生成。 */
inline bool layoutBuiltinCall(const Expr& expr) {
  return expr.kind == Expr::Kind::Call && (expr.integer == -8 || expr.integer == -9);
}

struct Slot {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  /** M-D：`volatile T*` 标记位。 */
  bool volatilePointee = false;
  TypeKind alt = TypeKind::None;
  int index = -1;
  int words = 1;
  std::string typeName;
  std::string altName;
  bool isConst = false;
  Expr constant;
};

/* M-C：可赋值左值 = 变量/字段/下标/*指针（out/ref 实参与赋值目标同一形状，复用
   emitAddress 管道）。字面量、表达式结果都不是左值。 */
inline bool assignableLValue(const Expr& expr) {
  return expr.kind == Expr::Kind::Name || expr.kind == Expr::Kind::Member
    || (expr.kind == Expr::Kind::Binary && expr.op == Tok::LBracket)
    || (expr.kind == Expr::Kind::Unary && expr.op == Tok::Star);
}

class Checker {
 public:
  void run(Unit& unit);

 private:
  std::vector<Function>* functions_ = nullptr;
  std::vector<ClassDecl>* classes_ = nullptr;
  std::vector<ClassDecl>* classTemplates_ = nullptr;
  std::vector<Function>* functionTemplates_ = nullptr;
  std::vector<InterfaceDecl>* interfaceTemplates_ = nullptr;
  std::vector<int> pending_;
  std::vector<InterfaceDecl>* interfaces_ = nullptr;
  std::vector<std::string>* unitStrings_ = nullptr;
  std::vector<ConstStruct>* unitStructs_ = nullptr;
  std::vector<ConstClass>* unitClasses_ = nullptr;
  bool shared_ = false;
  const std::vector<StructDecl>* structs_ = nullptr;
  const std::vector<EnumDecl>* enums_ = nullptr;
  std::string retName_;
  TypeKind retAlt_ = TypeKind::None;
  std::string retAltName_;
  /** M-D：返回类型的指针点类型与 volatile 位（return 检查逐位比对用）。 */
  TypeKind retPointee_ = TypeKind::None;
  bool retVolatilePointee_ = false;
  std::vector<std::map<std::string, Slot>> scopes_;
  std::map<std::string, Expr> moduleConsts_;
  int switchDepth_ = 0;
  int version_ = 1;
  int words_ = 0;
  int staticNext_ = 0;
  int loops_ = 0;
  int self_ = 0;
  bool sawGoto_ = false;
  int tryDepth_ = 0;
  std::map<std::string, int> labels_;
  TypeKind ret_ = TypeKind::Void;

  void push() { scopes_.emplace_back(); }
  void pop() { scopes_.pop_back(); }

  Slot* find(const std::string& name);

  int alloc(const std::string& name, TypeKind type, TypeKind pointee, int count);

  int allocStatic(const std::string& name, TypeKind type, TypeKind pointee);

  void allocConst(const std::string& name, TypeKind type, TypeKind pointee, TypeKind alt, const std::string& typeName, const std::string& altName, Expr value);

  bool constScalar(TypeKind type) const;

  Expr makeIntConstant(long long value, TypeKind type);

  Expr makeFloatConstant(double value, TypeKind type);

  Expr makeBoolConstant(bool value);

  bool constantTrue(const Expr& expr);

  long long constantInteger(const Expr& expr);

  double constantDouble(const Expr& expr);

  long long wrapBits(long long value, int bits, bool signedType);

  long long constantAsInteger(const Expr& expr);

  Expr castConstant(Expr value, TypeKind target);

  Expr foldBinary(Tok op, const Expr& left, const Expr& right);

  Expr constantValue(const Expr& source);

  /* ===== M-A：sizeof/offsetof/alignof 编译期内建（Sema 期折成 LitInt(long)，零运行时） =====
     类型实参在节点的 type/pointee/alt/typeName/altName 五元组（解析期 parseType 填，
     泛型实例化后是替换后的形态）；offsetof 的字段名在 labels[0]。单位是位。 */
  Expr foldLayoutBuiltin(const Expr& expr);

  /* sizeof 语义 = 存储跨度（槽粒度）：标量/指针/引用 64；struct = 字段数×64；
     class =（对象头 + 字段数）×64（new 的分配跨度，v2 含 1 字头、v1 无头）。 */
  long long layoutSpan(TypeKind kind, TypeKind pointee, const std::string& typeName);

  /* alignof 语义 = 八位组区自然宽度（位）：byte 8/short 16/int 32/char 32/boolean 8/
     long/float/double/指针/引用 64；struct/class = 各字段 alignof 的最大值。 */
  long long layoutAlign(TypeKind kind, TypeKind pointee, const std::string& typeName);

  /* 宽度递归核：object = 顶层类型实参形态（类/结构体名按对象展开），字段形态引用恒 64。 */
  long long alignOfDesc(TypeKind kind, TypeKind pointee, const std::string& typeName, bool object);

  /* offsetof：字段位偏移（class 含对象头），与 layoutStructs/layoutClasses 的 field.offset 同一尺。 */
  long long layoutFieldOffset(TypeKind kind, TypeKind pointee, const std::string& typeName, const std::string& field);

  /* M-A：枚举值放开到常量表达式（`enum { A = sizeof(long) }`）。layoutEnums 按声明序折值，
     值表达式里的 `名字::值` 先让目标枚举折值（DFS），成环拒绝。 */
  void foldEnumDecl(EnumDecl& decl, std::vector<EnumDecl>& enums, std::map<std::string, int>& state);

  void prescanEnumRefs(const Expr& expr, std::vector<EnumDecl>& enums, std::map<std::string, int>& state);

  EnumDecl* findEnumMut(std::vector<EnumDecl>& enums, const std::string& name);

  /* 三个布局内建名保留（同 __dtor_ 先例）：用户函数/常量不得同名。 */
  static void rejectReservedName(const std::string& name);

  Expr adaptConstant(Expr value, TypeKind type, const std::string& typeName);

  void loadConstants(const std::vector<ConstDecl>& decls);

  void resolveSignatures();

  /* 析构自动链的合成调用语句（构造链同款形态，走正常解析）。 */
  Stmt makeDtorCallStmt(const Function& dtor, int line);

  /* 基类析构自动链（与构造相反：派生先、基类后）：在每个 return 前和函数末尾插基类析构调用。 */
  void insertBaseDtorCalls(std::vector<Stmt>& body, const Function& baseDtor, const Function& self);

  void rejectBaseDtorCallsInExpr(const Expr& expr, const Function& self);

  void rejectBaseDtorCalls(const std::vector<Stmt>& body, const Function& self);

  void checkFunction(Function& function);

  void collectLabels(const std::vector<Stmt>& body);

  void layoutClasses(std::vector<ClassDecl>& classes);

  const ClassDecl* findClass(const std::string& name) const;

  const InterfaceDecl* findInterface(const std::string& name) const;

  bool classImplements(const std::string& className, const std::string& interfaceName) const;

  /* 类引用可以当基类引用用：沿基类链向上找。派生类的 this 传给基类方法的
     隐式 this 参数就是这条转换；没有它，派生类里调用继承方法会解析失败。 */
  bool classDerivesFrom(const std::string& child, const std::string& parent) const;

  /* 覆盖签名：参数类型序列（不含 this，含指针指向）和返回类型完全一致，失败性（@Fails）也一致。 */
  bool sameOverrideSignature(const Function& left, const Function& right) const;

  /* 构造 = 与类同名的方法（Class::Class）。 */
  bool isConstructor(const Function& fn) const;

  /* 语句是不是构造链调用：调用了本类基类链上某个类的构造。 */
  bool isCtorChainCall(const Function& ctor, const Stmt& stmt) const;

  /* @Overwrite：基类链上必须有同签名方法。同名但签名不一致是“覆盖签名不一致”，
     基类链上根本没有同名方法是“没有可覆盖的方法”。 */
  void validateOverrides();

  /* 方法槽里有 @Overwrite 覆盖时，解析到这个槽的调用都走方法表派发；
     一个覆盖都没有的槽保持静态直呼（存量程序零开销）。 */
  bool virtualSlot(const Function& target) const;

  /* M4：访问检查。访问者身份 = 所在方法的类；自由函数/模块级没有类身份。
     private 成员只允许：声明类自己、类级 @Friend 列出的类、成员级 @Friend 列出的类。 */
  std::string accessorName() const;

  void checkFieldAccess(const Field& field);

  void checkMethodAccess(const Function& target);

  /* 类链上最近的 @Destruct（析构沿链自动串起来，名字可以各不相同）。 */
  const Function* findDtor(const std::string& className) const;

  bool anyDtorInSubtree(const std::string& className) const;

  bool anyDtorInImplementors(const std::string& interfaceName) const;

  /* 带析构的类型：类引用（看类子树）或接口引用（看实现类）。集合元素不析构。 */
  bool destructible(TypeKind type, const std::string& typeName) const;

  /* @Destruct：零参、: void、每类至多一个；不能同时 @Overwrite；需要对象头（#VERSION 2）。 */
  void validateDestructors();

  /* @Fails（M3 失败值）：可失败函数的返回值通道在 r1（0 = 成功，非 0 = fail 对象）。
     析构不能可失败；接口方法的实现必须与接口的失败性一致（validateInterfaces）；
     构造可以可失败（M3 收口：失败时销毁已建成的基类链）。 */
  void validateFailure();

  /* M4：@Friend 列出的必须是类。 */
  void validateFriends();

  /* ===== M5：泛型单态化 =====
     模板不进常规管线；每个实参组合克隆一份、替换类型参数后按普通类/函数走原管线
     （重载决议、代码生成全部复用）。实例名 = 模板名<实参,...>，全程当普通类型名。 */

  struct TypeArg {
    TypeKind kind = TypeKind::None;
    TypeKind pointee = TypeKind::None;
    TypeKind alt = TypeKind::None;
    std::string typeName;
    std::string altName;
    std::string text;
  };

  static void splitTop(const std::string& text, std::vector<std::string>& out);

  static bool splitGenericText(const std::string& text, std::string& base, std::vector<std::string>& args);

  std::string substText(const std::string& text, const std::map<std::string, TypeArg>& map);

  TypeArg typeArgFromText(const std::string& text);

  void substDesc(TypeKind& kind, TypeKind& pointee, TypeKind& alt, std::string& typeName, std::string& altName, const std::map<std::string, TypeArg>& map);

  void substExpr(Expr& expr, const std::map<std::string, TypeArg>& map);

  /* M-A：布局内建节点的类型实参随泛型实参替换。`T*` 形态保留星号（指针是 64，
     不能塌成 T 的值宽）；指向指针/集合的 `T*` 是双重指针，拒绝。 */
  void substLayoutBuiltin(Expr& expr, const std::map<std::string, TypeArg>& map);

  void substStmt(Stmt& stmt, const std::map<std::string, TypeArg>& map);

  void substFunction(Function& fn, const std::map<std::string, TypeArg>& map);

  /* 收集文本里所有 Base<...> 请求（含 args 里嵌套的）。 */
  static void collectRequestText(const std::string& text, std::vector<std::string>& out);

  bool requestWanted(const std::string& request);

  bool hasFunction(const std::string& name) const;

  /* 缺口 5：T : Base 约束——实参必须是该类或其派生（接口约束 = 实现该接口）。
     实参本身还是未实例化的泛型实例名时跳过：它会先被实例化，之后常规类型解析兜底。 */
  void checkBounds(const std::vector<std::string>& params, const std::vector<std::string>& bounds,
                   const std::map<std::string, TypeArg>& map, const std::string& request) {
    for (std::size_t index = 0; index < params.size() && index < bounds.size(); index += 1) {
      const std::string& bound = bounds[index];
      if (bound.empty()) continue;
      const auto found = map.find(params[index]);
      const std::string argName = found == map.end() ? std::string() : found->second.typeName;
      if (findClass(argName) == nullptr && argName.find('<') != std::string::npos) continue;
      bool ok = argName == bound;
      if (!ok && findClass(argName) != nullptr) {
        ok = classDerivesFrom(argName, bound) || classImplements(argName, bound);
      }
      if (!ok) fail("泛型实参不满足约束 " + request + "：" + params[index] + " : " + bound);
    }
  }

  /* M5 驱动：反复扫描具体代码直到所有泛型请求都实例化完（闭包）。 */
  void instantiateAll();
  /* 待实例化文本收集（泛型实参出现过的每一处名字），instantiateAll 每轮先收集再挑请求。 */
  void collectInstanceTexts(std::vector<std::string>& texts);

  /* 克隆进来的函数要接进 combine 构建的 visible 可见集：
     同源互相可见；导入面沿用同源既有函数的可见集（同一文件的 import 集合相同）。 */
  void linkClones();

  /* 可失败操作：@Fails 调用（含派发）、fallible 集合操作（下标/空 pop/缺键）、
     可失败构造的 new（M3 收口）。 */
  bool fallibleExpr(const Expr& expr) const;

  bool sameMethodSignature(const Function& impl, const Function& iface) const;

  bool findImplementation(const std::string& className, const Function& method) const;

  void layoutInterfaces(std::vector<InterfaceDecl>& interfaces);

  void validateInterfaces(const std::vector<ClassDecl>& classes);

  const StructDecl* findStruct(const std::string& name) const;

  StructDecl* findStructMut(std::vector<StructDecl>& structs, const std::string& name);

  const EnumDecl* findEnum(const std::string& name) const;

  int structWords(const std::string& name) const;

  /* M-B：多字值类型的字数：struct = 字段数、span = 2（元素位地址 + 元素个数），其余一槽。 */
  int valueWords(TypeKind kind, const std::string& typeName) const {
    if (kind == TypeKind::Struct) return structWords(typeName);
    return kind == TypeKind::Span ? 2 : 1;
  }

  // 类名、结构体名、枚举名都先写成名字。类名解析成指针，结构体解析成值，枚举解析成底层整数并保留枚举名。
  // 名字后面的 * 在解析阶段把 pointee 标成 Void，用来和已经解析过的类指针区分。
  void resolveType(TypeKind& kind, TypeKind& pointee, const std::string& typeName);

  TypeKind kindOfName(const std::string& name);

  std::string unwrap(const std::string& desc) const;

  void splitMap(const std::string& inner, std::string& key, std::string& value) const;

  void validateDesc(const std::string& desc);

  /* M-B：span[T] 元素类型检查（标量/指针/枚举；string/集合/结构体/接口/void/嵌套 span 拒绝）。 */
  void validateSpan(TypeKind& pointee, const std::string& desc);

  void repair(TypeKind kind, TypeKind& pointee, TypeKind& alt, std::string& typeName, std::string& altName);

  void fillDesc(Expr& expr, const std::string& desc);

  bool sameCollection(const Expr& expr, TypeKind kind, const std::string& typeName, const std::string& altName) const;

  bool fits(const Expr& expr, TypeKind kind, const std::string& typeName, TypeKind alt, const std::string& altName,
            ParamMode mode = ParamMode::None, TypeKind pointee = TypeKind::None, bool volatilePointee = false) const;

  /* 完全匹配看类型名，不看返回类型。Foo* 和 Bar* 都是指针，不能算成同一个候选。 */
  bool identicalArg(const Expr& expr, const Param& param) const;

  /* M-C：候选带 out/ref 形参而对应实参不是可赋值左值时的专门诊断（bad-out-literal 口径）。 */
  void rejectOutArgShapes(const std::string& name, const std::vector<Expr>& args) const;

  /* M-D：只差 volatile 位的指针流转 = 隐式互转，拒绝并给专门诊断（显式转换才放行）。 */
  bool volatileOnlyMismatch(const Expr& expr, TypeKind kind, const std::string& typeName, TypeKind pointee, bool volatilePointee) const;
  /* M-D：volatile 指针的解引用不走出参通道（out/ref 写回是普通 store，会丢 volatile 语义）。 */
  bool volatileDeref(const Expr& expr) const;
  /* M-D：调用实参里只差 volatile 位的指针——专门诊断（同 rejectOutArgShapes 口径）。 */
  void rejectVolatileArgShapes(const std::string& name, const std::vector<Expr>& args) const;

  /* M-E：obr::atomic::* 调用的编译期校验（地址 64 位对齐、内存序标注参数）。
     运行时动作（信箱服务序列化、丢读缓存/发布）本轮是余量，见 README 余量清单。 */
  void checkAtomicCall(const Function& target, const Expr& expr);

  /* ===== M-C：out 形参只写检查（函数体收尾跑一遍）=====
     out 形参名不能当值用（读出、按值传参、运算都拒绝）；只允许三种位置：
     赋值目标链根（`x = v`、`x.字段 = v`）、`&x`、out/ref 实参位的左值链（转发）。
     ref 形参读写都行。 */
  void checkOutUse(const Function& function);
  void outUseStmt(const Stmt& stmt);
  void outUseExpr(const Expr& expr, int ctx);
  /* 当前函数的 out 形参槽号（checkOutUse 填；Name.integer 对槽号）。 */
  std::set<int> outSlots_;

  /* 完全匹配优先。没有完全匹配时，只有一个可加宽的候选才选用。多个可加宽由调用方报歧义。 */
  int pickOverload(const Function& self, const std::string& name, const std::vector<Expr>& args, int& widenedCount) const;

  void layoutEnums(std::vector<EnumDecl>& enums);

  void layoutStructs(std::vector<StructDecl>& structs);

  void resolveClassFields(std::vector<ClassDecl>& classes);

  void rejectForeignEnum(const std::string& destName, TypeKind dest, const std::string& srcName, TypeKind src) const;

  bool takeEnum(Expr& expr);

  void checkStmt(Stmt& stmt);
  /* 语句检查的任务域拆分（CheckerStmt.cpp）。 */
  void checkStmtForIn(Stmt& stmt);
  void checkStmtDecl(Stmt& stmt);
  void checkStmtSwitch(Stmt& stmt);

  /* `f()?`（M3）：失败传播后缀。必须是可失败操作，且本位置要有归宿
     （最近的 try，或 @Fails 函数的返回通道）；否则编译失败。 */
  void checkExpr(Expr& expr);

  void checkExprInner(Expr& expr);
  /* 表达式检查的任务域拆分（CheckerExpr.cpp）：Call 的特殊形态（fail.of/集合操作/接口方法）
     先分派，普通调用的重载解析收尾在 checkExprCall；二元运算尾巴在 checkExprBinary。 */
  void checkExprFailOf(Expr& expr);
  void checkExprCollectionCall(Expr& expr);
  /* M-B：span 的构造（span[T](地址, 个数)，-10）与成员调用（s.sub(起, 个数)，-11）。 */
  void checkExprSpanCtor(Expr& expr);
  void checkExprSpanCall(Expr& expr);
  void checkExprInterfaceCall(Expr& expr);
  void checkExprCall(Expr& expr);
  void checkExprName(Expr& expr);
  void checkExprNew(Expr& expr);
  void checkExprMember(Expr& expr);
  void checkExprCast(Expr& expr);
  void checkExprUnary(Expr& expr);
  void checkExprAssign(Expr& expr);
  void checkExprBinary(Expr& expr);
};

}  // namespace sema
}  // namespace obr
