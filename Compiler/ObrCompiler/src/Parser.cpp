#include "Parser.hpp"

#include "Lexer.hpp"
#include "parse/ParserImpl.hpp"

namespace obr {

SourceFile parseSource(const std::string& source, bool header) { return parse::Parser(lex(source), header).parseFile(); }

}  // namespace obr
