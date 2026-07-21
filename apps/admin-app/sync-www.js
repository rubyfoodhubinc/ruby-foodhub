// Builds the app's web assets: copies the live admin portal page and the
// assets it references from the repo root into www/, renaming the page to
// index.html. Run this before every `npx cap sync` (or use `npm run sync`)
// so the app ships whatever is currently deployed on the website.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const www = path.join(__dirname, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

fs.copyFileSync(path.join(root, 'admin.html'), path.join(www, 'index.html'));
for (const f of ['favicon.png', 'logo-mark-small.png']) {
  fs.copyFileSync(path.join(root, f), path.join(www, f));
}

console.log('www/ rebuilt for the Admin app from the repo root.');
