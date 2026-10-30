/** 被测试构建分别打包进页面/Worker。只观察已有执行结果，合成输入仅由测试父页面显式发起。 */
import {memoryCounter,noteMemoryAccess} from 'virtual:obrc-memory-counter';
// 硬件由 blob Worker 动态装入；相对 fetch URL 在这种 Worker 中没有层级基址。
const endpoint=path=>new URL(path,location.origin).href;
const context=fetch(endpoint('/__context')).then(r=>r.json());
let settings=null;void context.then(value=>{settings=value;});
const cells=new Map();
const fontRows=new Map();let fontX=0,fontY=0;
const source=crypto.randomUUID();let sequence=0;
let tokenCount=0;const logical=memoryCounter();
export const token=point=>`${source}:${point}:${++tokenCount}`;
export const metricsEnabled=()=>settings!==null&&settings.mode!=='timing';
export function access(operation){if(settings?.mode!=='timing')noteMemoryAccess(logical,operation);}
export const accessSnapshot=()=>({...logical});
/** 从已有成功写回的载荷观察ABI控制字；不执行额外的来宾读取。 */
export function captureControls(actor,address,bytes){
 if(!metricsEnabled()||actor!==2||!bytes)return[];
 const result=[],data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=address+BigInt(bytes.byteLength*8);
 for(let ordinal=0;ordinal<8;ordinal++)for(const offset of[128n,192n]){
  const home=1048576n+BigInt(ordinal)*268435456n,at=home+offset;
  if(at>=address&&at+64n<=end&&(at-address)%8n===0n)result.push({actor,ordinal,home,address:at,width:64,offset,value:data.getBigInt64(Number((at-address)/8n),true),token:token('control-write'),evidence:'successful-native-writeback'});
 }
 return result;
}
export function emitControls(items){for(const item of items)report('control-write',item);}
export function control(operation,address,width,value){
 if(!metricsEnabled()||width!==64)return;
 for(const offset of[128n,192n]){const shifted=address-1048576n-offset;if(shifted>=0n&&shifted%268435456n===0n&&shifted/268435456n<8n)report('control-'+operation,{ordinal:Number(shifted/268435456n),address,width,value,offset,token:token('memory-control'),evidence:'successful-physical-channel'});}
}
const pending=[];let timer=null;
const inflight=new Set();let transportError=null,channel=null;
const timingKinds=new Set(['page','power','terminal','page-error','faults','input-error','input-done']);
function flush(){
 if(timer!==null){clearTimeout(timer);timer=null;}
 const batch=pending.splice(0);if(!batch.length)return;
 const work=context.then(async ctx=>{
  const events=batch.filter(e=>ctx.mode!=='timing'||timingKinds.has(e.kind)).map(e=>({...e,run:ctx.run}));
  if(events.length){const response=await fetch(endpoint('/__event'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(events,(_k,v)=>typeof v==='bigint'?String(v):v)});if(!response.ok)throw Error('observer batch rejected '+response.status);}
 });
 inflight.add(work);void work.then(()=>inflight.delete(work),error=>{inflight.delete(work);transportError=String(error);channel?.postMessage({kind:'observer-error',source,error:transportError});});
}
// 每个生产者在同一广播通道宣布自己。barrier ACK 只在其截止序号之前的HTTP批次全部确认后发送。
void context.then(ctx=>{
 if(ctx.mode==='timing')return;
 channel=new BroadcastChannel('obrc-test-'+ctx.run);
 channel.onmessage=async({data})=>{
  if(data?.kind!=='barrier'||(data.to&&data.to!==source))return;
  const through=sequence;report('watermark',{token:data.token,through});const watermark=sequence;flush();
  await Promise.allSettled([...inflight]);
  channel.postMessage({kind:'barrier-ack',source,token:data.token,through,watermark,error:transportError});
 };
 report('producer',{name:typeof window==='undefined'?globalThis.name:'page'});flush();
 channel.postMessage({kind:'producer',source,name:typeof window==='undefined'?globalThis.name:'page'});
}).catch(error=>{transportError=String(error);});
const epoch=()=>performance.timeOrigin+performance.now();
export function report(kind,data){
 if(settings?.mode==='timing'&&!timingKinds.has(kind))return;
 const time=epoch(),order=++sequence;
 pending.push({time,source,order,kind,data});
 if(pending.length>=32||kind==='terminal'||kind==='page-error')flush();
 else if(timer===null)timer=setTimeout(flush,100);
}
const buffer=new ArrayBuffer(8),view=new DataView(buffer);
function floating(value){view.setBigUint64(0,BigInt.asUintN(64,BigInt(value)),true);return view.getFloat64(0,true);}
export function font(item){
 if(item.operation===41){fontX=floating(item.b);fontY=floating(item.c)-14;}
 if(item.operation===34&&floating(item.c)>20&&floating(item.d)===18)fontRows.delete(floating(item.b));
 if(item.operation===42&&item.bytes){const data=new DataView(item.bytes.buffer,item.bytes.byteOffset,item.bytes.byteLength);let text='';for(let i=0;i+4<=data.byteLength;i+=4){const code=data.getUint32(i,true);text+=String.fromCodePoint(code<=0x10ffff?code:0xfffd);}fontRows.set(fontY,{x:fontX,y:fontY,text});}
}
export function glyph(x,y,code){cells.set(`${x},${y}`,{x:Number(x),y:Number(y),code:Number(code)});}
export function rows(){
 if(fontRows.size)return [...fontRows.values()].sort((a,b)=>a.y-b.y);
 const grouped=new Map();for(const c of cells.values()){const row=grouped.get(c.y)??[];row.push(c);grouped.set(c.y,row);}
 return [...grouped].sort(([a],[b])=>a-b).map(([y,row])=>({y,text:row.sort((a,b)=>a.x-b.x).map(c=>String.fromCodePoint(c.code>=0&&c.code<=0x10ffff?c.code:0xfffd)).join('')}));
}
export function connectInput(){
 if(typeof window==='undefined')return;
 window.addEventListener('message',async event=>{
  if(event.source!==parent||event.origin!==location.origin||event.data?.kind!=='obrc-test-input')return;
  try{
   for(const ch of event.data.text){
    const key=ch==='\n'?'Enter':ch,code=ch==='\n'?'Enter':ch===' '?'Space':/[a-z]/.test(ch)?'Key'+ch.toUpperCase():ch==='/'?'Slash':ch==='-'?'Minus':ch==='>'?'Period':ch;
    window.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true,shiftKey:ch==='>'}));
    window.dispatchEvent(new KeyboardEvent('keypress',{key,code,bubbles:true,shiftKey:ch==='>'}));
    await new Promise(r=>setTimeout(r,150));
    window.dispatchEvent(new KeyboardEvent('keyup',{key,code,bubbles:true}));
    await new Promise(r=>setTimeout(r,30));
   }
   report('input-done',{text:event.data.text});
  }catch(error){report('input-error',{message:String(error)});}
 });
 report('page',{userAgent:navigator.userAgent,timeOrigin:performance.timeOrigin});
 window.addEventListener('error',event=>report('page-error',{message:event.message}));
 window.addEventListener('unhandledrejection',event=>report('page-error',{message:String(event.reason)}));
}
