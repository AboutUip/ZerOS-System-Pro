/** Reproducible compile/differential checks; uses the unchanged product CPU, never a replacement VM. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from '../../../Toolchain/node_modules/esbuild/lib/main.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
process.chdir(repo);
const out=path.resolve(process.env.OBRC_CHECK_OUT??'Toolchain/CompilerCheck/differential');fs.mkdirSync(out,{recursive:true});
const compilerInput=path.resolve(process.env.OBRC??'Compiler/ObrCompiler/obrc');
const compiler=path.join(out,'candidate-obrc');fs.copyFileSync(compilerInput,compiler);fs.chmodSync(compiler,0o755);
const baseline=process.env.OBRC_BASELINE&&path.resolve(process.env.OBRC_BASELINE);
const passOptions=process.env.OBRC_TEST_PASSES?['-passes',process.env.OBRC_TEST_PASSES]:[];
const sourceLines=new Map();
function sourceLength(file){if(!sourceLines.has(file))sourceLines.set(file,fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').length:0);return sourceLines.get(file);}
const results=[];const failures=[];let assertions=0;
function check(ok,message){++assertions;if(!ok)failures.push(message);}
// Test-only source transform counts successful logical accesses, including product private caches.
const countMemory={name:'compiler-test-memory-count',setup(b){b.onLoad({filter:/CoreDispatch\.ts$/},args=>{
 let source=fs.readFileSync(args.path,'utf8');
 for(const name of ['absorbScratch','absorbLinear','absorbFrameLoad','takeSupervisorFrame']){
  const signature=`function ${name}(step: Record<string, unknown>): boolean {`;
  assert(source.includes(signature),`counter hook drift: ${name}`);
  source=source.replace(signature,`${signature}\n const done=${name}Measured(step);\n if(done && quietFault === "") (globalThis as any).__compilerAccess(step["Op"]);\n return done;\n }\n function ${name}Measured(step: Record<string, unknown>): boolean {`);
 }
 const signature='function applyAccessMeta(meta: AccessMeta, value: bigint, found: number, span: readonly bigint[] | null): void {';
 assert(source.includes(signature),'counter hook drift: applyAccessMeta');
 source=source.replace(signature,signature+'\n (globalThis as any).__compilerAccess(meta.apply);');
 source+='\n(globalThis as any).__compilerAccessInstrumented = true;\n';
 return {contents:source,loader:'ts'};
});}};
for(const [name,plugins] of [['Native',[]],['Zap',[countMemory]]])await build({entryPoints:[`Compiler/ObrCompiler/tests/${name}Runner.mjs`],outfile:path.join(out,`${name.toLowerCase()}-runner.mjs`),bundle:true,platform:'node',format:'esm',logLevel:'error',plugins});
await build({entryPoints:['ZerOS-PRO/Hardware/Cpu/Host/CoreDispatch.ts'],outfile:path.join(out,'core-instance.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error'});
function compile(exe,source,flags,dest){
 const start=performance.now();
 const p=spawnSync(exe,[...(Array.isArray(source)?source:[source]),'-I','Compiler/ObrCompiler/lib','-I','Compiler/ObrCompiler/examples','-I','ZerOS-PRO/Hardware/Memory','-I','ZerOS-PRO/Hardware/Motherboard','-I','ZerOS-PRO/Hardware/Gpu',...flags,'-o',dest],{encoding:'utf8',timeout:30000});
 return {status:p.status,diagnostic:p.stderr.trim(),ms:performance.now()-start};
}
function run(file,mode){const format=fs.readFileSync(file).subarray(0,4).toString();const p=spawnSync(process.execPath,[path.join(out,format==='ZNB1'?'native-runner.mjs':'zap-runner.mjs'),file,...(mode?[mode]:[])],{encoding:'utf8',timeout:40000,maxBuffer:16*1024*1024});if(p.status!==0)throw Error(p.stderr||'runtime timeout');return JSON.parse(p.stdout);}
function observable(r){return {kind:r.kind,r0:r.r0,events:r.events,visible:r.visible};}
const finite=new Set(['arith','arg4','async','bound','collect','concat','edge','fib','goto','index','lang','libmore','logic','loop','main','math','more','neststr','ptr','recur','sticky','struct-cast','type','zapcall']);
// Link the same implementation units required by the language README; -I supplies headers only.
const companions={libmore:['obr.base','obr.hash','obr.json','obr.rand','obr.text'],guest:['obr.con','obr.proc','obr.text'],'nas-ready':['obr.nas']};
const mathProvider=path.join(out,'math-provider.obr');fs.writeFileSync(mathProvider,'import math; deRfun math::add(int a,int b): int {return a+b;}\n');
finite.add('program');
const sources=fs.readdirSync('Compiler/ObrCompiler/examples').filter(n=>n.endsWith('.obr')).map(n=>{
 const name=n.slice(0,-4);const inputs=[`Compiler/ObrCompiler/examples/${n}`,...(companions[name]??[]).map(lib=>`Compiler/ObrCompiler/lib/${lib}.obr`)];
 if(name==='program')inputs.push(mathProvider);
 return ['example/'+n,inputs,finite.has(name)];
});
sources.push(['firmware/Logo',['ZerOS-PRO/Boot/Logo.obr','Driver/Gpu/gl.obr'],true]);
const legacyBoxingFix=new Set(['example/libmore.obr','fixture/char-join']);
const fixtures={
 'counter-direct':`deRfun main(): long {\n __zap__ {\n place r0, 42\n store.64 r0, 68173824\n load.64 r0, 68173824\n halt\n }\n }`,
 'counter-indirect':`deRfun main(): long {\n __zap__ {\n place r1, 68173824\n place r0, 42\n sti.64 r0, r1\n ldi.64 r0, r1\n halt\n }\n }`,
 'char-join':`deRfun main(): int {string a='A'+"b";string b="a"+'B';string u='中'+"文";if(length(a)==2&&a[0]=='A'&&a[1]=='b'&&length(b)==2&&b[0]=='a'&&b[1]=='B'&&length(u)==2&&u[0]=='中'&&u[1]=='文')return 70;return 0;}`,
 'wide-scaled':`deRfun main(): long { *(long*)(8192L+2L*64L+2048L)=73L; return *(long*)(8192L+2L*64L+2048L); }`,
 'shared-alias':`deRfun main(): long { long* cell=(long*)4096L; *cell=17L; char* narrow=(char*)4096L; *narrow='A'; return *cell; }`,
 'loop-alias':`deRfun main(): long { long n=0L; long sum=0L; while(n<100L) { sum=sum+n; n=n+1L; } *(long*)4096L=sum; return sum; }`,
 'fold-reloc':`deRfun main(): long { long address=2000000L; long delta=64L; long* cell=(long*)(address+delta); *cell=42L; return *cell; }`,
 'numeric-jump':`deRfun main(): long {\n __zap__ {\n place r0, 0\n place r1, 42\n jz r0, 5\n place r1, 0\n halt\n or r0, r1, r1\n halt\n }\n }`,
 'numeric-jump-hex':`deRfun main(): long {\n __zap__ {\n place r0, 0\n place r1, 42\n jz r0, 0x5\n place r1, 0\n halt\n or r0, r1, r1\n halt\n }\n }`,
 'raw-clobber':`deRfun main(): long { long x=7L; __zap__ {\n place r1, 99\n place r0, 43\n }\n return x;\n }`,
 'division-fault':`deRfun main(): long { long x=0L; return 7L/x; }`,
 'alignment':`deRfun main(): long { long* cell=(long*)4097L; return *cell; }`,
 'inline-small':`deRfun inc(long n): long { return n+1L; } deRfun main(): long { long n=0L; n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); n=inc(n); return n; }`,
 'abi-seven':fs.readFileSync('ZerOS-PRO/Hardware/Cpu/Test/NativeSample.obr','utf8'),
};
for(const [name,source] of Object.entries(fixtures)){const file=path.join(out,name+'.obr');fs.writeFileSync(file,source);sources.push(['fixture/'+name,file,true]);}
for(const [label,source,execute] of sources){
 for(const pie of [false,true]){
  const entries=[];
  const variants=[...(baseline?[['baseline',baseline,[]]]:[]),...['0','1','2'].map(n=>['O'+n,compiler,['-O'+n,...passOptions]])];
  for(const [variant,exe,opt] of variants){
   const file=path.join(out,label.replaceAll('/','-')+(pie?'-pie':'')+'-'+variant);
   const c=compile(exe,source,[...opt,...(pie?['-pie']:[]),'-debug','-zap'],file);
   const entry={label,pie,variant,...c};entries.push(entry);results.push(entry);
   const knownRejection=label.startsWith('example/bad-')||(variant==='baseline'&&((!pie&&label==='fixture/alignment')||(pie&&label==='fixture/abi-seven')));
   check(knownRejection?c.status!==0:c.status===0,label+' '+variant+' expected acceptance/rejection');
   if(c.status!==0)continue;
   const image=fs.readFileSync(file);entry.bytes=image.length;entry.format=image.subarray(0,4).toString();entry.debugBytes=fs.statSync(file+'.debug').size;
   const debug=fs.readFileSync(file+'.debug','utf8').split('\n').slice(0,-1);entry.instructions=debug.length-1;
   check(debug.every((row,i)=>i===0||row.split('\t').length===4),label+' debug field count');
   for(const row of debug.slice(1)){
    const [,origin,line,fn]=row.split('\t');
    check(origin?Number(line)>=1&&Number(line)<=sourceLength(origin)&&fn.length>0:Number(line)===0&&fn.length===0,label+' source mapping range');
   }
   const indices=debug.slice(1).map(row=>Number(row.split('\t')[0]));
   check(indices.every((at,i)=>Number.isInteger(at)&&at>=0&&(i===0||at>indices[i-1])),label+' debug indices');
   if(entry.format==='ZPB1')check(indices.every((at,i)=>at===i)&&image.readUInt32LE(8)===indices.length,label+' ZAP debug coverage');
   else check(indices.every(at=>at>=96&&at<(12+image.readUInt32LE(8))*8&&at%8===0),label+' native debug range');
   if(variant==='O1'){
    const repeat=compile(exe,source,[...opt,...(pie?['-pie']:[])],file+'-repeat');
    check(repeat.status===0&&image.equals(fs.readFileSync(file+'-repeat')),label+' deterministic/debug-neutral');
   }
   if(!execute){try{entry.decoded=run(file,entry.format==='ZNB1'?'--debug-only':'--decode-only');}catch(error){failures.push(label+' decode/debug: '+error.message);}}
   if(execute){try{entry.run=run(file);check(entry.run.calleeSaved!==false,label+' '+variant+' callee saved');
    if(entry.format==='ZPB1'&&label.startsWith('fixture/counter-'))check(entry.run.kind==='halt'&&entry.run.r0==='42'&&entry.run.memory.logical?.loads===1&&entry.run.memory.logical?.stores===1,label+' actual private load/store counters');
    if(entry.run.kind==='fault'&&variant!=='baseline'){
      let index;
      if(entry.format==='ZPB1')index=entry.run.stop?.index;
      else {const at=BigInt(entry.run.rip)-(1n<<31n);for(let i=0;i<indices.length;++i)if(BigInt(indices[i])<=at)index=i;}
      check(Number.isInteger(index)&&index>=0&&index<debug.length-1,label+' fault mapped into debug');
      if(Number.isInteger(index))entry.faultSite=debug[index+1].split('\t');
      if(label==='fixture/division-fault'||label==='fixture/alignment')check(entry.faultSite?.[1]===source&&Number(entry.faultSite?.[2])===1,label+' fault source statement');
    }
    const gold={'example/fib.obr':'70','example/arith.obr':'70','example/collect.obr':'62','example/async.obr':'1','example/libmore.obr':'73','example/ptr.obr':'70','example/struct-cast.obr':'17','example/main.obr':'7','example/math.obr':'22','example/program.obr':'7','fixture/raw-clobber':'7','fixture/numeric-jump':'42','fixture/numeric-jump-hex':'42'};
    if(gold[label]!==undefined&&!(variant==='baseline'&&legacyBoxingFix.has(label)))check(entry.run.kind==='halt'&&entry.run.r0===gold[label],label+' semantic golden result');
    if(label==='fixture/char-join'&&variant!=='baseline')check(entry.run.kind==='halt'&&entry.run.r0==='70','character boxing golden result');
   }catch(error){entry.runtimeError=error.message;failures.push(label+' '+variant+' '+(pie?'PIE':'native')+': '+error.message);}}
  }
  const normal=entries.find(e=>e.variant==='O0');
  for(const entry of entries){
   if(!(entry.variant==='baseline'&&((pie&&label==='fixture/abi-seven')||label==='fixture/alignment')))check(entry.status===normal.status,`${label} ${pie} ${entry.variant} compile status differs`);
   if(label.startsWith('example/bad-')&&entry.status!==0&&normal.status!==0)check(entry.diagnostic===normal.diagnostic,`${label} ${entry.variant} rejection diagnostic differs`);
   if(entry.run&&normal.run&&!(entry.variant==='baseline'&&legacyBoxingFix.has(label)))check(JSON.stringify(observable(entry.run))===JSON.stringify(observable(normal.run)),`${label} ${pie} ${entry.variant} observable differs`);
  }
  if(baseline){const old=entries[0];if(old.status===0&&normal.status===0&&!legacyBoxingFix.has(label)){const prefix=path.join(out,label.replaceAll('/','-')+(pie?'-pie':''));check(fs.readFileSync(prefix+'-baseline').equals(fs.readFileSync(prefix+'-O0')),label+' O0 byte regression');}}
 }
 console.log(label,failures.length?'failures='+failures.length:'ok');
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model},assertions,failures,results},null,2)+'\n');
}
console.log(JSON.stringify({assertions,failures:failures.length,results:results.length}));for(const f of failures)console.error(f);process.exitCode=failures.length?1:0;
