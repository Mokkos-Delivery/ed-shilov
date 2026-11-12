// Run the reviewed tests distributed with this release. Old overlay files stay intact.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const names=JSON.parse(fs.readFileSync(path.join(root,'tests/release-tests.json'),'utf8'));
if(!Array.isArray(names)||!names.length||names.some(n=>typeof n!=='string'||! /^[a-z0-9-]+\.test\.mjs$/.test(n)))throw Error('Invalid release test manifest');
const result=spawnSync(process.execPath,['--test',...names.map(n=>'tests/'+n)],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
