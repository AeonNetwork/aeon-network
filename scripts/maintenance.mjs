// Toggle maintenance mode:  npm run maintenance -- 60   (minutes)   |   npm run maintenance -- off
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(new URL('../.maintenance', import.meta.url));
const arg = process.argv[2] || '60';
if (arg === 'off') {
  rmSync(file, { force: true });
  console.log('Maintenance off: the site is open.');
} else {
  const minutes = Number(arg);
  if (!(minutes > 0)) throw new Error('Usage: npm run maintenance -- <minutes> | off');
  const end = Date.now() + minutes * 60_000;
  writeFileSync(file, String(end));
  console.log(`Maintenance on until ${new Date(end).toISOString()} (${minutes} min). It ends by itself.`);
}
