/** 无筛选归档所有原始浏览器记录；恢复后必须逐字节匹配原始JSON的SHA。 */
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';import{createHash}from'node:crypto';
const [mode,input,output]=process.argv.slice(2),sha=b=>createHash('sha256').update(b).digest('hex');
if(!input||!output||!['pack','unpack'].includes(mode))throw Error('Usage: node browser-records.mjs pack raw.json directory | unpack index.json restored.json');
if(mode==='pack'){
 const raw=fs.readFileSync(input),data=JSON.parse(raw),runs=data.runs;delete data.runs;fs.mkdirSync(output,{recursive:true});
 const entries=runs.map((run,index)=>{const raw=Buffer.from(JSON.stringify(run)),compressed=zlib.gzipSync(raw,{level:9}),file=`${String(index).padStart(3,'0')}-${run.run}.json.gz`;fs.writeFileSync(path.join(output,file),compressed);return{file,run:run.run,variant:run.variant,command:run.command,mode:run.mode,status:run.result?.status??'incomplete',rawSha256:sha(raw),compressedSha256:sha(compressed)};});
 const index={rawSha256:sha(raw),rawBytes:raw.length,top:data,entries};fs.writeFileSync(path.join(output,'index.json'),JSON.stringify(index,null,2)+'\n');console.log(JSON.stringify({runs:entries.length,rawBytes:raw.length,rawSha256:index.rawSha256}));
}else{
 const index=JSON.parse(fs.readFileSync(input)),root=path.dirname(input),runs=index.entries.map(entry=>{const compressed=fs.readFileSync(path.join(root,entry.file));if(sha(compressed)!==entry.compressedSha256)throw Error('Compressed archive drift '+entry.file);const raw=zlib.gunzipSync(compressed);if(sha(raw)!==entry.rawSha256)throw Error('Raw record drift '+entry.file);return JSON.parse(raw);});
 const raw=Buffer.from(JSON.stringify({...index.top,runs},null,2)+'\n');if(sha(raw)!==index.rawSha256)throw Error('Restored original JSON does not match');fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,raw);console.log(JSON.stringify({runs:runs.length,bytes:raw.length,sha256:sha(raw)}));
}
