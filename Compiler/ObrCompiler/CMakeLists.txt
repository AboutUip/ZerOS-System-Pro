cmake_minimum_required(VERSION 3.16)
project(Obrc LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(obrc
  src/obrc.cpp
  src/Lexer.cpp
  src/Parser.cpp
  src/parse/ParserCore.cpp
  src/parse/ParserType.cpp
  src/parse/ParserDecl.cpp
  src/parse/ParserStmt.cpp
  src/parse/ParserExpr.cpp
  src/Sema.cpp
  src/sema/CheckerCore.cpp
  src/sema/CheckerConst.cpp
  src/sema/CheckerType.cpp
  src/sema/CheckerDecl.cpp
  src/sema/CheckerGeneric.cpp
  src/sema/CheckerStmt.cpp
  src/sema/CheckerExpr.cpp
  src/sema/CheckerAtomic.cpp
  src/type/Type.cpp
  src/intrinsic/Intrinsic.cpp
  src/codegen/Generate.cpp
  src/codegen/Emit.cpp
  src/codegen/Fold.cpp
  src/codegen/Peephole.cpp
  src/codegen/Runtime.cpp
  src/codegen/Collect.cpp
  src/codegen/Inline.cpp
  src/codegen/LowerUtil.cpp
  src/codegen/LowerDtor.cpp
  src/codegen/LowerFail.cpp
  src/codegen/LowerStruct.cpp
  src/codegen/LowerSpan.cpp
  src/codegen/LowerCall.cpp
  src/codegen/LowerExpr.cpp
  src/codegen/LowerStmt.cpp
  src/codegen/LowerAtomic.cpp
  src/codegen/Math.cpp
  src/codegen/Ui.cpp
  src/codegen/UiUtil.cpp
  src/codegen/UiLayout.cpp
  src/codegen/UiValue.cpp
  src/codegen/UiDraw.cpp
  src/codegen/UiState.cpp
  src/codegen/UiRoutineDraw.cpp
  src/codegen/UiRoutineState.cpp
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
