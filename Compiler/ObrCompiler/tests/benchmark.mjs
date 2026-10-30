import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {guestCorpus} from './corpus.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');process.chdir(repo);
const out=path.resolve(process.env.OBRC_BENCH_OUT??'Toolchain/CompilerCheck/benchmark');fs.mkdirSync(out,{recursive:true});
const compiler=path.resolve(process.env.OBRC??'Compiler/ObrCompiler/obrc');
const baseline=path.resolve(process.env.OBRC_BASELINE??'Toolchain/CompilerCheck/baseline/obrc');
const repeats=Number(process.env.OBRC_BENCH_REPEAT??5);if(!Number.isInteger(repeats)||repeats<1)throw Error('invalid repeat count');
const snapshots={};
for(const [name,file] of [['baseline',baseline],['candidate',compiler]]){
 const target=path.join(out,name+'-obrc');fs.copyFileSync(file,target);fs.chmodSync(target,0o755);
 snapshots[name]={path:target,sha256:createHash('sha256').update(fs.readFileSync(target)).digest('hex')};
}
const variants=[['baseline',snapshots.baseline.path,[]],['O0',snapshots.candidate.path,['-O0']],['O1',snapshots.candidate.path,['-O1']],['O2',snapshots.candidate.path,['-O2']]];
const results=[];
function compile(exe,args){const start=performance.now();const r=spawnSync(exe,args,{encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(r.stderr||r.error?.message);return performance.now()-start;}
const manifest=guestCorpus(repo).filter(job=>!process.env.OBRC_BENCH_FILTER||new RegExp(process.env.OBRC_BENCH_FILTER).test(job.name));
const startedAt=new Date().toISOString();
// RSS 使用额外的编译进程，不把 time 包装器开销混入上面的计时样本。
// Darwin time -l 的 resident set size 单位为字节；Linux GNU time %M 为 KiB。
const rssTool=process.platform==='darwin'?['-l']:process.platform==='linux'?['-f','obrc-max-rss-kib %M']:null;
function profile(row){
 if(!rssTool)return {available:false,reason:'RSS profiler supports Darwin time -l and GNU time only'};
 const run=spawnSync('/usr/bin/time',[...rssTool,row.exe,...row.args],{encoding:'utf8',timeout:60000});
 const raw=run.stderr??'';const match=process.platform==='darwin'?raw.match(/(\d+)\s+maximum resident set size/):raw.match(/obrc-max-rss-kib (\d+)/);
 if(run.status!==0||!match)throw Error('RSS measurement failed: '+raw+(run.error?.message??''));
 return {available:true,bytes:Number(match[1])*(process.platform==='linux'?1024:1),command:['/usr/bin/time',...rssTool,row.exe,...row.args],raw};
}
const hostVersion=spawnSync(process.env.OBRC_CXX??'c++',['--version'],{encoding:'utf8'}).stdout?.split('\n')[0]??'unavailable';
const sourceRef=spawnSync(process.env.OBRC_GIT??'git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim()??'unavailable';
const sourcePatch=spawnSync(process.env.OBRC_GIT??'git',['diff','--binary','HEAD','--','Compiler/ObrCompiler/src','Compiler/ObrCompiler/CMakeLists.txt'],{encoding:'utf8'});
if(sourcePatch.status!==0)throw Error(sourcePatch.stderr);
fs.writeFileSync(path.join(out,'compiler-source.patch'),sourcePatch.stdout);
fs.copyFileSync(fileURLToPath(import.meta.url),path.join(out,'benchmark-source.mjs'));
fs.copyFileSync(fileURLToPath(new URL('./corpus.mjs',import.meta.url)),path.join(out,'corpus-source.mjs'));
const provenance={sourceRef,baselineRef:process.env.OBRC_BASELINE_REF??null,sourcePatchSha256:createHash('sha256').update(sourcePatch.stdout).digest('hex'),benchmarkSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
for(const job of manifest){
 const rows=variants.map(([variant,exe,opt])=>{
  const file=path.join(out,variant,job.name);fs.mkdirSync(path.dirname(file),{recursive:true});
  const args=[...job.sources,...job.flags,...opt,'-o',file];
  return {name:job.name,variant,exe,args,file,coldMs:compile(exe,args),warmMs:[]};
 });
 // 交错并轮换每一轮的起点，减小文件缓存/后台负载/温度随顺序变化的偏差。
 for(let repeat=0;repeat<repeats;++repeat)for(let at=0;at<rows.length;++at){
  const row=rows[(at+repeat)%rows.length];row.warmMs.push(compile(row.exe,row.args));
 }
 const saved=[];
 for(const row of rows){
  compile(row.exe,[...row.args,'-debug']);
  const image=fs.readFileSync(row.file);const debug=fs.readFileSync(row.file+'.debug','utf8').split('\n').slice(1,-1);
  const result={name:row.name,variant:row.variant,bytes:image.length,sha256:createHash('sha256').update(image).digest('hex'),format:image.subarray(0,4).toString(),instructions:debug.length,debugBytes:fs.statSync(row.file+'.debug').size,coldMs:row.coldMs,warmMs:row.warmMs,medianMs:[...row.warmMs].sort((a,b)=>a-b)[Math.floor(repeats/2)],peakRss:profile(row)};
  saved.push(result);results.push(result);
 }
 const old=saved[0];console.log(job.name,saved.map(r=>`${r.variant}:${r.bytes}B/${r.medianMs.toFixed(1)}ms`).join(' '));
 for(const row of saved)row.relative={bytes:row.bytes/old.bytes-1,medianMs:row.medianMs/old.medianMs-1};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({startedAt,environment:{node:process.version,os:os.release(),cpu:os.cpus()[0].model,arch:process.arch,hostCompiler:hostVersion,loadAverage:os.loadavg()},sourceRef,provenance,repeats,order:'interleaved-rotating',snapshots,manifest,results},null,2)+'\n');
}
