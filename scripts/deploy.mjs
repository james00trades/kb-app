// Publishes the built app (dist/) to the gh-pages branch, which GitHub Pages serves.
// Run with `npm run deploy`: type-check, tests and build run first.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const inDist = (args) => execFileSync('git', args, { cwd: dist, stdio: 'inherit' });

if (!existsSync(dist + 'index.html')) throw new Error('dist/ is missing. Run npm run build first.');
if (git(['status', '--porcelain']) !== '') throw new Error('Commit your changes first, so the live app matches main.');

const origin = git(['remote', 'get-url', 'origin']);
const name = git(['config', 'user.name']);
const email = git(['config', 'user.email']);
const commit = git(['rev-parse', '--short', 'HEAD']);

execFileSync('git', ['push', 'origin', 'main'], { cwd: root, stdio: 'inherit' });

writeFileSync(dist + '.nojekyll', '');
rmSync(dist + '.git', { recursive: true, force: true });
inDist(['init', '-q', '-b', 'gh-pages']);
inDist(['add', '-A']);
inDist(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `Deploy ${commit}`]);
inDist(['push', '--force', '-q', origin, 'gh-pages']);
rmSync(dist + '.git', { recursive: true, force: true });
console.log(`Published ${commit}. GitHub Pages updates within a minute or two.`);
