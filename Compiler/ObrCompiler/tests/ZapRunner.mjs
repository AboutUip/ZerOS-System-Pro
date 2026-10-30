/** 使用产品的 ZPB1 解码器、CPU 协调器和 CoreDispatch，通过真实 MessageChannel 执行。 */
import fs from 'node:fs';
import {MessageChannel,MessagePort} from 'node:worker_threads';
import {ZerOS as Runtime} from '../../../ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts';
import {ZerOS as Core} from '../../../ZerOS-PRO/Hardware/Cpu/Host/CoreDispatch.ts';
import {ZerOS as Binary} from '../../../ZerOS-PRO/Hardware/Cpu/Structure/ProgramBinary.ts';
import {ZerOS as Metric} from '../../../ZerOS-PRO/Hardware/Motherboard/Host/MetricPage.ts';
import {ZerOS as Instruction} from '../../../ZerOS-PRO/Hardware/Cpu/Structure/CpuInstruction.ts';
import {ZerOS as SandboxRoot} from '../../../ZerOS-PRO/Hardware/Sandbox/Bootstrap/SandboxRuntime.ts';
import {ZerOS as SandboxConfig} from '../../../ZerOS-PRO/Hardware/Sandbox/Config/SandboxConfig.ts';
import {ZerOS as SandboxTest} from '../../../ZerOS-PRO/Hardware/Sandbox/Test/SandboxSelfCheck.ts';
import {ZerOS as Assembler} from '../../../ZerOS-PRO/Hardware/Sandbox/Host/Assemble.ts';
import {guestMemory} from './GuestMemory.mjs';
import {memoryCounter,noteMemoryAccess} from './MemoryCounters.mjs';

globalThis.MessagePort=MessagePort;
const stops=[];
globalThis.postMessage=record=>{if(typeof record.reason==='number'&&typeof record.ordinal==='number'&&typeof record.op==='string')stops.push(record);};

export async function runZapFile(file, libraryFile = null, install = false, sandbox = false, decodeOnly = false) {
  const target=Number(process.env.OBRC_TEST_CORE??1);
  let image=fs.readFileSync(file);
  let launch=null;
  if(sandbox){
    SandboxTest.Hardware.Sandbox.runSandboxSelfCheck();
    const config=SandboxConfig.Hardware.Sandbox.SandboxConfig;const api=SandboxRoot.Hardware.Sandbox;
    const word=(values)=>{const bytes=new Uint8Array(8);bytes.set(values);return bytes;};
    api.exchangeWord(0,word([config.CommandReset]));
    for(let i=0;i<image.length;i+=6){const chunk=image.subarray(i,i+6);api.exchangeWord(0,word([config.CommandAppend,chunk.length,...chunk]));}
    api.exchangeWord(0,word([config.CommandRun]));launch=api.takeLaunch();
    if(!launch)throw Error('sandbox did not produce a launch');
    const lines=Assembler.Hardware.Sandbox.assemble(launch.lines);
    image=Binary.Hardware.Cpu.encodeProgramBinary(lines.map(line=>{const step=Instruction.Hardware.Cpu.parseCpuInstruction(line);if(!step)throw Error('sandbox assembly failed');return step;}));
  }
  if(Buffer.from(image.subarray(0,4)).toString()!=='ZPB1')throw Error('expected ZPB1');
  const decoded=Binary.Hardware.Cpu.decodeProgramImage(image);
  if(decodeOnly)return {decodedSteps:decoded.steps.length,imports:decoded.imports.length,exports:decoded.symbols.length,relocs:decoded.relocs.length};
  const memory=guestMemory();const events=[];
  const logical=memoryCounter();
  globalThis.__compilerAccess=(op)=>noteMemoryAccess(logical,op);
  let harnessError=null;
  let memoryReads=0;let memoryWrites=0;let batches=0;
  const board=new MessageChannel();const cpu=new MessageChannel();
  function exec(opcode,address,value){
    const widths={1:1,2:1,3:8,4:8,5:16,6:16,7:32,8:32,9:64,10:64,11:32,12:32,13:64,14:64};
    const width=widths[opcode];if(!width)throw Error('unsupported memory opcode '+opcode);
    if(opcode%2===0){++memoryWrites;return memory.word(address,width,value);}
    ++memoryReads;return memory.word(address,width);
  }
  function query(seat,field){
    if(seat===3&&(field===0||field===1))return field===0?1024n:640n;
    throw Error('unsupported test query '+seat+','+field);
  }
  function onMessage(record,reply){
    try{
      if(record.kind==='access-batch'){
        ++batches;
        const values=[];const found=new Uint8Array(record.tag.length);
        for(let i=0;i<record.tag.length;++i){
          if(record.tag[i]===1)values.push(exec(record.opcode[i],record.address[i],record.data[i]));
          else if(record.tag[i]===2)values.push(query(record.a[i],record.b[i]));
          else throw Error('unsupported test access tag '+record.tag[i]);
        }
        reply.postMessage({kind:'access-batch-result',ok:true,done:values.length,value:values,found});
      }else if(record.kind==='exec'){
        reply.postMessage({kind:'exec-result',ok:true,isStore:record.opcode%2===0,value:exec(record.opcode,record.address,record.data)});
      }else if(record.kind==='load-span'){
        const bytes=new Uint8Array(record.length);
        for(let i=0;i<bytes.length;++i)bytes[i]=memory.load(record.address+BigInt(i*8));
        reply.postMessage({kind:'load-span-result',ok:true,bytes});
      }else if(record.kind==='store-span'){
        for(let i=0;i<record.bytes.length;++i)memory.store(record.address+BigInt(i*8),record.bytes[i]);
        reply.postMessage({kind:'store-span-result',ok:true});
      }else if(record.kind==='store-spans'){
        for(let at=0;at<record.addresses.length;++at)for(let i=0;i<record.parts[at].length;++i)memory.store(record.addresses[at]+BigInt(i*8),record.parts[at][i]);
        reply.postMessage({kind:'store-span-result',ok:true});
      }else if(record.kind==='gpu-batch'){
        events.push(...record.commands.map(command=>JSON.parse(JSON.stringify(command,(_k,v)=>typeof v==='bigint'?v.toString():v))));
        reply.postMessage({kind:'gpu-batch-result',ok:true});
      }else if(record.kind==='gpu'){
        events.push(JSON.parse(JSON.stringify(record,(_k,v)=>typeof v==='bigint'?v.toString():v)));
        reply.postMessage({kind:'exec-result',ok:true,isStore:true,value:0n});
      }else throw Error('unsupported board message '+record.kind);
    }catch(error){
      if(error.message.startsWith("unsupported"))harnessError=error.message;
      const kind=record.kind==='access-batch'?'access-batch-result':record.kind==='load-span'?'load-span-result':'exec-result';
      reply.postMessage({kind,ok:false,done:0,value:[],message:error.message});
    }
  }
  board.port1.on('message',record=>onMessage(record,board.port1));
  const secondBoard=new MessageChannel();const secondCpu=new MessageChannel();
  secondBoard.port1.on('message',record=>onMessage(record,secondBoard.port1));
  const runtime=Runtime.Hardware.Cpu;
  runtime.declareCoreCount(8);runtime.noteCpuIdentity('ZerOS-Reference-Cpu','ZerOS-Team','ZCP1');
  const page=Metric.Hardware.Motherboard.openMetricPage();runtime.adoptMetricPage(page);
  runtime.acceptMountedCore(0,cpu.port1);
  Metric.Hardware.Motherboard.writeMetric(3,0,0,1024n);
  Metric.Hardware.Motherboard.writeMetric(3,1,0,640n);
  Core.Hardware.Cpu.acceptCoreMessage({kind:'core',ordinal:0,boardPort:board.port2,cpuPort:cpu.port2,metrics:page});
  async function probeValues(ordinal){
    const bits=(process.env.OBRC_PROBES??'').split(',').filter(Boolean);if(bits.length===0)return {};
    if(bits.length>8)throw Error('too many test probes');
    const steps=[...bits.map((bit,i)=>`load.64 r${i}, ${BigInt(bit)}`),'halt'].map(line=>Instruction.Hardware.Cpu.parseCpuInstruction(line));
    if(steps.some(step=>!step))throw Error('test probe did not parse');
    const result=await runtime.runGuest(ordinal,steps);if(!result.Ok)throw Error('test probe failed: '+result.Message);
    return Object.fromEntries(bits.map((bit,i)=>[bit,result.Registers[i].toString()]));
  }
  try{
    if(install || libraryFile){
      // 与浏览器 Worker 相同，每颗核心必须有独立的模块状态。
      const coreURL=new URL('./core-instance.mjs',import.meta.url);
      const Core1=await import(coreURL.href);
      runtime.acceptMountedCore(target,secondCpu.port1);
      Core1.ZerOS.Hardware.Cpu.acceptCoreMessage({kind:'core',ordinal:target,boardPort:secondBoard.port2,cpuPort:secondCpu.port2,metrics:page});
      const base=20000000n;const libraryBase=40000000n;
      for(let i=0;i<image.length;++i)memory.store(base+BigInt(i*8),image[i]);
      const lines=[`place r1, ${target}`,`place r2, ${base}`,`place r3, ${image.length}`,'install r1, r2, r3'];
      if(libraryFile){const library=fs.readFileSync(libraryFile);for(let i=0;i<library.length;++i)memory.store(libraryBase+BigInt(i*8),library[i]);lines.push(`place r2, ${libraryBase}`,`place r3, ${library.length}`,'attach r0, r1, r2, r3');}
      lines.push('halt');
      const prepared=await runtime.runGuest(0,lines.map(line=>{const step=Instruction.Hardware.Cpu.parseCpuInstruction(line);if(!step)throw Error('test instruction did not parse');return step;}));
      if(!prepared.Ok)throw Error('product install/attach failed: '+prepared.Message);
      runtime.schedule(target);await runtime.startedRun(target);
      const regs=await runtime.readRegisters(target);const stop=stops.at(-1)??null;
      const steps=runtime.metric(target,1).toString();const measuredMemory={logical:null,...memory.counters(),memoryReads,memoryWrites,batches};
      const probes=stop?.reason===3?{}:await probeValues(target);
      return {kind:stop?.reason===3?'fault':'installed',stop,r0:regs[0].toString(),steps,probes,events,visible:memory.visible(),memory:measuredMemory};
    }
    let result=await runtime.runGuest(0,decoded.steps);
    for(let resumes=0;result.Ok&&stops.at(-1)?.reason===1;++resumes){
      if(resumes>=1000)throw Error('too many guest yields');
      events.push({yield:true});
      try{await runtime.runSequence(0,decoded.steps);result={Ok:true,Message:'',Registers:await runtime.readRegisters(0)};}
      catch(error){result={Ok:false,Message:error.message,Registers:await runtime.readRegisters(0)};}
    }
    if(harnessError)throw Error(harnessError);
    const stop=stops.at(-1)??null;
    if(!result.Ok&&stop&&decoded.steps[stop.index]?.Op!==stop.op)throw Error("fault index/op disagrees with product decoder");
    if(launch)SandboxRoot.Hardware.Sandbox.noteGuestResult(launch.ticket,result.Ok,result.Message,result.Registers);
    const steps=runtime.metric(0,1).toString();const measuredMemory={logical:globalThis.__compilerAccessInstrumented?{...logical}:null,...memory.counters(),memoryReads,memoryWrites,batches};
    const probes=result.Ok?await probeValues(0):{};
    return {stop,sandbox:launch!==null,kind:result.Ok?'halt':'fault',r0:result.Registers[0].toString(),message:result.Message,steps,probes,events,visible:memory.visible(),memory:measuredMemory};
  }finally{for(const channel of [board,cpu,secondBoard,secondCpu]){channel.port1.close();channel.port2.close();}}
}

if(process.argv[2]){
  const timer=setTimeout(()=>{console.error('ZAP execution timed out');process.exit(2);},30000);
  try{console.log(JSON.stringify(await runZapFile(process.argv[2],process.argv[3]&&!["--install","--sandbox","--decode-only"].includes(process.argv[3])?process.argv[3]:null,process.argv[3]==="--install",process.argv[3]==="--sandbox",process.argv[3]==="--decode-only")));}
  catch(error){console.error(error.stack);process.exitCode=1;}
  finally{clearTimeout(timer);}
}
