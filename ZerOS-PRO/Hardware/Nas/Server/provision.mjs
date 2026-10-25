/**
 * 把资源目录整理进 NAS 的运行时树。
 * 编译内核之后执行：node ZerOS-PRO/Hardware/Nas/Server/provision.mjs
 *
 * /boot/display 不是源码。文件还不存在时，按显示器驱动的默认宽高写成四个八位组。
 * 已经由 BIOS 或换分辨率改过的文件留着，重编不覆盖。
 * /boot/debug 也不是源码。缺文件时写成一个八位组 0，表示调试关闭。已经改过的不覆盖。
 * 字体源在 ZerOS-PRO/Resource/Font。这里拷到客路径 /font，并标成只读。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../Root");
const resourceFont = path.resolve(here, "../../../Resource/Font");
const driverSource = path.resolve(here, "../../../../Driver/Display/panel.obr");
const hostSource = path.resolve(here, "../../Display/Config/DisplayConfig.ts");

/** 从驱动函数和宿主常量读出同一档默认宽高。两边不一致就停下。 */
export function readDisplayDefault() {
  const driver = fs.readFileSync(driverSource, "utf8");
  const host = fs.readFileSync(hostSource, "utf8");
  const width = pair(driver, "panel::defaultWidth", host, "DefaultWidth");
  const height = pair(driver, "panel::defaultHeight", host, "DefaultHeight");
  return { width, height };
}

function pair(driver, driverName, host, hostName) {
  const fromDriver = new RegExp(`deRfun ${driverName}\\(\\): long \\{\\r?\\n  return (\\d+)L;`).exec(driver);
  const fromHost = new RegExp(`export const ${hostName} = (\\d+);`).exec(host);
  if (fromDriver === null || fromHost === null || fromDriver[1] !== fromHost[1]) {
    throw new Error(`显示器默认 ${driverName} 和 ${hostName} 不一致`);
  }
  return Number(fromDriver[1]);
}

/** 缺文件时写成一个八位组 0。已有文件不改。0 是关，1 是开，和固件的 8128 同一档。 */
export function seedDebug() {
  const boot = path.join(root, "boot");
  fs.mkdirSync(boot, { recursive: true });
  const debug = path.join(boot, "debug");
  if (fs.existsSync(debug)) {
    return;
  }
  fs.writeFileSync(debug, Buffer.from([0]));
}

/** 缺文件时写成小端 16 位宽、小端 16 位高。已有文件不改。 */
export function seedDisplay() {
  const size = readDisplayDefault();
  const boot = path.join(root, "boot");
  fs.mkdirSync(boot, { recursive: true });
  const display = path.join(boot, "display");
  if (fs.existsSync(display)) {
    return;
  }
  const bytes = Buffer.alloc(4);
  bytes.writeUInt16LE(size.width, 0);
  bytes.writeUInt16LE(size.height, 2);
  fs.writeFileSync(display, bytes);
}

/** 用资源目录覆盖 /font，然后把每个文件标成只读。 */
export function copyFonts() {
  if (!fs.existsSync(resourceFont)) {
    throw new Error(`没有字体资源 ${resourceFont}`);
  }
  const destDir = path.join(root, "font");
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(resourceFont)) {
    const from = path.join(resourceFont, name);
    if (!fs.statSync(from).isFile()) {
      continue;
    }
    const to = path.join(destDir, name);
    if (fs.existsSync(to)) {
      fs.chmodSync(to, 0o666);
    }
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o444);
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

if (isDirectRun()) {
  seedDisplay();
  seedDebug();
  copyFonts();
}
