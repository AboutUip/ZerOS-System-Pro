/** 串行运行隔离的真实浏览器机器；NAS 使用未修改的官方服务。测试日志与产物只进 CompilerCheck。 */
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import{randomUUID}from'node:crypto';import{fileURLToPath}from'node:url';
import{startServer}from'../../../ZerOS-PRO/Hardware/Nas/Server/serve.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');process.chdir(repo);
const out=path.resolve(process.env.OBRC_INTEGRATION_OUT??'Toolchain/CompilerCheck/integration-strict');
const variants=new Set(['baseline','O0','O1','O2','legacy-kernel','legacy-bios','legacy-logo','legacy-load']);const runs=new Map();let active=null,nas=null;const sockets=new Set();
const resultFile=path.join(out,'browser-results.json');
if(fs.existsSync(resultFile))for(const run of JSON.parse(fs.readFileSync(resultFile)).runs??[]){if(run.result===null)run.interruptedBeforeResult=true;runs.set(run.run,run);}
function save(){fs.writeFileSync(resultFile,JSON.stringify({updated:new Date().toISOString(),runs:[...runs.values()]},null,2)+'\n');}
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
async function body(req){let value='';for await(const part of req){value+=part;if(value.length>8*1024*1024)throw Error('test record too large');}return value?JSON.parse(value):{};}
async function stopNas(){if(!nas)return;for(const s of sockets)s.destroy();await new Promise(r=>nas.server.close(r));nas=null;sockets.clear();}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cache-Control','no-store');
 try{const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__start'&&req.method==='POST'){
   const data=await body(req);if(!variants.has(data.variant))throw Error('unknown variant');await stopNas();
   const root=path.join(out,data.variant,'NasRoot');fs.rmSync(path.join(root,'boot/compiler-out'),{force:true});
   nas=await startServer(root,8765);nas.server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
   active={run:randomUUID(),variant:data.variant,command:data.command??'',mode:data.mode??'smoke',serverRevision:2};
   runs.set(active.run,{...active,started:new Date().toISOString(),events:[],result:null});save();json(res,active);return;
  }
  if(url.pathname==='/__context'){if(!active)throw Error('no active case');json(res,active);return;}
  if(url.pathname==='/__event'&&req.method==='POST'){
   const value=await body(req);for(const event of Array.isArray(value)?value:[value]){const run=runs.get(event.run);if(!run)throw Error('unknown run');run.events.push(event);}json(res,{ok:true});return;
  }
  if(url.pathname==='/__status'){const run=runs.get(url.searchParams.get('run'));if(!run)throw Error('unknown run');json(res,run);return;}
  if(url.pathname==='/__finish'&&req.method==='POST'){
   const data=await body(req),run=runs.get(data.run);if(!run)throw Error('unknown run');
   const root=path.join(out,run.variant,'NasRoot');run.result={...data,outputFile:fs.existsSync(path.join(root,'boot/compiler-out'))?fs.readFileSync(path.join(root,'boot/compiler-out'),'utf8'):null};save();json(res,{ok:true});return;
  }
  if(url.pathname==='/__capture'&&req.method==='POST'){
   const data=await body(req),run=runs.get(data.run);if(!run||run.mode!=='bios-manual')throw Error('unknown manual device run');
   (run.manualCaptures??=[]).push(data);save();json(res,{ok:true});return;
  }
  if(url.pathname==='/__results'){save();json(res,{runs:[...runs.values()]});return;}
  if(url.pathname==='/'||url.pathname==='/harness.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(new URL('./IntegrationHarness.html',import.meta.url)));return;}
  const match=url.pathname.match(/^\/vm\/([^/]+)\/(.*)$/)??(active&&url.pathname.startsWith('/assets/')?['',active.variant,url.pathname.slice(1)]:null);if(!match||!variants.has(match[1])){res.writeHead(404);res.end();return;}
  const root=path.join(out,match[1],'Dist'),file=path.resolve(root,match[2]||'index.html');if(!file.startsWith(root+path.sep))throw Error('invalid static path');
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'});fs.createReadStream(file).pipe(res);
 }catch(error){json(res,{error:String(error)},500);}
});
server.listen(5290,'127.0.0.1',()=>console.log('Integration harness http://127.0.0.1:5290/'));
process.on('SIGINT',async()=>{save();await stopNas();server.close();});
