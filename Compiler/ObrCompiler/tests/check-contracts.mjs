/** CLI, slot/PIE/attach and optimization-control regressions. Run after check-compiler.mjs. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {build} from '../../../Toolchain/node_modules/esbuild/lib/main.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');process.chdir(repo);
const out=path.resolve(process.env.OBRC_CONTRACT_OUT??'Toolchain/CompilerCheck/contracts');fs.mkdirSync(out,{recursive:true});
const exe=path.resolve(process.env.OBRC??'Compiler/ObrCompiler/obrc');let checks=0;const results=[];
function test(value,message){++checks;assert(value,message);}
function source(name,text){const f=path.join(out,name);fs.writeFileSync(f,text);return f;}
for(const [input,file] of [['ZapRunner.mjs','zap-runner.mjs'],['NativeRunner.mjs','native-runner.mjs']])await build({entryPoints:['Compiler/ObrCompiler/tests/'+input],outfile:path.join(out,file),bundle:true,platform:'node',format:'esm',logLevel:'error'});
await build({entryPoints:['ZerOS-PRO/Hardware/Cpu/Host/CoreDispatch.ts'],outfile:path.join(out,'core-instance.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error'});
function compile(sources,flags,name,ok=true){const output=path.join(out,name);const r=spawnSync(exe,[...sources,'-I','Compiler/ObrCompiler/lib','-I','ZerOS-PRO/Hardware/Memory','-I','ZerOS-PRO/Resource/Bin','-I',out,...flags,'-o',output],{encoding:'utf8',timeout:30000});test(ok?r.status===0:r.status!==0,name+': '+r.stderr);return {output,diagnostic:r.stderr};}
function run(file,arg){const runner=fs.readFileSync(file).subarray(0,4).toString()==='ZNB1'?'native-runner.mjs':'zap-runner.mjs';const r=spawnSync(process.execPath,[path.join(out,runner),file,...(arg?[arg]:[])],{encoding:'utf8',timeout:40000});test(r.status===0,'runtime: '+r.stderr);return JSON.parse(r.stdout);}
const simple=source('simple.obr','deRfun main(): long { long x=7L; return x*6L; }');
const args=source('args.obr',`import memory; import arg;
deRfun main(): long {long home=1048576L;long base=home+65536L*64L;memory::store64(3L,base);memory::store64(5L,base+256L);memory::store64(4L,base+320L);memory::store64(6L,base+384L);return argc(home)*100L+argLen(home,1L)*10L+argLen(home,2L);}`);
const header=source('contract.mr','deRfun contractAdd(long a, long b): long;');
const library=source('library.obr','export deRfun contractAdd(long a,long b): long { return a+b; }');
const caller=source('caller.obr','#DYN\nimport contract;\ndeRfun main(): long { return contractAdd(20L,22L); }');
for(const level of ['-O0','-O1','-O2']){
 for(let slot=0;slot<8;++slot){
  const file=compile([simple],[level,'-slot',String(slot),'-debug','-zap'],`slot-${slot}${level}`).output;
  const r=spawnSync(process.execPath,[path.join(out,'native-runner.mjs'),file],{encoding:'utf8'});test(r.status===0,'slot native runner: '+r.stderr);const value=JSON.parse(r.stdout);test(value.r0==='42'&&value.calleeSaved&&value.rspBalanced,`slot ${slot} ABI`);
 }
 const pie=compile([args,'ZerOS-PRO/Resource/Bin/arg.obr'],[level,'-pie','-debug'],`args${level}`).output;
 const ran=run(pie,'--install');test(ran.r0==='346','PIE relocation + argument block');results.push({level,case:'PIE install on core 1',run:ran});
 const lib=compile([library],[level,'-shared','-debug'],`library${level}`).output;
 const app=compile([caller],[level,'-pie','-debug'],`caller${level}`).output;
 const linked=run(app,lib);test(linked.r0==='42','#DYN/import/attach/exports');results.push({level,case:'shared attach on core 1',run:linked});
 for(const flags of [['-pie','-slot','1'],['-shared','-slot','1'],['-shared','-pie'],['-slot','8'],['-slot','-1'],['-O3'],['-passes','unknown']])compile([simple],[level,...flags],'rejected',false);
 const plain=compile([simple],[level],'plain').output;test(!fs.existsSync(plain+'.zap'),'default emitted zap');
 const named=compile([simple],[level],`named${level}.zap`).output;test(fs.existsSync(named)&&fs.existsSync(named.slice(0,-4)),'-o .zap contract');
}
// 执行真实 shell 编辑/拆词用例；构建脚本只编译它，本检查也验证结果三格。
for(const level of ['-O0','-O1','-O2']){
 const file=compile(['ZerOS-PRO/System/Shell/edit-check.obr','ZerOS-PRO/System/Shell/edit.obr'],[level,'-I','ZerOS-PRO/System/Shell','-debug'],`edit${level}`).output;
 const r=spawnSync(process.execPath,[path.join(out,'native-runner.mjs'),file],{encoding:'utf8',timeout:60000,env:{...process.env,OBRC_PROBES:'2097152,2097216,2097280'}});
 test(r.status===0,'edit-check runtime: '+r.stderr);const value=JSON.parse(r.stdout);
 test(value.kind==='halt'&&value.probes['2097152']==='149'&&value.probes['2097216']==='0'&&value.probes['2097280']==='0','shell edit 149 checks');
 results.push({level,case:'System/Shell/edit-check',run:value});
}
// 递归七参数 ABI 的结果落在四格共享内存，不能仅检查 main 返回 0。
for(const level of ['-O0','-O1','-O2']){
 const file=compile(['ZerOS-PRO/Hardware/Cpu/Test/NativeSample.obr'],[level,'-debug','-zap'],`abi${level}`).output;
 const r=spawnSync(process.execPath,[path.join(out,'native-runner.mjs'),file],{encoding:'utf8',env:{...process.env,OBRC_PROBES:'2097152,2097216,2097280,2097344'}});
 test(r.status===0,'ABI runtime: '+r.stderr);const value=JSON.parse(r.stdout);
 test(JSON.stringify(Object.values(value.probes))===JSON.stringify(['42','43','654322','654321'])&&value.calleeSaved&&value.rspBalanced,'ABI registers/stack/scaled memory');
 results.push({level,case:'recursive seven argument ABI',run:value});
}
for(const level of ['-O0','-O1','-O2']){
 const file=compile(['ZerOS-PRO/Hardware/Cpu/Test/NativeSample.obr'],[level,'-pie','-debug'],`abi-pie${level}`).output;
 for(const core of [1,4]){
  const bits=[2097152n,2097216n,2097280n,2097344n].map(at=>String(at+BigInt(core)*268435456n));
  const r=spawnSync(process.execPath,[path.join(out,'zap-runner.mjs'),file,'--install'],{encoding:'utf8',timeout:40000,env:{...process.env,OBRC_PROBES:bits.join(','),OBRC_TEST_CORE:String(core)}});
  test(r.status===0,'PIE ABI runtime: '+r.stderr);const value=JSON.parse(r.stdout);
  test(value.kind==='installed'&&JSON.stringify(Object.values(value.probes))===JSON.stringify(['42','43','654322','654321']),'PIE software stack ABI and relocation');
  results.push({level,core,case:'recursive seven argument PIE ABI',run:value});
 }
}
// 原始成本20、复制增长4，恰好达到20%上限；同时验证允许内联的正向边界。
const inline=source('inline.obr','deRfun inc(long n): long {return n+1L;} deRfun main(): long {long n=1L;n=inc(n);n=inc(n);return n+1L;}');
const inlined=compile([inline],['-O2','-debug','-zap'],'inlined').output;
const outline=compile([inline],['-O2','-fno-inline-small','-debug','-zap'],'outlined').output;
test(!fs.readFileSync(inlined).equals(fs.readFileSync(outline)),'inline-small switch has no effect');
test(run(inlined).r0==='4'&&run(outline).r0==='4','bounded positive inline case changed result');
// 总 AST 成本 6、重复体成本 2：20% 预算只能取 1，禁止原先 +1 带来的 33.3% 扩张。
const tiny=source('tiny-budget.obr','deRfun f(): long {return 1L;} deRfun main(): long {return f()+f();}');
const bounded=compile([tiny],['-O2','-debug'],'tiny-bounded').output;
const tinyOutline=compile([tiny],['-O2','-fno-inline-small'],'tiny-outlined').output;
test(fs.readFileSync(bounded).equals(fs.readFileSync(tinyOutline)),'tiny unit exceeded 20 percent inline budget');
test(run(bounded).r0==='2','tiny budget decision changed observable result');
// 原有黄金测试固定检查 disp8 字节形状：用 O0 验证旧映像兼容，O1/O2 的新形状由上面的真实 CPU ABI 检查覆盖。
await build({entryPoints:['ZerOS-PRO/Hardware/Cpu/Test/NativeImageCheck.ts'],outfile:path.join(out,'legacy-native-check.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error'});
const legacy=spawnSync(process.execPath,[path.join(out,'legacy-native-check.mjs'),path.join(out,'abi-O0')],{encoding:'utf8',timeout:40000});
test(legacy.status===0,'legacy native byte/ABI golden: '+legacy.stderr);results.push({case:'unchanged NativeImageCheck on O0 golden',status:legacy.status});
const sandbox=source('sandbox.obr','deRfun main(): long {\n __zap__ {\n place r0, 42\n halt\n }\n}\n');
for(const level of ['-O0','-O1','-O2']){
 const file=compile([sandbox],[level,'-zap'],`sandbox${level}`).output;
 const value=run(file+'.zap','--sandbox');test(value.sandbox&&value.r0==='42'&&value.kind==='halt','sandbox assembled compiler raw ZAP');
 results.push({level,case:'sandbox',run:value});
}
const restrictions=source('restricted.obr','@Callfun(!*)\ndeRfun hidden(): long {return 1L;}\ndeRfun main(): long{return hidden();}');
for(const level of ['-O0','-O1','-O2']){const r=compile([restrictions],[level],'restricted',false);test(r.diagnostic.includes('@Callfun'),'Callfun diagnostics');}
const linkRestricted=source('link-restricted.obr','#LINK /allowed.obr\nexport deRfun helper(): long {return 1L;}');
const external=source('external.obr','import link; deRfun main(): long {return helper();}');source('link.mr','deRfun helper(): long;');
for(const level of ['-O0','-O1','-O2'])compile([external,linkRestricted],[level],'link-denied',false);
for(const pass of ['-fno-peephole','-fno-fold','-fno-load-forward','-fno-dce','-fno-native-compact','-fno-scaled','-fno-inline-small'])compile([simple],['-O2',pass,'-debug'],'switch-'+pass);
for(const sequence of ['forward,dce','dce,forward,dce','forward,forward,dce','fold','load-forward','load-forward,fold,dce','fold,load-forward,dce,fold,dce']){
 const file=compile([simple],['-O2','-passes',sequence,'-debug'],'order-'+sequence).output;
 const value=run(file);test(value.kind==='halt'&&value.r0==='42','pass order runtime: '+sequence);
 results.push({case:'pass order execution',sequence,run:value});
}
const report=path.join(out,'coverage.tsv');compile([simple],['-O1','-native-report',report],'coverage');test(fs.readFileSync(report,'utf8').includes('encodable\t'),'native coverage report');
const fallback=source('fallback.obr','deRfun main(): long { __zap__ {\n place r0, 7\n jmp r0\n }\n return 0L;\n }');
compile([fallback],['-O1','-native-report',report],'fallback');test(fs.readFileSync(report,'utf8').includes('native return requires r6 or r7'),'operand coverage report');
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,results},null,2)+'\n');console.log(JSON.stringify({checks,failures:0}));
