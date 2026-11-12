import fs from 'fs';
import path from 'path';

const siteDir = path.resolve('site');
const backupsRoot = path.resolve('backups');

if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
  console.error('site/ is missing. Nothing was backed up.');
  process.exit(1);
}

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(backupsRoot, `site-backup-${stamp}`);

fs.mkdirSync(backupsRoot, { recursive: true });
fs.cpSync(siteDir, dest, { recursive: true });

const copied = countFiles(dest);
const kept = fs
  .readdirSync(backupsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('site-backup-'))
  .map((entry) => {
    const full = path.join(backupsRoot, entry.name);
    return { full, mtime: fs.statSync(full).mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime);

for (const old of kept.slice(5)) {
  fs.rmSync(old.full, { recursive: true, force: true });
}

const remaining = Math.min(kept.length, 5);
console.log(`Copied ${copied} files to ${path.relative(process.cwd(), dest)}`);
console.log(`Keeping ${remaining} newest site backup${remaining === 1 ? '' : 's'}.`);
