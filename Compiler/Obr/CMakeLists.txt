cmake_minimum_required(VERSION 3.16)
project(Obrc LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(obrc
  src/obrc.cpp
  src/Lexer.cpp
  src/Parser.cpp
  src/Sema.cpp
  src/Codegen.cpp
)
