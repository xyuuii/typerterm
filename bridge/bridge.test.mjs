import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';
import ssh2 from 'ssh2';
import {createBridge} from './server.mjs';

const {Server,utils}=ssh2;
function collector(ws){const queue=[],wait=[];ws.on('message',(data,binary)=>{const m=binary?{binary:Buffer.from(data)}:JSON.parse(data.toString());const n=wait.findIndex(x=>x.predicate(m));if(n>=0){const w=wait.splice(n,1)[0];clearTimeout(w.timer);w.resolve(m);}else queue.push(m);});return (predicate,timeout=8000)=>{const n=queue.findIndex(predicate);if(n>=0)return Promise.resolve(queue.splice(n,1)[0]);return new Promise((resolve,reject)=>{const item={predicate,resolve,timer:setTimeout(()=>{const i=wait.indexOf(item);if(i>=0)wait.splice(i,1);reject(new Error('等待测试事件超时'));},timeout)};wait.push(item);});};}
function get(url,headers={}){return new Promise((resolve,reject)=>{http.get(url,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});}

test('本地桥接：访问边界、指纹、UTF-8、输入、PTY、流控与清理',async()=>{
 const keys=utils.generateKeyPairSync('ed25519');const expectedFingerprint='SHA256:'+createHash('sha256').update(utils.parseKey(keys.private).getPublicSSH()).digest('base64').replace(/=+$/,'');
 const password=randomBytes(16).toString('hex');const remoteClients=new Set();let connectionCount=0,lastPty=null,lastResize=null,remoteChannel=null;
 const remote=new Server({hostKeys:[keys.private]},client=>{connectionCount++;remoteClients.add(client);client.on('error',()=>{});client.on('close',()=>remoteClients.delete(client));client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username==='fixture-user'&&ctx.password===password)ctx.accept();else ctx.reject();});client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('pty',(accept,reject,info)=>{lastPty=info;accept?.();});session.on('window-change',(accept,reject,info)=>{lastResize=info;accept?.();});session.on('shell',accept=>{remoteChannel=accept();const bytes=Buffer.from('READY 中文\r\n');remoteChannel.write(bytes.subarray(0,8));remoteChannel.write(bytes.subarray(8));remoteChannel.on('data',data=>{if(data.toString()==='BURST'){for(let i=0;i<64;i++)remoteChannel.write(Buffer.alloc(8192,65));remoteChannel.write('BURST-END');}else remoteChannel.write(Buffer.concat([Buffer.from('ECHO:'),data]));});});}));});
 await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));const sshPort=remote.address().port;
 const bridge=await createBridge();const sockets=[];
 try{
  assert.equal(bridge.server.address().address,'127.0.0.1');assert.equal(await get(bridge.url),200);assert.equal(await get(bridge.url,{Host:'not-the-local-host'}),403);
  const bad=new WebSocket(bridge.url.replace('http:','ws:')+'/terminal',{origin:'https://unrelated.invalid'});sockets.push(bad);const rejected=await new Promise(resolve=>{bad.on('unexpected-response',(_,res)=>{res.resume();resolve(res.statusCode);bad.terminate();});bad.on('error',()=>resolve(403));});assert.equal(rejected,403);
  const wrong=new WebSocket(bridge.url.replace('http:','ws:')+'/terminal',{origin:bridge.url});sockets.push(wrong);const wrongNext=collector(wrong);await once(wrong,'open');wrong.send(JSON.stringify({type:'connect',token:'wrong'}));assert.equal((await wrongNext(m=>m.type==='error')).message,'本地访问口令不正确');assert.equal(connectionCount,0);
  const ws=new WebSocket(bridge.url.replace('http:','ws:')+'/terminal',{origin:bridge.url});sockets.push(ws);const next=collector(ws);const received=[];ws.on('message',(data,binary)=>{if(binary){received.push(Buffer.from(data));ws.send(JSON.stringify({type:'ack',bytes:data.length}));}});await once(ws,'open');ws.send(JSON.stringify({type:'connect',token:bridge.token,host:'127.0.0.1',port:sshPort,username:'fixture-user',password,cols:48,rows:24}));
  const hk=await next(m=>m.type==='hostkey');assert.equal(hk.fingerprint,expectedFingerprint);assert.equal(lastPty,null);ws.send(JSON.stringify({type:'verify',accept:true}));await next(m=>m.type==='connected');await next(m=>m.binary);let hostPrompts=1;ws.on('message',(data,binary)=>{if(!binary&&JSON.parse(data.toString()).type==='hostkey')hostPrompts++;});assert.equal(remoteClients.size,1);const [peer]=[...remoteClients];await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('重新协商超时')),5000);peer.rekey(()=>{clearTimeout(timer);resolve();});});assert.equal(hostPrompts,1);assert.equal(lastPty.cols,48);assert.equal(lastPty.rows,24);
  ws.send(Buffer.from('ABC 中文\x03'));let text='';for(let i=0;i<5&&!text.includes('ECHO:ABC 中文\x03');i++){await next(m=>m.binary);text=Buffer.concat(received).toString('utf8');}assert.ok(text.includes('READY 中文'));assert.ok(text.includes('ECHO:ABC 中文\x03'));assert.ok(!text.includes(password));
  ws.send(JSON.stringify({type:'resize',cols:91,rows:31,width:980,height:620}));await new Promise(resolve=>setTimeout(resolve,100));assert.equal(lastResize.cols,91);assert.equal(lastResize.rows,31);assert.equal(lastResize.width,980);assert.equal(lastResize.height,620);
  const before=Buffer.concat(received).length;ws.send(Buffer.from('BURST'));let burst='';for(let i=0;i<100&&!burst.endsWith('BURST-END');i++){await next(m=>m.binary);burst=Buffer.concat(received).subarray(before).toString();}assert.equal(burst.length,524288+9);assert.ok(burst.endsWith('BURST-END'));
  ws.send(Buffer.from('AFTER'));await next(m=>m.binary&&m.binary.includes(Buffer.from('ECHO:AFTER')));assert.ok(Buffer.concat(received).toString().endsWith('ECHO:AFTER'));
  ws.close();await once(ws,'close');
 }finally{for(const ws of sockets)if(ws.readyState!==WebSocket.CLOSED){ws.on('error',()=>{});ws.terminate();}await bridge.close();for(const c of remoteClients)c.end();await new Promise(resolve=>remote.close(resolve));}
});
