/** 测试专用观察器的公开故障结束快照：迟到变化、重复屏障与getter失败均不能假通过。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {build} from '../../../Toolchain/node_modules/esbuild/lib/main.js';
import {publicFaultSnapshot,faultSnapshotAtBarrier,faultSnapshotRequired} from './PublicFaultSignatures.mjs';

const out=path.resolve(process.env.OBRC_BARRIER_CHECK_OUT??'Toolchain/CompilerCheck/public-fault-barrier');
fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['Compiler/ObrCompiler/tests/IntegrationObserver.mjs'],outfile:path.join(out,'observer.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error',plugins:[{name:'test-counter',setup(api){api.onResolve({filter:/^virtual:obrc-memory-counter$/},()=>({path:path.resolve('Compiler/ObrCompiler/tests/MemoryCounters.mjs')}));}}]});
const saved={fetch:globalThis.fetch,location:globalThis.location,window:globalThis.window,BroadcastChannel:globalThis.BroadcastChannel};
const events=[],messages=[];let channel,checks=0;
const check=(value,message)=>{checks++;assert(value,message);};
try{
 globalThis.location={origin:'http://test.invalid'};globalThis.window={};
 globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/__context'))return{json:async()=>({run:'unit-barrier',mode:'smoke'})};events.push(...JSON.parse(options.body));return{ok:true};};
 globalThis.BroadcastChannel=class{constructor(){channel=this;}postMessage(value){messages.push(value);}close(){}};
 const observer=await import(pathToFileURL(path.join(out,'observer.mjs')));
 await new Promise(setImmediate);
 observer.report('faults',{faults:[],last:null});
 const late={Code:0,Source:0,Core:2,Index:7,Text:'late public fault',Op:'div',Site:'fixture.obr:1',Stack:[],Window:true};
 let reads=0;observer.bindPublicFaults(()=>{reads++;return{faults:[late],last:late};});
 await channel.onmessage({data:{kind:'barrier',token:'fresh'}});
 const snapshots=events.filter(e=>e.kind==='faults'&&e.data.barrierToken==='fresh');
 const ack=messages.find(m=>m.kind==='barrier-ack'&&m.token==='fresh');
 check(snapshots.length===1&&snapshots[0].data.faults[0].Text==='late public fault','barrier must read changes absent from the earlier periodic snapshot');
 check(ack.error===null&&ack.through===snapshots[0].order&&ack.watermark===ack.through+1,'fresh snapshot must precede the exact acknowledged watermark');
 check(events.filter(e=>e.source===ack.source).every((e,i)=>e.order===i+1),'all source events through cutoff remain contiguous');
 const collection={token:'fresh',producers:[{name:'page',source:ack.source}],acks:[ack]};
 const final=publicFaultSnapshot(events);
 check(faultSnapshotAtBarrier(events,collection,final).fresh,'verifier must accept the actual page sampling point');
 check(!faultSnapshotAtBarrier(events.map(e=>e.kind==='faults'?{...e,data:{...e.data,barrierToken:null}}:e),collection,final).fresh,'missing raw token must be rejected');
 check(!faultSnapshotAtBarrier(events,{...collection,acks:[{...ack,through:ack.through+1}]},final).fresh,'wrong ACK cutoff must be rejected');
 check(!faultSnapshotAtBarrier(events,collection,{...final,order:final.order-1}).fresh,'older final snapshot must be rejected');
 check(faultSnapshotRequired({mode:'smoke',result:{}}),'deleting the self-declared flag cannot disable freshness');
 check(faultSnapshotRequired({mode:'smoke',result:{faultsAtBarrierRequired:false}}),'a false self-declared flag cannot disable freshness');
 check(!faultSnapshotRequired({mode:'smoke'},true),'only the explicit historical verifier mode can accept old snapshot limits');
 await channel.onmessage({data:{kind:'barrier',token:'fresh'}});
 check(reads===1&&events.filter(e=>e.kind==='watermark'&&e.data.token==='fresh').length===1,'duplicate barrier must reuse one original snapshot and watermark');
 observer.bindPublicFaults(()=>{throw Error('getter unavailable');});
 await channel.onmessage({data:{kind:'barrier',token:'failed-reader'}});
 const rejected=messages.find(m=>m.kind==='barrier-ack'&&m.token==='failed-reader');
 check(String(rejected.error).includes('public fault snapshot failed'),'failed public getter must produce a failed ACK');
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,failures:0,events,messages},null,2)+'\n');
 console.log(JSON.stringify({checks,failures:0}));
}finally{
 channel?.close();for(const [key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
}
