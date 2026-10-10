// Copies the demo page and the example data and policies it shows into the documentation's
// public folder, so the docs build publishes the demo at <docs>/demo/.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}docs/public/demo/`;
mkdirSync(target, { recursive: true });
for (const [from, to] of [
  ['demo/page/index.html', 'index.html'],
  ['examples/railway/data.trig', 'data.trig'],
  ['examples/railway/policies.ttl', 'policies.ttl'],
]) {
  copyFileSync(`${root}${from}`, `${target}${to}`);
}
console.log(`Demo page copied to ${target}`);
