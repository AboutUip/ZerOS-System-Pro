#pragma once

namespace obr {

enum class Tok {
  End, Ident, Int, Float, StringLit, CharLit, True, False, Null, Undefined,
  LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Colon, Semi, Question,
  Plus, Minus, Star, Slash, Percent, Pow, Not, BitNot,
  Eq, Ne, Lt, Le, Gt, Ge, And, Or, BitAnd, BitOr, BitXor,
  Shl, Shr, UShr, Assign, PlusEq, MinusEq, StarEq, SlashEq, PercentEq,
  PlusPlus, MinusMinus,
  If, Else, Switch, Case, Default, Fallthrough, While, For, Break, Continue, Return, Goto, DeRfun, Import, Namespace, Static, Public, Private, Var, Const, Export, Zap, Version, Link, Dyn, Scope,
  Class, Interface, Implements, Struct, Enum, New, Async, Await, At, Dot
};

}  // namespace obr
