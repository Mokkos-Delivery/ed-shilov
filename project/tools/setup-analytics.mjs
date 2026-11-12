import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomInt} from 'node:crypto';
import {parse,modify,applyEdits} from 'jsonc-parser';

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ANALYTICS_DATABASE='eduard-shilov-analytics';
export const ANALYTICS_BINDING='ANALYTICS_DB';
export const CLEANUP_CRON='17 3 * * *';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const NAME=/^[a-zA-Z0-9_-]{1,100}$/;
export function readConfig(text){
  const errors=[],config=parse(text,errors,{allowTrailingComma:true});
  if(errors.length||!config||typeof config!=='object'||Array.isArray(config))throw Error('Некорректный JSONC в worker/wrangler.jsonc.');
  if(config.name!=='eduard-shilov-media'||config.vars?.PROJECT_ID!=='eduard-shilov-site')throw Error('Настройка предназначена для Worker eduard-shilov-media проекта eduard-shilov-site.');
  if(typeof config.account_id!=='string'||!/^[a-f0-9]{32}$/i.test(config.account_id))throw Error('Укажите account_id Cloudflare в текущем worker/wrangler.jsonc.');
  for(const key of ['d1_databases','ratelimits'])if(config[key]!==undefined&&!Array.isArray(config[key]))throw Error('Некорректный раздел '+key+'.');
  if((config.d1_databases||[]).filter(x=>x.binding===ANALYTICS_BINDING).length>1)throw Error('В конфигурации повторяется ANALYTICS_DB.');
  if(config.triggers?.crons!==undefined&&!Array.isArray(config.triggers.crons))throw Error('Некорректный список triggers.crons.');
  return config;
}
export function updateAnalyticsConfig(text,database,{namespaceId=String(randomInt(1,1_000_000_000))}={}){
  if(!UUID.test(database.uuid||'')||!NAME.test(database.name||''))throw Error('Cloudflare вернул некорректное описание базы.');
  const config=readConfig(text),bindings=config.d1_databases||[],index=bindings.findIndex(x=>x.binding===ANALYTICS_BINDING);
  const existing=index<0?{}:bindings[index];
  if(existing.database_id&&existing.database_id!==database.uuid)throw Error('ANALYTICS_DB уже указывает на другую базу. Переключение не выполнено.');
  const options={formattingOptions:{insertSpaces:true,tabSize:2,eol:text.includes('\r\n')?'\r\n':'\n'}};
  const edit=(parts,value)=>{text=applyEdits(text,modify(text,parts,value,options));};
  if(index<0)edit(config.d1_databases?['d1_databases',-1]:['d1_databases'],config.d1_databases?{binding:ANALYTICS_BINDING,database_name:database.name,database_id:database.uuid,migrations_dir:'migrations'}:[{binding:ANALYTICS_BINDING,database_name:database.name,database_id:database.uuid,migrations_dir:'migrations'}]);
  else{
    edit(['d1_databases',index,'database_name'],database.name);
    edit(['d1_databases',index,'database_id'],database.uuid);
    edit(['d1_databases',index,'migrations_dir'],'migrations');
  }
  if(!(config.ratelimits||[]).some(x=>x.name==='ANALYTICS_RATE_LIMITER')){
    const used=new Set((config.ratelimits||[]).map(x=>x.namespace_id));
    while(used.has(namespaceId))namespaceId=String(randomInt(1,1_000_000_000));
    const limiter={name:'ANALYTICS_RATE_LIMITER',namespace_id:namespaceId,simple:{limit:60,period:60}};
    edit(config.ratelimits?['ratelimits',-1]:['ratelimits'],config.ratelimits?limiter:[limiter]);
  }
  const crons=config.triggers?.crons||[];
  if(!crons.includes(CLEANUP_CRON))edit(config.triggers?.crons?['triggers','crons',-1]:['triggers','crons'],config.triggers?.crons?CLEANUP_CRON:[CLEANUP_CRON]);
  if(config.vars.ANALYTICS_DAILY_LIMIT===undefined)edit(['vars','ANALYTICS_DAILY_LIMIT'],'5000');
  readConfig(text);return text;
}
export function selectDatabase(databases,config){
  if(!Array.isArray(databases))throw Error('Не удалось прочитать список D1.');
  const binding=config.d1_databases?.find(x=>x.binding===ANALYTICS_BINDING);
  const matches=binding?.database_id?databases.filter(x=>x.uuid===binding.database_id):databases.filter(x=>x.name===(binding?.database_name||ANALYTICS_DATABASE));
  if(matches.length>1)throw Error('Найдено несколько баз аналитики. Проверьте D1 в Cloudflare.');
  if(binding?.database_id&&!matches.length)throw Error('Настроенная ANALYTICS_DB не найдена в выбранном аккаунте. Новая база не создана.');
  return matches[0]||null;
}
function wranglerRunner(root){
  const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
  if(!fs.existsSync(cli))throw Error('Сначала выполните npm.cmd ci.');
  return args=>{
    const result=spawnSync(process.execPath,[cli,...args,'--config','worker/wrangler.jsonc'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});
    if(result.error||result.status!==0)throw Error('Ошибка Wrangler: '+args.slice(0,3).join(' ')+'. Проверьте вход через npx.cmd wrangler login и доступ к D1 этого аккаунта.');
    return result.stdout;
  };
}
export function setupAnalytics({root=ROOT,args=[],run,print=console.log}={}){
  if(args.some(x=>x!=='--apply')||args.length>1)throw Error('Используйте setup-analytics.mjs [--apply].');
  const file=path.join(root,'worker/wrangler.jsonc');
  if(!args.includes('--apply')){
    print('План: найти или создать D1 eduard-shilov-analytics в текущем аккаунте, добавить ANALYTICS_DB, ограничение частоты и ежедневную очистку, применить SQL-миграции. Worker и Hosting будут опубликованы отдельно.');
    print('Для выполнения: npm.cmd run setup:analytics -- --apply. Никаких файлов или облачных ресурсов не изменено.');
    return {applied:false};
  }
  if(!fs.existsSync(file))throw Error('Не найден worker/wrangler.jsonc. Сначала настройте существующий проект; не заменяйте свою конфигурацию примером.');
  const original=fs.readFileSync(file,'utf8'),config=readConfig(original),invoke=run||wranglerRunner(root);
  const list=()=>{let value;try{value=JSON.parse(invoke(['d1','list','--json']));}catch(error){if(error.message.startsWith('Ошибка Wrangler:'))throw error;throw Error('Не удалось прочитать JSON списка D1.');}return value;};
  let database=selectDatabase(list(),config);
  if(!database){
    const name=config.d1_databases?.find(x=>x.binding===ANALYTICS_BINDING)?.database_name||ANALYTICS_DATABASE;
    if(!NAME.test(name))throw Error('Некорректное имя базы аналитики.');
    print('Создаю D1 '+name+'…');
    let creationError;try{invoke(['d1','create',name,'--update-config=false']);}catch(error){creationError=error;}
    // Query the account again: a previous interrupted run or another setup may
    // have created it. Never scrape a UUID from free-form CLI log output.
    database=selectDatabase(list(),config);
    if(!database)throw creationError||Error('Созданная база не найдена. Повторите настройку; новая копия автоматически не создаётся.');
  }
  const updated=updateAnalyticsConfig(original,database);
  if(updated!==original){
    const backup=path.join(root,'credentials/wrangler-before-analytics.jsonc');fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});
    try{fs.writeFileSync(backup,original,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
    const temp=file+'.analytics.tmp';fs.writeFileSync(temp,updated,{mode:0o600});fs.renameSync(temp,file);
  }
  print('База: '+database.name+'. Применяю миграции…');
  invoke(['d1','migrations','apply',ANALYTICS_BINDING,'--remote']);
  // An interrupted migration is safe to retry; Wrangler tracks applied files.
  // This final query also makes a skipped/cancelled migration observable.
  invoke(['d1','execute',ANALYTICS_BINDING,'--remote','--command','SELECT COUNT(*) AS ready FROM analytics_meta;','--json']);
  print('D1 настроена. Для включения статистики выполните npm.cmd run deploy:worker -- --apply, затем npm.cmd run deploy:hosting -- --apply.');
  return {applied:true,database:database.name,binding:ANALYTICS_BINDING,deployed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{setupAnalytics({args:process.argv.slice(2)});}catch(error){console.error(error.message);process.exitCode=1;}
}
