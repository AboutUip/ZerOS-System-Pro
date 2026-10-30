/** Source manifest mirrors build-guest.mjs. Output files are temporary, never the NAS runtime root. */
import fs from 'node:fs';
import path from 'node:path';
export function guestCorpus(repo){
 const product=path.join(repo,'ZerOS-PRO');const kernel=path.join(product,'Kernel');const lib=path.join(repo,'Compiler/ObrCompiler/lib');
 const memory=path.join(product,'Hardware/Memory');const board=path.join(product,'Hardware/Motherboard');
 const proc=path.join(lib,'obr.proc.obr');const text=path.join(lib,'obr.text.obr');
 const includes=['Init','Proc','Mm','Sched','Fs','Exec','Font','Text','Test'].flatMap(n=>['-I',path.join(kernel,n)]);
 const common=['-I',memory,'-I',board,'-I',lib];const pie=['-pie','-slot','0',...common];
 const kernelFiles=['Init/start','Proc/task','Mm/mm','Sched/sched','Fs/vfs','Exec/exec','Font/font','Text/utf8','Test/suite'].map(n=>path.join(kernel,n+'.obr'));
 const jobs=[{name:'kernel/start',sources:[...kernelFiles,path.join(lib,'obr.nas.obr')],flags:['-slot','2',...includes,...common]},
 {name:'kernel/init',sources:[path.join(product,'System/Init/init.obr'),proc,text],flags:pie},
 {name:'os/sh',sources:[path.join(product,'System/Shell/sh.obr'),path.join(product,'System/Shell/edit.obr'),proc],flags:[...pie,'-I',path.join(product,'System/Shell')]},
 {name:'os/session',sources:[path.join(product,'System/Session/session.obr'),proc],flags:pie},
 {name:'kernel/idle',sources:[path.join(kernel,'Idle/idle.obr')],flags:pie},
 {name:'kernel/drv/pulse',sources:[path.join(kernel,'Drv/pulse.obr')],flags:pie}];
 const bin=path.join(product,'Resource/Bin');
 for(const name of fs.readdirSync(bin).filter(n=>n.endsWith('.obr')&&n!=='arg.obr').sort())if(fs.readFileSync(path.join(bin,name),'utf8').includes('deRfun main'))jobs.push({name:'bin/'+name.slice(0,-4),sources:[path.join(bin,name),path.join(bin,'arg.obr'),proc],flags:[...pie,'-I',bin]});
 return jobs;
}
