/** 构建彼此隔离的真实 NAS、固件和浏览器包；不替换工作区 obrc 或产品源码。 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{build,loadConfigFromFile}from'../../../Toolchain/node_modules/vite/dist/node/index.js';
import{guestCorpus}from'./corpus.mjs';import{integrationProbe}from'./IntegrationProbe.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');process.chdir(repo);
const out=path.resolve(process.env.OBRC_INTEGRATION_OUT??'Toolchain/CompilerCheck/integration-strict');fs.mkdirSync(out,{recursive:true});
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const baseline=path.resolve(process.env.OBRC_BASELINE??'Toolchain/CompilerCheck/baseline-built/obrc');
const candidate=path.resolve(process.env.OBRC??'Compiler/ObrCompiler/obrc');
const legacy=path.resolve('Toolchain/CompilerCheck/legacy-peel/obrc');
const baselineManifest=fs.existsSync(baseline+'.json')?JSON.parse(fs.readFileSync(baseline+'.json')):null;
const provenance={base:process.env.OBRC_BASELINE_REF??baselineManifest?.ref??null,baseline:sha(baseline),candidate:sha(candidate),observer:sha(new URL('./IntegrationObserver.mjs',import.meta.url)),plugin:sha(new URL('./IntegrationProbe.mjs',import.meta.url)),counter:sha(new URL('./MemoryCounters.mjs',import.meta.url)),node:process.version,os:os.release(),cpu:os.cpus()[0].model};
const frozen={};for(const [name,file]of[['baseline',baseline],['candidate',candidate]]){const dest=path.join(out,name+'-obrc');fs.copyFileSync(file,dest);fs.chmodSync(dest,0o755);frozen[name]=dest;}
const jobs=guestCorpus(repo),lib=path.join(repo,'Compiler/ObrCompiler/lib'),product=path.join(repo,'ZerOS-PRO');
const includes=['-I',lib,'-I',path.join(repo,'Driver/Gpu'),'-I',path.join(product,'Hardware/Gpu'),'-I',path.join(product,'Hardware/Motherboard'),'-I',path.join(product,'Hardware/Memory')];
const firmware=[
 {name:'Bios',exportName:'biosProgram',sources:['ZerOS-PRO/Boot/Bios.obr','ZerOS-PRO/Boot/Keys.obr','ZerOS-PRO/Boot/Splash.obr','ZerOS-PRO/Boot/Panel.obr','ZerOS-PRO/Boot/Clear.obr','Driver/Pointer/pointer.obr','Compiler/ObrCompiler/lib/obr.widget.obr','Compiler/ObrCompiler/lib/obr.nas.obr','Driver/Display/panel.obr','Driver/Gpu/gl.obr'],flags:[]},
 {name:'Logo',exportName:'logoProgram',sources:['ZerOS-PRO/Boot/Logo.obr','Driver/Gpu/gl.obr'],flags:[]},
 {name:'Load',exportName:'loadProgram',sources:['ZerOS-PRO/Boot/Load.obr','Compiler/ObrCompiler/lib/obr.nas.obr'],flags:['-slot','3']}
];
function compile(exe,sources,flags,file){fs.mkdirSync(path.dirname(file),{recursive:true});const r=spawnSync(exe,[...sources,...flags,'-o',file],{encoding:'utf8',timeout:120000});if(r.status!==0)throw Error(sources[0]+': '+r.stderr);}
function sites(file){const rows=fs.readFileSync(file+'.debug','utf8').split('\n');if(rows.shift()!=='obr-debug 1')return[];const runs=[];for(const row of rows){if(!row)continue;const [at,file,line,fn]=row.split('\t');if(!file||!fn)continue;const tail=runs.at(-1),name=path.basename(file),index=Number(at),ln=Number(line);if(tail&&tail[1]===index&&tail[2]===name&&tail[3]===ln&&tail[4]===fn)tail[1]++;else runs.push([index,index+1,name,ln,fn]);}return runs;}
async function browser(variant){
 const dir=path.join(out,variant),loaded=await loadConfigFromFile({command:'build',mode:'production'},path.join(repo,'Toolchain/vite.config.ts'));
 const cfg=loaded.config;const module='\0obrc-test-firmware';
 const firmwarePlugin={name:'obrc-test-firmware',resolveId(id){if(id==='zeros-boot-firmware')return module;},load(id){if(id!==module)return null;return firmware.map(j=>{const file=path.join(dir,'firmware',j.name);return `export const ${j.exportName}=${JSON.stringify([...fs.readFileSync(file)])};export const ${j.exportName}Sites=${JSON.stringify(sites(file))};`;}).join('\n');}};
 await build({...cfg,configFile:false,logLevel:'error',plugins:[firmwarePlugin,...cfg.plugins.filter(p=>p.name!=='zeros-obr-firmware'),integrationProbe()],build:{...cfg.build,outDir:path.join(dir,'Dist'),emptyOutDir:true}});
}
for(const [variant,exe,opt]of[['baseline',frozen.baseline,[]],['O0',frozen.candidate,['-O0']],['O1',frozen.candidate,['-O1']],['O2',frozen.candidate,['-O2']]]){
 const dir=path.join(out,variant);fs.mkdirSync(dir,{recursive:true});const manifest=path.join(dir,'manifest.json');
 if(fs.existsSync(manifest)){const prior=JSON.parse(fs.readFileSync(manifest));if(JSON.stringify(prior.provenance)!==JSON.stringify(provenance))throw Error('Frozen integration build differs; choose a new output directory');console.log('Reusing',variant);continue;}
 const root=path.join(dir,'NasRoot');if(!fs.existsSync(root))fs.cpSync(path.join(product,'Hardware/Nas/Root'),root,{recursive:true});
 const reuse=process.env.OBRC_REUSE_IMAGES_FROM?path.resolve(process.env.OBRC_REUSE_IMAGES_FROM,variant):null;
 if(reuse){const saved=JSON.parse(fs.readFileSync(path.join(reuse,'manifest.json')));if(saved.provenance.baseline!==provenance.baseline||saved.provenance.candidate!==provenance.candidate)throw Error('Compiler changed; refuse image reuse');for(const j of saved.programs)if(sha(path.join(reuse,'NasRoot',j.name))!==j.sha256)throw Error('Reused image drift: '+j.name);for(const j of saved.firmware)if(sha(path.join(reuse,'firmware',j.name))!==j.sha256)throw Error('Reused firmware drift: '+j.name);for(const j of jobs){const dest=path.join(root,j.name);fs.copyFileSync(path.join(reuse,'NasRoot',j.name),dest);fs.copyFileSync(path.join(reuse,'NasRoot',j.name+'.debug'),dest+'.debug');}fs.cpSync(path.join(reuse,'firmware'),path.join(dir,'firmware'),{recursive:true});}
 else for(const j of jobs)compile(exe,j.sources,[...j.flags,...opt,'-debug'],path.join(root,j.name));
 fs.writeFileSync(path.join(root,'boot/display'),Buffer.from([128,2,224,1]));fs.writeFileSync(path.join(root,'boot/debug'),Buffer.from([0]));fs.writeFileSync(path.join(root,'boot/compiler-input'),'alpha\nbeta\n');
 if(!reuse)for(const j of firmware)compile(exe,j.sources,[...includes,...j.flags,...opt,'-debug'],path.join(dir,'firmware',j.name));
 await browser(variant);
 fs.writeFileSync(manifest,JSON.stringify({variant,provenance,programs:jobs.map(j=>({name:j.name,sha256:sha(path.join(root,j.name)),bytes:fs.statSync(path.join(root,j.name)).size})),firmware:firmware.map(j=>({name:j.name,sha256:sha(path.join(dir,'firmware',j.name))}))},null,2)+'\n');console.log('Built full integration',variant);
}
// 历史窥孔控制只能在对应旧产品源码上显式构建；不能将旧编译器默默用于新增 opcode 的新产品。
if(process.env.OBRC_INCLUDE_LEGACY==='1'&&fs.existsSync(legacy)){
 const dir=path.join(out,'legacy-kernel');if(!fs.existsSync(dir))fs.cpSync(path.join(out,'baseline'),dir,{recursive:true});
 compile(legacy,jobs[0].sources,[...jobs[0].flags,'-debug'],path.join(dir,'NasRoot/kernel/start'));
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({variant:'legacy-kernel',provenance,legacy:JSON.parse(fs.readFileSync('Toolchain/CompilerCheck/legacy-peel/manifest.json')),change:'Only NAS kernel/start compiled with dormant legacy peel enabled; original baseline firmware and remaining programs retained'},null,2)+'\n');
 console.log('Built legacy-kernel fault control');
 for(const part of ['Bios','Logo','Load']){
  const variant='legacy-'+part.toLowerCase(),target=path.join(out,variant);if(!fs.existsSync(target))fs.cpSync(path.join(out,'baseline'),target,{recursive:true});
  const j=firmware.find(job=>job.name===part);compile(legacy,j.sources,[...includes,...j.flags,'-debug'],path.join(target,'firmware',part));await browser(variant);
  fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({variant,provenance,legacy:JSON.parse(fs.readFileSync('Toolchain/CompilerCheck/legacy-peel/manifest.json')),change:'Only '+part+' firmware compiled with dormant legacy peel enabled; original NAS and other firmware retained'},null,2)+'\n');console.log('Built',variant,'fault control');
 }
}
const collector=path.join(out,'collector-source');fs.mkdirSync(collector,{recursive:true});for(const file of ['IntegrationProbe.mjs','IntegrationObserver.mjs','MemoryCounters.mjs'])fs.copyFileSync(new URL('./'+file,import.meta.url),path.join(collector,file));
fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');console.log('Integration artifacts ready:',out);
