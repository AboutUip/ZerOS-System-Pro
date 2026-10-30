/** 独立审计来源：strict_requirements_test / independent-agent-20261030。
 * 仅去除诊断堆栈；保留所有语义字段，不按core/op全局豁免。
 */
export function faultSignature(record){
 if(!record||typeof record!=='object')throw Error('fault record is absent');
 for(const key of ['Code','Source','Core','Index'])if(!Number.isInteger(record[key]))throw Error('invalid fault integer '+key);
 for(const key of ['Text','Op','Site'])if(typeof record[key]!=='string')throw Error('invalid fault text '+key);
 if(typeof record.Window!=='boolean'||!Array.isArray(record.Stack)||record.Stack.some(v=>typeof v!=='string'))throw Error('invalid fault window/stack');
 return Object.fromEntries(Object.keys(record).filter(k=>k!=='Stack').sort().map(key=>[key,key==='Text'?record[key].replace(/\s+stack=[\s\S]*?(?=\s+draw=|$)/,'').trimEnd():record[key]]));
}
export function publicFaultSnapshot(events,beforeTime=Infinity){
 const snapshots=events.filter(e=>e.kind==='faults'&&e.time<beforeTime).sort((a,b)=>a.time-b.time||a.order-b.order);if(!snapshots.length)return {observed:false,signatures:null,time:null,historyConsistent:false};
 let prior=[],last=null;for(const event of snapshots){
  if(!Array.isArray(event.data?.faults))throw Error('public fault snapshot has no list');
  const list=event.data.faults.map(faultSignature);
  if(list.length<prior.length||prior.some((v,i)=>JSON.stringify(v)!==JSON.stringify(list[i])))throw Error('observed public fault list changed or lost earlier entries');
  if(list.length&&JSON.stringify(faultSignature(event.data.last))!==JSON.stringify(list.at(-1)))throw Error('LastFault differs from the last public list entry');
  prior=list;last=event;
 }
 return {observed:true,signatures:prior,time:last.time,historyConsistent:true,source:last.source,order:last.order};
}
