// Basic privacy gate, runs in CI on every push (and locally with `npm run privacy`).
// Fails if:
//  1. an app file (what the phone loads) mentions an outside URL,
//  2. any tracked file holds an email address other than the noreply one,
//  3. a JSON file that looks like a real backup sits outside tests/fixtures,
//  4. the fixture isn't marked as invented sample data.
// Known, accepted exceptions live in PROJECT.md 6b (lab/photos, design mockups) and are skipped here.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];

const APP = /^(index\.html|sw\.js|manifest\.webmanifest|js\/.+\.js|css\/.+\.css)$/;
const ALLOWED_URL = /^https?:\/\/www\.w3\.org\//; // SVG/XML namespaces only
const NOREPLY = 'rizi-cmd@users.noreply.github.com';
const TEXT = /\.(html|js|mjs|css|json|md|webmanifest|yml|yaml|txt)$/;

for (const f of files) {
  if (!TEXT.test(f)) continue;
  const src = readFileSync(f, 'utf8');

  if (APP.test(f)) {
    for (const m of src.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)]*/gi)) {
      const url = m[0].startsWith('//') ? 'https:' + m[0] : m[0];
      if (!ALLOWED_URL.test(url)) problems.push(`${f}: outside URL in the app: ${m[0]}`);
    }
  }

  for (const m of src.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    if (m[0].toLowerCase() !== NOREPLY) problems.push(`${f}: email address: ${m[0]}`);
  }

  if (f.endsWith('.json') && !f.startsWith('tests/fixtures/') && /"app"\s*:\s*"bodytrack"/.test(src)) {
    problems.push(`${f}: looks like a backup file outside tests/fixtures`);
  }
}

const fixtures = files.filter(f => f.startsWith('tests/fixtures/') && f.endsWith('.json'));
for (const f of fixtures) {
  const obj = JSON.parse(readFileSync(f, 'utf8'));
  if (!/invented/i.test(String(obj.sample || ''))) problems.push(`${f}: fixture is not marked "sample": "...INVENTED..."`);
}

if (problems.length) {
  console.error('Privacy check failed:\n' + problems.map(p => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`Privacy check passed (${files.length} files).`);
