import {base64url,unbase64url,jsonBytes} from './core.mjs';
import {fetchHeaders,readJSON} from './http.mjs';

let tokenCache=null, tokenPending=null, keysCache=null;
export function clearToken() { tokenCache=null; }
export async function driveToken(env,net=fetch) {
  if(tokenCache?.credential===env.DRIVE_SERVICE_ACCOUNT_JSON && tokenCache.expires>Date.now()+60000) return tokenCache.token;
  if(tokenPending) return tokenPending;
  tokenPending=(async()=>{
    const sa=JSON.parse(env.DRIVE_SERVICE_ACCOUNT_JSON||'{}');
    if(!sa.client_email || !sa.private_key) throw Error('Drive is not configured');
    const pem=sa.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
    const bytes=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
    const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const now=Math.floor(Date.now()/1000);
    const head=base64url(jsonBytes({alg:'RS256',typ:'JWT'}));
    const data=base64url(jsonBytes({iss:sa.client_email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
    const input=head+'.'+data, sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(input));
    const response=await fetchHeaders(net,'https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+base64url(sig)})});
    if(!response.ok) throw Error('Drive authorization unavailable');
    const result=await readJSON(response,16384);
    if(!result.access_token) throw Error('Drive authorization unavailable');
    tokenCache={credential:env.DRIVE_SERVICE_ACCOUNT_JSON,token:result.access_token,expires:Date.now()+Math.min(Number(result.expires_in)||3600,3600)*1000};
    return result.access_token;
  })();
  try{return await tokenPending;}finally{tokenPending=null;}
}
export async function verifyFirebaseIdToken(token,env,net=fetch) {
  if(!env.PROJECT_ID || !env.ADMIN_UID || typeof token!=='string' || token.length>12000) throw Error('Unauthorized');
  const parts=token.split('.'); if(parts.length!==3) throw Error('Unauthorized');
  const header=JSON.parse(new TextDecoder().decode(unbase64url(parts[0])));
  const payload=JSON.parse(new TextDecoder().decode(unbase64url(parts[1])));
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=='RS256'||!header.kid||payload.aud!==env.PROJECT_ID
    ||payload.iss!=='https://securetoken.google.com/'+env.PROJECT_ID||payload.sub!==env.ADMIN_UID
    ||payload.email_verified!==true||!Number.isFinite(payload.exp)||payload.exp<=now
    ||!Number.isFinite(payload.iat)||payload.iat>now+30
    ||!Number.isFinite(payload.auth_time)||payload.auth_time>now+30) throw Error('Unauthorized');
  if(!keysCache||keysCache.expires<Date.now()||!keysCache.keys.some(k=>k.kid===header.kid)) {
    const response=await fetchHeaders(net,'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    if(!response.ok) throw Error('Unauthorized');
    const data=await readJSON(response);
    keysCache={keys:data.keys||[],expires:Date.now()+3600000};
  }
  const jwk=keysCache.keys.find(k=>k.kid===header.kid); if(!jwk)throw Error('Unauthorized');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unbase64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!valid)throw Error('Unauthorized'); return payload;
}
