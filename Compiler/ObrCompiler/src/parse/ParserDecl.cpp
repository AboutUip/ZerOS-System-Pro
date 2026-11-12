#include "ParserImpl.hpp"

#include "../Diagnostic.hpp"
#include "../type/Type.hpp"

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace parse {

  void Parser::parseTop(SourceFile& file, const std::string& space) {
    if (eat(Tok::Import)) {
      if (header_) fail(".mr 不能 import");
      if (!space.empty()) fail("import 只能写在文件顶层");
      if (!check(Tok::Ident)) fail("import 缺少模块名");
      std::string name = take().text;
      while (eat(Tok::Dot)) {
        if (!check(Tok::Ident)) fail("import 模块名不完整");
        name += ".";
        name += take().text;
      }
      file.imports.push_back(std::move(name));
      expect(Tok::Semi, "import 缺少 ;");
      return;
    }
    if (check(Tok::Namespace)) {
      if (!header_) fail(".obr 不能声明 namespace");
      take();
      if (!check(Tok::Ident)) fail("namespace 缺少名字");
      const std::string name = take().text;
      expect(Tok::LBrace, "namespace 缺少 {");
      const std::string next = space.empty() ? name : space + "::" + name;
      while (!check(Tok::RBrace) && !check(Tok::End)) parseTop(file, next);
      expect(Tok::RBrace, "namespace 缺少 }");
      if (check(Tok::Semi)) fail("namespace 的 } 后面不能写 ;");
      return;
    }
    if (eat(Tok::Interface)) {
      if (header_) fail(".mr 接口声明还没接");
      InterfaceDecl decl = parseInterface(space);
      if (!decl.typeParams.empty()) file.interfaceTemplates.push_back(std::move(decl));
      else file.interfaces.push_back(std::move(decl));
      return;
    }
    if (eat(Tok::Class)) {
      ClassDecl decl = parseClass(file, space);
      if (!decl.typeParams.empty()) file.classTemplates.push_back(std::move(decl));
      else file.classes.push_back(std::move(decl));
      return;
    }
    if (eat(Tok::Struct)) {
      file.structs.push_back(parseStruct(space));
      return;
    }
    if (eat(Tok::Enum)) {
      file.enums.push_back(parseEnum(space));
      return;
    }
    if (eat(Tok::Const)) {
      file.consts.push_back(parseConst(space));
      return;
    }
    std::vector<std::string> callfun;
    bool callfunNone = false;
    bool fails = false;
    std::vector<std::string> classFriends;
    if (eat(Tok::At)) {
      if (!check(Tok::Ident)) fail("特性缺少名字");
      const std::string feature = take().text;
      if (feature == "Overwrite") fail("类方法才能写 @Overwrite");
      if (feature == "Destruct") fail("类方法才能写 @Destruct");
      if (feature == "Friend") {
        expect(Tok::LParen, "@Friend 缺少 (");
        while (!check(Tok::RParen) && !check(Tok::End)) {
          if (!check(Tok::Ident)) fail("@Friend 缺少名字");
          classFriends.push_back(take().text);
          if (!eat(Tok::Comma)) break;
        }
        expect(Tok::RParen, "@Friend 缺少 )");
      } else if (feature == "Fails") {
        fails = true;
      } else if (feature != "Callfun") {
        fail("特性只接受 @Callfun、@Fails 或 @Friend");
      } else {
      expect(Tok::LParen, "@Callfun 缺少 (");
      if (eat(Tok::Not)) {
        expect(Tok::Star, "@Callfun(!*) 写法不对");
        callfunNone = true;
      } else if (!eat(Tok::Star)) {
        while (!check(Tok::RParen) && !check(Tok::End)) {
          std::string item;
          if (!check(Tok::Ident)) fail("@Callfun 缺少文件名");
          item = take().text;
          while (eat(Tok::Dot)) {
            if (!check(Tok::Ident)) fail("@Callfun 文件名不完整");
            item += ".";
            item += take().text;
          }
          callfun.push_back(item);
          if (!eat(Tok::Comma)) break;
        }
      }
      expect(Tok::RParen, "@Callfun 缺少 )");
      }
    }
    /* M4：@Friend(类名...) 只能写在类声明前（授权整类）。 */
    if (check(Tok::Class)) {
      if (!classFriends.empty() && callfun.empty() && !fails && !callfunNone) {
        take();
        ClassDecl friendDecl = parseClass(file, space);
        friendDecl.friends = std::move(classFriends);
        if (!friendDecl.typeParams.empty()) file.classTemplates.push_back(std::move(friendDecl));
        else file.classes.push_back(std::move(friendDecl));
        return;
      }
      fail("类声明前只能写 @Friend(...)");
    }
    if (!classFriends.empty()) fail("@Friend 只能写在类声明或成员前");
    Function function = parseFunction(space);
    function.callfun = std::move(callfun);
    function.callfunNone = callfunNone;
    function.fails = fails;
    if (!function.typeParams.empty()) {
      if (!space.empty()) fail("方法还不能有类型参数");
      file.functionTemplates.push_back(std::move(function));
    } else {
      file.functions.push_back(std::move(function));
    }
  }

  std::string Parser::declaredName(const std::string& space) {
    if (!check(Tok::Ident)) fail("缺少名字");
    std::string name = take().text;
    if (!space.empty()) name = space + "::" + name;
    return name;
  }

  StructDecl Parser::parseStruct(const std::string& space) {
    StructDecl decl;
    decl.name = declaredName(space);
    expect(Tok::LBrace, "struct 缺少 {");
    while (!check(Tok::RBrace) && !check(Tok::End)) {
      if (check(Tok::DeRfun) || check(Tok::Async) || check(Tok::Class) || check(Tok::Struct) || check(Tok::Enum)) fail("结构体里只能写字段");
      /* M4：字段可见性（缺省 public）与成员级 @Friend。 */
      bool isPrivate = false;
      std::vector<std::string> friends;
      for (;;) {
        if (eat(Tok::Private)) {
          isPrivate = true;
          continue;
        }
        if (eat(Tok::Public)) {
          isPrivate = false;
          continue;
        }
        if (!eat(Tok::At)) break;
        if (!check(Tok::Ident)) fail("特性缺少名字");
        const std::string feature = take().text;
        if (feature != "Friend") fail("结构体字段只能写 @Friend");
        expect(Tok::LParen, "@Friend 缺少 (");
        while (!check(Tok::RParen) && !check(Tok::End)) {
          if (!check(Tok::Ident)) fail("@Friend 缺少名字");
          friends.push_back(take().text);
          if (!eat(Tok::Comma)) break;
        }
        expect(Tok::RParen, "@Friend 缺少 )");
      }
      const ParsedType parsed = parseType();
      if (!check(Tok::Ident)) fail("字段缺少名字");
      Field field;
      field.type = parsed.kind;
      field.pointee = parsed.pointee;
      field.volatilePointee = parsed.volatilePointee;
      field.alt = parsed.alt;
      field.typeName = parsed.typeName;
      field.altName = parsed.altName;
      field.name = take().text;
      field.isPrivate = isPrivate;
      field.friends = std::move(friends);
      for (const Field& earlier : decl.fields) {
        if (earlier.name == field.name) fail("字段重复 " + field.name);
      }
      decl.fields.push_back(field);
      expect(Tok::Semi, "字段缺少 ;");
    }
    if (decl.fields.empty()) fail("结构体至少要有一个字段");
    expect(Tok::RBrace, "struct 缺少 }");
    return decl;
  }

  ConstDecl Parser::parseConst(const std::string& space) {
    ConstDecl decl;
    const ParsedType parsed = parseType();
    decl.type = parsed.kind;
    decl.pointee = parsed.pointee;
    decl.volatilePointee = parsed.volatilePointee;
    decl.alt = parsed.alt;
    decl.typeName = parsed.typeName;
    decl.altName = parsed.altName;
    if (decl.type == TypeKind::Void) fail("常量不能是 void");
    decl.name = declaredName(space);
    expect(Tok::Assign, "常量缺少 =");
    decl.expr = parseExpr();
    expect(Tok::Semi, "常量缺少 ;");
    decl.line = tokens_[static_cast<std::size_t>(at_ - 1)].line;
    return decl;
  }

  EnumDecl Parser::parseEnum(const std::string& space) {
    EnumDecl decl;
    decl.name = declaredName(space);
    decl.underlying = TypeKind::Int;
    if (eat(Tok::Colon)) {
      if (!check(Tok::Ident)) fail("enum 缺少底层类型");
      const std::string underlying = take().text;
      if (underlying == "int") decl.underlying = TypeKind::Int;
      else if (underlying == "long") decl.underlying = TypeKind::Long;
      else fail("枚举底层类型只能是 int 或 long");
    }
    expect(Tok::LBrace, "enum 缺少 {");
    while (!check(Tok::RBrace) && !check(Tok::End)) {
      if (!check(Tok::Ident)) fail("枚举值缺少名字");
      EnumValue item;
      item.name = take().text;
      for (const EnumValue& earlier : decl.values) {
        if (earlier.name == item.name) fail("枚举值重复 " + item.name);
      }
      if (eat(Tok::Assign)) {
        /* M-A：枚举值放开到常量表达式——解析期只存初始化式，Sema 的 layoutEnums
           按声明序经 constantValue 折值（可写 sizeof/offsetof/alignof、枚举值、常量运算）。
           int 枚举直接写 L 后缀 long 字面量仍拒绝（存量口径，含负号形态）。 */
        item.init = parseExpr();
        item.hasInit = true;
        const Expr* probe = &item.init;
        if (probe->kind == Expr::Kind::Unary && probe->op == Tok::Minus && probe->kids.size() == 1) probe = &probe->kids[0];
        if (decl.underlying == TypeKind::Int && probe->kind == Expr::Kind::LitInt && probe->type == TypeKind::Long) {
          fail("int 枚举不能写 long 常量");
        }
      }
      decl.values.push_back(item);
      if (!eat(Tok::Comma)) break;
    }
    if (decl.values.empty()) fail("枚举至少要有一个值");
    expect(Tok::RBrace, "enum 缺少 }");
    return decl;
  }

  InterfaceDecl Parser::parseInterface(const std::string& space) {
    if (!check(Tok::Ident)) fail("interface 缺少名字");
    InterfaceDecl decl;
    decl.name = declaredName(space);
    /* 缺口 5：泛型接口 interface I[T, U]；约束 `T : 基类`。 */
    if (check(Tok::LBracket)) {
      take();
      parseTypeParams(decl.typeParams, decl.typeParamBounds);
    }
    expect(Tok::LBrace, "interface 缺少 {");
    while (!check(Tok::RBrace) && !check(Tok::End)) {
      /* M3：接口方法可以标 @Fails（实现的失败性必须一致）。 */
      bool fails = false;
      if (eat(Tok::At)) {
        if (!check(Tok::Ident)) fail("特性缺少名字");
        const std::string feature = take().text;
        if (feature != "Fails") fail("接口方法只能写 @Fails");
        fails = true;
      }
      if (!check(Tok::DeRfun)) fail("interface 里只能写 deRfun 方法声明");
      Function method = parseFunction(decl.name, true);
      method.owner = decl.name;
      method.fails = fails;
      if (!method.typeParams.empty()) fail("接口方法不能带类型参数");
      decl.methods.push_back(std::move(method));
    }
    expect(Tok::RBrace, "interface 缺少 }");
    return decl;
  }

  ClassDecl Parser::parseClass(SourceFile& file, const std::string& space) {
    if (!check(Tok::Ident)) fail("class 缺少名字");
    ClassDecl decl;
    decl.name = declaredName(space);
    /* M5：泛型类型参数 class Name[T, U]；缺口 5：约束 `T : 基类`。 */
    if (check(Tok::LBracket)) {
      take();
      parseTypeParams(decl.typeParams, decl.typeParamBounds);
    }
    if (eat(Tok::Colon)) {
      if (!check(Tok::Ident)) fail("继承缺少基类名字");
      decl.base = take().text;
      /* M5：基类也可以是实例化泛型 class Sub : Base[int]。 */
      if (check(Tok::LBracket)) {
        take();
        decl.base += typeArgsText();
      }
      if (check(Tok::Comma)) fail("不支持多重继承，多个基类不能同时从偏移 0 开始");
    }
    if (eat(Tok::Implements)) {
      do {
        if (!check(Tok::Ident)) fail("implements 缺少接口名字");
        decl.interfaces.push_back(take().text);
        /* 缺口 5：实现的也可以是实例化泛型接口 implements I[int]。 */
        if (check(Tok::LBracket)) {
          take();
          decl.interfaces.back() += typeArgsText();
        }
      } while (eat(Tok::Comma));
    }
    expect(Tok::LBrace, "class 缺少 {");
    int offset = 0;
    while (!check(Tok::RBrace) && !check(Tok::End)) {
      std::vector<std::string> callfun;
      bool callfunNone = false;
      bool overwrite = false;
      bool destruct = false;
      bool fails = false;
      std::vector<std::string> friends;
      bool isPrivate = false;
      /* 成员前缀：可见性（M4）与特性（@...）交错，后写的可见性生效。 */
      for (;;) {
        if (eat(Tok::Private)) {
          isPrivate = true;
          continue;
        }
        if (eat(Tok::Public)) {
          isPrivate = false;
          continue;
        }
        if (!eat(Tok::At)) break;
        if (!check(Tok::Ident)) fail("特性缺少名字");
        const std::string feature = take().text;
        if (feature == "Overwrite") {
          overwrite = true;
          continue;
        }
        if (feature == "Destruct") {
          destruct = true;
          continue;
        }
        if (feature == "Fails") {
          fails = true;
          continue;
        }
        if (feature == "Friend") {
          expect(Tok::LParen, "@Friend 缺少 (");
          while (!check(Tok::RParen) && !check(Tok::End)) {
            if (!check(Tok::Ident)) fail("@Friend 缺少名字");
            friends.push_back(take().text);
            if (!eat(Tok::Comma)) break;
          }
          expect(Tok::RParen, "@Friend 缺少 )");
          continue;
        }
        if (feature != "Callfun") fail("特性只接受 @Callfun、@Overwrite、@Destruct、@Fails 或 @Friend");
        expect(Tok::LParen, "@Callfun 缺少 (");
        if (eat(Tok::Not)) {
          expect(Tok::Star, "@Callfun(!*) 写法不对");
          callfunNone = true;
        } else if (!eat(Tok::Star)) {
          while (!check(Tok::RParen) && !check(Tok::End)) {
            if (!check(Tok::Ident)) fail("@Callfun 缺少文件名");
            std::string item = take().text;
            while (eat(Tok::Dot)) {
              if (!check(Tok::Ident)) fail("@Callfun 文件名不完整");
              item += ".";
              item += take().text;
            }
            callfun.push_back(item);
            if (!eat(Tok::Comma)) break;
          }
        }
        expect(Tok::RParen, "@Callfun 缺少 )");
      }
      if (check(Tok::DeRfun) || check(Tok::Async) || !callfun.empty() || callfunNone || overwrite || destruct || fails) {
        Function method = parseFunction(decl.name);
        method.owner = decl.name;
        method.callfun = std::move(callfun);
        method.callfunNone = callfunNone;
        method.overwrite = overwrite;
        method.destruct = destruct;
        method.fails = fails;
        method.isPrivate = isPrivate;
        method.friends = std::move(friends);
        Param self;
        self.type = TypeKind::None;
        self.typeName = decl.name;
        self.name = "this";
        method.params.insert(method.params.begin(), self);
        if (!decl.typeParams.empty() || !method.typeParams.empty()) file.functionTemplates.push_back(std::move(method));
        else file.functions.push_back(std::move(method));
        continue;
      }
      const ParsedType parsed = parseType();
      if (!check(Tok::Ident)) fail("字段缺少名字");
      Field field;
      field.type = parsed.kind;
      field.pointee = parsed.pointee;
      field.volatilePointee = parsed.volatilePointee;
      field.alt = parsed.alt;
      field.typeName = parsed.typeName;
      field.altName = parsed.altName;
      field.name = take().text;
      field.isPrivate = isPrivate;
      field.friends = std::move(friends);
      field.offset = offset;
      offset += 64;
      decl.fields.push_back(field);
      expect(Tok::Semi, "字段缺少 ;");
    }
    expect(Tok::RBrace, "class 缺少 }");
    return decl;
  }

  Function Parser::parseFunction(const std::string& space, bool signatureOnly) {
    const bool exported = eat(Tok::Export);
    const bool asyncFun = eat(Tok::Async);
    Function function;
    function.line = peek().line;
    expect(Tok::DeRfun, header_ ? ".mr 里只能声明函数头、namespace、struct 或 enum" : "顶层只能是 import、class、struct、enum 或 deRfun");
    const std::string written = qualified();
    function.name = space.empty() ? written : space + "::" + written;
    /* M5：泛型类型参数 deRfun name[T, U](...)；缺口 5：约束 `T : 基类`、类方法可带。 */
    if (check(Tok::LBracket)) {
      take();
      parseTypeParams(function.typeParams, function.typeParamBounds);
    }
    function.exported = exported;
    function.asyncFun = asyncFun;
    expect(Tok::LParen, "函数参数缺少 (");
    if (!check(Tok::RParen)) {
      do {
        Param param;
        /* M-C：`out` / `ref` 前缀修饰参数类型（out = 只写、ref = 读写；ABI = 一个地址字）。 */
        param.mode = takeParamModifier();
        const ParsedType parsed = parseType();
        param.type = parsed.kind;
        param.pointee = parsed.pointee;
        param.volatilePointee = parsed.volatilePointee;
        param.alt = parsed.alt;
        param.typeName = parsed.typeName;
        param.altName = parsed.altName;
        if (param.type == TypeKind::Void) fail("参数不能是 void");
        if (!check(Tok::Ident)) fail("参数缺少名字");
        param.name = take().text;
        function.params.push_back(param);
      } while (eat(Tok::Comma));
    }
    expect(Tok::RParen, "参数列表缺少 )");
    expect(Tok::Colon, "函数缺少返回类型");
    const ParsedType ret = parseType();
    function.ret = ret.kind;
    function.retPointee = ret.pointee;
    function.retVolatilePointee = ret.volatilePointee;
    function.retAlt = ret.alt;
    function.retName = ret.typeName;
    function.retAltName = ret.altName;
    if (header_ || signatureOnly) {
      expect(Tok::Semi, "函数头必须以 ; 结束");
      return function;
    }
    if (check(Tok::Semi)) fail(".obr 里的 deRfun 必须有函数体，函数头写在 .mr");
    expect(Tok::LBrace, "函数体缺少 {");
    while (!check(Tok::RBrace) && !check(Tok::End)) function.body.push_back(parseStmt());
    expect(Tok::RBrace, "函数体缺少 }");
    return function;
  }

}  // namespace parse
}  // namespace obr
