// Read-only CustomDomain diagnostics. Reuse the existing Firebase CLI session;
// never print tokens, credential objects, certificate keys or HTTP auth headers.
const {firebaseCLIClient} = require('./deploy-firestore-rules.cjs');
const path = require('node:path');
const URL = 'https://firebasehosting.googleapis.com/v1beta1/projects/eduard-shilov-site/sites/eduard-shilov-site/customDomains/eduardshilov.com';
const issues = values => (values || []).slice(0,20).map(v=>({code:v.code,message:String(v.message||'').slice(0,1000)}));
const records = values => (values || []).map(s=>({domainName:s.domainName,records:(s.records||[]).map(r=>({type:r.type,value:r.rdata,action:r.requiredAction})),errors:s.checkError?issues([s.checkError]):[]}));
async function main({client,print=console.log,now=()=>new Date().toISOString()}={}){
 client ||= await firebaseCLIClient({root:path.resolve(__dirname,'..')});
 const response=await client.request({url:URL,method:'GET',timeout:20000,retry:false});
 const d=response.data,cert=d.cert||{},http=cert.verification?.http;
 const report={observedAt:now(),domain:'eduardshilov.com',hostState:d.hostState,ownershipState:d.ownershipState,reconciling:d.reconciling,updateTime:d.updateTime,dnsLastCheckTime:d.requiredDnsUpdates?.checkTime,dnsDiscovered:records(d.requiredDnsUpdates?.discovered),dnsRequired:records(d.requiredDnsUpdates?.desired),certificateState:cert.state,certificateIssues:issues(cert.issues),issues:issues(d.issues),readOnly:true,changesMade:false};
 if(http)report.certificateHTTPCheck={path:http.path,lastCheckTime:http.lastCheckTime,errors:http.checkError?issues([http.checkError]):[]};
 print(JSON.stringify(report,null,2));return report;
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({ok:false,httpStatus:error.response?.status,code:error.response?.data?.error?.status||(/^[A-Z_]{1,80}$/.test(error.code||'')?error.code:'DOMAIN_STATUS_FAILED'),readOnly:true}));process.exitCode=1;});
