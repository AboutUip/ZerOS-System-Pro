/** 固定历史提交，只接通当时休眠的 peel；输出是隔离的故障对照，禁止用于产品构建。 */
import fs from 'node:fs';import path from 'node:path';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');process.chdir(repo);
const out=path.resolve(process.env.OBRC_LEGACY_OUT??'Toolchain/CompilerCheck/legacy-peel');
if(fs.existsSync(out))throw Error('Refuse to overwrite immutable legacy build: '+out);
fs.mkdirSync(out,{recursive:true});const source=path.join(out,'source');fs.mkdirSync(source);
function run(exe,args,input){const r=spawnSync(exe,args,{input,maxBuffer:64*1024*1024});if(r.status!==0)throw Error(String(r.stderr||r.error));return r.stdout;}
const ref='7bf78874240d695ff384cbf75efc1a3198036677';
run('tar',['-xf','-','-C',source],run(process.env.OBRC_GIT??'git',['archive','--format=tar',ref,'Compiler/ObrCompiler']));
const file=path.join(source,'Compiler/ObrCompiler/src/codegen/Generate.cpp');let text=fs.readFileSync(file,'utf8');
const marker='      /* 窥孔编出来的内核停在 Starting，自检画面被固件盖住。先关掉，等内核能到提示符再开。 */';
if(text.split(marker).length!==2)throw Error('Historical patch anchor drift');
text=text.replace(marker,marker+'\n      peel(result.text, result.sites);');fs.writeFileSync(file,text);
const cmake=process.env.OBRC_CMAKE??'cmake';run(cmake,['-S',path.join(source,'Compiler/ObrCompiler'),'-B',path.join(out,'build'),'-DCMAKE_BUILD_TYPE=Release']);
run(cmake,['--build',path.join(out,'build'),'--parallel','4']);
const binary=path.join(out,'obrc');fs.copyFileSync(path.join(source,'Compiler/ObrCompiler/obrc'),binary);fs.chmodSync(binary,0o755);
const metadata={ref,change:'Only insert peel(result.text, result.sites) in Generator::run finish',sha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex')};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify(metadata));
