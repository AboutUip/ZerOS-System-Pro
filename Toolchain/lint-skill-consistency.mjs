/**
 * lint 单源一致性校验：Compiler/ObrExtension/compilerLint.js 的 scanSyntaxRules 规则表
 * ↔ Documents/Skills/ObrLanguage/SKILL.md 的规则面（「现在接受」到「还没有」各节）。
 * SKILL.md 是语言事实的单源；本脚本保证插件侧 lint 不缺、不多、不与 SKILL 矛盾。
 * 发现不一致时以 SKILL 为准修 Compiler/ObrExtension/ 侧（插件同步），SKILL 不为 lint 改口。
 * 在 Toolchain 执行：node ./lint-skill-consistency.mjs（npm test 已串入）。
 *
 * 比对口径：
 * 1. lint 侧集合：静态解析 compilerLint.js 里 scanSyntaxRules 的函数体，抽出全部
 *    `new vscode.Diagnostic(range, 消息, ...)` 的消息模板，`${...}` 插值归一成 `…`，
 *    一条诊断消息 = 一条 lint 规则。scanLiveDiagnostics 的行首指令检查
 *    （#VERSION / #DYN / #LINK）不在本比对面。
 * 2. SKILL 侧集合：把「## 现在接受」起各节（「还没有」除外）正文按中文句号/分号切成
 *    句子，句中同时命中【标记面】与【规范词】的句子算一条 SKILL 规则条目：
 *    - 标记面（scanSyntaxRules 管辖的表面）：
 *      @Destruct / @Overwrite / @Fails / @Friend / throw / try / catch / fail.of；
 *    - 规范词：必须 / 不能 / 不得 / 只接受 / 拒绝 / 编译失败 / 需要 / 只能 / 至多 / 禁止。
 *    `#VERSION` 门槛句不在标记面里——SKILL 把版本前提写在条目开头（如「失败值（#VERSION 2）」），
 *    由事实表按定向正则跨句取证。
 * 3. 事实表（下方 FACTS）：每条可校验语言事实声明三组正则——
 *    - governs：认领 SKILL 规则条目（句子级，一条句子被任一事实认领即视为有覆盖）；
 *    - evidence：在 SKILL 规则面文本里取语言事实的依据（带 [^。；]* 的正则限同句取证；
 *      版本门槛类允许跨句，因为版本前提写在条目开头）；
 *    - lint：在 lint 规则集合里取对应检查消息。
 *    kind=lint 的事实要求 evidence 与 lint 双侧命中；kind=compiler 的事实只在 SKILL 取证
 *    （该规则由编译器管、五件套回归负责，scanSyntaxRules 不做局部检查）。
 * 4. 报差异即退出码 1，三类标签：
 *    【缺漏】kind=lint 事实 SKILL 有依据而 lint 无对应检查；或 SKILL 规则条目没有被
 *            任何事实认领（比对表需要扩，或确认该条不属 lint 面后登记 compiler 事实）。
 *    【多余】lint 规则集合里有消息不被任何事实认领（插件多出了 SKILL 没有依据的检查）。
 *    【矛盾】事实单侧命中（措辞漂移，两侧对不上）；「还没有」节出现 lint 管辖的标记面
 *            （lint 在强制 SKILL 声明还没有的表面）；或 lint 消息提到「还没有」里的能力。
 * 5. 粒度限制：句子是最小比对单元，句内未被事实 governs 覆盖的次要措辞不单独报警；
 *    消息模板归一后按「正则命中」比较，不比对模板插值部分（如函数名、类名）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const LINT_PATH = path.join(repoRoot, "Compiler", "ObrExtension", "compilerLint.js");
const SKILL_PATH = path.join(repoRoot, "Documents", "Skills", "ObrLanguage", "SKILL.md");

/* 标记面与规范词：决定哪些 SKILL 句子算规则条目（口径第 2 条）。
   sizeof/offsetof/alignof 自 M-A 起进标记面（scanSyntaxRules 有保留名检查）；
   span[ 自 M-B 起进标记面（只认类型形态 span[，裸 span 标识符/调用不算）；
   out/ref 自 M-C 起进标记面（只认独立词，`obr::print::out` 这类限定名不算）。
   volatile 自 M-D 起、atomic/MemoryOrder/memory::fence 自 M-E 起进标记面。 */
const MARKERS = /@(?:Destruct|Overwrite|Fails|Friend)\b|\b(?:throw|try|catch)\b|fail\.of|\b(?:sizeof|offsetof|alignof)\b|span\[|(?<![:.\w])(?:out|ref)\b|\bvolatile\b|\batomic\b|MemoryOrder|memory::fence/;
const NORMATIVE = /必须|不能|不得|只接受|拒绝|编译失败|需要|只能|至多|禁止/;

/* 「还没有」节里声明没有的能力：lint 不得强制、不得提及。 */
const NOT_YET = /宏|多重继承|垃圾回收|JSON|随机数|std::rout|system\.mr/;

const problems = [];
function flag(tag, message) {
  problems.push(`【${tag}】${message}`);
}

/* ---------- lint 侧：解析 scanSyntaxRules 的诊断消息模板 ---------- */

function extractLintRules(source) {
  const start = source.indexOf("function scanSyntaxRules");
  if (start < 0) {
    flag("矛盾", "compilerLint.js 里找不到 scanSyntaxRules，解析口径失效");
    return [];
  }
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end < 0 ? source.length : end);
  const rules = [];
  const pattern = /new vscode\.Diagnostic\(\s*range\s*,\s*(`[^`]*`|"(?:[^"\\]|\\.)*")/g;
  for (const m of body.matchAll(pattern)) {
    const key = m[1]
      .slice(1, -1)
      .replace(/\$\{[^}]*\}/g, "…")
      .replace(/\\(.)/g, "$1");
    rules.push(key);
  }
  return rules;
}

/* ---------- SKILL 侧：切节、切句、筛规则条目 ---------- */

function extractSections(skillText) {
  const body = skillText.replace(/^---[\s\S]*?\r?\n---\r?\n/, "");
  const sections = [];
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections.map((s) => ({ title: s.title, text: s.lines.join("\n") }));
}

function splitSentences(text) {
  return text
    .split(/[。；]/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/* ---------- 事实表（口径第 3 条） ---------- */

const FACTS = [
  {
    id: "overwrite-v2",
    kind: "lint",
    desc: "@Overwrite 需要 #VERSION 2",
    governs: /@Overwrite[^。；]*需要\s*`?#VERSION 2/,
    evidence: [/@Overwrite[^。；]*需要\s*`?#VERSION 2/],
    lint: [/需要 #VERSION 2/],
  },
  {
    id: "dtor-v2",
    kind: "lint",
    desc: "@Destruct 需要 #VERSION 2",
    governs: /@Destruct[^。；]*需要\s*`?#VERSION 2/,
    evidence: [/@Destruct[^。；]*需要\s*`?#VERSION 2/],
    lint: [/需要 #VERSION 2/],
  },
  {
    id: "fails-v2",
    kind: "lint",
    desc: "@Fails 属失败值面，失败值需要 #VERSION 2",
    governs: null,
    evidence: [/失败值\*{0,2}（`#VERSION 2`）/, /@Fails/],
    lint: [/需要 #VERSION 2/],
  },
  {
    id: "throw-v2",
    kind: "lint",
    desc: "throw / try / catch 需要 #VERSION 2",
    governs: null,
    evidence: [/失败值\*{0,2}（`#VERSION 2`）/, /\bthrow\b[\s\S]{0,400}?\btry\b[\s\S]{0,400}?\bcatch\b/],
    lint: [/throw \/ try \/ catch 需要 #VERSION 2/],
  },
  {
    id: "fail-value-v2",
    kind: "lint",
    desc: "失败值（fail.of / catch(fail)）需要 #VERSION 2",
    governs: null,
    evidence: [/失败值\*{0,2}（`#VERSION 2`）/, /fail\.of/],
    lint: [/失败值需要 #VERSION 2/],
  },
  {
    id: "dtor-no-params",
    kind: "lint",
    desc: "@Destruct 零参",
    governs: /@Destruct[^。；]*零参/,
    evidence: [/@Destruct[^。；]*零参/],
    lint: [/@Destruct 必须没有参数/],
  },
  {
    id: "dtor-void",
    kind: "lint",
    desc: "@Destruct 返回 void",
    governs: /@Destruct[^。；]*`: void`/,
    evidence: [/@Destruct[^。；]*`: void`/],
    lint: [/@Destruct 必须返回 void/],
  },
  {
    id: "dtor-single",
    kind: "lint",
    desc: "@Destruct 每类至多一个",
    governs: /@Destruct[^。；]*每类至多一个/,
    evidence: [/@Destruct[^。；]*每类至多一个/],
    lint: [/每类至多一个/],
  },
  {
    id: "dtor-not-overwrite",
    kind: "lint",
    desc: "@Destruct 不能同时 @Overwrite",
    governs: /不能同时 `@Overwrite`/,
    evidence: [/不能同时 `@Overwrite`/],
    lint: [/@Destruct 不能同时 @Overwrite/],
  },
  {
    id: "dtor-not-ctor",
    kind: "lint",
    desc: "@Destruct 不能写在构造上",
    governs: /@Destruct[^。；]*不能写在构造上/,
    evidence: [/@Destruct[^。；]*不能写在构造上/],
    lint: [/@Destruct 不能写在构造上/],
  },
  {
    id: "fails-not-dtor",
    kind: "lint",
    desc: "@Fails 不能标在析构上",
    governs: /不能标在析构上/,
    evidence: [/不能标在析构上/],
    lint: [/@Fails 不能标在析构上/],
  },
  {
    id: "friend-args",
    kind: "lint",
    desc: "@Friend 只接受类名列表",
    governs: /@Friend\(类名/,
    evidence: [/@Friend\(类名/],
    lint: [/@Friend 只接受类名列表/],
  },
  {
    id: "friend-class-only",
    kind: "lint",
    desc: "@Friend 列出的必须是类",
    governs: /@Friend` 列出的必须是类/,
    evidence: [/@Friend` 列出的必须是类/],
    lint: [/@Friend 只接受类名列表/],
  },
  {
    id: "fails-consistency",
    kind: "compiler",
    desc: "接口实现的失败性必须与接口一致，基类构造可失败时派生构造也要标 @Fails",
    governs: /失败性必须与接口一致/,
    evidence: [/失败性必须与接口一致/],
  },
  {
    id: "ctor-not-overwritten",
    kind: "compiler",
    desc: "构造不能被覆盖（@Overwrite 写在构造上编译失败）",
    governs: /构造不能被覆盖/,
    evidence: [/构造不能被覆盖/],
  },
  {
    id: "layout-builtin",
    kind: "compiler",
    desc: "sizeof/offsetof/alignof 编译期内建：折常量、单位是位、槽跨度与值自然宽度之别（编译器管，regress 钉入）",
    governs: /\b(?:sizeof|offsetof|alignof)\b/,
    evidence: [/`sizeof\(T\)`/, /sizeof 是槽跨度/, /alignof 是值自然宽度/, /单位是位/],
  },
  {
    id: "layout-reserved",
    kind: "lint",
    desc: "sizeof/offsetof/alignof 保留给编译期内建，用户函数/常量不得同名",
    governs: /保留给编译期内建/,
    evidence: [/保留给编译期内建/],
    lint: [/保留给编译期内建/],
  },
  {
    id: "span-element",
    kind: "lint",
    desc: "span[T] 元素类型只接受标量和指针（string/集合/void/嵌套 span 静态报错；结构体/接口/类名由编译器管）",
    governs: /`span\[T\]` 元素类型只接受标量和指针/,
    evidence: [/`span\[T\]` 元素类型只接受标量和指针/],
    lint: [/span 的元素类型只接受标量和指针/],
  },
  {
    id: "span-ctor-address",
    kind: "compiler",
    desc: "span[T](地址, 个数) 构造：地址来源必须是指针或整数位址（编译器管，regress 钉入）",
    governs: /构造 `span\[T\]\(地址, 个数\)`[^。；]*必须是指针或整数位址/,
    evidence: [/构造 `span\[T\]\(地址, 个数\)`[^。；]*必须是指针或整数位址/],
  },
  /* M-C：out/ref 形参（多返回值）。标记面自 M-C 起收 out/ref 独立词；
     下列事实共用宽 governs（同 layout-builtin 先例），evidence 按各自事实取证。 */
  {
    id: "out-ref-abi",
    kind: "compiler",
    desc: "out/ref ABI 逐位等于 long* + &x（同一地址字槽，与存量 long* 互调）",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/ABI 逐位等于 `long\*` \+ `&x`/, /同一参数槽/, /都走同一槽/],
  },
  {
    id: "out-ref-lvalue",
    kind: "compiler",
    desc: "out/ref 实参必须是可赋值左值（变量/字段/下标/*指针），字面量与表达式拒绝",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/实参必须是可赋值左值/, /out\/ref 形参的实参必须是可赋值左值/],
  },
  {
    id: "out-ref-write-only",
    kind: "compiler",
    desc: "out 只写、ref 读写；out 形参名当值用编译失败",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/`out` 是只写/, /`ref` 是读写/, /out 形参只能写，不能读/],
  },
  {
    id: "out-ref-signature",
    kind: "compiler",
    desc: "修饰词进签名（重载/接口实现/覆盖比对区分 out/ref/无修饰）与 mangling（pointee 同修）",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/修饰词进签名/, /都进 mangling/],
  },
  {
    id: "out-ref-fails-inline",
    kind: "compiler",
    desc: "out/ref 形参函数禁止内联；@Fails + out 失败路径不写出参",
    governs: /(?<![:.\w])(?:out|ref)\b|@Fails/,
    evidence: [/禁止内联/, /失败路径不写出参/],
  },
  {
    id: "out-ref-tptr",
    kind: "compiler",
    desc: "出参类型可以是任意一层指针（out Node* 是 Node** 场景正解），T** 仍拒绝",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/任意一层指针/, /`T\*\*` 语法仍拒绝/],
  },
  {
    id: "out-span",
    kind: "compiler",
    desc: "out span[byte] 出参形态启用（M-B 决定 3 的启用点）",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/`out span\[byte\]` 可用/, /整值写回/],
  },
  {
    id: "out-window-slots",
    kind: "compiler",
    desc: "窗口槽登记表：服务号→+128..+320 槽用途，新增服务必须登记（现存约定不动）",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/新增服务必须登记/, /fd@/],
  },
  {
    id: "out-ref-param-only",
    kind: "lint",
    desc: "out/ref 只修饰参数类型（返回类型/字段/变量类型不带），插件静态检查",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/只修饰参数类型/],
    lint: [/out\/ref 只修饰参数类型/],
  },
  {
    id: "out-ref-no-void",
    kind: "lint",
    desc: "out/ref 形参不能是 void，插件静态检查",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/出参形参不能是 `void`/],
    lint: [/out\/ref 形参不能是 void/],
  },
  {
    id: "out-ref-no-tptr",
    kind: "lint",
    desc: "out/ref 形参不能写 T**（只接受一层指针），插件静态检查",
    governs: /(?<![:.\w])(?:out|ref)\b/,
    evidence: [/也不能写 `T\*\*`/],
    lint: [/不能写 T\*\*/],
  },
  /* M-D：volatile 指针（MMIO/共享字访问面）。M-E：obr::atomic / MemoryOrder / memory::fence。
     共用宽 governs（同 out-ref 先例），evidence 按各自事实取证。 */
  {
    id: "volatile-scalar-pointee",
    kind: "lint",
    desc: "volatile 指针的点类型只接受单字标量（结构体/类名点类型要符号表，编译器管）",
    governs: /\bvolatile\b/,
    evidence: [/点类型只接受单字标量/],
    lint: [/volatile 指针的点类型只能是单字标量/],
  },
  {
    id: "volatile-pointer-only",
    kind: "lint",
    desc: "volatile 只能修饰指针类型（要写 volatile T*），插件静态检查",
    governs: /\bvolatile\b/,
    evidence: [/只能修饰指针类型/],
    lint: [/volatile 只能修饰指针类型/],
  },
  {
    id: "volatile-conversion",
    kind: "compiler",
    desc: "volatile↔普通指针隐式互转拒绝，同点类型显式转换才放行；无关指针不能互转",
    governs: /\bvolatile\b/,
    evidence: [/不能隐式互转/, /显式转换/, /无关指针不能互转/],
  },
  {
    id: "volatile-peephole",
    kind: "compiler",
    desc: "Peephole 对 volatile 面全关（合并/删读/转发/折叠四个危险优化屏蔽；无重排器，不可重排已成立）",
    governs: /\bvolatile\b/,
    evidence: [/四个危险优化/, /全部屏蔽/, /没有重排器/],
  },
  {
    id: "volatile-dual-track",
    kind: "compiler",
    desc: "volatile 是语义、硬件白名单是仿真内部保险，双轨不互相替代",
    governs: /\bvolatile\b/,
    evidence: [/是语义/, /是仿真内部保险/],
  },
  {
    id: "atomic-signature",
    kind: "compiler",
    desc: "obr::atomic 签名面：volatile long* 地址参数、cas/fetchAdd 返回旧值",
    governs: /\batomic\b/,
    evidence: [/地址参数必须是 `volatile long\*`/, /返回旧值/],
  },
  {
    id: "atomic-align",
    kind: "compiler",
    desc: "原子常量位址必须 64 位对齐，非对齐编译拒绝",
    governs: /\batomic\b/,
    evidence: [/常量位址必须 64 位对齐/],
  },
  {
    id: "atomic-order",
    kind: "lint",
    desc: "内存序三档（Acquire/Release/SeqCst），不提供 relaxed；序必须写 MemoryOrder 常量（编译期标注）",
    governs: /MemoryOrder/,
    evidence: [/三档/, /不提供 relaxed/, /必须写 MemoryOrder 的常量/],
    lint: [/内存序只有 Acquire\/Release\/SeqCst 三档/],
  },
  {
    id: "fence-semantics",
    kind: "compiler",
    desc: "memory::fence = release+acquire 全屏障一档，运行时下限轻量 svc（不加 CPU 指令）",
    governs: /memory::fence/,
    evidence: [/release\+acquire 全屏障/, /只有一档/, /轻量 svc/],
  },
  {
    id: "atomic-fence-runtime",
    kind: "compiler",
    desc: "运行时余量：cas/fetchAdd 信箱服务、fence svc、acquire/release 动作落地前调用是停机桩（imported 约定）",
    governs: /停机桩|运行时余量/,
    evidence: [/都是运行时余量/, /编译成停机桩/],
  },
  {
    id: "boundary-table",
    kind: "compiler",
    desc: "不可恢复停机 vs 失败值边界表（编译拒绝/失败值/停机桩/硬件值域分界）",
    governs: /不可恢复停机/,
    evidence: [/### 不可恢复停机 vs 失败值/],
  },
];

/* ---------- 比对 ---------- */

const lintSource = fs.readFileSync(LINT_PATH, "utf8");
const skillSource = fs.readFileSync(SKILL_PATH, "utf8");

const lintRules = extractLintRules(lintSource);
if (lintRules.length === 0) {
  flag("矛盾", "scanSyntaxRules 一条诊断消息都没解析出来（解析口径或函数体变化）");
}

const sections = extractSections(skillSource);
if (sections.length === 0) {
  flag("矛盾", "SKILL.md 里没有解析出 ## 小节");
}
const notYet = sections.find((s) => s.title === "还没有");
const ruleSections = sections.filter((s) => s.title !== "还没有");
const ruleText = ruleSections.map((s) => s.text).join("\n");
const sentences = ruleSections.flatMap((s) => splitSentences(s.text).map((text) => ({ section: s.title, text })));
const candidates = sentences.filter((s) => MARKERS.test(s.text) && NORMATIVE.test(s.text));

/* 1) 事实逐条比对（缺漏 / 矛盾）。 */
for (const fact of FACTS) {
  const evidenceOk = fact.evidence.every((re) => re.test(ruleText));
  const lintHits = (fact.lint || []).filter((re) => lintRules.some((key) => re.test(key)));
  if (!evidenceOk) {
    flag("矛盾", `事实 ${fact.id}（${fact.desc}）在 SKILL 规则面找不到依据——措辞漂移，以 SKILL 为准核对事实表或插件`);
    continue;
  }
  if (fact.kind === "lint" && lintHits.length === 0) {
    flag("缺漏", `事实 ${fact.id}（${fact.desc}）SKILL 有依据，scanSyntaxRules 没有对应检查`);
  }
}

/* 2) lint 消息都要被事实认领（多余）。 */
for (const key of lintRules) {
  const claimed = FACTS.some((fact) => (fact.lint || []).some((re) => re.test(key)));
  if (!claimed) {
    flag("多余", `scanSyntaxRules 的消息不被任何事实认领：「${key}」——插件多出检查或事实表待补`);
  }
}

/* 3) SKILL 规则条目都要被事实认领（缺漏）。 */
for (const item of candidates) {
  const claimed = FACTS.some((fact) => fact.governs && fact.governs.test(item.text));
  if (!claimed) {
    flag("缺漏", `SKILL「${item.section}」有规则条目未被任何事实认领：「${item.text}」`);
  }
}

/* 4) 「还没有」节：lint 不得强制、不得提及还没有的表面（矛盾）。 */
if (!notYet) {
  flag("缺漏", "SKILL.md 没有「还没有」节");
} else {
  if (/@(?:Destruct|Overwrite|Fails|Friend)\b/.test(notYet.text)) {
    flag("矛盾", `「还没有」节出现 lint 管辖的标记面：「${notYet.text.trim()}」`);
  }
  for (const key of lintRules) {
    if (NOT_YET.test(key)) {
      flag("矛盾", `lint 消息提到「还没有」声明没有的能力：「${key}」`);
    }
  }
}

/* ---------- 汇总 ---------- */

const lintFacts = FACTS.filter((f) => f.kind === "lint").length;
console.log(
  `lint-SKILL 比对：lint 规则 ${lintRules.length} 条，SKILL 规则条目 ${candidates.length} 条，` +
    `事实 ${FACTS.length} 条（lint ${lintFacts} / compiler ${FACTS.length - lintFacts}）`
);
if (problems.length > 0) {
  for (const message of problems) console.error(message);
  console.error(`lint-SKILL 不一致：${problems.length} 处（缺漏/多余/矛盾见上），以 SKILL 为准修插件侧`);
  process.exit(1);
}
console.log("lint-SKILL 一致：无缺漏、无多余、无矛盾");
