const [major,minor]=process.versions.node.split('.').map(Number);
if(major<24||(major===24&&minor<12)){
  console.error('This project requires Node.js 24.12.0 or newer. Installed: '+process.versions.node+'. Install Node.js 24 LTS from https://nodejs.org/en/download and reopen the terminal.');
  process.exitCode=1;
}
