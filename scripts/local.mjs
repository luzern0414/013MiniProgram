import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [task, ...args] = process.argv.slice(2);
if (process.env.NODE_ENV === 'production') {
  console.error('Local development helper cannot run in production.');
  process.exit(1);
}
const envFile = resolve(root, '.env.local');
const defaults = resolve(root, 'config/environments/development.env.example');
const variables = {};
for (const line of readFileSync(existsSync(envFile) ? envFile : defaults, 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  const split = line.indexOf('=');
  if (split < 1) continue;
  variables[line.slice(0, split).trim()] = line.slice(split + 1).trim();
}
const env = { ...variables, ...process.env };
const commands = {
  'api': ['--filter', '@restaurant/api', 'dev'],
  'api:start': ['--filter', '@restaurant/api', 'start'],
  'db:migrate': ['--filter', '@restaurant/api', 'db:migrate'],
  'db:seed': ['--filter', '@restaurant/api', 'db:seed'],
  'api:integration': ['--filter', '@restaurant/api', 'test:integration'],
  'web': ['--filter', '@restaurant/merchant-web', 'dev'],
  'customer': ['--filter', '@restaurant/customer-mini', 'dev:h5'],
  'merchant': ['--filter', '@restaurant/merchant-mini', 'dev:h5'],
};
if (!commands[task]) {
  console.error('Choose local task: ' + Object.keys(commands).join(', '));
  process.exit(1);
}
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [...commands[task], ...args], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);

