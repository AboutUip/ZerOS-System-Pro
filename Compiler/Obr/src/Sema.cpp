#include "Sema.hpp"

#include "Diagnostic.hpp"

#include <cctype>
#include <map>
#include <string>
#include <vector>

namespace obr {
namespace {

struct Slot {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  int index = -1;
};

bool numeric(TypeKind type) {
  return type == TypeKind::Byte || type == TypeKind::Short || type == TypeKind::Int || type == TypeKind::Long || type == TypeKind::Float || type == TypeKind::Double;
}

bool integral(TypeKind type) {
  return type == TypeKind::Byte || type == TypeKind::Short || type == TypeKind::Int || type == TypeKind::Long;
}

int rank(TypeKind type) {
  if (type == TypeKind::Short) return 1;
  if (type == TypeKind::Int) return 2;
  if (type == TypeKind::Long) return 3;
  if (type == TypeKind::Float) return 4;
  if (type == TypeKind::Double) return 5;
  return 0;
}

TypeKind promote(TypeKind left, TypeKind right) {
  if (left == TypeKind::Byte || right == TypeKind::Byte) {
    if (left != TypeKind::Byte || right != TypeKind::Byte) fail("byte 不能和别的数值混用");
    return TypeKind::Byte;
  }
  if (left == right) return left;
  if (left == TypeKind::Double || right == TypeKind::Double) return TypeKind::Double;
  if (left == TypeKind::Float || right == TypeKind::Float) return TypeKind::Float;
  if (left == TypeKind::Long || right == TypeKind::Long) return TypeKind::Long;
  if (left == TypeKind::Int || right == TypeKind::Int) return TypeKind::Int;
  return TypeKind::Int;
}

bool labelText(const std::string& text) {
  if (text.empty() || !std::isalpha(static_cast<unsigned char>(text[0]))) return false;
  for (const char unit : text) {
    if (!std::isalnum(static_cast<unsigned char>(unit))) return false;
  }
  return true;
}

bool canWiden(TypeKind from, TypeKind to) {
  if (from == TypeKind::Undefined && to != TypeKind::Void) return true;
  if (from == to) return true;
  if (from == TypeKind::Char && (to == TypeKind::Int || to == TypeKind::Long)) return true;
  if (from == TypeKind::Byte || to == TypeKind::Byte) return false;
  return numeric(from) && numeric(to) && rank(from) > 0 && rank(to) >= rank(from);
}

const char* nameOf(TypeKind type) {
  if (type == TypeKind::Byte) return "byte";
  if (type == TypeKind::Short) return "short";
  if (type == TypeKind::Int) return "int";
  if (type == TypeKind::Long) return "long";
  if (type == TypeKind::Float) return "float";
  if (type == TypeKind::Double) return "double";
  if (type == TypeKind::Boolean) return "boolean";
  if (type == TypeKind::Char) return "char";
  if (type == TypeKind::String) return "string";
  if (type == TypeKind::Ptr) return "指针";
  if (type == TypeKind::Undefined) return "undefined";
  if (type == TypeKind::Void) return "void";
  return "未知";
}

class Checker {
 public:
  void run(Unit& unit) {
    functions_ = &unit.functions;
    for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
      if (!unit.functions[index].opcode.empty()) continue;
      self_ = static_cast<int>(index);
      checkFunction(unit.functions[index]);
    }
  }

 private:
  std::vector<Function>* functions_ = nullptr;
  std::vector<std::map<std::string, Slot>> scopes_;
  int words_ = 0;
  int staticNext_ = 0;
  int loops_ = 0;
  int self_ = 0;
  std::map<std::string, int> labels_;
  TypeKind ret_ = TypeKind::Void;

  void push() { scopes_.emplace_back(); }
  void pop() { scopes_.pop_back(); }

  Slot* find(const std::string& name) {
    for (int index = static_cast<int>(scopes_.size()) - 1; index >= 0; index -= 1) {
      auto found = scopes_[static_cast<std::size_t>(index)].find(name);
      if (found != scopes_[static_cast<std::size_t>(index)].end()) return &found->second;
    }
    return nullptr;
  }

  int alloc(const std::string& name, TypeKind type, TypeKind pointee) {
    if (scopes_.back().contains(name)) fail("变量重复 " + name);
    const int slot = words_;
    words_ += 1;
    scopes_.back()[name] = Slot{type, pointee, slot};
    return slot;
  }

  int allocStatic(const std::string& name, TypeKind type, TypeKind pointee) {
    if (scopes_.back().contains(name)) fail("变量重复 " + name);
    const int slot = -1 - staticNext_;
    staticNext_ += 1;
    scopes_.back()[name] = Slot{type, pointee, slot};
    return slot;
  }

  void checkFunction(Function& function) {
    scopes_.clear();
    push();
    words_ = 1;
    loops_ = 0;
    ret_ = function.ret;
    labels_.clear();
    collectLabels(function.body);
    for (Param& param : function.params) {
      param.slot = alloc(param.name, param.type, param.pointee);
    }
    for (Stmt& stmt : function.body) checkStmt(stmt);
    function.words = words_;
    pop();
  }

  void collectLabels(const std::vector<Stmt>& body) {
    for (const Stmt& stmt : body) {
      if (stmt.kind == Stmt::Kind::Label) {
        if (stmt.name.empty() || !labelText(stmt.name)) fail("标号只能由字母和数字组成 " + stmt.name);
        if (!labels_.insert({stmt.name, 1}).second) fail("标号重复 " + stmt.name);
      }
      if (stmt.kind == Stmt::Kind::Block || stmt.kind == Stmt::Kind::While) collectLabels(stmt.body);
      if (stmt.kind == Stmt::Kind::If) {
        collectLabels(stmt.body);
        collectLabels(stmt.other);
      }
    }
  }

  void checkStmt(Stmt& stmt) {
    if (stmt.kind == Stmt::Kind::Block) {
      push();
      for (Stmt& inner : stmt.body) checkStmt(inner);
      pop();
      return;
    }
    if (stmt.kind == Stmt::Kind::Decl) {
      if (stmt.expr.kind != Expr::Kind::LitInt || stmt.expr.type != TypeKind::None) {
        if (stmt.expr.kind != Expr::Kind::LitInt || !stmt.expr.text.empty() || stmt.expr.kids.size() > 0 || stmt.name.empty()) {
          // 有初始化式时检查；没有初始化式时 expr 是默认 LitInt 且 type 为 None。
        }
      }
      const bool hasInit = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty() && stmt.expr.integer == 0 && stmt.expr.text.empty());
      if (hasInit) {
        checkExpr(stmt.expr);
        if (!canWiden(stmt.expr.type, stmt.type) && stmt.expr.type != stmt.type) {
          fail(std::string("不能把 ") + nameOf(stmt.expr.type) + " 赋给 " + nameOf(stmt.type));
        }
      }
      stmt.slot = stmt.isStatic ? allocStatic(stmt.name, stmt.type, stmt.pointee) : alloc(stmt.name, stmt.type, stmt.pointee);
      return;
    }
    if (stmt.kind == Stmt::Kind::If || stmt.kind == Stmt::Kind::While) {
      checkExpr(stmt.expr);
      if (stmt.expr.type == TypeKind::Void) fail("条件不能是 void");
      if (stmt.kind == Stmt::Kind::While) loops_ += 1;
      push();
      for (Stmt& inner : stmt.body) checkStmt(inner);
      pop();
      if (stmt.kind == Stmt::Kind::While) loops_ -= 1;
      push();
      for (Stmt& inner : stmt.other) checkStmt(inner);
      pop();
      return;
    }
    if (stmt.kind == Stmt::Kind::Break || stmt.kind == Stmt::Kind::Continue) {
      if (loops_ < 1) fail("break 和 continue 只能写在 while 里");
      return;
    }
    if (stmt.kind == Stmt::Kind::Goto) {
      if (labels_.find(stmt.name) == labels_.end()) fail("没有标号 " + stmt.name);
      return;
    }
    if (stmt.kind == Stmt::Kind::Label) return;
    if (stmt.kind == Stmt::Kind::Return) {
      const bool hasValue = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty());
      if (ret_ == TypeKind::Void) {
        if (hasValue) fail("void 函数不能返回值");
        return;
      }
      if (!hasValue) fail("函数必须返回值");
      checkExpr(stmt.expr);
      if (stmt.expr.type != ret_ && !canWiden(stmt.expr.type, ret_)) {
        fail(std::string("返回类型是 ") + nameOf(stmt.expr.type) + "，函数要求 " + nameOf(ret_));
      }
      return;
    }
    if (stmt.kind == Stmt::Kind::Expr) checkExpr(stmt.expr);
  }

  void checkExpr(Expr& expr) {
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitFloat || expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar || expr.kind == Expr::Kind::LitString || expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined) return;
    if (expr.kind == Expr::Kind::Name) {
      Slot* slot = find(expr.text);
      if (slot == nullptr) fail("没有变量 " + expr.text);
      expr.type = slot->type;
      expr.pointee = slot->pointee;
      expr.integer = slot->index;
      return;
    }
    if (expr.kind == Expr::Kind::Call) {
      for (Expr& argument : expr.kids) checkExpr(argument);
      const Function& self = (*functions_)[static_cast<std::size_t>(self_)];
      int exact = -1;
      int widened = -1;
      int widenedCount = 0;
      for (const int index : self.visible) {
        const Function& function = (*functions_)[static_cast<std::size_t>(index)];
        if (function.name != expr.text || function.params.size() != expr.kids.size()) continue;
        bool same = true;
        bool fit = true;
        for (std::size_t param = 0; param < function.params.size(); param += 1) {
          const TypeKind want = function.params[param].type;
          const TypeKind have = expr.kids[param].type;
          if (have != want) same = false;
          if (have != want && !canWiden(have, want)) fit = false;
        }
        if (same) {
          if (exact >= 0) fail("调用 " + expr.text + " 有多个完全匹配");
          exact = index;
        } else if (fit) {
          widened = index;
          widenedCount += 1;
        }
      }
      const int chosen = exact >= 0 ? exact : widenedCount == 1 ? widened : -1;
      if (chosen < 0 && expr.text == "length" && expr.kids.size() == 1 && expr.kids[0].type == TypeKind::String) {
        expr.integer = -2;
        expr.type = TypeKind::Int;
        return;
      }
      if (chosen < 0) fail(widenedCount > 1 ? "调用 " + expr.text + " 有多个可加宽的函数" : "没有函数 " + expr.text);
      expr.integer = chosen;
      expr.type = (*functions_)[static_cast<std::size_t>(chosen)].ret;
      return;
    }
    if (expr.kind == Expr::Kind::Cast) {
      checkExpr(expr.kids[0]);
      if (expr.type != TypeKind::Ptr) fail("这一版只把整数转成指针");
      if (!integral(expr.kids[0].type) && expr.kids[0].type != TypeKind::Long) fail("指针转换的来源必须是整数");
      return;
    }
    if (expr.kind == Expr::Kind::Unary) {
      checkExpr(expr.kids[0]);
      if (expr.op == Tok::BitAnd) {
        if (expr.kids[0].kind != Expr::Kind::Name) fail("& 只能取变量的地址");
        expr.type = TypeKind::Ptr;
        expr.pointee = expr.kids[0].type;
        expr.integer = expr.kids[0].integer;
        return;
      }
      if (expr.op == Tok::Star) {
        if (expr.kids[0].type != TypeKind::Ptr) fail("* 只能用于指针");
        expr.type = expr.kids[0].pointee;
        return;
      }
      if (expr.op == Tok::Not) {
        if (expr.kids[0].type == TypeKind::Void) fail("! 不能用于 void");
        expr.type = TypeKind::Boolean;
        return;
      }
      if (!numeric(expr.kids[0].type)) fail("一元正负号只能用于数值");
      if (expr.op == Tok::BitNot) {
        if (!integral(expr.kids[0].type)) fail("~ 目前只接受整数");
        expr.type = TypeKind::Int;
        return;
      }
      else expr.type = expr.kids[0].type;
      return;
    }
    if (expr.kind == Expr::Kind::Update) {
      checkExpr(expr.kids[0]);
      if (expr.kids[0].kind != Expr::Kind::Name) fail("++ 和 -- 只能用于变量");
      if (!numeric(expr.kids[0].type)) fail("++ 和 -- 只能用于数值");
      expr.type = expr.kids[0].type;
      return;
    }
    if (expr.kind == Expr::Kind::Assign) {
      checkExpr(expr.kids[0]);
      checkExpr(expr.kids[1]);
      if (expr.kids[0].kind != Expr::Kind::Name && !(expr.kids[0].kind == Expr::Kind::Unary && expr.kids[0].op == Tok::Star)) fail("赋值的左边必须是变量或 *指针");
      if (expr.op == Tok::Assign) {
        const TypeKind dest = expr.kids[0].type;
        if (expr.kids[1].type != dest && !canWiden(expr.kids[1].type, dest) && !(dest == TypeKind::Ptr && integral(expr.kids[1].type))) fail("赋值类型不一致");
        if (dest == TypeKind::Ptr && expr.kids[1].type == TypeKind::Ptr) expr.pointee = expr.kids[1].pointee;
      } else if (!numeric(expr.kids[0].type) || (expr.kids[0].type == TypeKind::Byte && expr.kids[1].type != TypeKind::Byte)) {
        fail("复合赋值的类型不合法");
      }
      expr.type = expr.kids[0].type;
      return;
    }
    if (expr.kind == Expr::Kind::Ternary) {
      checkExpr(expr.kids[0]);
      checkExpr(expr.kids[1]);
      checkExpr(expr.kids[2]);
      if (expr.kids[0].type == TypeKind::Void || expr.kids[1].type == TypeKind::Void || expr.kids[2].type == TypeKind::Void) fail("三元表达式不能是 void");
      if (expr.kids[1].type != expr.kids[2].type) fail("三元表达式的两个分支类型必须相同");
      expr.type = expr.kids[1].type;
      return;
    }
    checkExpr(expr.kids[0]);
    checkExpr(expr.kids[1]);
    const TypeKind left = expr.kids[0].type;
    const TypeKind right = expr.kids[1].type;
    if (expr.op == Tok::LBracket) {
      if (left != TypeKind::String || !integral(right)) fail("下标只能用于字符串和整数");
      expr.type = TypeKind::Char;
      return;
    }
    if (expr.op == Tok::And || expr.op == Tok::Or) {
      if (left == TypeKind::Void || right == TypeKind::Void) fail("逻辑运算不能是 void");
      expr.type = TypeKind::Boolean;
      return;
    }
    if (expr.op == Tok::Eq || expr.op == Tok::Ne) {
      if (left != right || (!integral(left) && left != TypeKind::Float && left != TypeKind::Double && left != TypeKind::Char && left != TypeKind::String)) {
        fail("== 的两侧类型必须相同，并且是数值、char 或 string");
      }
      expr.type = TypeKind::Boolean;
      return;
    }
    if (expr.op == Tok::Lt || expr.op == Tok::Le || expr.op == Tok::Gt || expr.op == Tok::Ge) {
      if (left != right || !integral(left)) fail("关系运算只能比较相同的整数类型");
      expr.type = TypeKind::Boolean;
      return;
    }
    if (expr.op == Tok::Pow) {
      expr.type = promote(left, right) == TypeKind::Byte ? TypeKind::Byte : TypeKind::Double;
      return;
    }
    if (expr.op == Tok::BitAnd || expr.op == Tok::BitOr || expr.op == Tok::BitXor || expr.op == Tok::Shl || expr.op == Tok::Shr || expr.op == Tok::UShr) {
      if (!numeric(left) || !numeric(right)) fail("位运算只能用于数值");
      promote(left, right);
      expr.type = TypeKind::Int;
      return;
    }
    if (expr.op == Tok::Plus && (left == TypeKind::String || right == TypeKind::String || left == TypeKind::Char || right == TypeKind::Char)) {
      if (left == TypeKind::Boolean || right == TypeKind::Boolean || left == TypeKind::Undefined || right == TypeKind::Undefined || left == TypeKind::Void || right == TypeKind::Void) {
        fail("不能这样拼接字符串");
      }
      expr.type = TypeKind::String;
      return;
    }
    if (!numeric(left) || !numeric(right)) fail("算术运算只能用于数值");
    expr.type = promote(left, right);
  }
};

}  // namespace

void check(Unit& unit) { Checker{}.run(unit); }

std::string signatureOf(const Function& function) {
  std::string text = function.name + "(";
  for (std::size_t index = 0; index < function.params.size(); index += 1) {
    if (index > 0) text += ",";
    text += nameOf(function.params[index].type);
  }
  text += "):";
  text += nameOf(function.ret);
  return text;
}

bool sameSignature(const Function& left, const Function& right) { return signatureOf(left) == signatureOf(right); }

struct OpcodeSpec {
  const char* name;
  const char* opcode;
  TypeKind ret;
  int count;
  int arg0;
  bool resultR6;
  bool copyLast;
};

const OpcodeSpec* opcodeSpec(const std::string& name) {
  static const OpcodeSpec table[] = {
      {"gpu::box", "gpu.box", TypeKind::Long, 6, 0, true, false},
      {"gpu::text", "gpu.text", TypeKind::Long, 5, 0, true, false},
      {"gpu::align", "gpu.align", TypeKind::Void, 3, 0, false, false},
      {"gpu::paint", "gpu.paint", TypeKind::Void, 3, 0, false, false},
      {"gpu::glyph", "gpu.glyph", TypeKind::Void, 2, 0, false, false},
      {"gpu::drop", "gpu.drop", TypeKind::Void, 1, 0, false, false},
      {"gpu::compose", "gpu.compose", TypeKind::Void, 0, 0, false, false},
      {"gpu::present", "gpu.present", TypeKind::Void, 0, 0, false, false},
      {"port::state", "port.state", TypeKind::Long, 1, 1, false, false},
      {"port::char", "port.char", TypeKind::Long, 2, 1, false, false},
      {"query", "query", TypeKind::Long, 3, 1, false, false},
      {"inbox", "inbox", TypeKind::Long, 1, 0, false, false},
      {"xchg", "xchg", TypeKind::Long, 3, 1, false, true},
      {"halt", "halt", TypeKind::Void, 0, 0, false, false},
      {"memory::loadOctet", "ldi.octet", TypeKind::Long, 1, 1, false, false},
      {"memory::load16", "ldi.16", TypeKind::Long, 1, 1, false, false},
      {"memory::load32", "ldi.32", TypeKind::Long, 1, 1, false, false},
      {"memory::load64", "ldi.64", TypeKind::Long, 1, 1, false, false},
      {"memory::loadFloat32", "ldi.f32", TypeKind::Long, 1, 1, false, false},
      {"memory::loadFloat64", "ldi.f64", TypeKind::Double, 1, 1, false, false},
      {"memory::storeOctet", "sti.octet", TypeKind::Void, 2, 0, false, false},
      {"memory::store16", "sti.16", TypeKind::Void, 2, 0, false, false},
      {"memory::store32", "sti.32", TypeKind::Void, 2, 0, false, false},
      {"memory::store64", "sti.64", TypeKind::Void, 2, 0, false, false},
      {"memory::storeFloat32", "sti.f32", TypeKind::Void, 2, 0, false, false},
      {"memory::storeFloat64", "sti.f64", TypeKind::Void, 2, 0, false, false},
      {"memory::hertz", "mem.hertz", TypeKind::Void, 1, 0, false, false},
      {"memory::metric", "mem.metric", TypeKind::Long, 1, 1, false, false},
  };
  for (const OpcodeSpec& spec : table) {
    if (name == spec.name) return &spec;
  }
  return nullptr;
}

void bindOpcode(Function& function) {
  const OpcodeSpec* spec = opcodeSpec(function.name);
  if (spec == nullptr) return;
  if (std::string(spec->opcode) == "inbox") {
    if (function.ret != TypeKind::Long || function.params.size() != 1 || function.params[0].type != TypeKind::Ptr || function.params[0].pointee != TypeKind::Long) {
      fail("指令声明与通用指令不一致 " + function.name);
    }
    if (!function.body.empty()) fail("指令不能再写函数体 " + function.name);
    function.opcode = spec->opcode;
    function.opcodeArg0 = spec->arg0;
    function.opcodeResultR6 = spec->resultR6;
    function.opcodeCopyLast = spec->copyLast;
    return;
  }
  if (function.ret != spec->ret || static_cast<int>(function.params.size()) != spec->count) {
    fail("指令声明与通用指令不一致 " + function.name);
  }
  for (std::size_t index = 0; index < function.params.size(); index += 1) {
    const TypeKind type = function.params[index].type;
    if (std::string(spec->opcode) == "sti.f64" && index == 0) {
      if (type != TypeKind::Double) fail("指令参数必须是 double " + function.name);
      continue;
    }
    if (type != TypeKind::Long) fail("指令参数必须是 long " + function.name);
  }
  if (!function.body.empty()) fail("指令不能再写函数体 " + function.name);
  function.opcode = spec->opcode;
  function.opcodeArg0 = spec->arg0;
  function.opcodeResultR6 = spec->resultR6;
  function.opcodeCopyLast = spec->copyLast;
}

bool alreadyVisible(const Function& function, int index) {
  for (const int item : function.visible) {
    if (item == index) return true;
  }
  return false;
}

bool linkAllows(const std::vector<std::string>& links, const std::string& caller) {
  if (links.empty()) return true;
  std::string name = caller;
  const std::size_t slash = name.find_last_of("/\\");
  if (slash != std::string::npos) name = name.substr(slash + 1);
  const std::string logical = "/" + name;
  for (const std::string& item : links) {
    if (item == "/") return true;
    if (item == logical) return true;
  }
  return false;
}

Unit combine(std::vector<SourceFile> sources, const std::vector<HeaderFile>& headers) {
  Unit unit;
  for (SourceFile& source : sources) {
    std::map<std::string, int> seen;
    for (Function& function : source.functions) {
      function.origin = source.path;
      if (function.exported) {
        for (const char unit : function.name) {
          if (unit == ':') fail("导出的函数名不能带 ::");
        }
      }
      function.links = source.links;
      bindOpcode(function);
      const std::string key = signatureOf(function);
      if (!seen.insert({key, 1}).second) fail("函数重复 " + function.name);
      if (!source.imports.empty()) {
        int matches = 0;
        for (const std::string& imported : source.imports) {
          const HeaderFile* header = nullptr;
          for (const HeaderFile& item : headers) {
            if (item.name == imported) header = &item;
          }
          if (header == nullptr) fail("没有头文件 " + imported);
          for (const Function& decl : header->decls) {
            if (sameSignature(decl, function)) matches += 1;
          }
        }
        if (matches != 1) fail(matches == 0 ? "没有对应的函数头 " + function.name : "函数头重复 " + function.name);
      }
      unit.functions.push_back(std::move(function));
    }
  }
  for (const HeaderFile& header : headers) {
    for (const Function& decl : header.decls) {
      if (opcodeSpec(decl.name) == nullptr) continue;
      for (const Function& function : unit.functions) {
        if (sameSignature(function, decl)) fail("指令不能再写函数体 " + decl.name);
      }
      Function function = decl;
      function.origin = header.name;
      bindOpcode(function);
      unit.functions.push_back(std::move(function));
    }
  }
  for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
    Function& function = unit.functions[index];
    for (std::size_t other = 0; other < unit.functions.size(); other += 1) {
      const Function& candidate = unit.functions[other];
      if (candidate.origin == function.origin) {
        function.visible.push_back(static_cast<int>(other));
        continue;
      }
      const SourceFile* source = nullptr;
      for (const SourceFile& item : sources) {
        if (item.path == function.origin) source = &item;
      }
      if (source == nullptr) continue;
      for (const std::string& imported : source->imports) {
        for (const HeaderFile& header : headers) {
          if (header.name != imported) continue;
          for (const Function& decl : header.decls) {
            if (sameSignature(decl, candidate) && !alreadyVisible(function, static_cast<int>(other)) && linkAllows(candidate.links, function.origin)) {
              function.visible.push_back(static_cast<int>(other));
            }
          }
        }
      }
    }
  }
  return unit;
}

}  // namespace obr
