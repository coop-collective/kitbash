import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { snapshotApp, restoreApp, totals } from '../lifecycle/snapshots.mjs';

test('lifecycle artifacts restore source with integrity and omit local secrets/runtime state',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lifecycle-snapshot-'));
  try {
    const app=path.join(root,'source'), blobs=path.join(root,'blobs'), copy=path.join(root,'copy');
    await mkdir(path.join(app,'src'),{recursive:true});
    await writeFile(path.join(app,'src/index.ts'),'export const answer=42;\n');
    await writeFile(path.join(app,'.dev.vars'),'SECRET=do-not-publish\n');
    await mkdir(path.join(app,'.wrangler'));await writeFile(path.join(app,'.wrangler','state'),'private database');
    const snapshot=await snapshotApp(app,blobs);
    assert.deepEqual(snapshot.files.map(f=>f.path),['src/index.ts']);
    await restoreApp(snapshot,blobs,copy);
    assert.equal(await readFile(path.join(copy,'src/index.ts'),'utf8'),'export const answer=42;\n');
    await assert.rejects(restoreApp(snapshot,blobs,copy),/EEXIST/);
    await writeFile(path.join(blobs,snapshot.files[0].sha256),'tampered');
    await assert.rejects(restoreApp(snapshot,blobs,path.join(root,'tampered-copy')),/hash mismatch/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('lifecycle accounting includes failed attempts and preserves unknown billing',()=>{
  const attempts=[{agent:{resultPresent:true,costUsd:.2,wallMs:100},validationWallMs:20,passed:false},{agent:{resultPresent:true,costUsd:.1,wallMs:50},validationWallMs:10,passed:true}];
  const measured=totals(attempts);
  assert.ok(Math.abs(measured.costUsd-.3)<1e-10);assert.equal(measured.agentWallMs,150);assert.equal(measured.validationWallMs,30);
  const unknown=totals([...attempts,{agent:{resultPresent:false,wallMs:25}}]);
  assert.equal(unknown.costUsd,null);assert.equal(unknown.billingComplete,false);assert.equal(unknown.agentWallMs,175);
});
