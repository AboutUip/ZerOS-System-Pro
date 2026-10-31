/** 诊断专用：原始NAS差异不因此豁免。只折叠经manifest+真实文件严格证明的连续可执行映像读取。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function classifyNas(requests,variant,artifact){
 const manifest=JSON.parse(fs.readFileSync(path.join(artifact,variant,'manifest.json'))),normalized=[],loads=[],errors=[];
 const signalFile=path.join(artifact,'signal-build/manifest.json');
 if(fs.existsSync(signalFile)){const signal=JSON.parse(fs.readFileSync(signalFile)),row=signal.rows.find(r=>r.variant===variant),target=path.join(artifact,variant,'NasRoot/bin/compiler-signal-smoke');const sourceFile=[path.join(artifact,'signal-build/source/signal-smoke.obr'),signal.source.file].find(file=>file&&fs.existsSync(file));if(row&&sourceFile&&sha(fs.readFileSync(sourceFile))===signal.source.sha256&&fs.existsSync(target)&&sha(fs.readFileSync(target))===row.sha256)manifest.programs.push({name:'bin/compiler-signal-smoke',sha256:row.sha256,bytes:row.bytes});}
 for(let at=0;at<requests.length;at++){
  const request=requests[at];normalized.push(request);
  if(request.op!=='open'||request.mode!==0||typeof request.path!=='string'||!request.path.startsWith('/'))continue;
  const entry=manifest.programs.find(row=>row.name===request.path.slice(1));if(!entry)continue;
  const first=at+1,reads=[];let next=first,handle=null,total=0;
  while(next<requests.length&&requests[next].op==='read'){
   const read=requests[next];if(handle===null)handle=read.handle;
   const expectedKeys=['op','path','from','to','handle','mode','offset','length','index','data'].sort();
   if(JSON.stringify(Object.keys(read).sort())!==JSON.stringify(expectedKeys)||read.path!==''||read.from!==''||read.to!==''||read.mode!==0||read.index!==0||read.data!==''){errors.push({at:next,path:request.path,reason:'executable read has unclassified payload or fields',request:read});break;}
   if(read.handle!==handle)break;
   if(!Number.isInteger(read.offset)||read.offset!==total||!Number.isInteger(read.length)||read.length<=0||read.length>262144){errors.push({at:next,path:request.path,reason:'noncontiguous or invalid executable read',request:read});break;}
   reads.push(read);total+=read.length;next++;
  }
  if(errors.some(e=>e.at===next)){continue;}
  const close=requests[next];
  if(!reads.length||close?.op!=='close'||close.handle!==handle){errors.push({at,path:request.path,reason:'executable open is not followed by a complete unambiguous read/close transaction'});continue;}
  let bytes;try{bytes=fs.readFileSync(path.join(artifact,variant,'NasRoot',entry.name));}catch(error){errors.push({at,path:request.path,reason:'declared image is absent',error:String(error)});continue;}
  const actual=sha(bytes);
  if(actual!==entry.sha256||bytes.length!==entry.bytes||total!==bytes.length||reads.some(read=>read.length!==Math.min(262144,bytes.length-read.offset))){errors.push({at,path:request.path,reason:'manifest, actual bytes/hash and requested full coverage disagree',declaredBytes:entry.bytes,actualBytes:bytes.length,requestedBytes:total,declaredHash:entry.sha256,actualHash:actual});continue;}
  normalized.push({op:'diagnostic-executable-read',path:request.path,handle});
  normalized.push(close);loads.push({path:request.path,from:first,to:next-1,handle,requestCount:reads.length,requestedBytes:total,actualBytes:bytes.length,sha256:actual});at=next;
 }
 return {normalized,loads,errors};
}
