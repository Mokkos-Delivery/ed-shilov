const kinds=new Set(['tracks','videos','photos','news']);
const itemId=/^[A-Za-z0-9_-]{1,160}$/;

export function bindPublication(record,kind,id) {
  if(!kinds.has(kind)||!itemId.test(id))throw Error('Некорректная публикация.');
  return {...record,ownerKind:kind,ownerId:id};
}

export function referencedMediaIds(item) {
  const result=new Set();
  for(const value of [item.audio_mp3,item.audio_wav,item.url,item.videoUrl,item.video1080pUrl,item.video720pUrl,item.cover,item.coverUrl,...Object.values(item.qualities||{})]) {
    if(typeof value!=='string')continue;
    const match=/^\/media\/([A-Za-z0-9_-]{10,160})(?:\/[^/?#]+)?(?:[?#].*)?$/.exec(value);
    if(match)result.add(match[1]);
  }
  return result;
}

export function publicationReference(record) {
  const hasKind=Object.hasOwn(record,'ownerKind'),hasId=Object.hasOwn(record,'ownerId');
  if(!hasKind&&!hasId)return null;
  if(!hasKind||!hasId||!kinds.has(record.ownerKind)||!itemId.test(record.ownerId))throw Error('Invalid publication reference');
  return {kind:record.ownerKind,id:record.ownerId};
}
