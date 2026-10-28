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
  src/codegen/Peephole.cpp
  src/codegen/Runtime.cpp
  src/codegen/Collect.cpp
  src/codegen/Inline.cpp
  src/codegen/Lower.cpp
  src/codegen/Math.cpp
  src/codegen/Ui.cpp
  src/codegen/Font.cpp
  src/image/Write.cpp
  src/image/Native.cpp
  src/image/NativeImage.cpp
)
add_executable(native-encode-check
  src/image/Native.cpp
  src/image/NativeCheck.cpp
)
# Vite 在本目录找 obrc / obrc.exe，不看 build/。多配置生成器默认再套一层 Debug/Release，所以每一档都指回这里。
set_target_properties(obrc PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_CURRENT_SOURCE_DIR}"
)
