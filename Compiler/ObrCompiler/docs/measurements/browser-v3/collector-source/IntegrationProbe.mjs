/** 仅用于集成测试的构建期观察器。产品源码和生成映像不加入测试 opcode 或依赖。 */
import fs from 'node:fs';
const moduleId='virtual:obrc-integration-probe';
export function integrationProbe(){
 const replace=(source,needle,next)=>{if(source.split(needle).length!==2)throw Error('Integration probe anchor drift: '+needle);return source.replace(needle,next);};
 return {name:'obrc-integration-observer',enforce:'pre',
  resolveId(id){if(id===moduleId)return '\0'+moduleId;},
  load(id){if(id==='\0'+moduleId)return fs.readFileSync(new URL('./IntegrationObserver.mjs',import.meta.url),'utf8');},
  transform(source,id){const file=id.split('?')[0];let result=source;
   const header=`import {report as __obrcReport, glyph as __obrcGlyph, font as __obrcFont, rows as __obrcRows, connectInput as __obrcInput} from '${moduleId}';\n`;
   if(file.endsWith('/Cpu/Bootstrap/CpuRuntime.ts')){
    result=replace(result,'        terminalLive = true;',`        __obrcReport('terminal', {first: !terminalLive, rows: __obrcRows(), cores: Array.from(cores, ([ordinal, core]) => ({ordinal, executed: core.Executed})), memoryPublished: MetricPageRoot.Hardware.Motherboard.readMetric(2, 6, 0)});\n        terminalLive = true;`);
    result=replace(result,'        const core = requireOrdinal(ordinal);\n        core.nativeReply = reply;',`        const core = requireOrdinal(ordinal);\n        __obrcReport('syscall', {ordinal, service, native: true, executed: core.Executed});\n        core.nativeReply = reply;`);
    result=replace(result,'            openSvc.set(ordinal, Number(service));',`            __obrcReport('syscall', {ordinal, service, native: false, executed: requireOrdinal(ordinal).Executed});\n            openSvc.set(ordinal, Number(service));`);
    const queue='      function queuePaint(ordinal: number, item: Record<string, unknown>): void {';
    result=replace(result,queue,queue+`\n        if (ordinal === 2) __obrcFont(item);`);
    const stop='      function noteStop(ordinal: number, reason: number, index: number, op: string, detail: string): void {';
    result=replace(result,stop,stop+`\n        if (reason === 0 || reason === 3) __obrcReport('stop', {ordinal, reason, index, op, detail, executed: requireOrdinal(ordinal).Executed});`);
    const install='      export async function nativeInstall(ordinal: number, target: bigint, address: bigint, length: bigint): Promise<void> {\n        await installImage(ordinal, target, address, length);';
    result=replace(result,install,install+`\n        __obrcReport('installed', {target, length, executed: requireOrdinal(Number(target)).Executed});`);
    const start=result.indexOf('      export async function nativeCharacter(');if(start<0)throw Error('nativeCharacter missing');
    const at=result.indexOf('        refuseGpu(ordinal);',start);if(at<0)throw Error('nativeCharacter body missing');
    result=result.slice(0,at)+`        if (ordinal === 2) __obrcGlyph(x, y, code);\n`+result.slice(at);
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
