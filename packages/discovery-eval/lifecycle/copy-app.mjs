import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { restoreApp } from './snapshots.mjs';

const [evidenceDirectory,pair,arm,phase,destination]=process.argv.slice(2);
if(!evidenceDirectory||!['1','2','3'].includes(pair)||!['scratch','reuse'].includes(arm)||!['integration','maintenance'].includes(phase)||!destination)throw new Error('Usage: node lifecycle/copy-app.mjs EVIDENCE_DIRECTORY 1|2|3 scratch|reuse integration|maintenance NEW_DESTINATION');
const root=path.resolve(evidenceDirectory);
const evidence=JSON.parse(await readFile(path.join(root,'evidence.json'),'utf8'));
const stage=evidence.results.stages.find(stage=>stage.pair===Number(pair)&&stage.arm===arm&&stage.phase===phase);
if(!stage?.finalSnapshot?.files?.length)throw new Error('No complete source snapshot for this stage');
await restoreApp(stage.finalSnapshot,path.join(root,'blobs'),path.resolve(destination));
console.log(JSON.stringify({destination:path.resolve(destination),originalPassed:stage.passed,note:'Fresh source reproduction only; private benchmark database/session state is not included. Local public demo credentials only. Install the frozen lock, migrate locally, then run dev. Do not deploy the demo login.'}));
