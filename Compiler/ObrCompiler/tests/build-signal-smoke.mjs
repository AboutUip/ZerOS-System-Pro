/** 使用现有guest ABI构建信号测试；只安装到任务专用集成NAS，产品源码不变。 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const root=path.resolve(repo,process.env.OBRC_INTEGRATION_OUT??'Toolchain/CompilerCheck/integration-strict');
const out=path.join(root,'signal-build');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original=fileURLToPath(new URL('./fixtures/signal-smoke.obr',import.meta.url));
const source=path.join(out,'source/signal-smoke.obr');
fs.mkdirSync(path.dirname(source),{recursive:true});fs.copyFileSync(original,source);
// obrc会自动加载可执行文件旁的lib；快照放在独立bin目录，以免与显式-I产生两个库副本。
const frozen={};
for(const [name,file]of [['baseline',process.env.OBRC_BASELINE??'Toolchain/CompilerCheck/baseline-built/obrc'],['candidate',process.env.OBRC??'Compiler/ObrCompiler/obrc']]){
 const target=path.join(out,'bin',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.resolve(repo,file),target);fs.chmodSync(target,0o755);frozen[name]={path:target,sha256:sha(target)};
}
const lib=path.join(repo,'Compiler/ObrCompiler/lib'),companion=path.join(lib,'obr.proc.obr');
const includes=['-I',lib,'-I',path.join(repo,'ZerOS-PRO/Hardware/Memory'),'-I',path.join(repo,'ZerOS-PRO/Hardware/Motherboard')];
const rows=[];
for(const [variant,compiler,flags]of [['baseline',frozen.baseline.path,[]],['O1',frozen.candidate.path,['-O1']],['O2',frozen.candidate.path,['-O2']]]){
 const file=path.join(out,variant),args=[source,companion,'-pie','-slot','0',...includes,...flags,'-debug','-o',file];
 const result=spawnSync(compiler,args,{encoding:'utf8',timeout:30000});if(result.status!==0)throw Error(result.stderr||result.error?.message);
 const image=fs.readFileSync(file);if(image.subarray(0,4).toString()!=='ZPB1')throw Error('Signal fixture must use existing PIE ZPB1');
 rows.push({variant,compiler,args,file,sha256:sha(file),bytes:image.length});
}
for(const row of rows){const file=path.join(root,row.variant,'NasRoot/bin/compiler-signal-smoke');if(!fs.existsSync(path.dirname(file)))throw Error('Run build-integration.mjs first');fs.copyFileSync(row.file,file);if(sha(file)!==row.sha256)throw Error('Signal fixture install mismatch');row.installed=file;}
const manifest={source:{file:original,sha256:sha(original)},companion:{file:companion,sha256:sha(companion)},frozen,rows};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest,null,2));
