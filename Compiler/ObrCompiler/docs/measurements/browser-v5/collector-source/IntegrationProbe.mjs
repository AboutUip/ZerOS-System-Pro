/** 仅用于集成测试的构建期观察器。产品源码和生成映像不加入测试 opcode 或依赖。 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const moduleId='virtual:obrc-integration-probe';
export function integrationProbe(){
 const replace=(source,needle,next)=>{if(source.split(needle).length!==2)throw Error('Integration probe anchor drift: '+needle);return source.replace(needle,next);};
 return {name:'obrc-integration-observer',enforce:'pre',
  resolveId(id){if(id===moduleId)return '\0'+moduleId;if(id==='virtual:obrc-memory-counter')return fileURLToPath(new URL('./MemoryCounters.mjs',import.meta.url));},
  load(id){if(id==='\0'+moduleId)return fs.readFileSync(new URL('./IntegrationObserver.mjs',import.meta.url),'utf8');},
  transform(source,id){const file=id.split('?')[0];let result=source;
   const header=`import {report as __obrcReport, glyph as __obrcGlyph, font as __obrcFont, rows as __obrcRows, connectInput as __obrcInput, token as __obrcToken, access as __obrcAccess, accessSnapshot as __obrcAccessSnapshot, metricsEnabled as __obrcEnabled, captureControls as __obrcControls, emitControls as __obrcEmitControls, control as __obrcControl} from '${moduleId}';\n`;
   if(file.endsWith('/Cpu/Bootstrap/CpuRuntime.ts')){
    result=replace(result,'        terminalLive = true;',`        __obrcReport('terminal', {first: !terminalLive, rows: __obrcRows(), cores: Array.from(cores, ([ordinal, core]) => ({ordinal, executed: core.Executed})), memoryPublished: MetricPageRoot.Hardware.Motherboard.readMetric(2, 6, 0)});\n        terminalLive = true;`);
    result=replace(result,'        const core = requireOrdinal(ordinal);\n        core.nativeReply = reply;',`        const core = requireOrdinal(ordinal);\n        __obrcReport('syscall', {ordinal, service, native: true, home: core.boundOrigin, executed: core.Executed});\n        core.nativeReply = reply;`);
    result=replace(result,'            openSvc.set(ordinal, Number(service));',`            __obrcReport('syscall', {ordinal, service, native: false, home: requireOrdinal(ordinal).boundOrigin, executed: requireOrdinal(ordinal).Executed});\n            if (service === 28n && __obrcEnabled()) requireOrdinal(ordinal).port.postMessage({kind:'obrc-test-snapshot', point:'svc28', token:__obrcToken('svc28')});\n            openSvc.set(ordinal, Number(service));`);
    const queue='      function queuePaint(ordinal: number, item: Record<string, unknown>): void {';
    result=replace(result,queue,queue+`\n        if (ordinal === 2) __obrcFont(item);`);
    const stop='      function noteStop(ordinal: number, reason: number, index: number, op: string, detail: string): void {';
    result=replace(result,stop,stop+`\n        if (reason === 0 || reason === 3) { const token=__obrcToken('stop'); __obrcReport('stop', {ordinal, reason, index, op, detail, token, executed: requireOrdinal(ordinal).Executed}); if(reason===0 && __obrcEnabled()) requireOrdinal(ordinal).port.postMessage({kind:'obrc-test-snapshot', point:'halt', token}); }`);
    const install='      export async function nativeInstall(ordinal: number, target: bigint, address: bigint, length: bigint): Promise<void> {\n        await installImage(ordinal, target, address, length);';
    result=replace(result,install,install+`\n        { const token=__obrcToken('install'); __obrcReport('installed', {target, length, token, executed: requireOrdinal(Number(target)).Executed}); if(__obrcEnabled()) requireOrdinal(Number(target)).port.postMessage({kind:'obrc-test-snapshot',point:'installed',token}); }`);
    result=replace(result,'        return writeSpan(ordinal, address, bytes);',`        const captured=__obrcControls(ordinal,address,bytes);\n        return writeSpan(ordinal, address, bytes).then(() => { __obrcEmitControls(captured); });`);
    result=replace(result,'          work = writeSpans(ordinal, addresses, parts);',`          const captured=addresses.flatMap((address,index) => __obrcControls(ordinal,address,parts[index]));\n          work = writeSpans(ordinal, addresses, parts).then(() => { __obrcEmitControls(captured); });`);
    result=replace(result,'        target.latch = data;',`        target.latch = data;\n        __obrcReport('reply', {from:fromOrdinal,to:toOrdinal,data});`);
    const start=result.indexOf('      export async function nativeCharacter(');if(start<0)throw Error('nativeCharacter missing');
    const at=result.indexOf('        refuseGpu(ordinal);',start);if(at<0)throw Error('nativeCharacter body missing');
    result=result.slice(0,at)+`        if (ordinal === 2) __obrcGlyph(x, y, code);\n`+result.slice(at);
   }else if(file.endsWith('/Cpu/Host/CoreDispatch.ts')){
    const marker='      function onCpu(data: unknown): void {\n        const record = asRecord(data);\n        if (record === null) {\n          return;\n        }\n        const kind = record["kind"];';
    result=replace(result,marker,marker+`\n        if(kind==='obrc-test-snapshot'){__obrcReport('guest-snapshot',{ordinal:selfOrdinal,point:record['point'],token:record['token'],returnValue:readRegister(0),logical:__obrcAccessSnapshot()});return;}`);
    for(const name of ['absorbScratch','absorbLinear','absorbFrameLoad','takeSupervisorFrame']){
     const signature=`function ${name}(step: Record<string, unknown>): boolean {`;
     result=replace(result,signature,signature+`\n const done=${name}Observed(step);if(done && quietFault === '')__obrcAccess(step['Op']);return done;\n }\n function ${name}Observed(step: Record<string, unknown>): boolean {`);
    }
    const signature='function applyAccessMeta(meta: AccessMeta, value: bigint, found: number, span: readonly bigint[] | null): void {';
    result=replace(result,signature,signature+`\n __obrcAccess(meta.apply);`);
   }else if(file.endsWith('/Memory/Host/MemoryDispatch.ts')){
    result=replace(result,'            const value = ready.executeChannelRead(address, width);',`            const value = ready.executeChannelRead(address, width);\n            __obrcControl('read',address,width,value);`);
    result=replace(result,'            ready.executeChannelWrite(address, width, data);',`            ready.executeChannelWrite(address, width, data);\n            __obrcControl('write',address,width,data);`);
   }else if(file.endsWith('/Nas/Bootstrap/NasRuntime.ts')){
    result=replace(result,'            socket.send(JSON.stringify(request));',`            __obrcReport('nas-request', request);\n            socket.send(JSON.stringify(request));`);
   }else if(file.endsWith('/Motherboard/Bootstrap/FirmwarePower.ts')){
    result=replace(result,'            Board.Power();',`            __obrcReport('power', {});\n            Board.Power();`);
   }else if(file.endsWith('/Display/Host/PageHost.ts')){
    result=replace(result,'      openDisplayPage();',`      __obrcInput();\n      openDisplayPage();`);
    result=replace(result,'        void import("../../Motherboard/Bootstrap/FirmwarePower");',`        let __faultCount = -1;\n        setInterval(() => { const faults = page.Faults(); if (faults.length !== __faultCount) { __faultCount = faults.length; __obrcReport('faults', {faults, last: page.LastFault()}); } }, 250);\n        void import("../../Motherboard/Bootstrap/FirmwarePower");`);
   }else return null;
   return header+result;
  }
 };
}
