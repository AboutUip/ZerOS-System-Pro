/** 将实际 BIOS 的 main 换成有限帧循环，测真实 CPU 路径；GPU 仅记命令并立即回执。
 * 这是 CPU 绘制工作量/布局回归测试，不能替代浏览器和 WebGPU 的长期帧率测试。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
const own=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const root=process.env.ZEROS_CHECK_SOURCE || own;
const numbers=process.argv.includes("--numbers");
const label=(process.env.ZEROS_BIOS_LABEL || (process.env.ZEROS_CHECK_SOURCE?"baseline":"fixed"))+(numbers?"-numbers":"");
const frameCount=Number(process.env.ZEROS_BIOS_FRAMES || 20);
if(!Number.isInteger(frameCount) || frameCount<2 || frameCount>10000){throw new Error("invalid frame count");}
const dir=path.join(own,"Toolchain/Zap/BiosCheck",label);fs.mkdirSync(dir,{recursive:true});
const original=fs.readFileSync(path.join(root,"ZerOS-PRO/Boot/Bios.obr"),"utf8");
const source=path.join(dir,"Bios.obr");
const main=numbers?`
deRfun main(): int {
  *(long*)5632 = 0L;
  putnum(0L, 0L, 0L, 0L);
  putnum(0L, 24L, -1L, 0L);
  putnum(0L, 48L, 9L, 0L);
  putnum(0L, 72L, 10L, 0L);
  putnum(0L, 96L, 9223372036854775807L, 0L);
  obr::ui::present();
  halt(); return 0;
}`:`
deRfun main(): int {
  *(long*)4096 = 2L;
  *(long*)5184 = 1L;
  *(long*)4160 = 1L;
  long frame = 0L;
  while (frame < ${frameCount}L) { paint(); frame = frame + 1L; }
  *(long*)5312 = *(long*)5632;
  frame = 0L;
  while (frame < ${frameCount}L) { paint(); frame = frame + 1L; }
  halt(); return 0;
}`;
fs.writeFileSync(source,original.slice(0,original.indexOf("deRfun main(): int"))+main);
const files=[source,...["ZerOS-PRO/Boot/Clear.obr","Driver/Pointer/pointer.obr","Compiler/Obr/lib/obr.widget.obr","Compiler/Obr/lib/obr.nas.obr","Driver/Display/panel.obr","Driver/Gpu/gl.obr"].map(p=>path.join(root,p))];
const includes=["ZerOS-PRO/Boot","ZerOS-PRO/Hardware/Gpu","Driver/Gpu","ZerOS-PRO/Hardware/Motherboard","ZerOS-PRO/Hardware/Memory"].flatMap(p=>["-I",path.join(root,p)]);
const binary=path.join(dir,"bios");
const compiled=spawnSync(path.join(root,"Compiler/Obr/obrc"),[...files,...includes,"-o",binary],{encoding:"utf8"});
if(compiled.status!==0){throw new Error(compiled.stderr||compiled.stdout);}
const adapter=fs.readFileSync(path.join(own,"Toolchain/Checks/bios-vm.mjs"),"utf8").replaceAll('"../../ZerOS-PRO/',JSON.stringify(path.join(root,"ZerOS-PRO/")).slice(0,-1));
const vm=path.join(dir,"vm.mjs");
// 只在测试 bundle 暴露集合大小，正式产品和运行时接口不增加观测字段。
const cacheProbe={name:"test-cache-size",setup(builder){builder.onLoad({filter:/CoreDispatch\.ts$/},args=>{
  let code=fs.readFileSync(args.path,"utf8");
  const extra=["keptWords","readBytes"].filter(name=>code.includes(`const ${name} = new Map`)).map(name=>`,${name}:${name}.size`).join("");
  code=code.replace("const keptOctets = new Map<bigint, number>();",`const keptOctets = new Map<bigint, number>();(globalThis as unknown as {__privateCacheSample:()=>unknown}).__privateCacheSample=()=>({octets:keptOctets.size${extra}});`);
  return {contents:code,loader:"ts",resolveDir:path.dirname(args.path)};
});}};
await build({stdin:{contents:adapter,resolveDir:own,loader:"js"},plugins:[cacheProbe],outfile:vm,bundle:true,platform:"node",format:"esm",logLevel:"error"});
const {run}=await import(pathToFileURL(vm));
const watchdog=setTimeout(()=>{console.error("BIOS test timed out");process.exit(2);},Number(process.env.ZEROS_BIOS_TIMEOUT || 60000));
const result=await run(new Uint8Array(fs.readFileSync(binary)));clearTimeout(watchdog);
fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(result,null,2));
if(numbers){
  if(result.frames.length!==1 || result.frames[0].text!=="009109223372036854775807"){throw new Error("整数绘制边界错误");}
  console.log(JSON.stringify({numbers:"ok",glyphs:result.frames[0].text}));
  process.exit(0);
}
const summary=rows=>{const times=rows.slice(1).map(x=>x.ms).sort((a,b)=>a-b);return {medianMs:times[Math.floor(times.length/2)],commands:rows[rows.length-1].commands,glyphs:rows[rows.length-1].glyphs};};
console.log(JSON.stringify({frames:result.frames.length,top:summary(result.frames.slice(0,frameCount)),bottom:summary(result.frames.slice(frameCount)),executed:result.executed,scrollLimit:result.scrollLimit,cache:result.frames.at(-1).cache}));
if(result.frames.length!==frameCount*2 || result.scrollLimit!=="652" || !result.frames[0].text.includes("CPU") || !result.frames.at(-1).text.includes("CORE7")){throw new Error("BIOS帧数、滚动范围或末尾核心信息不正确");}
