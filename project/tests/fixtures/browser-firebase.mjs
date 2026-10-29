// Test boundary only. Production never imports this module.
const fixture=window.__studioFixture ||= {observers:[],subscriptions:[],popupCount:0,persistence:null};
const data=()=>JSON.parse(localStorage.getItem('fixtureCatalog')||'{"tracks":{},"media":{}}');
const user={uid:'fixture_owner',email:'owner@example.test',emailVerified:true,getIdToken:async()=> 'fixture-id-token'};
const auth=fixture.auth ||= {currentUser:localStorage.getItem('fixtureSignedIn')?user:null};
function notify(){for(const s of fixture.subscriptions)s.fn({docs:Object.values(data()[s.kind]||{}).map(v=>({id:v.id,data:()=>v}))});}
export const initializeApp=()=>({});export const getAuth=()=>auth;export const getFirestore=()=>({});
export const browserLocalPersistence={type:'LOCAL'};
export async function setPersistence(a,p){fixture.persistence=p.type;}
export function onAuthStateChanged(a,fn){fixture.observers.push(fn);queueMicrotask(()=>fn(auth.currentUser));}
export class GoogleAuthProvider{addScope(){}setCustomParameters(){}static credentialFromResult(){return {accessToken:'fixture-drive-token'};}}
export async function signInWithPopup(){fixture.popupCount++;auth.currentUser=user;localStorage.setItem('fixtureSignedIn','1');for(const fn of fixture.observers)fn(user);return {};}
export async function reauthenticateWithPopup(){return signInWithPopup();}
export async function signOut(){auth.currentUser=null;localStorage.removeItem('fixtureSignedIn');for(const fn of fixture.observers)fn(null);}
export const collection=(db,kind)=>kind;export const doc=(db,kind,id)=>({kind,id});
export function onSnapshot(kind,fn){const s={kind,fn};fixture.subscriptions.push(s);notify();return ()=>{fixture.subscriptions=fixture.subscriptions.filter(x=>x!==s);};}
export async function getDoc(ref){const d=data()[ref.kind]?.[ref.id];return {exists:()=>!!d,data:()=>d};}
export async function getDocs(kind){return {docs:Object.values(data()[kind]||{}).map(v=>({id:v.id,data:()=>v}))};}
export async function setDoc(ref,value){const d=data();(d[ref.kind]||={})[ref.id]=value;localStorage.setItem('fixtureCatalog',JSON.stringify(d));notify();}
export async function updateDoc(ref,value){const d=data();Object.assign(d[ref.kind][ref.id],value);localStorage.setItem('fixtureCatalog',JSON.stringify(d));notify();}
export function writeBatch(){const ops=[];return {set:(ref,value)=>ops.push({ref,value}),update:(ref,value)=>ops.push({ref,value,merge:true}),commit:async()=>{const d=data();for(const {ref,value,merge} of ops){d[ref.kind]||={};d[ref.kind][ref.id]=merge?{...d[ref.kind][ref.id],...value}:value;}localStorage.setItem('fixtureCatalog',JSON.stringify(d));notify();if(fixture.loseCommit){fixture.loseCommit=false;throw Error('Ответ Firestore потерян (тест)');}}};}
