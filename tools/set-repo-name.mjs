// Set the manifest "id" for the GitHub repo you deploy to:
//   node tools/set-repo-name.mjs flight-compass-plain-test-1
// On a shared origin the id must be "/<repo-name>/" (never "./" or "/").
// Cache names, localStorage keys and the IndexedDB name follow the serving
// folder automatically at runtime, so the manifest is the only file to change.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const name = (process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9._-]+$/.test(name)) {
  console.error('Usage: node tools/set-repo-name.mjs <repo-name>   (letters, digits, . _ - only)');
  process.exit(1);
}
const file = fileURLToPath(new URL('../manifest.webmanifest', import.meta.url));
const m = JSON.parse(readFileSync(file, 'utf8'));
m.id = `/${name}/`;
writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
console.log(`manifest id → ${m.id}. Deploy to https://johnbui765.github.io/${name}/`);
