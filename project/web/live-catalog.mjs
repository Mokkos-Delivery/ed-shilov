import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {getFirestore,collection,query,where,onSnapshot} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const config=window.ED_CLOUD_CONFIG||{};
if(config.firebase?.apiKey && config.firebase?.projectId) {
  const app=initializeApp(config.firebase),db=getFirestore(app),page=location.pathname;
  const needed=new Set();
  if(document.querySelector('.music-card'))needed.add('tracks');
  if(document.querySelector('#video-grid'))needed.add('videos');
  if(document.querySelector('.news-grid'))needed.add('news');
  if(page==='/bio'||page==='/bio.html')needed.add('photos');
  let seeded=false;
  const pending=new Map();
  const apply=()=>{if(seeded)for(const [kind,items] of pending)window.ED_CLOUD.publish(kind,items);};
  const {doc}=await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js');
  onSnapshot(doc(db,'settings','public'),snapshot=>{seeded=snapshot.exists()&&snapshot.data().catalogueSeeded===true;apply();},()=>{});
  for(const kind of needed)onSnapshot(query(collection(db,kind),where('published','==',true)),snapshot=>{
    const items=snapshot.docs.map(x=>({...x.data(),id:x.id})).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
    pending.set(kind,items);apply();
  },()=>{
    // Keep the static catalogue available during a network error; never announce a successful sync.
    window.dispatchEvent(new CustomEvent('ed:catalogue-error',{detail:{kind}}));
  });
}
