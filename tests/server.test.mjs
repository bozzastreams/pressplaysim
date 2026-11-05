import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {startServer} from '../dist-server/index.js';
test('original simulator serves the local workspace and compiled app without activation',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'pressplaysim-original-'));let service;
 try{
  service=await startServer({port:0,dev:false,dataDir,staticDir:fileURLToPath(new URL('../dist/',import.meta.url))});
  const base='http://127.0.0.1:'+service.port;
  const infoResponse=await fetch(base+'/api/info');assert.equal(infoResponse.status,200);
  const info=await infoResponse.json();assert.equal(info.configured,false);assert.equal(info.local,true);assert.equal(info.brand.name,'Your club');
  const page=await fetch(base);assert.equal(page.status,200);const html=await page.text();assert.match(html,/id="root"/);
  const asset=html.match(/src="([^"]+\.js)"/)[1];assert.equal((await fetch(base+asset)).status,200);
  assert.equal((await fetch(base+'/api/info',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.ok(existsSync(fileURLToPath(new URL('../native/pressplay-mp4-export',import.meta.url))));
 }finally{if(service)await service.close();rmSync(dataDir,{recursive:true,force:true});}
});
