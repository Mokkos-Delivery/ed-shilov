import test,{before,after} from 'node:test';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,updateDoc} from 'firebase/firestore';
import fs from 'node:fs';

let environment;
before(async()=>{
  environment=await initializeTestEnvironment({projectId:'demo-eduard-shilov',firestore:{host:'127.0.0.1',port:8188,rules:fs.readFileSync('firestore.rules','utf8').replace('__ADMIN_UID__','owner-uid')}});
  await environment.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'tracks','published-track'),{id:'published-track',title:'Песня',published:true});
    await setDoc(doc(db,'tracks','hidden-track'),{id:'hidden-track',title:'Черновик',published:false});
    await setDoc(doc(db,'media','published_media_1'),{driveId:'published_media_1',name:'a.mp3',size:42,mime:'audio/mpeg',published:true});
    await setDoc(doc(db,'media','private_media_1'),{driveId:'private_media_1',name:'b.mp3',size:42,mime:'audio/mpeg',published:false});
    await setDoc(doc(db,'media','linked_media_1'),{driveId:'linked_media_1',name:'c.mp3',size:42,mime:'audio/mpeg',published:true,ownerKind:'tracks',ownerId:'published-track'});
    await setDoc(doc(db,'media','draft_media_1'),{driveId:'draft_media_1',name:'d.mp3',size:42,mime:'audio/mpeg',published:true,ownerKind:'tracks',ownerId:'hidden-track'});
  });
});
after(async()=>{await environment?.cleanup();});
test('Visitors read only published items and cannot enumerate private media',async()=>{
  const db=environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db,'tracks','published-track')));
  await assertFails(getDoc(doc(db,'tracks','hidden-track')));
  await assertSucceeds(getDocs(query(collection(db,'tracks'),where('published','==',true))));
  await assertFails(getDocs(collection(db,'tracks')));
  await assertSucceeds(getDoc(doc(db,'media','published_media_1')));
  await assertFails(getDoc(doc(db,'media','private_media_1')));
  await assertFails(getDocs(collection(db,'media')));
});
test('Another signed-in user cannot publish, change ownership or access hidden content',async()=>{
  const db=environment.authenticatedContext('other-uid',{email_verified:true}).firestore();
  await assertFails(setDoc(doc(db,'tracks','injected'),{id:'injected',title:'Injected',published:true}));
  await assertFails(updateDoc(doc(db,'tracks','published-track'),{published:false}));
  await assertFails(getDoc(doc(db,'tracks','hidden-track')));
  await assertFails(setDoc(doc(db,'settings','public'),{adminUid:'other-uid'}));
});
test('Verified owner can publish and hide content; document-ID forgery is rejected',async()=>{
  const db=environment.authenticatedContext('owner-uid',{email_verified:true}).firestore();
  await assertSucceeds(setDoc(doc(db,'tracks','owner-track'),{id:'owner-track',title:'Новая песня',published:true}));
  await assertSucceeds(updateDoc(doc(db,'tracks','owner-track'),{published:false}));
  await assertSucceeds(getDoc(doc(db,'tracks','owner-track')));
  await assertFails(setDoc(doc(db,'tracks','different-id'),{id:'forged-id',title:'Новая песня',published:true}));
  await assertFails(setDoc(doc(db,'media','media-id'),{driveId:'other-media-id',name:'x.mp3',mime:'audio/mpeg',size:10,published:true}));
});
test('An unverified owner cannot access administrator actions',async()=>{
  const db=environment.authenticatedContext('owner-uid',{email_verified:false}).firestore();
  await assertFails(setDoc(doc(db,'tracks','unverified-track'),{id:'unverified-track',title:'No',published:true}));
});
test('Media follows publication visibility; incomplete links are rejected',async()=>{
  const visitor=environment.unauthenticatedContext().firestore();
  const owner=environment.authenticatedContext('owner-uid',{email_verified:true}).firestore();
  await assertSucceeds(getDoc(doc(visitor,'media','linked_media_1')));
  await assertFails(getDoc(doc(visitor,'media','draft_media_1')));
  await assertSucceeds(updateDoc(doc(owner,'tracks','published-track'),{published:false}));
  await assertFails(getDoc(doc(visitor,'media','linked_media_1')));
  await assertSucceeds(updateDoc(doc(owner,'tracks','published-track'),{published:true}));
  await assertSucceeds(getDoc(doc(visitor,'media','linked_media_1')));
  await assertFails(setDoc(doc(owner,'media','partial_link_1'),{driveId:'partial_link_1',name:'x.mp3',mime:'audio/mpeg',size:4,published:true,ownerKind:'tracks'}));
});

test('Social history is private to the verified owner, including stored post text',async()=>{
  const value={requestId:'post-1',text:'Unreleased announcement',url:'',channels:['telegram_1'],createdAt:'2026-10-27T10:00:00.000Z',results:{telegram_1:{state:'pending'}}};
  const owner=environment.authenticatedContext('owner-uid',{email_verified:true}).firestore();
  await assertSucceeds(setDoc(doc(owner,'socialPosts','post-1'),value));
  await assertSucceeds(updateDoc(doc(owner,'socialPosts','post-1'),{'results.telegram_1':{state:'sent',postId:'42'}}));
  await assertSucceeds(getDocs(collection(owner,'socialPosts')));
  await assertSucceeds(setDoc(doc(owner,'socialPosts','post-four'),{...value,requestId:'post-four',channels:['telegram_1','telegram_2','vk_troika','vk_eduard']}));
  for(const context of [environment.unauthenticatedContext(),environment.authenticatedContext('other-uid',{email_verified:true}),environment.authenticatedContext('owner-uid',{email_verified:false})]){
    const db=context.firestore();await assertFails(getDoc(doc(db,'socialPosts','post-1')));await assertFails(getDocs(collection(db,'socialPosts')));await assertFails(setDoc(doc(db,'socialPosts','forged'),{...value,requestId:'forged'}));
  }
  await assertFails(setDoc(doc(owner,'socialPosts','different-id'),value));
});
