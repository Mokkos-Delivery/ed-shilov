// Use allowed Rules API operations; do not broaden IAM roles for optional CLI preflights.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {GoogleAuth, OAuth2Client} = require('google-auth-library');
const hash = text => createHash('sha256').update(text).digest('hex');
const normalize = text => text.replace(/\s+/g, '');
const defaultRules = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }";
async function firebaseCLIClient(options = {}) {
  const version = options.version || require('firebase-tools/package.json').version;
  if (version !== '15.33.0') throw Object.assign(Error('Unsupported Firebase CLI version.'), {code:'FIREBASE_CLI_VERSION_MISMATCH'});
  const auth = options.auth || require('firebase-tools/lib/auth');
  const account = auth.getProjectDefaultAccount(options.root || path.resolve(__dirname, '..'));
  if (account?.user?.email?.toLowerCase() !== 'wefewfwewfewef853@gmail.com' || !account.tokens?.refresh_token)
    throw Object.assign(Error('Sign in as the Firebase project owner.'), {code:'FIREBASE_CLI_ACCOUNT_MISMATCH'});
  const tokens = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  if (typeof tokens?.access_token !== 'string' || !tokens.access_token.trim())
    throw Object.assign(Error('Firebase CLI session is unavailable.'), {code:'FIREBASE_CLI_SESSION_UNAVAILABLE'});
  const Client = options.Client || OAuth2Client, client = new Client();
  client.setCredentials({access_token:tokens.access_token});
  return client;
}
async function main(options = {}) {
  const args = options.args || process.argv.slice(2);
  if (args.some(arg => !['--apply','--firebase-cli'].includes(arg))) throw Error('Unknown deployment argument.');
  const root = options.root || path.resolve(__dirname, '..');
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  const project = settings.firebase.projectId;
  const content = fs.readFileSync(path.join(root, 'firestore.generated.rules'), 'utf8');
  if (project !== 'eduard-shilov-site' || settings.adminUid !== 'owner_36405b57fb7c4ae58d8e2e817ec67ead' || !content.includes("'" + settings.adminUid + "'") ||
      content.includes('__ADMIN_UID__') || content.includes('__UNCONFIGURED_DENY_ALL__')) throw Error('Rules are not configured.');
  const api = 'https://firebaserules.googleapis.com/v1/', releaseName = 'projects/' + project + '/releases/cloud.firestore';
  const knownReportPath = path.join(root, 'firestore-deployment.json');
  const knownReport = fs.existsSync(knownReportPath) ? JSON.parse(fs.readFileSync(knownReportPath, 'utf8')) : null;
  const print = options.print || (value => console.log(JSON.stringify(value)));
  if (!options.client && !args.includes('--firebase-cli') && !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Use --firebase-cli or configure ADC credentials.');
  const client = options.client || (args.includes('--firebase-cli') ? await firebaseCLIClient({root}) : await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient());
  const previous = await client.request({url: api + releaseName, timeout: 15000});
  const previousName = previous.data.rulesetName;
  if (!previousName?.startsWith('projects/' + project + '/rulesets/')) throw Error('Unexpected previous ruleset.');
  const old = await client.request({url: api + previousName, timeout: 15000});
  const oldFiles = old.data.source?.files || [];
  const alreadyDeployed = oldFiles.length === 1 && hash(oldFiles[0].content) === hash(content);
  const knownPrevious = oldFiles.length === 1 && knownReport?.project === project
    && knownReport?.ownerUid === settings.adminUid && knownReport?.rulesetName === previousName
    && knownReport?.sha256 === hash(oldFiles[0].content);
  if (!alreadyDeployed && !knownPrevious && (oldFiles.length !== 1 || normalize(oldFiles[0].content) !== normalize(defaultRules))) throw Error('Existing custom rules require review.');
  if (!args.includes('--apply')) {
    print({project, sourceSha256: hash(content), alreadyDeployed, changesMade: false});
    return;
  }
  let rulesetName = previousName;
  if (!alreadyDeployed) {
    fs.writeFileSync(path.join(root, 'firestore.previous.rules'), oldFiles[0].content);
    const created = await client.request({url: api + 'projects/' + project + '/rulesets', method: 'POST',
      data: {source: {files: [{name: 'firestore.rules', content}]}}, timeout: 20000, retry: false});
    rulesetName = created.data.name;
    if (!rulesetName?.startsWith('projects/' + project + '/rulesets/')) throw Error('Unexpected created ruleset.');
    await client.request({url: api + releaseName, method: 'PATCH', data: {release: {name: releaseName, rulesetName}}, timeout: 20000, retry: false});
  }
  const active = await client.request({url: api + releaseName, timeout: 15000});
  const deployed = await client.request({url: api + active.data.rulesetName, timeout: 15000});
  const actual = deployed.data.source?.files || [];
  if (active.data.rulesetName !== rulesetName || actual.length !== 1 || hash(actual[0].content) !== hash(content)) throw Error('Deployment verification failed.');
  const report = {checkedAt: new Date().toISOString(), project, releaseName, rulesetName, previousRulesetName: previousName,
    sha256: hash(content), ownerUid: settings.adminUid, sourceAcceptedByRulesAPI: true, deployedSourceMatches: true};
  fs.writeFileSync(path.join(root, 'firestore-deployment.json'), JSON.stringify(report, null, 2) + '\n');
  print(report);
}
module.exports = {main, firebaseCLIClient};
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ok: false, status: error.response?.status,
    code: error.code || error.response?.data?.error?.status || 'RULES_DEPLOYMENT_FAILED'}));
  process.exitCode = 1;
});
