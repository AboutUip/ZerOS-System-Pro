#pragma once

#include <string>

namespace obr {

/** 把 ZAP 文本收成无扩展名程序二进制。标号和 call 先展开，CPU 不再解析助记符。 */
void writeProgramBinary(const std::string& path, const std::string& zapText);

}  // namespace obr
