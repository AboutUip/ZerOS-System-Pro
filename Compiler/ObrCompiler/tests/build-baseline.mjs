/** Build an immutable reference compiler from a Git commit, without checking out over the working tree. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');process.chdir(repo);
const git=process.env.OBRC_GIT??'git';const cmake=process.env.OBRC_CMAKE??'cmake';
function command(exe,args,options={}){const r=spawnSync(exe,args,{maxBuffer:64*1024*1024,...options});if(r.status!==0)throw Error((r.stderr??r.error?.message??'command failed').toString());return r.stdout;}
const ref=command(git,['rev-parse','--verify',(process.env.OBRC_BASE_REF??'7bf78874240d695ff384cbf75efc1a3198036677')+'^{commit}']).toString().trim();
if(!/^[a-f0-9]{40}$/.test(ref))throw Error('baseline ref did not resolve to a commit');
const output=path.resolve(process.argv[2]??'Toolchain/CompilerCheck/baseline-built/obrc');
if(fs.existsSync(output))throw Error('baseline output already exists; choose a new immutable output path: '+output);
fs.mkdirSync(path.dirname(output),{recursive:true});const source=fs.mkdtempSync(path.join(path.dirname(output),'source-'));
const archive=command(git,['archive','--format=tar',ref,'Compiler/ObrCompiler']);command('tar',['-xf','-','-C',source],{input:archive});
const version=command(cmake,['--version']).toString().split('\n')[0];const build=path.join(source,'build');
command(cmake,['-S',path.join(source,'Compiler/ObrCompiler'),'-B',build,'-DCMAKE_BUILD_TYPE=Release']);command(cmake,['--build',build,'--config','Release','--parallel','4']);
const binary=path.join(source,'Compiler/ObrCompiler',process.platform==='win32'?'obrc.exe':'obrc');fs.copyFileSync(binary,output,fs.constants.COPYFILE_EXCL);fs.chmodSync(output,0o755);
const manifest={ref,cmake:version,sha256:createHash('sha256').update(fs.readFileSync(output)).digest('hex'),buildType:'Release',platform:process.platform,arch:process.arch};
fs.writeFileSync(output+'.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({...manifest,output}));
