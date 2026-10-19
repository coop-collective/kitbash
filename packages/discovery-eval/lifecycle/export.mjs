import { mkdir, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, totals } from './snapshots.mjs';

const json = async file => JSON.parse(await readFile(file,'utf8'));
async function privateValues(directory,values=new Set()) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(['app','blobs','node_modules'].includes(entry.name))continue;
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()) await privateValues(file,values);
    else if(entry.name.startsWith('private-')&&entry.name.endsWith('.json')) {
      const visit=value=>{
        if(!value||typeof value!=='object')return;
        for(const [key,item] of Object.entries(value)) {
          if(/cookie|token|secret|password/i.test(key)&&typeof item==='string'&&item.length>8)values.add(item);
          else visit(item);
        }
      };
      visit(await json(file));
    }
  }
  return values;
}
export async function exportRun(source,destination) {
  const protocol=await json(path.join(source,'protocol.json'));
  const results=await json(path.join(source,'results.json'));
  const secrets=await privateValues(source);
  const sanitize=value=>{
    let text=JSON.stringify(value,null,2);
    for(const secret of secrets)text=text.split(secret).join('[redacted ephemeral fixture session]');
    text=text.split(source).join('<RUN_DIRECTORY>').split(protocol.catalogRoot).join('<CATALOG_ROOT>');
    return JSON.parse(text);
  };
  await mkdir(destination,{recursive:false});
  await mkdir(path.join(destination,'blobs'));
  const files=new Set();
  for(const stage of results.stages) {
    if(stage.checkpointPath) {delete stage.checkpointPath;stage.checkpointRetainedPrivately=true;}
    for(const snapshot of [stage.finalSnapshot,...stage.attempts.map(a=>a.snapshot)]) for(const file of snapshot?.files??[])files.add(file.sha256);
    for(const attempt of stage.attempts) {
      const relative=path.join(`pair-${stage.pair}`,stage.arm,stage.phase,`attempt-${attempt.attempt}`);
      const target=path.join(destination,relative);await mkdir(target,{recursive:true});
      const audit=path.join(source,relative,'tool-audit.jsonl');
      try {
        const entries=(await readFile(audit,'utf8')).split('\n').filter(Boolean).map(line=>sanitize(JSON.parse(line)));
        await writeFile(path.join(target,'tool-audit.jsonl'),entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
      } catch(error) {if(error.code!=='ENOENT')throw error;}
      if(attempt.agent)await writeFile(path.join(target,'agent-summary.json'),JSON.stringify(sanitize(attempt.agent),null,2)+'\n');
      try {await cp(path.join(source,relative,'acceptance',`review-rooms-${stage.phase}.png`),path.join(target,'browser.png'),{errorOnExist:true,force:false});}
      catch(error) {if(error.code!=='ENOENT')throw error;}
    }
  }
  for(const name of files) {
    if(!/^[a-f0-9]{64}$/.test(name))throw new Error('Invalid content-addressed source hash');
    const body=await readFile(path.join(source,'blobs',name));
    if(sha256(body)!==name)throw new Error('Source blob hash mismatch');
    await writeFile(path.join(destination,'blobs',name),body,{flag:'wx'});
  }
  results.totals=totals(results.stages.flatMap(stage=>stage.attempts));
  const published=sanitize({protocol,results});
  await writeFile(path.join(destination,'evidence.json'),JSON.stringify(published,null,2)+'\n');
  await writeFile(path.join(destination,'README.md'),'# Lifecycle experiment evidence\n\n`evidence.json` preserves the frozen protocol, every measured attempt, original checks and content-addressed source manifests. `blobs/` contains the unique source bytes named by SHA-256. These are experimental app outputs, including failures; they are not production-ready examples. Raw model conversations, local databases, credentials and ephemeral fixture-session cookies are omitted. CLI costs are list-price estimates, not invoice charges.\n\nSee `../../lifecycle/README.md` for protocol and reproduction commands.\n');
  return {destination,stages:results.stages.length,sourceBlobs:files.size,totals:results.totals};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [source,destination]=process.argv.slice(2);
  if(!source||!destination)throw new Error('Usage: node lifecycle/export.mjs RUN_DIRECTORY NEW_DESTINATION');
  console.log(JSON.stringify(await exportRun(path.resolve(source),path.resolve(destination))));
}
