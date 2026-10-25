/** 测试适配器：使用生产CPU解码器、协调器、CoreDispatch，通过MessageChannel连接。
 * 仅把物理内存/未就绪扩展口替换为内存数组，未重写Obr分配器或VFS逻辑。 */
import { MessageChannel, MessagePort } from "node:worker_threads";
import { ZerOS as Runtime } from "../../ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts";
import { ZerOS as Core } from "../../ZerOS-PRO/Hardware/Cpu/Host/CoreDispatch.ts";
import { ZerOS as Metric } from "../../ZerOS-PRO/Hardware/Motherboard/Host/MetricPage.ts";
import { ZerOS as Binary } from "../../ZerOS-PRO/Hardware/Cpu/Structure/ProgramBinary.ts";

globalThis.MessagePort = MessagePort;
globalThis.postMessage = () => {};
const frames=[];let commands=0;let glyphs=0;
let frameCommands=0;let frameGlyphs=0;let lastFrame=0;let text="";const floatView=new DataView(new ArrayBuffer(8));
function gpuCommands(batch){for(const command of batch){commands++;frameCommands++;if(command.gpuOp==="accel" && command.operation===34){glyphs++;frameGlyphs++;floatView.setBigInt64(0,command.a,true);text+=String.fromCharCode(Math.trunc(floatView.getFloat64(0,true)));}}}
const bytes = new Uint8Array(16777216);
const memory = new DataView(bytes.buffer);
const ports = [];
function exec(opcode, address, value) {
  const at = Number(address / 8n);
  const widths = { 3:1,4:1,5:2,6:2,7:4,8:4,9:8,10:8 };
  const width = widths[opcode];
  if (!width || address % 8n || at < 0 || at + width > bytes.length) { throw new Error("test memory bounds"); }
  if (opcode % 2 === 0) {
    if (width === 1) { memory.setUint8(at, Number(value)); }
    else if (width === 2) { memory.setInt16(at, Number(value), true); }
    else if (width === 4) { memory.setInt32(at, Number(value), true); }
    else { memory.setBigInt64(at, value, true); }
    return 0n;
  }
  if (width === 1) { return BigInt(memory.getUint8(at)); }
  if (width === 2) { return BigInt(memory.getInt16(at, true)); }
  if (width === 4) { return BigInt(memory.getInt32(at, true)); }
  return memory.getBigInt64(at, true);
}
const board = new MessageChannel();
const cpu = new MessageChannel();
ports.push(board.port1, board.port2, cpu.port1, cpu.port2);
board.port1.on("message", (record) => {
  try {
    if (record.kind === "access-batch") {
      const value = Array.from(record.tag, (tag, i) => tag === 1 ? exec(record.opcode[i],record.address[i],record.data[i]) : 0n);
      board.port1.postMessage({kind:"access-batch-result",ok:true,done:value.length,value,found:new Uint8Array(value.length)});
    } else if (record.kind === "exec") {
      board.port1.postMessage({kind:"exec-result",ok:true,isStore:record.opcode%2===0,value:exec(record.opcode,record.address,record.data)});
    } else if(record.kind === "gpu-batch") {
      gpuCommands(record.commands);board.port1.postMessage({kind:"gpu-batch-result",ok:true,message:""});
    } else if(record.kind === "gpu") {
      if(record.gpuOp === "present"){
        const now=performance.now();
        frames.push({at:now,ms:lastFrame?now-lastFrame:0,commands:frameCommands,glyphs:frameGlyphs,text,cache:globalThis.__privateCacheSample?.(),heap:process.memoryUsage().heapUsed});
        if(frames.length%50===0){console.log(JSON.stringify({progress:frames.length,elapsedMs:now-frames[0].at,cache:frames.at(-1).cache}));}
        lastFrame=now;frameCommands=0;frameGlyphs=0;text="";
      }
      board.port1.postMessage({kind:"exec-result",ok:true,isStore:true,value:0n,message:""});
    } else if (["port-state","port-char","port-byte"].includes(record.kind)) {
      board.port1.postMessage({kind:"port-result",ok:true,value:0n});
    } else { throw new Error(`unexpected board command ${record.kind}`); }
  } catch (error) { board.port1.postMessage({kind:"exec-result",ok:false,message:error.message}); }
});
const runtime = Runtime.Hardware.Cpu;
runtime.declareCoreCount(8);
runtime.noteCpuIdentity("ZerOS-Reference-Cpu","ZerOS-Team","ZCP1");
const metrics=Metric.Hardware.Motherboard;
const page=metrics.openMetricPage();runtime.adoptMetricPage(page);
runtime.acceptMountedCore(0,cpu.port1);
for(let index=1;index<8;index++){const extra=new MessageChannel();ports.push(extra.port1,extra.port2);runtime.acceptMountedCore(index,extra.port1);}
metrics.writeMetric(3,0,0,1024n);metrics.writeMetric(3,1,0,640n);
Core.Hardware.Cpu.acceptCoreMessage({kind:"core",ordinal:0,boardPort:board.port2,cpuPort:cpu.port2,metrics:page});
export async function run(binary) {
  try {
    const result = await runtime.runGuest(0,Binary.Hardware.Cpu.decodeProgramBinary(binary));
    if (!result.Ok) { throw new Error(result.Message); }
    const scrollLimit=await new Promise(resolve=>{const receive=row=>{if(row.kind==="span"){cpu.port1.off("message",receive);resolve(new DataView(row.bytes.buffer,row.bytes.byteOffset,row.bytes.byteLength).getBigInt64(0,true).toString());}};cpu.port1.on("message",receive);cpu.port1.postMessage({kind:"span",address:5632n,length:8});});
    return {frames,commands,glyphs,executed:runtime.metric(0,1).toString(),scrollLimit};
  } finally { for (const port of ports) { port.close(); } }
}
