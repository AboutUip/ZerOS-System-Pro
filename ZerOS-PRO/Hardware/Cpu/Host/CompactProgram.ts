/**
 * @module ZerOS.Hardware.Cpu.CompactProgram
 * @description 核心线程里的紧凑指令
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 客程序指令仍以对象形式进入核心。进核心之后，这里把整段收成并行数组。
 * 本地热路径只读这些数组，不再为每一条分配字段对象，也不再比较操作码字符串。
 * 不执行指令，不改寄存器，也不产生客机能看见的新指令或查询字段。
 * 操作码编号只在核心内部使用。客机二进制、ZCP1 和 burst 消息字段都不出现这些编号。
 *
 * ---------------------------------------------------------------------------
 * 概念分层
 * ---------------------------------------------------------------------------
 * 操作码是一个小整数。0 表示这条不是本地运算，核心仍按原来的对象去吸收或停下来。
 * 寄存器下标按每条 3 个槽排进同一条 Uint8Array。放不下或不是 0 到 255 的整数记成 255，
 * 执行时再按原来的语句失败，避免在收指令时就提前停下。
 * 立即数保持进来时的 bigint。place 的数据不是 bigint 时记成空，执行时失败。
 * 跳转目标仍是原来的 number。不是 number 时记成空。
 * 寄存器里的整数不在这里收成定宽数组。ZCP1 规定寄存器不设位宽、不按 2^n 取模。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 内部编号
 *   2. 紧凑程序
 *   3. 收指令
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /**
       * 每条指令占三个寄存器槽。
       * 0 是目的、条件或跳转用的寄存器。1 是左操作数或一元来源。2 是右操作数。
       */
      export const RegisterStride = 3;

      /** 槽里没有合法下标。执行时按缺寄存器失败，不在这里换一条指令。 */
      export const RegisterMissing = 255;

      /** 不是本地运算。核心继续走吸收、显卡队列或出核心。 */
      export const LocalNone = 0;

      /** 以下编号与本地操作一一对应。只给核心的热路径分支用。 */
      export const LocalPlace = 1;
      export const LocalAdd = 2;
      export const LocalEq = 3;
      export const LocalSub = 4;
      export const LocalUdiv = 5;
      export const LocalUmod = 6;
      export const LocalMul = 7;
      export const LocalDiv = 8;
      export const LocalMod = 9;
      export const LocalAnd = 10;
      export const LocalOr = 11;
      export const LocalXor = 12;
      export const LocalShl = 13;
      export const LocalShr = 14;
      export const LocalLt = 15;
      export const LocalLe = 16;
      export const LocalGt = 17;
      export const LocalGe = 18;
      export const LocalNot = 19;
      export const LocalItof = 20;
      export const LocalFadd = 21;
      export const LocalFsub = 22;
      export const LocalFmul = 23;
      export const LocalFdiv = 24;
      export const LocalFpow = 25;
      export const LocalFmod = 26;
      export const LocalFeq = 27;
      export const LocalJz = 28;
      export const LocalJnz = 29;
      export const LocalJmp = 30;
      export const LocalRet = 31;
      export const LocalLink = 32;
      export const LocalCall = 33;

      const codeByName: Readonly<Record<string, number>> = {
        place: LocalPlace,
        add: LocalAdd,
        eq: LocalEq,
        sub: LocalSub,
        udiv: LocalUdiv,
        umod: LocalUmod,
        mul: LocalMul,
        div: LocalDiv,
        mod: LocalMod,
        and: LocalAnd,
        or: LocalOr,
        xor: LocalXor,
        shl: LocalShl,
        shr: LocalShr,
        lt: LocalLt,
        le: LocalLe,
        gt: LocalGt,
        ge: LocalGe,
        not: LocalNot,
        itof: LocalItof,
        fadd: LocalFadd,
        fsub: LocalFsub,
        fmul: LocalFmul,
        fdiv: LocalFdiv,
        fpow: LocalFpow,
        fmod: LocalFmod,
        feq: LocalFeq,
        jz: LocalJz,
        jnz: LocalJnz,
        jmp: LocalJmp,
        ret: LocalRet,
        link: LocalLink,
        call: LocalCall,
      };

      /**
       * 一段已经进核心的指令。
       * 下标与客程序指令编号对齐，跳转仍跳到原来的编号。
       */
      export interface CompactProgram {
        /** 每条一个操作码。0 表示留给对象路径。 */
        readonly op: Uint8Array;
        /** 长度是指令数乘 RegisterStride。缺的槽是 RegisterMissing。 */
        readonly reg: Uint8Array;
        /** place 的立即数。其它指令或数据不合法时是空。 */
        readonly imm: readonly (bigint | null)[];
        /** 直接跳转目标。没有目标或目标不是 number 时是空。 */
        readonly target: readonly (number | null)[];
      }

      /** 操作码字符串换成内部编号。不认识的本地以外指令返回 0。 */
      function codeOf(name: string): number {
        const code = codeByName[name];
        if (code === undefined) {
          return LocalNone;
        }
        return code;
      }

      /**
       * 寄存器下标收成一个字节。
       * 超出 0 到 255 或不是整数时记成缺槽，执行阶段仍用原来的失败语句。
       */
      function fitRegister(value: unknown): number {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > RegisterMissing) {
          return RegisterMissing;
        }
        return value;
      }

      function isBinary(code: number): boolean {
        return (code >= LocalAdd && code <= LocalGe) || (code >= LocalFadd && code <= LocalFeq);
      }

      function isUnary(code: number): boolean {
        return code === LocalNot || code === LocalItof;
      }

      function isDirectJump(code: number): boolean {
        return code === LocalJz || code === LocalJnz || code === LocalLink || code === LocalCall;
      }

      /**
       * 把一条对象指令写进并行数组。
       * 这里只搬家，不判断除零、移位或跳转范围。那些仍在执行到这一条时失败。
       */
      function fillStep(
        step: Record<string, unknown>,
        code: number,
        index: number,
        reg: Uint8Array,
        imm: (bigint | null)[],
        target: (number | null)[],
      ): void {
        const base = index * RegisterStride;
        if (code === LocalPlace) {
          reg[base] = fitRegister(step["Register"]);
          const data = step["Data"];
          imm[index] = typeof data === "bigint" ? data : null;
          return;
        }
        if (isBinary(code)) {
          reg[base] = fitRegister(step["Destination"]);
          reg[base + 1] = fitRegister(step["Left"]);
          reg[base + 2] = fitRegister(step["Right"]);
          return;
        }
        if (isUnary(code)) {
          reg[base] = fitRegister(step["Destination"]);
          reg[base + 1] = fitRegister(step["Source"]);
          return;
        }
        if (code === LocalJmp || code === LocalRet) {
          reg[base] = fitRegister(step["Register"]);
          return;
        }
        if (isDirectJump(code)) {
          const jump = code === LocalJz || code === LocalJnz ? step["Condition"] : step["Register"];
          reg[base] = fitRegister(jump);
          const at = step["Target"];
          target[index] = typeof at === "number" ? at : null;
        }
      }

      /**
       * 整段指令收成紧凑程序。
       * 调用方在收到 burst 的 steps 时做一次。之后的节拍只带游标，不再重收。
       */
      export function packProgram(steps: readonly Record<string, unknown>[]): CompactProgram {
        const length = steps.length;
        const op = new Uint8Array(length);
        const reg = new Uint8Array(length * RegisterStride);
        reg.fill(RegisterMissing);
        const imm: (bigint | null)[] = new Array<bigint | null>(length);
        const target: (number | null)[] = new Array<number | null>(length);
        for (let index = 0; index < length; index += 1) {
          imm[index] = null;
          target[index] = null;
          const step = steps[index];
          if (step === undefined) {
            continue;
          }
          const name = step["Op"];
          const code = typeof name === "string" ? codeOf(name) : LocalNone;
          op[index] = code;
          if (code === LocalNone) {
            continue;
          }
          fillStep(step, code, index, reg, imm, target);
        }
        return { op, reg, imm, target };
      }
    }
  }
}
