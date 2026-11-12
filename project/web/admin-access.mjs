// Explicitly invited administrator. Only verified Google sign-in grants access.
export const additionalAdminEmail='huyencehdofen8632@gmail.com';
export function isAdministrator({uid,email,verified,google},ownerUid){
  return !!ownerUid&&typeof uid==='string'&&uid.length>0&&verified===true&&
    (uid===ownerUid||(google===true&&typeof email==='string'&&email.toLowerCase()===additionalAdminEmail));
}
