/** 使用实际 BIOS、CPU 与 ZPP1 设备验证输入顺序和绘制重启；GPU 只记录命令并立即回执。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=path.join(root,'Toolchain/Zap/BiosInputCheck');fs.mkdirSync(dir,{recursive:true});
const source=fs.readFileSync(path.join(root,'ZerOS-PRO/Boot/Bios.obr'),'utf8');
const common='*(long*)4096=2L;*(long*)5184=1L;*(long*)4160=0L;*(long*)5248=0L;*(long*)5312=0L;*(long*)7936=0L;';
const move=(y=98)=>[0,0,40,y,0,0];const down=(y)=>[1,1,40,y,0,0];const up=(y)=>[2,1,40,y,0,0];
const cases=[
  {name:'idle-moves',events:Array.from({length:30},()=>move()),body:'long dirty=takePointer(); if(dirty==0L && pointer::depth()==0L){*(long*)5632=1L;}else{*(long*)5632=-1L;}'},
  {name:'ordered-clicks',events:[...Array.from({length:26},()=>move()),down(98),up(98),down(132),up(132)],body:`long first=takePointer();long a=*(long*)4160;long queued=pointer::depth();long second=takePointer();long b=*(long*)4160;long last=takePointer();if(first==1L && second==1L && last==0L && a==1L && b==2L && queued==3L && pointer::depth()==0L){*(long*)5632=1L;}else{*(long*)5632=-1L;}`},
  {name:'drag-release',events:[move(200),up(200)],body:`*(long*)7936=1L;*(long*)8000=100L;*(long*)8064=0L;*(long*)5632=652L;long dirty=takePointer();long scroll=*(long*)5312;takePointer();if(dirty==1L && scroll==117L && *(long*)7936==0L && pointer::depth()==0L){*(long*)5632=1L;}else{*(long*)5632=-1L;}`},
  {name:'wheel-both-directions',events:[[3,0,400,200,0,1],[3,0,400,200,0,65535]],body:`*(long*)5312=100L;*(long*)5632=652L;long first=takePointer();long a=*(long*)5312;long second=takePointer();long b=*(long*)5312;if(first==1L && second==1L && a==120L && b==100L && pointer::depth()==0L){*(long*)5632=1L;}else{*(long*)5632=-1L;}`},
  {name:'cancel-stale-page',events:[],inject:true,body:`*(long*)4160=1L;fill();paint();if(*(long*)4160==2L){*(long*)5632=1L;}else{*(long*)5632=-1L;}`},
  {name:'bounded-restart',events:[],inject:true,repeat:true,body:`*(long*)4160=1L;fill();paint();*(long*)5632=1L;`},
];
const results=[];
for(const test of cases){
  const obr=path.join(dir,test.name+'.obr');const binary=path.join(dir,test.name);
  fs.writeFileSync(obr,source.slice(0,source.indexOf('deRfun main(): int'))+`deRfun main(): int {${common}${test.body}halt();return 0;}`);
  const inputs=[obr,...['ZerOS-PRO/Boot/Clear.obr','Driver/Pointer/pointer.obr','Compiler/Obr/lib/obr.widget.obr','Compiler/Obr/lib/obr.nas.obr','Driver/Display/panel.obr','Driver/Gpu/gl.obr'].map(x=>path.join(root,x))];
  const includes=['ZerOS-PRO/Boot','ZerOS-PRO/Hardware/Gpu','Driver/Gpu','ZerOS-PRO/Hardware/Motherboard','ZerOS-PRO/Hardware/Memory'].flatMap(x=>['-I',path.join(root,x)]);
  const compiled=spawnSync(path.join(root,'Compiler/Obr/obrc'),[...inputs,...includes,'-o',binary],{encoding:'utf8'});
  if(compiled.status!==0)throw Error(compiled.stderr||compiled.stdout);
  let adapter=fs.readFileSync(path.join(root,'Toolchain/Checks/bios-vm.mjs'),'utf8');
  const prelude=`import {ZerOS as Pointer} from '../../ZerOS-PRO/Hardware/Pointer/Bootstrap/PointerRuntime.ts';
const pointer=Pointer.Hardware.Pointer;const queries={};let injected=0;
function word(value){const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(value),true);return bytes;}
function enqueue(events){for(const event of events){for(const value of event){pointer.exchangeWord(0,word(value));}}}
function pointerQuery(query){queries[query]=(queries[query]||0)+1;const result=pointer.exchangeWord(1,word(query));return new DataView(result.buffer,result.byteOffset,8).getBigUint64(0,true);}
enqueue(${JSON.stringify(test.events)});
function maybeInject(){if(${test.inject===true} && commands>=100 && (injected===0 || (${test.repeat===true} && injected<4))){enqueue([[1,1,40,132,0,0],[2,1,40,132,0,0]]);injected++;}}
`;
  const mapping='tag === 1 ? exec(record.opcode[i],record.address[i],record.data[i]) : 0n';
  if(!adapter.includes(mapping))throw Error('adapter access shape changed');
  adapter=adapter.replace(mapping,'tag === 1 ? exec(record.opcode[i],record.address[i],record.data[i]) : tag === 4 ? pointerQuery(Number(record.data[i])) : 0n');
  adapter=adapter.replace('commands++;frameCommands++;','commands++;frameCommands++;maybeInject();');
  adapter=adapter.replace('return {frames,commands,glyphs,executed:runtime.metric(0,1).toString(),scrollLimit};','return {frames,commands,glyphs,executed:runtime.metric(0,1).toString(),scrollLimit,queries,injected};');
  const vm=path.join(dir,test.name+'.mjs');
  await build({stdin:{contents:prelude+adapter,resolveDir:path.join(root,'Toolchain/Checks'),loader:'js'},outfile:vm,bundle:true,platform:'node',format:'esm',logLevel:'error'});
  const {run}=await import(pathToFileURL(vm));
  const watchdog=setTimeout(()=>{console.error('input test timed out');process.exit(2);},60000);
  const result=await run(new Uint8Array(fs.readFileSync(binary)));clearTimeout(watchdog);
  fs.writeFileSync(path.join(dir,test.name+'.json'),JSON.stringify(result,null,2));
  if(result.scrollLimit!=='1')throw Error(test.name+' guest assertions failed');
  if(test.name==='idle-moves' && (result.queries[3]||result.queries[4]||result.queries[8]!==2))throw Error('idle move read coordinates or repeated depth');
  if(test.inject && (result.frames.length!==1 || !result.frames[0].text.includes('GPU')))throw Error(test.name+' stale frame submitted or bounded retry failed');
  results.push({name:test.name,status:'passed',frames:result.frames.length,queries:result.queries,injected:result.injected});
}
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
