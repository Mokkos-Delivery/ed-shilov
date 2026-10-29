// Firebase CLI 15.33.0 -> superstatic -> glob-slash uses path.join/normalize
// for URL patterns. On Windows that produces backslashes, breaking redirects
// and headers. Scope POSIX URL normalization to this emulator process only.
// No node_modules files, production configuration, auth or TLS settings change.
const path = require('node:path');
const {createRequire} = require('node:module');

function installHostingPathFix() {
  const hostingRequire = createRequire(require.resolve('firebase-tools/lib/serve/hosting'));
  const superstaticRequire = createRequire(hostingRequire.resolve('superstatic'));
  const globSlash = superstaticRequire('glob-slash');
  if (typeof globSlash.normalize !== 'function') {
    throw Error('Unsupported Hosting emulator URL normalizer. Check the pinned dependencies.');
  }
  // Do not replace backslashes in user patterns: they can be intentional glob
  // escapes. Use POSIX path operations from the outset, on every host platform.
  globSlash.normalize = (value) => path.posix.normalize(path.posix.join('/', value));
}

module.exports = {installHostingPathFix};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!['emulators:exec', 'emulators:start'].includes(args[0]) ||
      args[args.indexOf('--only') + 1] !== 'hosting' || !args.includes('--only')) {
    console.error('Use this wrapper only with emulators:exec/start --only hosting.');
    process.exitCode = 1;
  } else {
    installHostingPathFix();
    require('firebase-tools/lib/bin/firebase');
  }
}
