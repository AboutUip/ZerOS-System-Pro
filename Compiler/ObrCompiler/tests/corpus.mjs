/** Source manifest mirrors build-guest.mjs. Output files are temporary, never the NAS runtime root. */
import fs from 'node:fs';
import path from 'node:path';
export function guestCorpus(repo){
 const product=path.join(repo,'ZerOS-PRO');const kernel=path.join(product,'Kernel');const lib=path.join(repo,'Compiler/ObrCompiler/lib');
 const memory=path.join(product,'Hardware/Memory');const board=path.join(product,'Hardware/Motherboard');
 const proc=path.join(lib,'obr.proc.obr');const text=path.join(lib,'obr.text.obr');
 const includes=['Init','Proc','Mm','Sched','Fs','Exec','Font','Text','Test'].flatMap(n=>['-I',path.join(kernel,n)]);
 const common=['-I',memory,'-I',board,'-I',lib];const pie=['-pie','-slot','0',...common];
 const kernelFiles=['Init/start','Proc/task','Proc/pool','Proc/sig','Mm/mm','Sched/sched','Fs/vfs','Fs/pipe','Fs/dev','Fs/console','Fs/comm','Exec/exec','Exec/boot','Exec/spawn','Font/font','Text/utf8','Test/suite'].map(n=>path.join(kernel,n+'.obr'));
 const jobs=[{name:'kernel/start',sources:[...kernelFiles,path.join(lib,'obr.nas.obr')],flags:['-slot','2',...includes,...common]},
 {name:'kernel/init',sources:[path.join(product,'System/Init/init.obr'),proc,text],flags:pie},
 {name:'os/session',sources:[path.join(product,'System/Session/session.obr'),proc],flags:pie},
 {name:'kernel/idle',sources:[path.join(kernel,'Idle/idle.obr')],flags:pie},
 {name:'kernel/drv/pulse',sources:[path.join(kernel,'Drv/pulse.obr')],flags:pie}];
 // 与产品构建一致：App 子目录自行声明一个 main，其余非 check 单元共同链接。
 const apps=path.join(product,'Resource/App');
 for(const entry of fs.readdirSync(apps,{withFileTypes:true}).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
  const dir=path.join(apps,entry.name),bodies=fs.readdirSync(dir).filter(n=>n.endsWith('.obr')&&!n.endsWith('-check.obr'));
  const mains=bodies.filter(n=>fs.readFileSync(path.join(dir,n),'utf8').includes('deRfun main'));
  if(mains.length>1)throw Error(entry.name+' contains multiple main units');
  if(mains.length===1){const sources=[mains[0],...bodies.filter(n=>n!==mains[0])].map(n=>path.join(dir,n));
   jobs.splice(entry.name==='sh'?2:jobs.length,0,{name:entry.name==='sh'?'os/sh':'app/'+entry.name,sources:[...sources,proc],flags:[...pie,'-I',dir]});}
 }
 const bin=path.join(product,'Resource/Bin');
 for(const name of fs.readdirSync(bin).filter(n=>n.endsWith('.obr')&&n!=='arg.obr').sort())if(fs.readFileSync(path.join(bin,name),'utf8').includes('deRfun main'))jobs.push({name:'bin/'+name.slice(0,-4),sources:[path.join(bin,name),path.join(bin,'arg.obr'),proc],flags:[...pie,'-I',bin]});
 return jobs;
}
