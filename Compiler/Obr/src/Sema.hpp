#pragma once

#include "Ast.hpp"

namespace obr {

void check(Unit& unit);
Unit combine(std::vector<SourceFile> sources, const std::vector<HeaderFile>& headers);

}  // namespace obr
