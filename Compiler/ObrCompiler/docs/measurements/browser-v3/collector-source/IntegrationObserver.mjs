/** 被测试构建分别打包进页面/Worker。只观察已有执行结果，合成输入仅由测试父页面显式发起。 */
// 硬件由 blob Worker 动态装入；相对 fetch URL 在这种 Worker 中没有层级基址。
const endpoint=path=>new URL(path,location.origin).href;
const context=fetch(endpoint('/__context')).then(r=>r.json());
let settings=null;void context.then(value=>{settings=value;});
const cells=new Map();
const fontRows=new Map();let fontX=0,fontY=0;
const source=crypto.randomUUID();let sequence=0;
const pending=[];let timer=null;
const timingKinds=new Set(['page','power','terminal','page-error','faults','input-error','input-done']);
function flush(){
 if(timer!==null){clearTimeout(timer);timer=null;}
 const batch=pending.splice(0);if(!batch.length)return;
 void context.then(ctx=>{
  const events=batch.filter(e=>ctx.mode!=='timing'||timingKinds.has(e.kind)).map(e=>({...e,run:ctx.run}));
  if(events.length)return fetch(endpoint('/__event'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(events,(_k,v)=>typeof v==='bigint'?String(v):v)});
 }).catch(()=>{});
}
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
