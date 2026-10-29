#pragma once

#include <stdexcept>
#include <string>

namespace obr {

class Error : public std::runtime_error {
 public:
  explicit Error(const std::string& message) : std::runtime_error(message) {}
};

[[noreturn]] inline void fail(const std::string& message) { throw Error(message); }

}  // namespace obr
