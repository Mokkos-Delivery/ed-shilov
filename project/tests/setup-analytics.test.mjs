import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ANALYTICS_BINDING,CLEANUP_CRON,readConfig,setupAnalytics,updateAnalyticsConfig} from '../tools/setup-analytics.mjs';

const database={name:'eduard-shilov-analytics',uuid:'dddddddd-dddd-dddd-dddd-dddddddddddd'};
const original=`{
  // Keep the account deployment note.
  "name": "eduard-shilov-media",
  "account_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "vars": {
    "PROJECT_ID": "eduard-shilov-site",
    // Keep this existing private setting.
    "EXISTING_PRIVATE_SETTING": "local-value-must-stay-private",
  },
  "d1_databases": [
    // This unrelated binding has its own migrations.
    {"binding":"OLD_DB","database_name":"old","database_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","migrations_dir":"old-migrations"},
  ],
  "ratelimits": [{"name":"OLD_LIMITER","namespace_id":"12","simple":{"limit":5,"period":60}}],
  "triggers": {"crons":["1 2 * * *"]},
  "kv_namespaces": [{"binding":"OLD_KV","id":"cccccccccccccccccccccccccccccccc"}],
}
`;

function fixture(t,text=original){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'setup-analytics-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'worker'));
  fs.mkdirSync(path.join(root,'credentials'));
  fs.writeFileSync(path.join(root,'worker/wrangler.jsonc'),text);
  fs.writeFileSync(path.join(root,'worker/.dev.vars'),'EXISTING_TOKEN=keep-local-secret\n');
  fs.writeFileSync(path.join(root,'credentials/worker-secrets.json'),'{"EXISTING_TOKEN":"keep-stored-secret"}\n');
  return root;
}

function snapshot(root){
  return Object.fromEntries(fs.readdirSync(root,{recursive:true}).sort().flatMap(relative=>{
    const file=path.join(root,relative);
    return fs.statSync(file).isFile()?[[relative,fs.readFileSync(file,'utf8')]]:[];
  }));
}

function runner(root,{failMigration=false}={}){
  const calls=[],databases=[];
  return {calls,databases,run(args){
    calls.push(args);
    if(args.join(' ')==='d1 list --json')return JSON.stringify(databases);
    if(args.join(' ')===`d1 create ${database.name} --update-config=false`){
      assert.equal(databases.length,0,'database must only be created once');
      databases.push(database);return 'Created D1 database';
    }
    if(args.join(' ')===`d1 migrations apply ${ANALYTICS_BINDING} --remote`){
      const binding=readConfig(fs.readFileSync(path.join(root,'worker/wrangler.jsonc'),'utf8')).d1_databases.find(item=>item.binding===ANALYTICS_BINDING);
      assert.equal(binding.database_id,database.uuid,'binding must be saved before migration');
      if(failMigration){failMigration=false;throw Error('Simulated interrupted migration');}
      return 'Applied migrations';
    }
    if(args.join(' ')===`d1 execute ${ANALYTICS_BINDING} --remote --command SELECT COUNT(*) AS ready FROM analytics_meta; --json`)return '[{"success":true,"results":[{"ready":0}]}]';
    throw Error('Unexpected command: '+args.join(' '));
  }};
}

test('Analytics setup defaults to a plan without file changes or Wrangler calls',t=>{
  const root=fixture(t),before=snapshot(root),messages=[];
  const run=()=>assert.fail('Plan must not invoke Wrangler');
  assert.deepEqual(setupAnalytics({root,run,print:value=>messages.push(value)}),{applied:false});
  assert.deepEqual(snapshot(root),before);
  assert.deepEqual(setupAnalytics({root:path.join(root,'missing-project'),run,print(){}}),{applied:false});
  assert.equal(fs.existsSync(path.join(root,'missing-project')),false);
  assert.ok(messages.some(value=>value.includes('--apply')));
  assert.throws(()=>setupAnalytics({root,args:['--unknown'],run,print(){}}));
});

test('Applying setup preserves JSONC, secrets, unrelated bindings and backup, and reuses its database on repeat',t=>{
  const root=fixture(t),mock=runner(root),messages=[];
  const options={root,args:['--apply'],run:mock.run,print:value=>messages.push(value)};
  assert.deepEqual(setupAnalytics(options),{applied:true,database:database.name,binding:ANALYTICS_BINDING,deployed:false});
  assert.deepEqual(mock.calls.map(args=>args.slice(0,3)),[
    ['d1','list','--json'],['d1','create',database.name],['d1','list','--json'],
    ['d1','migrations','apply'],['d1','execute',ANALYTICS_BINDING]
  ]);
  const configFile=path.join(root,'worker/wrangler.jsonc'),updated=fs.readFileSync(configFile,'utf8');
  const before=readConfig(original),after=readConfig(updated);
  for(const comment of ['Keep the account deployment note.','Keep this existing private setting.','This unrelated binding has its own migrations.'])assert.ok(updated.includes('// '+comment));
  assert.equal(after.vars.EXISTING_PRIVATE_SETTING,before.vars.EXISTING_PRIVATE_SETTING);
  assert.equal(after.vars.ANALYTICS_DAILY_LIMIT,'5000');
  assert.deepEqual(after.d1_databases[0],before.d1_databases[0]);
  assert.deepEqual(after.d1_databases[1],{binding:ANALYTICS_BINDING,database_name:database.name,database_id:database.uuid,migrations_dir:'migrations'});
  assert.deepEqual(after.kv_namespaces,before.kv_namespaces);
  assert.deepEqual(after.ratelimits[0],before.ratelimits[0]);
  assert.equal(after.ratelimits[1].name,'ANALYTICS_RATE_LIMITER');
  assert.deepEqual(after.ratelimits[1].simple,{limit:60,period:60});
  assert.notEqual(after.ratelimits[1].namespace_id,'12');
  assert.deepEqual(after.triggers.crons,['1 2 * * *',CLEANUP_CRON]);
  assert.equal(fs.readFileSync(path.join(root,'credentials/wrangler-before-analytics.jsonc'),'utf8'),original);
  assert.equal(fs.readFileSync(path.join(root,'worker/.dev.vars'),'utf8'),'EXISTING_TOKEN=keep-local-secret\n');
  assert.equal(fs.readFileSync(path.join(root,'credentials/worker-secrets.json'),'utf8'),'{"EXISTING_TOKEN":"keep-stored-secret"}\n');
  const firstSnapshot=snapshot(root),callCount=mock.calls.length;
  setupAnalytics(options);
  assert.deepEqual(snapshot(root),firstSnapshot,'repeat must preserve the config and original backup');
  assert.deepEqual(mock.calls.slice(callCount).map(args=>args.slice(0,3)),[
    ['d1','list','--json'],['d1','migrations','apply'],['d1','execute',ANALYTICS_BINDING]
  ]);
  const output=messages.join('\n');
  for(const secret of ['local-value-must-stay-private','keep-local-secret','keep-stored-secret'])assert.equal(output.includes(secret),false);
});

test('An existing analytics binding is never silently switched to a different database',t=>{
  const configured=updateAnalyticsConfig(original,database,{namespaceId:'13'}),root=fixture(t,configured),before=snapshot(root),calls=[];
  const other={...database,uuid:'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'};
  assert.throws(()=>setupAnalytics({root,args:['--apply'],print(){},run(args){calls.push(args);return JSON.stringify([other]);}}),/ANALYTICS_DB не найдена/);
  assert.deepEqual(calls,[['d1','list','--json']]);
  assert.deepEqual(snapshot(root),before);
  assert.throws(()=>updateAnalyticsConfig(configured,other),/уже указывает на другую базу/);
});

test('Retrying an interrupted migration reuses the created database and original backup',t=>{
  const root=fixture(t),mock=runner(root,{failMigration:true}),options={root,args:['--apply'],run:mock.run,print(){}};
  assert.throws(()=>setupAnalytics(options),/Simulated interrupted migration/);
  const afterFailure=snapshot(root);
  assert.equal(setupAnalytics(options).applied,true);
  assert.equal(mock.calls.filter(args=>args[1]==='create').length,1);
  assert.equal(mock.calls.filter(args=>args[1]==='migrations').length,2);
  assert.equal(mock.calls.filter(args=>args[1]==='execute').length,1);
  assert.deepEqual(snapshot(root),afterFailure);
  assert.equal(fs.readFileSync(path.join(root,'credentials/wrangler-before-analytics.jsonc'),'utf8'),original);
});
