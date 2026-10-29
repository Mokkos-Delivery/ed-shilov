// Import the prepared public catalogue with create-only preconditions.
const fs = require('node:fs');
const path = require('node:path');
const {GoogleAuth} = require('google-auth-library');
const root = path.resolve(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'public/catalogue-bootstrap.json'), 'utf8'));
const project = settings.firebase.projectId;
if (project !== 'eduard-shilov-site') throw Error('Unexpected project.');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('ADC credentials required.');
const kinds = ['tracks', 'videos', 'news', 'photos', 'media'];
const database = 'projects/' + project + '/databases/(default)', documents = database + '/documents';
const api = 'https://firestore.googleapis.com/v1/';
const entries = [], counts = {};
for (const kind of kinds) {
  if (!Array.isArray(catalogue[kind])) throw Error('Invalid collection.');
  counts[kind] = catalogue[kind].length;
  for (const value of catalogue[kind]) {
    const id = kind === 'media' ? value.driveId : value.id;
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw Error('Invalid document ID.');
    entries.push({kind, id, value, name: documents + '/' + kind + '/' + id});
  }
}
if (entries.length > 1000 || new Set(entries.map(x => x.name)).size !== entries.length) throw Error('Unexpected catalogue size or duplicate IDs.');
function encode(value) {
  if (value === null) return {nullValue: null};
  if (typeof value === 'string') return {stringValue: value};
  if (typeof value === 'boolean') return {booleanValue: value};
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isSafeInteger(value) ? {integerValue: String(value)} : {doubleValue: value};
  if (Array.isArray(value)) return {arrayValue: {values: value.map(encode)}};
  if (value && typeof value === 'object') return {mapValue: {fields: fields(value)}};
  throw Error('Unsupported value.');
}
function fields(value) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])); }
async function main() {
  const client = await new GoogleAuth({scopes: ['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  let seeded = false;
  try {
    const state = await client.request({url: api + documents + '/settings/public', params: {'mask.fieldPaths': 'catalogueSeeded'}, timeout: 15000});
    seeded = state.data.fields?.catalogueSeeded?.booleanValue === true;
  } catch (error) { if (error.response?.status !== 404) throw error; }
  const finishOnly = process.argv.includes('--finish');
  if ((!process.argv.includes('--apply') && !finishOnly) || seeded) {
    console.log(JSON.stringify({project, counts, documents: entries.length, alreadySeeded: seeded, changesMade: false}));
    return;
  }
  let created = 0, preserved = 0;
  for (let start = 0; !finishOnly && start < entries.length; start += 200) {
    const batch = entries.slice(start, start + 200);
    const response = await client.request({url: api + database + '/documents:batchWrite', method: 'POST',
      data: {writes: batch.map(entry => ({update: {name: entry.name, fields: fields(entry.value)}, currentDocument: {exists: false}}))},
      timeout: 30000, retry: false});
    const statuses = response.data.status;
    if (!Array.isArray(statuses) || statuses.length !== batch.length) throw Error('Incomplete confirmation.');
    for (const status of statuses) {
      if (!status.code) created++;
      else if (status.code === 6) preserved++;
      else throw Error('Write rejected.');
    }
    console.log(JSON.stringify({processed: Math.min(start + 200, entries.length), created, preserved}));
  }
  for (const kind of kinds) {
    if (!counts[kind]) continue;
    const names = new Set();
    let pageToken;
    do {
      const result = await client.request({url: api + documents + '/' + kind,
        params: {pageSize: 1000, pageToken, 'mask.fieldPaths': kind === 'media' ? 'driveId' : 'id'}, timeout: 20000});
      for (const item of result.data.documents || []) names.add(item.name);
      pageToken = result.data.nextPageToken;
      if (names.size > 5000) throw Error('Unexpected collection size.');
    } while (pageToken && entries.some(entry => entry.kind === kind && !names.has(entry.name)));
    if (entries.some(entry => entry.kind === kind && !names.has(entry.name))) throw Error('Missing catalogue document.');
    console.log(JSON.stringify({verifiedCollection: kind, expected: counts[kind], found: names.size}));
  }
  await client.request({url: api + documents + '/settings/public', method: 'PATCH',
    params: {'updateMask.fieldPaths': ['catalogueSeeded', 'policyVersion']},
    data: {fields: fields({catalogueSeeded: true, policyVersion: settings.policyVersion})}, timeout: 15000, retry: false});
  console.log(JSON.stringify({project, counts, created, preserved, verified: true, catalogueSeeded: true}));
}
main().catch(error => {
  console.error(JSON.stringify({ok: false, status: error.response?.status,
    code: error.code || error.response?.data?.error?.status || 'CATALOGUE_SETUP_FAILED'}));
  process.exitCode = 1;
});
