import { spawn } from 'node:child_process';
import { cleanEnv, stopOwnedGroup } from './process.mjs';
const project=process.argv[2];if(!project)throw new Error('Usage: node diagnose-isolation.mjs APP_DIRECTORY');
const port=18880,base=`http://127.0.0.1:${port}`;
const child=spawn('pnpm',['exec','wrangler','dev','--ip','127.0.0.1','--port',String(port)],{cwd:project,env:cleanEnv(),detached:true,stdio:'ignore'});
const closed=new Promise(resolve=>child.once('close',resolve));
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!ready)throw new Error('Dev server not ready');
 const request=(url,cookie,method='GET',body)=>fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{origin:base}:{}),'content-type':'application/octet-stream'},body});
 const login=async email=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email,password:'local-demo-password'})});if(!r.ok)throw new Error('Demo login failed');return r.headers.get('set-cookie').split(';')[0]};
 const alice=await login('alice@example.test'),bob=await login('bob@example.test'),body='isolation diagnostic bytes';const created=await request('/api/uploads',alice,'POST',body);const{id}=await created.json();const foreignRead=await request('/api/uploads/'+id,bob),foreignDelete=await request('/api/uploads/'+id,bob,'DELETE'),ownerRead=await request('/api/uploads/'+id,alice);const ownerBody=await ownerRead.text();const ownerDelete=await request('/api/uploads/'+id,alice,'DELETE'),after=await request('/api/uploads/'+id,alice);const statuses={created:created.status,foreignRead:foreignRead.status,foreignDelete:foreignDelete.status,ownerRead:ownerRead.status,ownerDelete:ownerDelete.status,after:after.status};console.log(JSON.stringify({diagnostic:'post-run actual deletion isolation; original scores unchanged',statuses,ownerBytesPreserved:ownerBody===body,passed:statuses.created===201&&statuses.foreignRead===404&&[204,404].includes(statuses.foreignDelete)&&statuses.ownerRead===200&&ownerBody===body&&statuses.ownerDelete===204&&statuses.after===404}));
}finally{await stopOwnedGroup(child);await closed}
