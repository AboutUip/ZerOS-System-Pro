#pragma once

#include "Ast.hpp"

#include <string>
#include <vector>

namespace obr {

struct Token {
  Tok kind = Tok::End;
  std::string text;
  long long integer = 0;
  double number = 0;
};

std::vector<Token> lex(const std::string& source);

}  // namespace obr
