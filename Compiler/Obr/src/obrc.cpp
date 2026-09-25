#include "Codegen.hpp"
#include "Diagnostic.hpp"
#include "Parser.hpp"
#include "Sema.hpp"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

std::string readFile(const std::string& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) obr::fail("打不开 " + path);
  std::ostringstream buffer;
  buffer << input.rdbuf();
  return buffer.str();
}

void writeFile(const std::string& path, const std::string& text) {
  std::ofstream output(path, std::ios::binary);
  if (!output) obr::fail("写不出 " + path);
  output << text;
}

std::string directoryOf(const std::string& path) {
  const std::size_t slash = path.find_last_of("/\\");
  if (slash == std::string::npos) return ".";
  return path.substr(0, slash);
}

std::string fileName(const std::string& path) {
  const std::size_t slash = path.find_last_of("/\\");
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

bool exists(const std::string& path) {
  std::ifstream input(path, std::ios::binary);
  return static_cast<bool>(input);
}

}  // namespace

int main(int argc, char** argv) {
  try {
    std::vector<std::string> inputs;
    std::string output;
    std::vector<std::string> includes;
    for (int index = 1; index < argc; index += 1) {
      const std::string arg = argv[index];
      if (arg == "-o" && index + 1 < argc) {
        output = argv[++index];
        continue;
      }
      if (arg == "-I" && index + 1 < argc) {
        includes.push_back(argv[++index]);
        continue;
      }
      inputs.push_back(arg);
    }
    if (inputs.empty() || output.empty()) {
      std::cerr << "用法: obrc 文件.obr [更多.obr ...] [-I 头文件目录 ...] -o 文件.zap\n";
      return 2;
    }
    std::vector<obr::SourceFile> sources;
    std::vector<obr::HeaderFile> headers;
    for (const std::string& input : inputs) {
      if (fileName(input).size() < 5 || input.substr(input.size() - 4) != ".obr") {
        obr::fail("只接受 .obr 源文件 " + input);
      }
      obr::SourceFile source = obr::parseSource(readFile(input), false);
      source.path = input;
      sources.push_back(std::move(source));
    }
    for (const obr::SourceFile& source : sources) {
      for (const std::string& imported : source.imports) {
        bool loaded = false;
        for (const obr::HeaderFile& header : headers) {
          if (header.name == imported) loaded = true;
        }
        if (loaded) continue;
        std::string found;
        std::vector<std::string> directories;
        for (const std::string& input : inputs) directories.push_back(directoryOf(input));
        for (const std::string& include : includes) directories.push_back(include);
        for (const std::string& directory : directories) {
          const std::string candidate = directory + "/" + imported + ".mr";
          if (!exists(candidate)) continue;
          if (!found.empty() && found != candidate) obr::fail("模块名对应了两个头文件 " + imported);
          found = candidate;
        }
        if (found.empty()) obr::fail("找不到 " + imported + ".mr");
        obr::SourceFile header = obr::parseSource(readFile(found), true);
        obr::HeaderFile file;
        file.name = imported;
        file.decls = std::move(header.functions);
        headers.push_back(std::move(file));
      }
    }
    obr::Unit unit = obr::combine(std::move(sources), headers);
    obr::check(unit);
    writeFile(output, obr::generate(unit));
    return 0;
  } catch (const obr::Error& error) {
    std::cerr << error.what() << "\n";
    return 1;
  }
}
