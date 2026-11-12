// Local workerd fixture only. Tests are not copied into Hosting or the Worker.
// Report/cleanup helpers deliberately bypass login only on these test routes;
// production /api/admin/analytics still runs the real owner verifier below.
import {createWorker} from '../../worker/src/index.mjs';
import {analyticsReport,cleanupAnalytics} from '../../worker/src/analytics.mjs';

const app=createWorker(async url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/documents/tracks/runtime-song'))return Response.json({fields:{published:{booleanValue:true},id:{stringValue:'runtime-song'}}});
  if(path.includes('/documents/tracks/'))return new Response(null,{status:404});
  throw Error('External network is disabled in the analytics runtime fixture.');
});
export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(path==='/__test/report')return analyticsReport(request,env);
    if(path==='/__test/cleanup'){await cleanupAnalytics(env);return Response.json({ok:true});}
    return app.fetch(request,env,ctx);
  }
};
