/** 真正调用产品 native 解码/执行器；主机端仅提供测试内存与明确列出的设备应答。 */
import fs from 'node:fs';
import {ZerOS as Native} from '../../../ZerOS-PRO/Hardware/Cpu/Native/NativeRun.ts';
import {ZerOS as State} from '../../../ZerOS-PRO/Hardware/Cpu/Structure/NativeState.ts';
import {guestMemory} from './GuestMemory.mjs';

export function runNativeFile(file, limit=10000000, probeBits=[]) {
  const image=fs.readFileSync(file);
  if(image.subarray(0,4).toString()!=='ZNB1')throw Error('expected ZNB1');
  const codeEnd=12+image.readUInt32LE(8);
  // 将代码置于数据窗口之外；低位地址是示例程序的共享数据，不得与测试代码重叠。
  const origin=1n<<31n;
  const memory=guestMemory();memory.seed(image,origin);
  const state=State.Hardware.Cpu.freshNativeState(origin+96n);
  const saved=[3,5,12,13,14,15];
  for(const index of saved)state.reg[index]=BigInt(100+index);
  const events=[];let steps=0;let fetchOctets=0;
  const port={limitBit:memory.limitBit,load(bit){if(bit>=origin+96n&&bit<origin+BigInt(codeEnd*8))++fetchOctets;return memory.load(bit);},store:memory.store};
  let outcome='';let entryRsp=null;
  for(;steps<limit;){
    const result=Native.Hardware.Cpu.stepNative(state,port);++steps;if(steps===1)entryRsp=state.reg[4];
    if(result==='cont')continue;
    if(result==='halt'||result==='fault'){outcome=result;break;}
    if(typeof result!=='object')throw Error('unsupported native stop '+result);
    const regs=result.regs;const values=regs.map(index=>state.reg[index]??0n);
    const set=(value)=>{state.reg[regs[0]]=BigInt.asUintN(64,value);};
    if(result.opcode===1)set(0n);
    else if(result.opcode===0x0b){
      const [,seat,field]=values;
      if(seat===3n&&(field===0n||field===1n))set(field===0n?1024n:640n);
      else throw Error('unsupported test query '+values.join(','));
    }else if([0x11,0x12,0x13].includes(result.opcode)){
      events.push({opcode:result.opcode,values:values.slice(result.opcode===0x13?1:0).map(String)});
      if(result.opcode===0x13)set(0n);
    }else if(result.opcode===0x0a)events.push({yield:true});
    else if(result.opcode===0x1b){if(values[0]<0n||values[0]>1000n){outcome='fault';break;}events.push({dwell:String(values[0])});}
    else throw Error('unsupported test escape '+result.opcode);
    state.rip=result.next;
  }
  if(!outcome)throw Error('native instruction limit exceeded');
  const measuredMemory={...memory.counters(),fetchOctets};
  const rspBalanced=entryRsp!==null&&state.reg[4]===entryRsp;
  const probes=Object.fromEntries(probeBits.map(bit=>[String(bit),memory.word(BigInt(bit),64).toString()]));
  const calleeSaved=saved.every(index=>state.reg[index]===BigInt(100+index));
  return {kind:outcome,r0:BigInt.asIntN(64,state.reg[0]).toString(),steps,calleeSaved,rspBalanced,events,probes,visible:memory.visible(),memory:measuredMemory,rip:state.rip.toString()};
}

/** 每个 .debug 地址必须落在产品解码器确认的 native 指令边界上。 */
export function checkNativeDebug(file) {
  const image=fs.readFileSync(file);const origin=1n<<31n;
  const end=(12+image.readUInt32LE(8))*8;const boundaries=new Set();
  let at=96;let count=0;
  while(at<end){
    boundaries.add(at);let fetched=at-8;
    const state=State.Hardware.Cpu.freshNativeState(origin+BigInt(at));
    for(let i=0;i<state.reg.length;++i)state.reg[i]=16n;
    const port={limitBit:1n<<32n,load(bit){
      if(bit>=origin&&bit<origin+BigInt(end)) { fetched=Math.max(fetched,Number(bit-origin));return image[Number((bit-origin)/8n)]; }
      return 0;
    },store(){}};
    Native.Hardware.Cpu.stepNative(state,port);
    const next=fetched+8;if(next<=at||next>end)throw Error('native decode boundary at '+at);
    at=next;++count;
  }
  if(at!==end)throw Error('native code length mismatch');
  const rows=fs.readFileSync(file+'.debug','utf8').split('\n').slice(1,-1);
  for(const row of rows)if(!boundaries.has(Number(row.split('\t')[0])))throw Error('debug is not an instruction boundary: '+row);
  return {nativeInstructions:count,debugSites:rows.length,valid:rows.length};
}

if(process.argv[2]){
  try{console.log(JSON.stringify(process.argv[3]==='--debug-only'?{debug:checkNativeDebug(process.argv[2])}:{...runNativeFile(process.argv[2],10000000,(process.env.OBRC_PROBES??'').split(',').filter(Boolean)),debug:checkNativeDebug(process.argv[2])}));}
  catch(error){console.error(error.stack);process.exitCode=1;}
}
