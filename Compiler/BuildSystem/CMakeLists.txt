# Isolated build entry for the Obr host compiler.
# The language compiler sources stay in ../Obr; this directory owns only the
# build configuration, presets and tests.
cmake_minimum_required(VERSION 3.16)
project(ZerOSCompilerBuild LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The compiler sources contain UTF-8 Chinese diagnostics and comments.
if(MSVC)
  add_compile_options(/utf-8)
endif()

enable_testing()

# Source stays in ../Obr. The explicit binary directory keeps all generated
# files under this build system.
add_subdirectory(
  "${CMAKE_CURRENT_SOURCE_DIR}/../Obr"
  "${CMAKE_CURRENT_BINARY_DIR}/Obr"
)

add_test(NAME native-encode-check COMMAND native-encode-check)

add_test(
  NAME obrc-smoke
  COMMAND obrc
    ${CMAKE_CURRENT_SOURCE_DIR}/../Obr/examples/arith.obr
    -o ${CMAKE_CURRENT_BINARY_DIR}/obrc-smoke
)
