#pragma once

#include "Ast.hpp"

#include <string>

namespace obr {

SourceFile parseSource(const std::string& source, bool header);

}  // namespace obr
