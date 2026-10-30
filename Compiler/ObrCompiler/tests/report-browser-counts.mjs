/** 从真实浏览器执行记录提取命令装入/退出之间的核心区间；不证明期间没有capture/restore。 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const input=path.resolve(process.argv[2]??'Toolchain/CompilerCheck/integration-strict-v5/browser-results.json');
const output=path.resolve(process.argv[3]??path.join(path.dirname(input),'command-counts.json'));
const bytes=fs.readFileSync(input),data=JSON.parse(bytes),rows=[],failures=[];
const selected=new Map();
for(const run of data.runs)if(run.mode==='smoke'&&run.result?.status==='command-complete'&&run.result.collection?.ok&&!run.interruptedBeforeResult)selected.set(run.variant+'\0'+run.command,run);
for(const run of selected.values()){
 const scope={variant:run.variant,command:run.command,run:run.run};
 const events=[...run.events].sort((a,b)=>a.time-b.time||a.order-b.order);
 const prompt=events.find(e=>e.kind==='terminal'&&e.data.rows.some(row=>/^root@zeros:.*#/.test(row.text)));
 const after=events.filter(e=>prompt&&e.time>=prompt.time);
 const installs=after.filter(e=>e.kind==='installed'&&String(e.data.target)!=='2');
 if(!installs.length)failures.push({...scope,error:'no command child installation'});
 for(const install of installs){
  const core=Number(install.data.target),next=installs.find(e=>e.time>install.time&&Number(e.data.target)===core);
  const inside=after.filter(e=>e.time>=install.time&&(!next||e.time<next.time));
  const starts=inside.filter(e=>e.kind==='guest-snapshot'&&e.data.ordinal===core&&e.data.point==='installed'&&e.data.token===install.data.token);
  const exits=inside.filter(e=>e.kind==='syscall'&&e.data.ordinal===core&&String(e.data.service)==='28');
  const halts=inside.filter(e=>e.kind==='stop'&&e.data.ordinal===core&&e.data.reason===0);
  const ends=exits.length===1?inside.filter(e=>e.kind==='guest-snapshot'&&e.data.ordinal===core&&e.data.point==='svc28'&&e.time>=exits[0].time):halts.length===1?inside.filter(e=>e.kind==='guest-snapshot'&&e.data.ordinal===core&&e.data.point==='halt'&&e.data.token===halts[0].data.token):[];
  if(starts.length!==1||ends.length!==1||(exits.length!==1&&halts.length!==1)){
   failures.push({...scope,core,error:'child counter endpoints are missing or ambiguous',starts:starts.length,exits:exits.length,halts:halts.length,ends:ends.length});continue;
  }
  const stop=exits[0]??halts[0],steps=Number(stop.data.executed)+(exits.length===1?1:0)-Number(install.data.executed);
  const first=starts[0].data.logical,last=ends[0].data.logical,loads=last.loads-first.loads,stores=last.stores-first.stores;
  if(![steps,loads,stores].every(value=>Number.isSafeInteger(value)&&value>=0)){failures.push({...scope,core,error:'invalid counter delta',steps,loads,stores});continue;}
  rows.push({...scope,core,processIsolationVerified:false,steps,loads,stores,logicalMemory:loads+stores,installToken:install.data.token,endToken:ends[0].data.token,endKind:exits.length===1?'svc28-inclusive':'halt-exclusive',startExecuted:install.data.executed,endExecuted:stop.data.executed,firstLogical:first,lastLogical:last});
 }
}
const aggregates=[];
for(const run of selected.values()){
 const children=rows.filter(row=>row.run===run.run);
 aggregates.push({variant:run.variant,command:run.command,run:run.run,children:children.length,steps:children.reduce((sum,r)=>sum+r.steps,0),logicalMemory:children.reduce((sum,r)=>sum+r.logicalMemory,0)});
}
const median=values=>{const sorted=values.sort((a,b)=>a-b);return sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;};
const summary=[];
for(const variant of ['O1','O2']){
 const pairs=aggregates.filter(r=>r.variant===variant).map(row=>{
  const old=aggregates.find(r=>r.variant==='baseline'&&r.command===row.command);
  return old?{command:row.command,baselineSteps:old.steps,steps:row.steps,stepChange:row.steps/old.steps-1,baselineMemory:old.logicalMemory,logicalMemory:row.logicalMemory,memoryChange:row.logicalMemory/old.logicalMemory-1}:null;
 }).filter(Boolean);
 summary.push({variant,pairs,medianStepChange:median(pairs.map(r=>r.stepChange)),medianMemoryChange:median(pairs.map(r=>r.memoryChange))});
}
fs.writeFileSync(output,JSON.stringify({input,inputSha256:createHash('sha256').update(bytes).digest('hex'),definition:'CpuRuntime Executed core-interval deltas: installed to svc28 inclusive (+1 because probe precedes increment), or halt exclusive (product halt is uncounted). Logical private/physical accesses use per-core FIFO snapshots. The v5 collector does not observe capture/restore, so these intervals are exploratory and cannot certify process-exclusive instruction counts or be pooled with isolated microbenchmarks. This is instruction accounting, not elapsed time.',failures,rows,aggregates,summary},null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,failures,summary},null,2));
process.exitCode=failures.length?1:0;
