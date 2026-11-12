#include "Checker.hpp"

#include "../Diagnostic.hpp"
#include "../Utf8.hpp"
#include "../intrinsic/Intrinsic.hpp"
#include "../type/Type.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace obr {
namespace sema {

  void Checker::splitTop(const std::string& text, std::vector<std::string>& out) {
    int depth = 0;
    std::string current;
    for (char ch : text) {
      if (ch == '<' || ch == '[' || ch == '(') depth += 1;
      if (ch == '>' || ch == ']' || ch == ')') depth -= 1;
      if (ch == ',' && depth == 0) {
        out.push_back(current);
        current.clear();
        continue;
      }
      current += ch;
    }
    if (!current.empty()) out.push_back(current);
  }

  bool Checker::splitGenericText(const std::string& text, std::string& base, std::vector<std::string>& args) {
    if (text.empty() || text.back() != '>') return false;
    const std::size_t open = text.find('<');
    if (open == std::string::npos || open == 0) return false;
    base = text.substr(0, open);
    splitTop(text.substr(open + 1, text.size() - open - 2), args);
    return true;
  }

  std::string Checker::substText(const std::string& text, const std::map<std::string, TypeArg>& map) {
    if (text.empty() || map.empty()) return text;
    const auto direct = map.find(text);
    if (direct != map.end()) return direct->second.text;
    for (const std::string& word : {std::string("array["), std::string("list["), std::string("set["), std::string("span[")}) {
      if (text.rfind(word, 0) == 0 && text.back() == ']') {
        return word + substText(text.substr(word.size(), text.size() - word.size() - 1), map) + "]";
      }
    }
    if (text.rfind("map[", 0) == 0 && text.back() == ']') {
      std::vector<std::string> parts;
      splitTop(text.substr(4, text.size() - 5), parts);
      if (parts.size() == 2) return "map[" + substText(parts[0], map) + "," + substText(parts[1], map) + "]";
    }
    std::string base;
    std::vector<std::string> args;
    if (splitGenericText(text, base, args)) {
      std::string out = base + "<";
      for (std::size_t index = 0; index < args.size(); index += 1) {
        if (index > 0) out += ",";
        out += substText(args[index], map);
      }
      return out + ">";
    }
    return text;
  }

  Checker::TypeArg Checker::typeArgFromText(const std::string& text) {
    TypeArg arg;
    arg.text = text;
    if (text.empty()) fail("泛型实参是空类型");
    for (const std::string& word : {std::string("array["), std::string("list["), std::string("set["), std::string("span[")}) {
      if (text.rfind(word, 0) == 0 && text.back() == ']') {
        if (word == "array[") arg.kind = TypeKind::Array;
        else if (word == "list[") arg.kind = TypeKind::List;
        else if (word == "set[") arg.kind = TypeKind::Set;
        else arg.kind = TypeKind::Span;
        arg.typeName = text.substr(word.size(), text.size() - word.size() - 1);
        arg.pointee = kindOfName(arg.typeName);
        return arg;
      }
    }
    if (text.rfind("map[", 0) == 0 && text.back() == ']') {
      std::vector<std::string> parts;
      splitTop(text.substr(4, text.size() - 5), parts);
      if (parts.size() != 2) fail("map 实参要写成 map[键, 值]");
      arg.kind = TypeKind::Map;
      arg.typeName = parts[0];
      arg.altName = parts[1];
      arg.pointee = kindOfName(arg.typeName);
      arg.alt = kindOfName(arg.altName);
      return arg;
    }
    if (text.size() > 1 && text.back() == '*') {
      arg.kind = TypeKind::Ptr;
      arg.pointee = TypeKind::Void;
      arg.typeName = text.substr(0, text.size() - 1);
      return arg;
    }
    arg.pointee = TypeKind::None;
    arg.alt = TypeKind::None;
    arg.altName.clear();
    if (findInterface(text) != nullptr) {
      arg.kind = TypeKind::Interface;
      arg.typeName = text;
      return arg;
    }
    arg.kind = kindOfName(text);
    arg.typeName = text;
    /* 内置标量的常规解析形态是 typeName 为空；留着会让签名比较对不上手写的 int v。 */
    if (findEnum(text) == nullptr && findClass(text) == nullptr && findStruct(text) == nullptr
      && arg.kind != TypeKind::Ptr && arg.kind != TypeKind::Struct) {
      arg.typeName.clear();
    }
    return arg;
  }

  void Checker::substDesc(TypeKind& kind, TypeKind& pointee, TypeKind& alt, std::string& typeName, std::string& altName, const std::map<std::string, TypeArg>& map) {
    if (map.empty()) return;
    if (kind == TypeKind::Array || kind == TypeKind::List || kind == TypeKind::Set || kind == TypeKind::Map || kind == TypeKind::Span) {
      if (!typeName.empty()) typeName = substText(typeName, map);
      if (!altName.empty()) altName = substText(altName, map);
      return;
    }
    if (!typeName.empty()) {
      const auto found = map.find(typeName);
      if (found != map.end()) {
        kind = found->second.kind;
        pointee = found->second.pointee;
        alt = found->second.alt;
        typeName = found->second.typeName;
        altName = found->second.altName;
        return;
      }
      typeName = substText(typeName, map);
    }
    if (!altName.empty()) altName = substText(altName, map);
  }

  void Checker::substExpr(Expr& expr, const std::map<std::string, TypeArg>& map) {
    /* M-A：布局内建节点的类型实参走专用替换（`T*` 保留星号）；节点自身的名字（text）不替换。 */
    const bool builtin = layoutBuiltinCall(expr);
    if (builtin) substLayoutBuiltin(expr, map);
    else substDesc(expr.type, expr.pointee, expr.alt, expr.typeName, expr.altName, map);
    if ((expr.kind == Expr::Kind::New || expr.kind == Expr::Kind::Call) && !builtin) {
      if (!expr.text.empty()) expr.text = substText(expr.text, map);
    }
    for (Expr& kid : expr.kids) substExpr(kid, map);
  }

  void Checker::substLayoutBuiltin(Expr& expr, const std::map<std::string, TypeArg>& map) {
    /* 布局内建的类型实参随泛型实参替换，实例化后求值（布局已知）。`T*` 保留星号：
       指针恒 64，不能塌成 T 的值宽；T 本身是指针/集合/接口时 `T*` 是双重引用，拒绝。
       offsetof 的字段名（labels）是名字不是类型，不替换。 */
    const bool pointerToParam = expr.type == TypeKind::Ptr && expr.pointee == TypeKind::Void
      && !expr.typeName.empty() && map.find(expr.typeName) != map.end();
    if (!pointerToParam) {
      substDesc(expr.type, expr.pointee, expr.alt, expr.typeName, expr.altName, map);
      return;
    }
    const TypeArg& arg = map.find(expr.typeName)->second;
    if (collection(arg.kind) || arg.kind == TypeKind::Interface) fail("这一版只接受一层指针");
    if (arg.kind == TypeKind::Ptr && arg.pointee == TypeKind::Void) fail("这一版只接受一层指针");
    if (arg.kind == TypeKind::Ptr) fail("类名本身就是指针 " + arg.typeName);
    expr.alt = TypeKind::None;
    expr.altName.clear();
    expr.type = TypeKind::Ptr;
    expr.pointee = arg.typeName.empty() ? arg.kind : TypeKind::Void;
    expr.typeName = arg.typeName;
  }

  void Checker::substStmt(Stmt& stmt, const std::map<std::string, TypeArg>& map) {
    substDesc(stmt.type, stmt.pointee, stmt.alt, stmt.typeName, stmt.altName, map);
    substExpr(stmt.expr, map);
    for (Stmt& inner : stmt.body) substStmt(inner, map);
    for (Stmt& inner : stmt.other) substStmt(inner, map);
  }

  void Checker::substFunction(Function& fn, const std::map<std::string, TypeArg>& map) {
    substDesc(fn.ret, fn.retPointee, fn.retAlt, fn.retName, fn.retAltName, map);
    for (Param& param : fn.params) {
      substDesc(param.type, param.pointee, param.alt, param.typeName, param.altName, map);
    }
    for (Stmt& stmt : fn.body) substStmt(stmt, map);
  }

  void Checker::collectRequestText(const std::string& text, std::vector<std::string>& out) {
    for (std::size_t i = 0; i < text.size(); i += 1) {
      if (text[i] != '<') continue;
      std::size_t start = i;
      while (start > 0 && (std::isalnum(static_cast<unsigned char>(text[start - 1])) || text[start - 1] == '_' || text[start - 1] == ':')) {
        start -= 1;
      }
      if (start == i) continue;
      int depth = 0;
      std::size_t end = i;
      for (; end < text.size(); end += 1) {
        if (text[end] == '<') depth += 1;
        else if (text[end] == '>') {
          depth -= 1;
          if (depth == 0) break;
        }
      }
      if (end >= text.size()) return;
      out.push_back(text.substr(start, end - start + 1));
      collectRequestText(text.substr(i + 1, end - i - 1), out);
      i = end;
    }
  }

  bool Checker::requestWanted(const std::string& request) {
    const std::size_t pos = request.find('<');
    const std::string base = request.substr(0, pos);
    /* 每种解释各自判重：谁还缺实例，请求就还要做。 */
    for (const ClassDecl& decl : *classTemplates_) {
      if (decl.name == base && findClass(request) == nullptr) return true;
    }
    for (const InterfaceDecl& decl : *interfaceTemplates_) {
      if (decl.name == base && findInterface(request) == nullptr) return true;
    }
    for (const Function& tpl : *functionTemplates_) {
      if (tpl.owner.empty()) {
        if (tpl.name == base && !hasFunction(request)) return true;
        continue;
      }
      /* 方法模板（缺口 5）：请求是方法短名；实例名是 类::短名<实参>。 */
      if (tpl.typeParams.empty() || shortFunctionName(tpl.name) != base) continue;
      if (findClass(tpl.owner) == nullptr) continue;
      if (!hasFunction(tpl.owner + "::" + request)) return true;
    }
    return false;
  }

  bool Checker::hasFunction(const std::string& name) const {
    for (const Function& fn : *functions_) {
      if (fn.name == name) return true;
    }
    return false;
  }

  void Checker::instantiateAll() {    for (int guard = 0; guard < 100000; guard += 1) {
      std::string request;
      std::vector<std::string> texts;
      collectInstanceTexts(texts);
      std::vector<std::string> requests;
      for (const std::string& text : texts) {
        if (!text.empty() && text.find('<') != std::string::npos) collectRequestText(text, requests);
      }
      /* 名字短的先做：内层实例先于外层（`Pair<int,Pair<int,int>>` 里的 `Pair<int,int>`）。 */
      std::sort(requests.begin(), requests.end(), [](const std::string& a, const std::string& b) {
        return a.size() < b.size();
      });
      for (const std::string& candidate : requests) {
        if (requestWanted(candidate)) {
          request = candidate;
          break;
        }
      }
      if (request.empty()) break;
      const std::size_t pos = request.find('<');
      const std::string base = request.substr(0, pos);
      std::vector<std::string> argTexts;
      splitTop(request.substr(pos + 1, request.size() - pos - 2), argTexts);
      std::map<std::string, TypeArg> map;
      int made = 0;
      int sawWrongArity = 0;
      const ClassDecl* classTemplate = nullptr;
      for (const ClassDecl& decl : *classTemplates_) {
        if (decl.name == base) classTemplate = &decl;
      }
      if (classTemplate != nullptr && findClass(request) == nullptr) {
        if (argTexts.size() != classTemplate->typeParams.size()) fail("泛型实参数量不对 " + request);
        for (std::size_t index = 0; index < argTexts.size(); index += 1) {
          map[classTemplate->typeParams[index]] = typeArgFromText(argTexts[index]);
        }
        checkBounds(classTemplate->typeParams, classTemplate->typeParamBounds, map, request);
        /* 模板自身的名字也指向实例（this 参数、自引用类型都靠它）。 */
        TypeArg self;
        self.kind = TypeKind::None;
        self.typeName = request;
        self.text = request;
        map[base] = self;
        ClassDecl inst = *classTemplate;
        inst.name = request;
        inst.base = substText(inst.base, map);
        for (std::string& name : inst.interfaces) name = substText(name, map);
        inst.typeParams.clear();
        inst.typeParamBounds.clear();
        for (Field& field : inst.fields) {
          substDesc(field.type, field.pointee, field.alt, field.typeName, field.altName, map);
        }
        std::vector<Function> newTemplates;
        for (const Function& fn : *functionTemplates_) {
          if (fn.owner != base) continue;
          Function copy = fn;
          copy.owner = request;
          /* 构造按 Class::Class 约定命名：实例的构造是 Stack<int>::Stack<int>。 */
          copy.name = request + "::" + (isConstructor(fn) ? request : shortFunctionName(fn.name));
          substFunction(copy, map);
          if (!fn.typeParams.empty()) {
            /* 方法自有类型参数（缺口 5）：实例的方法仍是模板，等方法级请求再单态化。 */
            newTemplates.push_back(copy);
          } else {
            functions_->push_back(copy);
            pending_.push_back(static_cast<int>(functions_->size()) - 1);
          }
        }
        for (Function& fn : newTemplates) functionTemplates_->push_back(std::move(fn));
        classes_->push_back(inst);
        made += 1;
      }
      for (const Function& tpl : *functionTemplates_) {
        if (tpl.name != base || !tpl.owner.empty()) continue;
        if (hasFunction(request)) continue;
        if (argTexts.size() != tpl.typeParams.size()) {
          sawWrongArity += 1;
          continue;
        }
        std::map<std::string, TypeArg> fmap;
        for (std::size_t index = 0; index < argTexts.size(); index += 1) {
          fmap[tpl.typeParams[index]] = typeArgFromText(argTexts[index]);
        }
        checkBounds(tpl.typeParams, tpl.typeParamBounds, fmap, request);
        TypeArg self;
        self.kind = TypeKind::None;
        self.typeName = request;
        self.text = request;
        fmap[base] = self;
        Function copy = tpl;
        copy.name = request;
        copy.typeParams.clear();
        copy.typeParamBounds.clear();
        substFunction(copy, fmap);
        functions_->push_back(copy);
        pending_.push_back(static_cast<int>(functions_->size()) - 1);
        made += 1;
      }
      /* 泛型接口（缺口 5）：interface I[T] → I<int>，方法签名按实参替换。 */
      for (const InterfaceDecl& tpl : *interfaceTemplates_) {
        if (tpl.name != base) continue;
        if (findInterface(request) != nullptr) continue;
        if (argTexts.size() != tpl.typeParams.size()) {
          sawWrongArity += 1;
          continue;
        }
        std::map<std::string, TypeArg> imap;
        for (std::size_t index = 0; index < argTexts.size(); index += 1) {
          imap[tpl.typeParams[index]] = typeArgFromText(argTexts[index]);
        }
        checkBounds(tpl.typeParams, tpl.typeParamBounds, imap, request);
        InterfaceDecl inst = tpl;
        inst.name = request;
        inst.typeParams.clear();
        inst.typeParamBounds.clear();
        for (Function& method : inst.methods) {
          method.owner = request;
          method.name = request + "::" + shortFunctionName(method.name);
          substFunction(method, imap);
        }
        interfaces_->push_back(inst);
        made += 1;
      }
      /* 方法模板（缺口 5）：类方法 deRfun f[T](...)，请求是方法短名，逐 owner 实例化。
         不同类的同名方法参数个数可以不同：按个数匹配，全都不匹配才报实参数量不对。 */
      {
        std::vector<Function> newMethods;
        for (const Function& tpl : *functionTemplates_) {
          if (tpl.typeParams.empty() || tpl.owner.empty()) continue;
          if (shortFunctionName(tpl.name) != base) continue;
          if (findClass(tpl.owner) == nullptr) continue;
          const std::string instanceName = tpl.owner + "::" + request;
          if (hasFunction(instanceName)) continue;
          if (argTexts.size() != tpl.typeParams.size()) {
            sawWrongArity += 1;
            continue;
          }
          std::map<std::string, TypeArg> mmap;
          for (std::size_t index = 0; index < argTexts.size(); index += 1) {
            mmap[tpl.typeParams[index]] = typeArgFromText(argTexts[index]);
          }
          checkBounds(tpl.typeParams, tpl.typeParamBounds, mmap, request);
          Function copy = tpl;
          copy.name = instanceName;
          copy.typeParams.clear();
          copy.typeParamBounds.clear();
          substFunction(copy, mmap);
          newMethods.push_back(std::move(copy));
          made += 1;
        }
        for (Function& fn : newMethods) {
          functions_->push_back(std::move(fn));
          pending_.push_back(static_cast<int>(functions_->size()) - 1);
        }
      }
      /* 一个实例都没做成、又确实有同名模板：实参个数不对。 */
      if (made == 0 && sawWrongArity > 0) fail("泛型实参数量不对 " + request);
    }
    linkClones();
    return;
    fail("泛型实例化层次太深");
  }

  void Checker::collectInstanceTexts(std::vector<std::string>& texts) {      for (const ClassDecl& decl : *classes_) {
        texts.push_back(decl.base);
        for (const std::string& name : decl.interfaces) texts.push_back(name);
        for (const Field& field : decl.fields) {
          texts.push_back(field.typeName);
          texts.push_back(field.altName);
        }
      }
      for (const InterfaceDecl& decl : *interfaces_) {
        for (const Function& method : decl.methods) {
          texts.push_back(method.retName);
          for (const Param& param : method.params) texts.push_back(param.typeName);
        }
      }
      for (const Function& fn : *functions_) {
        texts.push_back(fn.retName);
        texts.push_back(fn.retAltName);
        for (const Param& param : fn.params) {
          texts.push_back(param.typeName);
          texts.push_back(param.altName);
        }
        std::vector<const Stmt*> stack;
        for (const Stmt& stmt : fn.body) stack.push_back(&stmt);
        while (!stack.empty()) {
          const Stmt* stmt = stack.back();
          stack.pop_back();
          texts.push_back(stmt->typeName);
          texts.push_back(stmt->altName);
          std::vector<const Expr*> exprs;
          exprs.push_back(&stmt->expr);
          for (const Stmt& inner : stmt->body) stack.push_back(&inner);
          for (const Stmt& inner : stmt->other) stack.push_back(&inner);
          while (!exprs.empty()) {
            const Expr* expr = exprs.back();
            exprs.pop_back();
            texts.push_back(expr->typeName);
            texts.push_back(expr->altName);
            if (expr->kind == Expr::Kind::New || expr->kind == Expr::Kind::Call) texts.push_back(expr->text);
            for (const Expr& kid : expr->kids) exprs.push_back(&kid);
          }
        }
      }
}

  void Checker::linkClones() {
    if (pending_.empty()) return;
    std::set<int> pendingSet(pending_.begin(), pending_.end());
    const int total = static_cast<int>(functions_->size());
    for (const int ci : pending_) {
      Function& clone = (*functions_)[static_cast<std::size_t>(ci)];
      std::set<int> visible;
      for (int j = 0; j < total; j += 1) {
        if (j == ci) continue;
        const Function& other = (*functions_)[static_cast<std::size_t>(j)];
        if (other.origin != clone.origin) continue;
        visible.insert(j);
        if (pendingSet.find(j) == pendingSet.end()) {
          (*functions_)[static_cast<std::size_t>(j)].visible.push_back(ci);
        }
      }
      for (int j = 0; j < total; j += 1) {
        if (j == ci || pendingSet.find(j) != pendingSet.end()) continue;
        const Function& other = (*functions_)[static_cast<std::size_t>(j)];
        if (other.origin != clone.origin) continue;
        for (const int v : other.visible) {
          if ((*functions_)[static_cast<std::size_t>(v)].origin != clone.origin) visible.insert(v);
        }
      }
      clone.visible.assign(visible.begin(), visible.end());
    }
    for (const int ci : pending_) {
      for (const int cj : pending_) {
        if (ci == cj) continue;
        Function& clone = (*functions_)[static_cast<std::size_t>(ci)];
        const Function& other = (*functions_)[static_cast<std::size_t>(cj)];
        if (other.origin != clone.origin) continue;
        bool present = false;
        for (const int v : clone.visible) {
          if (v == cj) present = true;
        }
        if (!present) clone.visible.push_back(cj);
      }
    }
    pending_.clear();
  }

}  // namespace sema
}  // namespace obr
