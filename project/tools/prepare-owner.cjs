// Read only the intended owner's identifiers. Never export authentication records.
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {GoogleAuth} = require('google-auth-library');
const root = path.resolve(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
const project = settings.firebase.projectId;
if (project !== 'eduard-shilov-site' || settings.adminEmail !== 'lvolyl76@gmail.com') throw Error('Unexpected project or owner.');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('ADC credentials required.');
async function main() {
  const client = await new GoogleAuth({scopes: ['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const base = 'https://identitytoolkit.googleapis.com/v1/projects/' + project;
  const lookup = await client.request({url: base + '/accounts:lookup', method: 'POST',
    params: {key: settings.firebase.apiKey, fields: 'users(localId,email,emailVerified,disabled,providerUserInfo(providerId))'},
    data: {email: [settings.adminEmail]}, timeout: 15000, retry: false});
  const users = lookup.data.users || [];
  if (users.length > 1) throw Error('Ambiguous owner.');
  let owner = users[0];
  if (owner && (owner.email !== settings.adminEmail || owner.disabled)) throw Error('Owner requires review.');
  if (settings.adminUid && (!owner || settings.adminUid !== owner.localId)) throw Error('Configured owner UID requires review.');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({project, email: settings.adminEmail, exists: !!owner, uid: owner?.localId,
      emailVerified: owner?.emailVerified === true, changesMade: false}));
    return;
  }
  let created = false;
  if (!owner) {
    const uid = 'owner_' + randomUUID().replaceAll('-', '');
    const result = await client.request({url: base + '/accounts', method: 'POST',
      params: {key: settings.firebase.apiKey, fields: 'localId,email'},
      data: {localId: uid, email: settings.adminEmail, emailVerified: false, displayName: 'Эдуард Шилов', disabled: false},
      timeout: 15000, retry: false});
    if (result.data.localId !== uid || result.data.email !== settings.adminEmail) throw Error('Unexpected created owner.');
    owner = {localId: uid, email: settings.adminEmail, emailVerified: false};
    created = true;
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner.localId)) throw Error('Invalid UID.');
  for (const name of ['settings.json', 'settings.example.json']) {
    const file = path.join(root, name), value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.firebase.projectId !== project || value.adminEmail !== settings.adminEmail) throw Error('Settings mismatch.');
    value.adminUid = owner.localId;
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  }
  console.log(JSON.stringify({project, uid: owner.localId, created, emailVerified: owner.emailVerified === true,
    passwordSet: false, realGoogleSignInStillRequired: owner.emailVerified !== true}));
}
main().catch(error => {
  console.error(JSON.stringify({ok: false, status: error.response?.status,
    code: error.code || error.response?.data?.error?.status || 'OWNER_SETUP_FAILED'}));
  process.exitCode = 1;
});
