#pragma once

#include "Ast.hpp"
#include "image/Debug.hpp"
#include "Optimization.hpp"

namespace obr {

Generated generate(Unit& unit, const OptimizationOptions& options = {});

}  // namespace obr
