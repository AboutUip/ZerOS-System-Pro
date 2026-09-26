#pragma once

#include "../Ast.hpp"

#include <string>

namespace obr {

struct OpcodeSpec {
  const char* name;
  const char* opcode;
  TypeKind ret;
  int count;
  int arg0;
  bool resultR6;
  bool copyLast;
};

const OpcodeSpec* opcodeSpec(const std::string& name);
void bindOpcode(Function& function);
bool libraryFunction(const Function& function);

}  // namespace obr
