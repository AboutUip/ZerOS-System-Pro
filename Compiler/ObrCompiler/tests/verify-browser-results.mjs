/** 独立验收器：只读原始事件与PNG。采集结束、提示符出现不等价于差分通过。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {publicFaultSnapshot,faultSnapshotAtBarrier,faultSnapshotRequired} from './PublicFaultSignatures.mjs';
// Derived from independent strict_requirements_test audit; no product runtime mutations.
const historicalPublicFaults=process.argv.includes('--historical-public-faults');
const args=process.argv.slice(2).filter(arg=>arg!=='--historical-public-faults');
if(!args[0]||args.some(arg=>arg.startsWith('--')))throw Error('Usage: node verify-browser-results.mjs browser-results.json [report.json] [timing-browser-results.json] [--historical-public-faults]');
const input=path.resolve(args[0]),artifact=path.dirname(input);
const output=path.resolve(args[1]??path.join(artifact,'independent-browser-verification.json'));
const inputBytes=fs.readFileSync(input),data=JSON.parse(inputBytes);
const timingInput=args[2]?path.resolve(args[2]):input;
const timingBytes=timingInput===input?inputBytes:fs.readFileSync(timingInput);
const timingData=timingInput===input?data:JSON.parse(timingBytes);
const failures=[],checks=[],notes=[],incomplete=[],historical=[],manualEvidence=[];
const incompleteFile=path.join(artifact,'known-incomplete-runs.json');
const knownIncomplete=fs.existsSync(incompleteFile)?JSON.parse(fs.readFileSync(incompleteFile)):[];
function check(ok,scope,message,details){checks.push({scope,message,ok:Boolean(ok)});if(!ok)failures.push({scope,message,details});}
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function median(values){const a=[...values].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;}
function decodePng(url){
 const png=Buffer.from(url.slice('data:image/png;base64,'.length),'base64');
 if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('invalid PNG signature');
 let width,height,channels;const compressed=[];
 for(let at=8;at<png.length;){const size=png.readUInt32BE(at),kind=png.subarray(at+4,at+8).toString(),chunk=png.subarray(at+8,at+8+size);if(at+12+size>png.length)throw Error('truncated PNG');
  if(kind==='IHDR'){width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);if(chunk[8]!==8||![2,6].includes(chunk[9])||chunk[10]||chunk[11]||chunk[12])throw Error('unsupported Chrome PNG format');channels=chunk[9]===6?4:3;}
  if(kind==='IDAT')compressed.push(chunk);at+=size+12;
 }
 if(!width||!height||width*height>10000000)throw Error('invalid dimensions');
 const packed=zlib.inflateSync(Buffer.concat(compressed)),stride=width*channels,raw=Buffer.alloc(width*height*4);if(packed.length!==(stride+1)*height)throw Error('PNG decoded size mismatch');
 let previous=Buffer.alloc(stride),cursor=0;
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=packed[cursor++],row=Buffer.alloc(stride);if(filter>4)throw Error('invalid PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;row[x]=(packed[cursor++]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}for(let x=0;x<width;x++){const from=x*channels,to=(y*width+x)*4;raw[to]=row[from];raw[to+1]=row[from+1];raw[to+2]=row[from+2];raw[to+3]=channels===4?row[from+3]:255;}previous=row;}
 return {width,height,raw,pngSha256:sha(png)};
}
function eventsOf(run){return [...run.events].sort((a,b)=>a.time-b.time||a.order-b.order);}
function collectedEvents(run,raw,scope){
 if(run.mode==='timing')return raw;
 const c=run.result?.collection;
 check(Boolean(c&&c.ok&&typeof c.token==='string'),scope,'collection has a successful explicit producer barrier',c);
 if(!c||!Array.isArray(c.producers)||!Array.isArray(c.acks))return raw;
 const expected={page:1,'ZerOS.Hardware.Motherboard':1,'ZerOS.Hardware.Memory':1,'ZerOS.Hardware.Cpu':1,'ZerOS.Hardware.Cpu.Core':8};
 const sources=new Set(c.producers.map(p=>p.source)),roles=c.producers.map(p=>p.name);
 check(sources.size===12&&c.producers.length===12&&Object.entries(expected).every(([role,count])=>roles.filter(v=>v===role).length===count),scope,'all twelve required producers occur exactly once',c.producers);
 check(Array.isArray(c.errors)&&c.errors.length===0,scope,'producer transport reported no errors',c.errors);
 check(c.acks.length===sources.size&&new Set(c.acks.map(a=>a.source)).size===sources.size&&c.acks.every(a=>sources.has(a.source)),scope,'barrier ACK set equals producer set');
 const cut=new Map();
 for(const producer of c.producers){
  const ack=c.acks.find(a=>a.source===producer.source),events=raw.filter(e=>e.source===producer.source);
  check(Boolean(ack&&ack.token===c.token&&!ack.error&&Number.isInteger(ack.through)&&ack.through>=1&&ack.watermark===ack.through+1),scope,'ACK binds token, source and exact sequence watermark',{producer,ack});
  if(!ack)continue;
  const declared=events.filter(e=>e.kind==='producer');
  check(declared.length===1&&declared[0].data.name===producer.name,scope,'producer identity is backed by its original raw announcement',{producer,declared});
  const watermarks=events.filter(e=>e.kind==='watermark'&&e.data.token===c.token);
  check(watermarks.length===1&&watermarks[0].order===ack.watermark&&watermarks[0].data.through===ack.through,scope,'ACK cutoff is backed by the raw watermark event',{ack,watermarks});
  const seq=events.filter(e=>e.order<=ack.watermark).map(e=>e.order).sort((a,b)=>a-b);
  check(seq.length===ack.watermark&&seq.every((n,i)=>n===i+1),scope,'every event through the acknowledged cutoff is present once',{source:producer.source,cutoff:ack.watermark,count:seq.length});
  cut.set(producer.source,ack.watermark);
 }
 check(raw.every(e=>sources.has(e.source)),scope,'all raw event producers belong to the acknowledged producer set');
 return raw.filter(e=>e.order<=(cut.get(e.source)??Infinity));
}
function rowsOf(event){return (event?.data?.rows??[]).map(row=>row.text.trimEnd()).filter(Boolean);}
const prompt=/^root@zeros:.*#/;
function firstTerminal(events){return events.find(e=>e.kind==='terminal'&&rowsOf(e).some(row=>prompt.test(row)));}
function normalizedPicture(run,events,scope){
 try{const image=decodePng(run.result.png);check(image.width===run.result.width&&image.height===run.result.height,scope,'PNG dimensions equal recorded canvas');
  const rows=events.filter(e=>e.kind==='terminal').at(-1)?.data?.rows??[],last=rows.at(-1);
  check(Boolean(last&&/^root@zeros:.*#\s*$/.test(last.text)),scope,'pixel mask has an explicit final prompt');
  if(last){const x=Number(last.x??0)+last.text.length*8,y=Number(last.y);if(!Number.isInteger(x)||!Number.isInteger(y))throw Error('noninteger cursor geometry');for(let yy=Math.max(y,0);yy<Math.min(y+16,image.height);yy++)for(let xx=Math.max(x,0);xx<Math.min(x+8,image.width);xx++)image.raw.fill(0,(yy*image.width+xx)*4,(yy*image.width+xx)*4+4);}
  const hash=sha(image.raw);check(hash===run.result.pixelHash,scope,'independent PNG decode reproduces normalized pixelHash',{actual:hash,reported:run.result.pixelHash});
  return {hash,width:image.width,height:image.height,raw:image.raw,pngSha256:image.pngSha256};
 }catch(error){check(false,scope,'original PNG must independently decode',String(error));return null;}
}
function expected(command){
 const simple={'pwd':['/'],'ls':['bin','boot','font','kernel','os'],'cat /boot/compiler-input':['alpha','beta'],'grep beta /boot/compiler-input':['beta'],'cp /boot/compiler-input /boot/compiler-out':[],'sort /boot/compiler-input':['alpha','beta'],'head /boot/compiler-input':['alpha','beta'],'wc /boot/compiler-input':['2 2 11 /boot/compiler-input'],'echo compiler-ok':['compiler-ok'],'cat /boot/compiler-input | xargs echo':['alpha beta'],'compiler-signal-smoke':['signal-ok 10 12 0'],'/bin/compiler-signal-smoke':['signal-ok 10 12 0'],'xargs echo < /boot/compiler-input':['alpha beta']};
 if(command==='find /boot'){const root=path.join(artifact,'baseline/NasRoot/boot');return ['/boot',...fs.readdirSync(root).filter(name=>name!=='compiler-out').sort().map(name=>'/boot/'+name)];}
 return simple[command];
}
const commands=['pwd','ls','cat /boot/compiler-input','grep beta /boot/compiler-input','cp /boot/compiler-input /boot/compiler-out','find /boot','sort /boot/compiler-input','head /boot/compiler-input','wc /boot/compiler-input','echo compiler-ok','cat /boot/compiler-input | xargs echo','xargs echo < /boot/compiler-input','compiler-signal-smoke'];
function exitEvidence(events,terminal,scope){
 const after=events.filter(e=>terminal&&e.time>=terminal.time),returnValues=[],exits=[],directExits=[];
 const waits=new Map();
 for(const event of after){
  if(event.kind==='syscall'&&String(event.data.service)==='21'){
   check(event.data.home!==undefined,scope,'wait21 records its actual bound origin');
   const list=waits.get(String(event.data.ordinal))??[];list.push({event,writes:[]});waits.set(String(event.data.ordinal),list);
  }else if(event.kind==='control-write'&&event.data.actor===2){
   const list=waits.get(String(event.data.ordinal))??[];
   for(const pending of list){if(pending.event.data.home===undefined)continue;try{if(BigInt(event.data.address)===BigInt(pending.event.data.home)+192n)pending.writes.push(event);}catch{}}
  }else if(event.kind==='reply'&&String(event.data.from)==='2'){
   const list=waits.get(String(event.data.to))??[];let pid;try{pid=BigInt(event.data.data);}catch{continue;}
   if(pid<=0n)continue;
   const candidates=list.filter(w=>w.writes.length>0);
   // 同一物理core可能复用多个任务，不能在多个pending wait之间猜测。
   if(candidates.length>1){check(false,scope,'wait status association is unambiguous across reused tasks',{parentCore:event.data.to,pending:candidates.length});continue;}
   if(candidates.length!==1){waits.delete(String(event.data.to));continue;}
   const pending=candidates[0],write=pending.writes.at(-1);
   check(write.data.width===64&&write.data.token!==undefined&&write.data.evidence==='successful-native-writeback',scope,'wait status came from a successful 64-bit write with provenance token',write.data);
   try{const value=BigInt(write.data.value);check(value>=0n&&value<=255n,scope,'kernel wait status is already an exitBits value',{value:String(value)});exits.push({ordinal:event.data.to,pid:String(pid),code:String(value),evidence:'wait21-status-write-reply',statusToken:write.data.token});}catch{check(false,scope,'wait status contains an actual integer');}
   waits.delete(String(event.data.to));
  }
 }
 for(const event of after.filter(e=>(e.kind==='guest-snapshot'&&e.data.point==='halt')||(e.kind==='guest-exit'&&e.data.evidence==='halt-r0'))){
  const token=event.data.stopToken??event.data.token,matching=after.find(e=>e.kind==='stop'&&e.data.reason===0&&e.data.ordinal===event.data.ordinal&&(e.data.stopToken??e.data.token)===token);
  check(token!==undefined&&Boolean(matching)&&event.time>=matching.time,scope,'halt return register is bound to its actual FIFO stop token',{event:event.data});
  if(event.kind==='guest-snapshot')check(Number.isInteger(event.data.logical?.loads)&&event.data.logical.loads>=0&&Number.isInteger(event.data.logical?.stores)&&event.data.logical.stores>=0,scope,'FIFO snapshot includes nonnegative cumulative logical counters',event.data);
  returnValues.push({ordinal:event.data.ordinal,value:String(event.data.returnValue??event.data.code),evidence:'halt-r0'});
 }
 for(const svc of after.filter(e=>e.kind==='syscall'&&String(e.data.service)==='28')){
  if(svc.data.home===undefined){notes.push({scope,message:'optional direct svc28 evidence unavailable: no bound origin',ordinal:svc.data.ordinal});continue;}
  let address;try{address=BigInt(svc.data.home)+128n;}catch{check(false,scope,'svc28 bound origin is an integer');continue;}
  const next=after.find(e=>e.time>svc.time&&((e.kind==='syscall'&&e.data.ordinal===svc.data.ordinal)||(e.kind==='installed'&&String(e.data.target)===String(svc.data.ordinal))||(e.kind==='control-write'&&String(e.data.address)===String(address))));
  const reads=after.filter(e=>e.kind==='control-read'&&e.time>=svc.time&&(!next||e.time<next.time)&&String(e.data.address)===String(address));
  const read=reads[0];if(!read){notes.push({scope,message:'optional direct svc28 evidence unavailable: no physical control read (may be cached)',ordinal:svc.data.ordinal,address:String(address)});continue;}
  check(read.data.width===64,scope,'exit control read proves a successful 64-bit access',{read:read.data});
  check(read.data.value!==undefined,scope,'exit control read includes its actual value');if(read.data.value===undefined)continue;
  try{const raw=BigInt(read.data.value),code=Number((raw%256n+256n)%256n);directExits.push({ordinal:svc.data.ordinal,code:String(code),evidence:'svc28-control-read',raw:String(raw),address:String(address)});}catch{check(false,scope,'exit control value is a signed integer');}
 }
 // task-code-write can prove scheduler exit, but a constant synthesized from halt is not evidence.
 for(const event of after.filter(e=>e.kind==='guest-exit'&&e.data.evidence==='task-code-write')){
  const raw=after.find(e=>e.kind==='task-code-write'&&e.data.token===event.data.token&&String(e.data.code)===String(event.data.code)&&e.data.ordinal===event.data.ordinal);
  check(Boolean(raw),scope,'scheduler exit links to an actual task-code write',event.data);if(raw)exits.push({ordinal:raw.data.ordinal,code:String(raw.data.code),evidence:'task-code-write'});
 }
 check(exits.length>0,scope,'actual OS exit state is observed separately from main returnValue');
 if(exits.length>0)check(exits.every(e=>e.code==='0'),scope,'valid fixture commands exited successfully',exits);
 return {returnValues,exits,directExits};
}
function signalEvidence(events,terminal,scope,run){
 const after=events.filter(e=>terminal&&e.time>=terminal.time),calls=after.filter(e=>e.kind==='syscall'&&['18','19'].includes(String(e.data.service))),cores=new Set(calls.map(e=>String(e.data.ordinal))),observed=[],rawReplies=[];
 check(cores.size===1,scope,'signal fixture calls have one actual guest caller',Array.from(cores));
 const expected=[['19','0'],['18','0'],['18','-1'],['18','2'],['18','0'],['18','0'],['18','0'],['18','0'],['19','10'],['19','12'],['19','0']];
 for(const call of calls){
  const index=after.indexOf(call),end=after.findIndex((e,i)=>i>index&&e.kind==='syscall'&&String(e.data.ordinal)===String(call.data.ordinal));
  const replies=after.slice(index+1,end<0?undefined:end).filter(e=>e.kind==='reply'&&String(e.data.from)==='2'&&String(e.data.to)===String(call.data.ordinal));
  check(replies.length===1,scope,'signal syscall has exactly one actual supervisor reply before the next call',{call:call.data,replies:replies.map(e=>e.data)});
  check(call.data.home!==undefined,scope,'signal syscall carries its actual bound origin',call.data);
  if(replies.length===1){try{const word=BigInt(replies[0].data.data),bounded=word>=-(1n<<63n)&&word<=(1n<<64n)-1n;check(bounded,scope,'signal supervisor reply is one actual 64-bit ABI word',{raw:String(word)});if(bounded){rawReplies.push([String(call.data.service),String(word)]);observed.push([String(call.data.service),String(BigInt.asIntN(64,word))]);}}catch(error){check(false,scope,'signal reply is an actual integer',String(error));}}
 }
 check(equal(observed,expected),scope,'real svc18/19 replies prove probe, rejection, delivery order, duplicate coalescing and drain',{expected,observed});
 try{
  const manifest=JSON.parse(fs.readFileSync(path.join(artifact,'signal-build/manifest.json'))),row=manifest.rows.find(r=>r.variant===run.variant),target=path.join(artifact,run.variant,'NasRoot/bin/compiler-signal-smoke'),sourceFile=[path.join(artifact,'signal-build/source/signal-smoke.obr'),manifest.source.file].find(file=>file&&fs.existsSync(file));
  check(Boolean(row&&sha(fs.readFileSync(target))===row.sha256&&sourceFile&&sha(fs.readFileSync(sourceFile))===manifest.source.sha256),scope,'executed signal guest matches independently built fixture source and image hash',{row,source:manifest.source});
 }catch(error){check(false,scope,'signal fixture source/image provenance is present',String(error));}
 return {normalized:observed,raw:rawReplies};
}
const canonical=command=>command==='/bin/compiler-signal-smoke'?'compiler-signal-smoke':command;
const latestSamples=new Map();for(const row of data.runs){if(row.mode!=='smoke'||!row.result||row.interruptedBeforeResult||!commands.includes(canonical(row.command)))continue;const key=row.variant+' '+canonical(row.command),old=latestSamples.get(key);if(!old||Date.parse(row.started)>Date.parse(old.started))latestSamples.set(key,row);}
const historyFile=path.join(artifact,'documented-historical-runs.json');
const documentedHistory=fs.existsSync(historyFile)?JSON.parse(fs.readFileSync(historyFile)):[];
function manual(run){
 const record={run:run.run,mode:run.mode,resultStatus:run.result?.status??null,captures:[]};manualEvidence.push(record);
 if(!run.manualCaptures?.length){record.note='No capture in this preliminary manual-mode run; neither ordinary boot failure nor a passed manual device test.';return;}
 const dir=output+'.manual';fs.mkdirSync(dir,{recursive:true});
 for(let i=0;i<run.manualCaptures.length;i++){const c=run.manualCaptures[i],scope='manual device '+run.run+' '+i;
  try{const picture=decodePng(c.png);check(picture.width===640&&picture.height===480&&c.width===640&&c.height===480,scope,'original manual PNG has actual device dimensions');
   const inputs=c.nativeInputs??[];check(inputs.length>0&&inputs.every(e=>e.trusted===true&&Number.isFinite(e.time)&&e.time<=c.time),scope,'manual input records contain observed trusted events preceding capture');
   const file=path.join(dir,run.run+'-'+i+'.png');fs.writeFileSync(file,Buffer.from(c.png.slice('data:image/png;base64,'.length),'base64'));
   record.captures.push({label:c.label,time:c.time,pngSha256:picture.pngSha256,file,inputs:inputs.length,pointerDown:inputs.filter(e=>e.kind==='pointerdown').length,arrowUp:inputs.filter(e=>e.kind==='keydown'&&e.key==='ArrowUp').length,setup:c.setup});
  }catch(error){check(false,scope,'manual PNG and input evidence independently decode',String(error));}
 }
 check(record.captures.length>=3&&record.captures.some(c=>c.pointerDown>0)&&record.captures.some(c=>c.arrowUp>0),'manual device '+run.run,'manual record contains pointer and ArrowUp smoke evidence with three raw captures');
 record.note='PNG visual contents were independently inspected as CPU, CPU after ArrowUp, GPU. This is a separate O1 manual device smoke; no boot-to-shell, timing, latency, or 60-FPS inference.';
}
const referenceRun=latestSamples.get('baseline pwd'),referenceEvents=referenceRun?eventsOf(referenceRun):[],referenceKernel=referenceEvents.find(e=>e.kind==='installed'&&String(e.data.target)==='2');
let publicFaultReference=null;try{publicFaultReference=publicFaultSnapshot(referenceEvents,referenceKernel?.time??-Infinity);check(publicFaultReference.observed,'public faults reference','baseline has an observed pre-kernel public fault list');if(publicFaultReference.observed)check(publicFaultReference.signatures.every(f=>referenceEvents.some(e=>e.kind==='stop'&&e.time<referenceKernel.time&&e.data.reason===3&&e.data.ordinal===f.Core&&e.data.index===f.Index&&e.data.op===f.Op)),'public faults reference','every reference signature is backed by an actual pre-kernel fault stop');}catch(error){check(false,'public faults reference','reference public fault list is valid',String(error));}
function publicFaultEvidence(events,scope,formal=true,run=null){
 try{const final=publicFaultSnapshot(events),same=Boolean(final.observed&&publicFaultReference?.observed&&equal(final.signatures,publicFaultReference.signatures)),extra=final.observed&&publicFaultReference?.observed?final.signatures.filter(v=>!publicFaultReference.signatures.some(r=>equal(v,r))):[];
  if(formal){check(final.observed,scope,'a public Faults/LastFault snapshot is observed');check(same,scope,'observed final public fault signatures equal the full intentional baseline boot reference',{reference:publicFaultReference?.signatures,actual:final.signatures,newPublicFaults:extra});}
  let freshAtBarrier=false;
  const requireFresh=faultSnapshotRequired(run,historicalPublicFaults);
  if(requireFresh){
   const freshness=faultSnapshotAtBarrier(events,run.result.collection,final);freshAtBarrier=freshness.fresh;
   if(formal)check(freshAtBarrier,scope,'final public fault list is captured at the page producer barrier cutoff',freshness);
  }
  return {...final,passed:same&&(!requireFresh||freshAtBarrier),newPublicFaults:extra,verdict:!same?'failed-new-or-missing-public-fault':requireFresh&&!freshAtBarrier?'failed-stale-public-fault-snapshot':'observed-signatures-match',freshAtBarrier,requireFresh};
 }catch(error){if(formal)check(false,scope,'public fault snapshots have a valid append-only signature history',String(error));return{passed:false,verdict:'invalid-public-fault-evidence',error:String(error),freshAtBarrier:false};}
}
notes.push({scope:'public faults freshness',historicalPublicFaults,text:historicalPublicFaults?'Explicit historical-public-faults mode: v5 records only support their last observed 250ms snapshot. This mode cannot establish the current candidate barrier freshness.':'All formal smoke records require a full page Faults/LastFault read immediately before that page producer watermark, regardless of any self-declared result flag. This is the explicit page sampling point, not a guarantee about future faults or physical display scanout.'});
const derived=new Map();
for(const run of data.runs){
 const scope=`${run.variant} ${run.command||run.mode} ${run.run}`,rawEvents=eventsOf(run);
 if(run.mode==='bios-manual'){manual(run);continue;}
 if(!run.result||run.interruptedBeforeResult){const known=knownIncomplete.find(item=>item.run===run.run);incomplete.push({run:run.run,variant:run.variant,command:run.command,started:run.started,events:rawEvents.length,reason:known?.reason??(run.interruptedBeforeResult?'producer marked interrupted before result':'no final result: active or interrupted'),compilerFailure:false});continue;}
 const selected=latestSamples.get(run.variant+' '+canonical(run.command));
 if(run.mode==='smoke'&&selected&&selected.run!==run.run){const documented=documentedHistory.find(item=>item.run===run.run);historical.push({run:run.run,variant:run.variant,command:run.command,status:run.result.status,events:rawEvents.length,selectedReplacement:selected.run,reason:documented?.reason??'Superseded complete sample; latest complete sample is used for current coverage.',manifest:documented?.manifest??null,publicFaults:publicFaultEvidence(rawEvents,scope,false)});if(run.result.status!=='command-complete'&&!documented)check(false,scope,'superseded unsuccessful sample still requires an explicit explanation',run.result.status);continue;}
 const events=collectedEvents(run,rawEvents,scope);
 check(true,scope,'case has a terminal result and was not interrupted before result');
 check(events.every(e=>e.run===run.run&&Number.isFinite(e.time)&&Number.isInteger(e.order)&&typeof e.source==='string'),scope,'all raw events have matching run, clock, producer and sequence');
 const power=events.filter(e=>e.kind==='power'),page=events.filter(e=>e.kind==='page'),terminal=firstTerminal(events);
 check(power.length===1&&page.length===1,scope,'exactly one actual power event and page identity');
 check(Boolean(terminal),scope,'native present contains an actual shell prompt');
 check(!events.some(e=>['page-error','input-error'].includes(e.kind)),scope,'no page/input errors',events.filter(e=>['page-error','input-error'].includes(e.kind)));
 if(terminal&&power[0])check(Math.abs(run.result.bootMs-(terminal.time-power[0].time))<0.01,scope,'bootMs matches raw prompt/power events');
 const bySource=new Map();for(const e of events){const seq=bySource.get(e.source)??[];seq.push(e.order);bySource.set(e.source,seq);}
 if(run.mode!=='timing')for(const [source,seq]of bySource){seq.sort((a,b)=>a-b);check(seq.every((n,i)=>n===i+1),scope,'smoke producer event sequence is complete and unique',{source,sequence:seq.filter((n,i)=>n!==i+1).slice(0,20),max:seq.at(-1),count:seq.length});}
 // 开机CPU自检在Power之后；以实际监督内核装入为界，不笼统豁免任何core3/div。
 const kernel=events.find(e=>e.kind==='installed'&&String(e.data.target)==='2');
 const preKernelFaults=events.filter(e=>e.kind==='stop'&&e.data.reason===3&&kernel&&e.time<kernel.time).map(e=>({ordinal:e.data.ordinal,index:e.data.index,op:e.data.op,detail:e.data.detail}));
 const postKernelFaults=events.filter(e=>e.kind==='stop'&&e.data.reason===3&&(!kernel||e.time>=kernel.time)).map(e=>e.data);
 if(run.mode!=='timing')check(Boolean(kernel),scope,'actual kernel install boundary observed');
 if(run.mode!=='timing')check(postKernelFaults.length===0,scope,'no execution faults after actual kernel install',postKernelFaults);
 const publicFaults=publicFaultEvidence(events,scope,true,run);
 const final=events.filter(e=>e.kind==='terminal').at(-1),rows=rowsOf(final);
 check(equal(run.result.rows,rows),scope,'recorded rows equal latest raw terminal frame',{recorded:run.result.rows,raw:rows});
 if(run.command){
  check(run.result.status==='command-complete',scope,'command returned to prompt',run.result.status);
  check(events.some(e=>e.kind==='input-done'&&e.data.text===run.command+'\n'),scope,'exact complete command was delivered');
  const p=rows.map((row,i)=>prompt.test(row)?i:-1).filter(i=>i>=0),stdout=p.length>=2?rows.slice(p[0]+1,p.at(-1)):null;
  check(p.length===2&&rows[p[0]]==='root@zeros:/# '+run.command&&rows[p[1]]==='root@zeros:/#',scope,'command echo and final prompt exactly match',{rows});
  const gold=expected(run.command);check(gold!==undefined&&equal(stdout,gold),scope,'stdout matches independent fixture golden',{expected:gold,actual:stdout});
  check(run.command.startsWith('cp ')?run.result.outputFile==='alpha\nbeta\n':run.result.outputFile===null,scope,'file side effect matches case',{actual:run.result.outputFile});
  const exit=exitEvidence(events,terminal,scope);
  const signal=['compiler-signal-smoke','/bin/compiler-signal-smoke'].includes(run.command)?signalEvidence(events,terminal,scope,run):null;
  const after=events.filter(e=>terminal&&e.time>=terminal.time),picture=normalizedPicture(run,events,scope);
  derived.set(run.run,{scope,rows,stdout,preKernelFaults,postKernelFaults,picture,syscalls:after.filter(e=>e.kind==='syscall').map(e=>({ordinal:e.data.ordinal,service:String(e.data.service),native:e.data.native})),nas:after.filter(e=>e.kind==='nas-request').map(e=>e.data),exit:exit.exits.map(e=>({ordinal:e.ordinal,code:e.code})),returnValues:exit.returnValues,signal,publicFaults});
 }else check(run.result.status==='booted',scope,'boot completed without command');
}
const comparisons=[],coverage=[];
for(const command of commands){
 const selected=new Map();for(const variant of ['baseline','O1','O2']){const matches=data.runs.filter(r=>r.mode==='smoke'&&canonical(r.command)===command&&r.variant===variant&&r.result&&!r.interruptedBeforeResult).sort((a,b)=>Date.parse(a.started)-Date.parse(b.started));check(matches.length>0,'coverage','required command/variant has a complete noninterrupted sample',{command,variant});selected.set(variant,matches.at(-1));coverage.push({command,variant,run:matches.at(-1)?.run??null,status:matches.at(-1)?.result?.status??'missing'});}
 const old=selected.get('baseline'),a=old&&derived.get(old.run);if(!a)continue;
 for(const variant of ['O1','O2']){const row=selected.get(variant),b=row&&derived.get(row.run);if(!b)continue;const scope=`differential ${command} ${variant}`;
  check(equal(a.rows,b.rows),scope,'terminal rows equal baseline');check(equal(a.stdout,b.stdout),scope,'stdout equals baseline');
  check(equal(a.preKernelFaults,b.preKernelFaults),scope,'pre-kernel hardware self-test fault signatures equal baseline');
  check(equal(a.syscalls,b.syscalls),scope,'complete post-prompt syscall sequence equals baseline',{baseline:a.syscalls,candidate:b.syscalls});
  check(equal(a.nas,b.nas),scope,'raw post-prompt NAS request sequence equals baseline',{baseline:a.nas,candidate:b.nas,note:'Executable loading requests may differ with image sizes; they are disclosed, not silently waived.'});
  check(a.exit.length>0&&equal(a.exit,b.exit),scope,'observed exit statuses equal baseline',{baseline:a.exit,candidate:b.exit});
  const same=Boolean(a.picture&&b.picture&&a.picture.width===b.picture.width&&a.picture.height===b.picture.height&&a.picture.hash===b.picture.hash);let difference=null;
  if(!same&&a.picture&&b.picture&&a.picture.width===b.picture.width&&a.picture.height===b.picture.height){let pixels=0,minX=Infinity,minY=Infinity,maxX=-1,maxY=-1;for(let at=0;at<a.picture.raw.length;at+=4)if(!a.picture.raw.subarray(at,at+4).equals(b.picture.raw.subarray(at,at+4))){pixels++;const pos=at/4,x=pos%a.picture.width,y=Math.floor(pos/a.picture.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}difference={pixels,box:pixels?[minX,minY,maxX,maxY]:null};}
  check(same,scope,'independently decoded pixels equal baseline (one explicit cursor cell excluded)',difference);comparisons.push({command,variant,pixelDifference:difference});
 }
}
if(timingInput!==input){
 const oldRoot=path.dirname(timingInput);let checked=0;
 for(const variant of ['baseline','O1','O2']){
  const old=JSON.parse(fs.readFileSync(path.join(oldRoot,variant,'manifest.json'))),now=JSON.parse(fs.readFileSync(path.join(artifact,variant,'manifest.json')));
  for(const key of ['programs','firmware'])for(const item of now[key]){
   const previous=old[key].find(row=>row.name===item.name),relative=key==='programs'?'NasRoot/'+item.name:'firmware/'+item.name;
   try{const a=sha(fs.readFileSync(path.join(oldRoot,variant,relative))),b=sha(fs.readFileSync(path.join(artifact,variant,relative)));check(Boolean(previous&&a===previous.sha256&&b===item.sha256&&a===b),'timing provenance','borrowed timing uses identical actual guest image and declared hashes',{variant,relative,old:a,current:b});checked++;}catch(error){check(false,'timing provenance','all actual timing guest images exist',{variant,relative,error:String(error)});}
  }
 }
 notes.push({scope:'timing provenance',checked,text:'Supplemental N5 timing is explicitly from a separately identified observer build. Identical guest images permit attribution to those compiler outputs; this is not a new timing run of the latest observer and does not transfer host compiler timing.'});
}
const timingRuns=timingData.runs.filter(r=>r.mode==='timing').sort((a,b)=>Date.parse(a.started)-Date.parse(b.started));
// 固定轮次之间有独立运行间隔；整轮保留，不挑选最快样本，也不混合多轮中位数。
const groups=[];for(const run of timingRuns){const last=groups.at(-1),previous=last?.at(-1);if(!last||Date.parse(run.started)-Date.parse(previous.started)>120000)groups.push([run]);else last.push(run);}
const timing={groups:[]};check(groups.length>0,'timing','at least one complete recorded N5 group exists');
for(const group of groups){
 const scope='timing '+group[0].started,entry={started:group[0].started,runs:group.map(r=>r.run),variants:{}};
 check(group.length===15,scope,'one uninterrupted group has exactly fifteen samples',{actual:group.length});
 for(const variant of ['baseline','O1','O2']){
  const rows=group.filter(r=>r.variant===variant);
  check(rows.length===5&&rows.every(r=>r.result?.status==='booted'&&r.result.bootMs>0),scope,'five successful fixed-variant samples',{variant,actual:rows.length});
  for(const run of rows){const raw=eventsOf(run),terminal=firstTerminal(raw),power=raw.filter(e=>e.kind==='power');check(power.length===1&&Boolean(terminal)&&Math.abs(run.result.bootMs-(terminal.time-power[0].time))<0.01,scope,'timing sample derives from one actual power and prompt present',{variant,run:run.run});}
  const values=rows.filter(r=>r.result?.bootMs>0).map(r=>r.result.bootMs);entry.variants[variant]={samples:values,median:rows.length===5?median(values):null};
 }
 const base=entry.variants.baseline.median;
 if(base)for(const variant of ['O1','O2']){const item=entry.variants[variant];if(item.median){item.relative=item.median/base-1;check(item.relative<=0,scope,'boot-to-prompt group median did not regress',{variant,relative:item.relative});}}
 timing.groups.push(entry);
}
const legacy=data.runs.filter(r=>r.variant==='legacy-kernel');if(legacy.some(r=>r.result?.status==='booted'))notes.push({requirement:'R-PEEL-01',status:'historical Starting failure NOT reproduced',evidence:legacy.filter(r=>r.result?.status==='booted').map(r=>r.run)});
notes.push({scope:'independence',text:'This is an independent software-agent check, not owner/third-party human acceptance.'});
notes.push({scope:'clock',text:'bootMs measures power to nativePresent ACK containing prompt; no claim of physical scanout timing or 60 FPS.'});
const observations=[...derived].map(([run,row])=>({run,scope:row.scope,stdout:row.stdout,exit:row.exit,returnValues:row.returnValues,signal:row.signal,publicFaults:row.publicFaults,pixelHash:row.picture?.hash,preKernelFaults:row.preKernelFaults,postKernelFaults:row.postKernelFaults}));
const result={created:new Date().toISOString(),input,inputSha256:sha(inputBytes),timingInput,timingInputSha256:sha(timingBytes),checks:checks.length,failures,passed:failures.length===0,timing,comparisons,coverage,coverageSummary:{required:coverage.length,observed:coverage.filter(r=>r.run!==null).length,commandComplete:coverage.filter(r=>r.status==='command-complete').length,timeouts:coverage.filter(r=>r.status==='command-timeout').length},observations,incomplete,historical,publicFaultReference,revision:'public-fault-signatures-v3-barrier',manualEvidence,notes};fs.writeFileSync(output+'.input.json',inputBytes);if(timingInput!==input)fs.writeFileSync(output+'.timing-input.json',timingBytes);fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({checks:checks.length,failures:failures.length,passed:result.passed,output,timing},null,2));process.exitCode=failures.length?1:0;
