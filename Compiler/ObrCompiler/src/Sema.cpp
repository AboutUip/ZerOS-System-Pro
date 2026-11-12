#include "Sema.hpp"

#include "Diagnostic.hpp"
#include "intrinsic/Intrinsic.hpp"
#include "sema/Checker.hpp"
#include "type/Type.hpp"

#include <map>
#include <string>
#include <vector>

namespace obr {


void check(Unit& unit) { sema::Checker{}.run(unit); }

std::string paramSignature(const Function& function) {
  std::string text = function.name + "(";
  for (std::size_t index = 0; index < function.params.size(); index += 1) {
    if (index > 0) text += ",";
    const Param& param = function.params[index];
    /* M-C：out/ref 修饰词与 pointee 都进签名（`f(out long)` 与 `f(long)` 是两个函数）。 */
    text += typeText(param.type, param.typeName, param.alt, param.altName, param.pointee, param.volatilePointee, param.mode);
  }
  text += ")";
  return text;
}

std::string signatureOf(const Function& function) {
  return paramSignature(function) + ":" + typeText(function.ret, function.retName, function.retAlt, function.retAltName, function.retPointee, function.retVolatilePointee);
}

bool sameSignature(const Function& left, const Function& right) { return signatureOf(left) == signatureOf(right); }

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

bool findClassName(const Unit& unit, const std::string& name) {
  for (const ClassDecl& decl : unit.classes) {
    if (decl.name == name) return true;
  }
  return false;
}

bool findStructName(const Unit& unit, const std::string& name) {
  for (const StructDecl& decl : unit.structs) {
    if (decl.name == name) return true;
  }
  return false;
}

bool findEnumName(const Unit& unit, const std::string& name) {
  for (const EnumDecl& decl : unit.enums) {
    if (decl.name == name) return true;
  }
  return false;
}

bool findInterfaceName(const Unit& unit, const std::string& name) {
  for (const InterfaceDecl& decl : unit.interfaces) {
    if (decl.name == name) return true;
  }
  return false;
}

bool typeTaken(const Unit& unit, const std::string& name) {
  return findClassName(unit, name) || findStructName(unit, name) || findEnumName(unit, name) || findInterfaceName(unit, name);
}

Unit combine(std::vector<SourceFile> sources, const std::vector<HeaderFile>& headers) {
  Unit unit;
  bool sawVersion1 = false;
  bool sawVersion2 = false;
  for (const SourceFile& source : sources) {
    if (source.version == 1) sawVersion1 = true;
    else if (source.version == 2) sawVersion2 = true;
    else fail("#VERSION 只接受语言版本 1 或 2");
  }
  if (sawVersion1 && sawVersion2) fail("同一个编译单元不能混用 #VERSION 1 和 #VERSION 2");
  unit.version = sawVersion2 ? 2 : 1;
  auto addConstant = [&](const ConstDecl& decl) {
    for (const ConstDecl& earlier : unit.consts) {
      if (earlier.name == decl.name) fail("常量重复 " + decl.name);
    }
    unit.consts.push_back(decl);
  };
  for (const HeaderFile& header : headers) {
    for (const ConstDecl& decl : header.consts) addConstant(decl);
  }
  for (const SourceFile& source : sources) {
    for (const InterfaceDecl& decl : source.interfaces) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.interfaces.push_back(decl);
    }
    for (const InterfaceDecl& decl : source.interfaceTemplates) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.interfaceTemplates.push_back(decl);
    }
    for (const ClassDecl& decl : source.classes) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.classes.push_back(decl);
    }
    for (const ClassDecl& decl : source.classTemplates) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.classTemplates.push_back(decl);
    }
    for (Function fn : source.functionTemplates) {
      fn.origin = source.path;
      fn.links = source.links;
      unit.functionTemplates.push_back(fn);
    }
    for (const StructDecl& decl : source.structs) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.structs.push_back(decl);
    }
    for (const EnumDecl& decl : source.enums) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.enums.push_back(decl);
    }
    for (const ConstDecl& decl : source.consts) addConstant(decl);
  }
  for (const HeaderFile& header : headers) {
    for (const StructDecl& decl : header.structs) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.structs.push_back(decl);
    }
    for (const EnumDecl& decl : header.enums) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.enums.push_back(decl);
    }
  }
  for (SourceFile& source : sources) {
    std::map<std::string, int> seen;
    for (Function& function : source.functions) {
      function.origin = source.path;
      function.links = source.links;
      bindOpcode(function);
      /* 返回类型不参与重载。参数类型或个数不同才是另一份函数。 */
      const std::string key = paramSignature(function);
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
        if (matches > 1) fail("函数头重复 " + function.name);
      }
      unit.functions.push_back(std::move(function));
    }
  }
  for (const HeaderFile& header : headers) {
    for (const Function& decl : header.decls) {
      const bool opcode = opcodeSpec(decl.name) != nullptr;
      const bool library = libraryFunction(decl);
      bool wanted = false;
      if (!opcode && !library) {
        for (const SourceFile& source : sources) {
          if (!source.dyn) continue;
          for (const std::string& imported : source.imports) {
            if (imported == header.name) wanted = true;
          }
        }
        if (!wanted) continue;
      }
      bool defined = false;
      for (const Function& function : unit.functions) {
        if (sameSignature(function, decl)) defined = true;
      }
      if (defined) {
        if (opcode || library) fail(library ? "库函数不能再写函数体 " + decl.name : "指令不能再写函数体 " + decl.name);
        continue;
      }
      Function function = decl;
      function.origin = header.name;
      if (library) function.opcode = "library";
      else if (opcode) bindOpcode(function);
      else function.imported = true;
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
