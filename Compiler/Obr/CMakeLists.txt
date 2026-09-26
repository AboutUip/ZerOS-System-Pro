cmake_minimum_required(VERSION 3.16)
project(Obrc LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(obrc
  src/obrc.cpp
  src/Lexer.cpp
  src/Parser.cpp
  src/Sema.cpp
  src/type/Type.cpp
  src/intrinsic/Intrinsic.cpp
  src/codegen/Generate.cpp
  src/codegen/Emit.cpp
  src/codegen/Fold.cpp
  src/codegen/Runtime.cpp
  src/codegen/Inline.cpp
  src/codegen/Lower.cpp
  src/codegen/Math.cpp
  src/codegen/Ui.cpp
  src/image/Write.cpp
)
