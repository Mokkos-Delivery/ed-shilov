import {docFields} from './core.mjs';
import {fetchHeaders,readJSON} from './http.mjs';

// Anonymous Firestore reads obey the same published-only rules as visitors.
// Never use the media service account or an administrator token here.
export function createCatalogueReader(net=fetch,now=()=>Date.now()){
 const cache=new Map(),pending=new Map();
 return async (kind,env)=>{
  if(!['tracks','videos','news','photos'].includes(kind))throw Error('Invalid catalogue');
  if(!/^[a-z][a-z0-9-]{4,62}$/.test(env.PROJECT_ID||''))throw Error('Missing project');
  const key=env.PROJECT_ID+'/'+kind,previous=cache.get(key);
  if(previous?.until>now())return previous.value;
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   const base=`https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents`;
   const state=await fetchHeaders(net,base+'/settings/public',{},8000);
   if(state.status===404){await state.body?.cancel();return {ok:true,seeded:false,items:[]};}
   if(!state.ok){await state.body?.cancel();throw Error('Catalogue unavailable');}
   const seeded=docFields(await readJSON(state,65536,8000)).catalogueSeeded===true;
   if(!seeded)return {ok:true,seeded:false,items:[]};
   const response=await fetchHeaders(net,base+':runQuery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:kind}],where:{fieldFilter:{field:{fieldPath:'published'},op:'EQUAL',value:{booleanValue:true}}},limit:2001}})},8000);
   if(!response.ok){await response.body?.cancel();throw Error('Catalogue unavailable');}
   const rows=await readJSON(response,4*1024*1024,8000);
   if(!Array.isArray(rows)||rows.length>2000)throw Error('Incomplete catalogue');
   const items=rows.filter(r=>r.document).map(r=>({...docFields(r.document),id:r.document.name.split('/').pop()})).filter(x=>x.published===true).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
   return {ok:true,seeded:true,items};
  })();
  pending.set(key,task);
  try{const value=await task;if(cache.size>=16)cache.clear();cache.set(key,{value,until:now()+15000});return value;}finally{pending.delete(key);}
 };
}
