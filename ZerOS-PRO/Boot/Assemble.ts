/**
 * @module ZerOS.Boot.Assemble
 * @description 把带标号的指令文本收成 CPU 能执行的编号跳转
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 标号、call、icall、ret、iret、chars 只存在于提交之前。
 * 标号展开之后，交给 CPU 的每一行仍然是 ZAP。
 * 短形式按调用约定展开：call / ret 用 r7，icall / iret 用 r6。
 * chars 改写 r0，字形写进 r1 里已有的文本节点。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. assemble
 */

export namespace ZerOS {
  export namespace Boot {
    function fail(message: string): never {
      throw new Error(`[ZerOS.Boot.Assemble] ${message}`);
    }

    /** 展开伪指令并记下标号，再把跳转目标换成指令编号。 */
    export function assemble(lines: readonly string[]): string[] {
      const callLink = "r7";
      const interruptLink = "r6";
      const expanded: string[] = [];
      for (const raw of lines) {
        const line = raw.trim();
        if (line.length < 1) {
          continue;
        }
        if (line.startsWith("chars ")) {
          const text = line.slice("chars ".length).trim();
          if (!text.startsWith("\"") || !text.endsWith("\"") || text.length < 2) {
            fail(`字符串不完整 ${line}`);
          }
          const body = text.slice(1, -1);
          for (let index = 0; index < body.length; index += 1) {
            const code = body.charCodeAt(index);
            expanded.push(`place r0, ${String(code)}`);
            expanded.push("gpu.glyph r1, r0");
          }
          continue;
        }
        if (line.startsWith("call ") && !/^call r[0-7],/u.test(line)) {
          expanded.push(`link ${callLink}, ${line.slice("call ".length).trim()}`);
          continue;
        }
        if (line.startsWith("icall ")) {
          expanded.push(`link ${interruptLink}, ${line.slice("icall ".length).trim()}`);
          continue;
        }
        if (line === "ret") {
          expanded.push(`jmp ${callLink}`);
          continue;
        }
        if (line === "iret") {
          expanded.push(`jmp ${interruptLink}`);
          continue;
        }
        expanded.push(line);
      }

      const labels = new Map<string, number>();
      const body: string[] = [];
      for (const line of expanded) {
        if (/^[A-Za-z][A-Za-z0-9]*:$/u.test(line)) {
          labels.set(line.slice(0, -1), body.length);
          continue;
        }
        body.push(line);
      }

      return body.map((line): string => {
        const parts = line.split(/[\s,]+/u).filter((part): boolean => part.length > 0);
        const head = parts[0];
        const target = parts[parts.length - 1];
        if ((head !== "jz" && head !== "jnz" && head !== "link" && head !== "call") || target === undefined) {
          return line;
        }
        if (/^(?:r[0-7]|[0-9]+|0x[0-9a-fA-F]+)$/u.test(target)) {
          return line;
        }
        const index = labels.get(target);
        if (index === undefined) {
          fail(`没有标号 ${target}`);
        }
        const left = parts[1];
        if (left === undefined) {
          fail(`跳转不完整 ${line}`);
        }
        return `${head} ${left}, ${String(index)}`;
      });
    }
  }
}
