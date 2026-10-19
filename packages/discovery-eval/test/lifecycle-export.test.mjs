import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {snapshotApp} from '../lifecycle/snapshots.mjs';
import {exportRun} from '../lifecycle/export.mjs';

test('public lifecycle evidence retains failed-attempt cost and source while redacting private sessions',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lifecycle-export-'));
  try {
    const source=path.join(root,'run'),app=path.join(source,'pair-1/scratch/app'),target=path.join(root,'evidence');
    const attempt=path.join(source,'pair-1/scratch/integration/attempt-0');
    await mkdir(app,{recursive:true});await mkdir(attempt,{recursive:true});
    await writeFile(path.join(app,'index.ts'),'export const fixture=true;\n');
    await writeFile(path.join(app,'.dev.vars'),'SECRET=private-fixture\n');
    const snapshot=await snapshotApp(app,path.join(source,'blobs'));
    const cookie='ks_session=ephemeral-private-cookie';
    await writeFile(path.join(source,'pair-1/scratch/private-legacy.json'),JSON.stringify({cookie}));
    await writeFile(path.join(source,'protocol.json'),JSON.stringify({catalogRoot:'/example/catalog',schedule:[]}));
    await writeFile(path.join(source,'results.json'),JSON.stringify({stages:[{pair:1,arm:'scratch',phase:'integration',passed:false,status:'complete',checkpointPath:'private-checkpoint.json',finalSnapshot:snapshot,attempts:[{attempt:0,snapshot,agent:{resultPresent:true,costUsd:.42,wallMs:123},passed:false,checks:{runtime:{passed:false,error:`Rejected ${cookie}`}}}]}]}));
    const result=await exportRun(source,target);
    assert.equal(result.totals.costUsd,.42);
    const text=await readFile(path.join(target,'evidence.json'),'utf8');
    assert.ok(!text.includes(cookie));assert.ok(!text.includes('private-checkpoint.json'));
    assert.match(text,/redacted ephemeral fixture session/);
    const evidence=JSON.parse(text);
    assert.equal(evidence.results.stages[0].passed,false);
    assert.deepEqual(evidence.results.stages[0].finalSnapshot.files.map(file=>file.path),['index.ts']);
    assert.equal(await readFile(path.join(target,'blobs',snapshot.files[0].sha256),'utf8'),'export const fixture=true;\n');
    await assert.rejects(exportRun(source,target),/EEXIST/);
  } finally {await rm(root,{recursive:true,force:true});}
});
