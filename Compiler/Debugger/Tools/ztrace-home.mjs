/**
 * 语料用的 /home 夹具。
 * 客根整棵不进版本库，所以每次跑语料前由这里种上。
 * 不依赖某台机器上已经有的 Root/home。
 */
import fs from "node:fs";
import path from "node:path";

/** 与 compress 的 putCode 相同：低位先写，宽从 9 起。 */
function compressZ(bytes, maxbits = 9) {
  const out = [31, 157, (maxbits | 128) & 255];
  let acc = 0;
  let accBits = 0;
  const put = (code, width) => {
    let bits = code;
    let need = width;
    while (need > 0) {
      let take = 8 - accBits;
      if (take > need) {
        take = need;
      }
      const mask = (1 << take) - 1;
      acc |= (bits & mask) << accBits;
      bits >>= take;
      accBits += take;
      need -= take;
      if (accBits >= 8) {
        out.push(acc & 255);
        acc = 0;
        accBits = 0;
      }
    }
  };
  put(256, 9);
  if (bytes.length > 0) {
    const dict = new Map();
    let next = 257;
    let width = 9;
    let limit = 512;
    const cap = 1 << maxbits;
    let word = bytes[0] ?? 0;
    for (let index = 1; index < bytes.length; index += 1) {
      const byte = bytes[index] ?? 0;
      const key = `${String(word)},${String(byte)}`;
      const found = dict.get(key);
      if (found !== undefined) {
        word = found;
      } else {
        put(word, width);
        if (next < cap) {
          dict.set(key, next);
          next += 1;
          if (next >= limit && width < maxbits) {
            width += 1;
            limit *= 2;
          }
        } else {
          put(256, width);
          dict.clear();
          next = 257;
          width = 9;
          limit = 512;
        }
        word = byte;
      }
    }
    put(word, width);
  }
  if (accBits > 0) {
    out.push(acc & 255);
  }
  return Buffer.from(out);
}

/** System V ar：`!<arch>\n` 加一个短成员 hi。`ar -t` 能列出它。 */
function makeArchive() {
  const header = Buffer.alloc(60, 0x20);
  Buffer.from("hi/").copy(header, 0);
  header.write("000000", 28, "ascii");
  header.write("0", 34, "ascii");
  header.write("00000644", 40, "ascii");
  const size = "         3";
  header.write(size, 48, "ascii");
  header[58] = 96;
  header[59] = 10;
  return Buffer.concat([Buffer.from("!<arch>\n"), header, Buffer.from("hi\n"), Buffer.from("\n")]);
}

function writeFile(root, rel, contents) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

/**
 * 在客根下准备语料会打开的文件。
 * root 是 NAS 的客根，不是仓库根。
 */
export function plantCorpusHome(root) {
  const text = Buffer.from("Hello\nworld\n");
  const compressed = compressZ(Buffer.from("hi\n"));
  writeFile(root, "home/test.txt", text);
  writeFile(root, "home/cz.txt", Buffer.from("hi\n"));
  writeFile(root, "home/gone.txt", Buffer.from("gone\n"));
  writeFile(root, "home/perf/a.txt", Buffer.from("k a\n"));
  writeFile(root, "home/perf/b.txt", Buffer.from("k b\n"));
  writeFile(root, "home/c.c", Buffer.from("int main()\n"));
  writeFile(root, "home/ts.txt", Buffer.from("a b\n"));
  writeFile(root, "home/what.txt", Buffer.from("@(#)zeros\n"));
  writeFile(root, "home/msg.src", Buffer.from("$set 1\n1 hello\n"));
  writeFile(root, "home/zz.Z", compressed);
  writeFile(root, "home/uz.Z", compressed);
  writeFile(root, "home/lib.a", makeArchive());
  writeFile(root, "home/sample.uu", Buffer.from("begin 666 /home/ud.out\n#:&D*\nend\n"));
  writeFile(root, "home/fix.diff", Buffer.from("--- /home/test.txt\n+++ /home/test.txt\n@@ -1 +1 @@\n Hello\n"));
  writeFile(root, "share/man/ls", Buffer.from("ls\n"));
}
