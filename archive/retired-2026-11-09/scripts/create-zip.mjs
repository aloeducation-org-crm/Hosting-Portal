const fs = require('fs');
const { createWriteStream, createGzip } = require('zlib');
const { execSync } = require('child_process');
const src = '/home/z/my-project';
const zipPath = '/home/z/my-project/download/ALO-Labs-Hosting-Portal.zip';
const exclude = new Set(['node_modules', '.next', '.git', 'db', 'upload', 'bun.lock', 'worklog.md', 'skills', 'mini-services', '_tmp-fix*', 'scripts/fix-lint.py', 'download/alo-labs-preview.png', 'package-lock.json', 'tsconfig.tsbuildinfo']);

const stream = createWriteStream(zipPath);
const gzip = createGzip({ level: 6, threshold: 1048576 });
const out = require('stream');
const pipe = require('stream/promises').pipeline;

let fileCount = 0;
let totalSize = 0;

function addFile(fp) {
  try {
    if (fs.statSync(fp).isDirectory()) {
      const items = fs.readdirSync(fp, { withFileTypes: true, recursive: true }).filter(i => !i.name.startsWith('.'));
      for (const i of items) addFile(fp + '/' + i);
    } else {
      fileCount++;
      totalSize += fs.statSync(fp).size;
      const rs = fs.createReadStream(fp);
      rs.pipe(gzip, { flush: true }).pipe(stream);
    }
  } catch {}
}

addFile(src + '/package.json');
addFile(src + '/.env.example');
addFile(src + '/next.config.ts');
addFile(src + '/tsconfig.json');
addFile(src + '/eslint.config.mjs');
addFile(src + '/postcss.config.mjs');
addFile(src + '/tailwind.config.ts');
addFile(src + '/vitest.config.ts');
addFile(src + '/components.json');
addFile(src + '/public/logo.svg');
addFile(src + '/public/robots.txt');

function addDir(d) {
  const items = fs.readdirSync(d, { withFileTypes: true, recursive: true }).filter(i => !i.name.startsWith('.'));
  for (const i of items) addFile(d + '/' + i);
}

addDir(src + '/app');
stream.on('finish', () => { gzip.end(); stream.end(); console.log('Added ' + fileCount + ' files, total ' + (totalSize / 1048576).toFixed(1) + ' MB'); console.log('ZIP saved to ' + zipPath); });
