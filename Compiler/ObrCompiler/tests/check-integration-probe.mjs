/** 观察器锚点和变换后的 TS 必须真实有效，避免“没有采集到”被误判为没有事件。 */
import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
import{transform}from'../../../Toolchain/node_modules/esbuild/lib/main.js';import{integrationProbe}from'./IntegrationProbe.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const probe=integrationProbe();let checks=0;
for(const name of ['Cpu/Bootstrap/CpuRuntime','Cpu/Host/CoreDispatch','Memory/Host/MemoryDispatch','Nas/Bootstrap/NasRuntime','Motherboard/Bootstrap/FirmwarePower','Display/Host/PageHost']){
 const file=path.join(repo,'ZerOS-PRO/Hardware',name+'.ts'),source=fs.readFileSync(file,'utf8'),result=probe.transform(source,file);assert(result&&result!==source);checks++;
 await transform(result,{loader:'ts',target:'es2022'});checks++;
}
assert.equal(probe.transform('const ordinary = 42;','unrelated.ts'),null);checks++;
console.log(JSON.stringify({checks,failures:0}));
