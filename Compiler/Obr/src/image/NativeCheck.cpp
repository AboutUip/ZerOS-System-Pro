#include "Native.hpp"

#include "../Utf8.hpp"

#include <iostream>

int main() {
  if (!obr::nativeEncodeSelfCheck()) {
    std::cerr << "native encode check failed\n";
    return 1;
  }
  if (!obr::utf8LiteralSelfCheck()) {
    std::cerr << "utf-8 literal check failed\n";
    return 1;
  }
  return 0;
}
