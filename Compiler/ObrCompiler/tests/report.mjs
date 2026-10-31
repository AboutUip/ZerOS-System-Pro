/** 汇总已有原始数据，不重新运行编译；所有百分比按逐程序比值的中位数计算。 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const input=path.resolve(repo,process.env.OBRC_REPORT_INPUT??'Toolchain/CompilerCheck');
const output=path.resolve(repo,process.env.OBRC_REPORT_OUT??'Compiler/ObrCompiler/docs/measurements');
fs.mkdirSync(output,{recursive:true});
const read=name=>JSON.parse(fs.readFileSync(path.join(input,name),'utf8'));
const benchmarkInput=process.env.OBRC_REPORT_BENCH??'benchmark-final/results.json';
const benchmark=read(benchmarkInput);
const differential=read(process.env.OBRC_REPORT_DIFF??'differential/results.json');
const contracts=read(process.env.OBRC_REPORT_CONTRACTS??'contracts/results.json');
if(differential.failures.length)throw Error('Cannot report a failing differential run');
const median=values=>{
 const a=values.filter(Number.isFinite).sort((a,b)=>a-b);
 if(!a.length)return null;
 return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;
};
const relative=(a,b)=>b>0?a/b-1:null;
const percent=n=>n===null?'n/a':(100*n).toFixed(2)+'%';
const variants=['O0','O1','O2'];
const summary={sourceRef:benchmark.sourceRef,provenance:benchmark.provenance,snapshots:benchmark.snapshots,environment:benchmark.environment,repeats:benchmark.repeats,static:[],dynamic:[],dynamicRows:[]};
for(const variant of variants){
 for(const format of ['ZPB1','ZNB1']){
  const rows=benchmark.results.filter(r=>r.variant===variant&&r.format===format);
  summary.static.push({variant,format,programs:rows.length,totalBytes:rows.reduce((a,r)=>a+r.bytes,0),medianByteChange:median(rows.map(r=>r.relative.bytes)),medianCompileTimeChange:median(rows.map(r=>r.relative.medianMs))});
 }
 for(const format of ['ZPB1','ZNB1']){
  const rows=[];
  for(const old of differential.results.filter(r=>r.variant==='baseline'&&r.run?.kind==='halt'&&r.format===format)){
   const next=differential.results.find(r=>r.variant===variant&&r.label===old.label&&r.pie===old.pie&&r.format===format&&r.run?.kind==='halt');
   if(!next)continue; // 故障、编译拒绝、格式改变不参与完成执行的性能比较。
   const before=old.run.memory,after=next.run.memory;
   const memoryValue=m=>format==='ZPB1'?m.logical.loads+m.logical.stores:m.readOctets-m.fetchOctets+m.writeOctets;
   rows.push({label:old.label,pie:old.pie,variant,format,beforeSteps:Number(old.run.steps),afterSteps:Number(next.run.steps),stepChange:relative(Number(next.run.steps),Number(old.run.steps)),memoryUnit:format==='ZPB1'?'logical-loads-plus-stores':'data-octets-read-plus-written',beforeMemory:memoryValue(before),afterMemory:memoryValue(after),memoryChange:relative(memoryValue(after),memoryValue(before)),beforePhysicalRequests:format==='ZPB1'?before.memoryReads+before.memoryWrites:null,afterPhysicalRequests:format==='ZPB1'?after.memoryReads+after.memoryWrites:null});
  }
  summary.dynamicRows.push(...rows);
  summary.dynamic.push({variant,format,cases:rows.length,memoryCases:rows.filter(r=>Number.isFinite(r.memoryChange)).length,medianStepChange:median(rows.map(r=>r.stepChange)),medianMemoryChange:median(rows.map(r=>r.memoryChange)),memoryUnit:rows[0]?.memoryUnit??null,stepRegressions:rows.filter(r=>r.stepChange>0).map(r=>({label:r.label,pie:r.pie,change:r.stepChange}))});
 }
}
// 只规范绝对仓库路径。原始样本/计数/每次运行时间不做筛除或四舍五入。
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2).replaceAll(repo,'<repo>')+'\n');
write('benchmark.json',benchmark);write('differential.json',differential);write('contracts.json',contracts);write('summary.json',summary);write('baseline-build.json',read(process.env.OBRC_REPORT_BASELINE??'baseline-built/obrc.json'));
const sourcePatch=path.join(input,path.dirname(benchmarkInput),'compiler-source.patch');
if(benchmark.provenance?.sourcePatchSha256){const raw=fs.readFileSync(sourcePatch);if(createHash('sha256').update(raw).digest('hex')!==benchmark.provenance.sourcePatchSha256)throw Error('Measured compiler source patch hash mismatch');fs.writeFileSync(path.join(output,'compiler-source.patch.gz'),gzipSync(raw,{level:9}));}
for(const level of ['O1','O2'])if(fs.existsSync(path.join(input,`artifacts-${level}.json`)))write(`artifacts-${level}.json`,read(`artifacts-${level}.json`));
let md='# 实测数据表\n\n由 `node Compiler/ObrCompiler/tests/report.mjs` 从原始结果生成。测量时工作区 HEAD `'+benchmark.sourceRef+'`；[源码补丁](compiler-source.patch.gz) 解压后 SHA256 为 `'+benchmark.provenance?.sourcePatchSha256+'`，逐文件源码身份见 benchmark.json 的 provenance.compilerSources（若该轮提供）。基线提交 `'+(benchmark.provenance?.baselineRef??'见 baseline-build.json')+'`。同一台 '+benchmark.environment.cpu+' / '+benchmark.environment.arch+'，Node '+benchmark.environment.node+'，OS '+benchmark.environment.os+'，'+benchmark.environment.hostCompiler+'。每种编译 1 次首次运行 + '+benchmark.repeats+' 次交错轮换独立进程运行；表中时间是后者中位数。首次运行没有清空 OS 文件缓存。\n\n';
const binCount=benchmark.manifest.filter(row=>row.name.startsWith('bin/')).length;
md+='## 真实 NAS 语料\n\n共 '+benchmark.manifest.length+' 个程序，包含 '+binCount+' 个 /bin 入口和 '+(benchmark.manifest.length-binCount)+' 个 kernel/os/app 程序；以本轮 manifest 为准，历史附件的字节数不作为本次基线。\n\n';
md+='| 级别 | 格式 | 程序数 | 总字节 | 字节变化中位数 | 编译耗时变化中位数 |\n|---|---|---:|---:|---:|---:|\n';
for(const r of summary.static)md+=`| ${r.variant} | ${r.format} | ${r.programs} | ${r.totalBytes} | ${percent(r.medianByteChange)} | ${percent(r.medianCompileTimeChange)} |\n`;
const nonPie=benchmark.manifest.filter(row=>!row.flags.includes('-pie')&&!row.flags.includes('-shared'));
md+='\n本轮真实非 PIE 语料共 '+nonPie.length+' 个：'+nonPie.map(row=>row.name).join('、')+'。';
for(const variant of variants){const rows=benchmark.results.filter(row=>row.variant===variant&&nonPie.some(job=>job.name===row.name));md+=variant+' 的 ZNB1 覆盖 '+rows.filter(row=>row.format==='ZNB1').length+'/'+nonPie.length+'；';}
md+='其余 '+(benchmark.manifest.length-nonPie.length)+' 个输入仍受既有 PIE/shared 契约限制。这个分母不代表任意合法非 PIE 输入均可 native。\n\n';
md+='| 程序 | 级别 | 格式 | 字节 | 字节变化 | 静态发射行 | debug 字节 | 首次 ms | 热中位 ms | 时间变化 |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n';
for(const r of benchmark.results)md+=`| ${r.name} | ${r.variant} | ${r.format} | ${r.bytes} | ${percent(r.relative.bytes)} | ${r.instructions} | ${r.debugBytes} | ${r.coldMs.toFixed(2)} | ${r.medianMs.toFixed(2)} | ${percent(r.relative.medianMs)} |\n`;
md+='\n“静态发射行”来自 debug 行数，native 一行可能扩成多条机器指令，不等于动态执行步数。原始 JSON 保留每次 warmMs 和完整源文件/参数 manifest。\n\n## 差分执行计数\n\n只统计基线与候选均正常 halt、格式相同的 `(label, pie)` 配对；同一个源的 PIE 与非 PIE 是不同装入路径。基线故障而候选修复、故障样本、拒绝输入与仅解码样本不参加性能中位数。下面是示例与微基准的单次确定性执行计数，不能外推为整机或 /bin 工作负载性能。\n\n';
md+='| 级别 | 格式 | 执行配对数 | 访存有效配对数 | 执行步数中位变化 | 内存指标中位变化 | 内存单位 | 步数退化个数 |\n|---|---|---:|---:|---:|---:|---|---:|\n';
for(const r of summary.dynamic)md+=`| ${r.variant} | ${r.format} | ${r.cases} | ${r.memoryCases} | ${percent(r.medianStepChange)} | ${percent(r.medianMemoryChange)} | ${r.memoryUnit} | ${r.stepRegressions.length} |\n`;
md+='\nZAP 的 logical-loads-plus-stores 包含私有缓存命中及成功主板访问；physicalRequests 是另外记录的真实主板请求，很多小程序全部命中缓存。Native 只报告扣除取指后的数据八位组数，不把它当成访存指令次数，也不与 ZAP 逻辑操作数混用。汇总没有将 CPU 缓存维护的宿主字节数当成来宾逻辑访存。\n\n';
md+=`差分 ${differential.results.length} 组合，${differential.assertions} 断言，${differential.failures.length} 失败。契约测试 ${contracts.checks} 项；详细用例、返回值、事件、内存、fault 源位置均见对应 JSON。\n`;
fs.writeFileSync(path.join(output,'Tables.md'),md);
console.log(JSON.stringify({static:summary.static,dynamic:summary.dynamic},null,2));
