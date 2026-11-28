// npm run dev: the crm's dev loop, with no dependency. tsc rebuilds dist on
// every change (the crm, core and store-mongo, through the project
// references); node --watch restarts the server and the worker when their
// built files change; Vite serves the admin and proxies the API to :3000.
// Each line is prefixed by its process. Ctrl-C stops them all.
import { spawn } from 'node:child_process';

const env = '--env-file-if-exists=.env';
const processes = [
  ['tsc', 'npx', ['tsc', '-b', '--watch', '--preserveWatchOutput']],
  ['http', 'node', ['--watch', env, 'dist/servers/http/main.js']],
  ['worker', 'node', ['--watch', env, 'dist/servers/worker/main.js']],
  ['vite', 'npx', ['vite']],
];
const width = Math.max(...processes.map(([name]) => name.length));

const children = processes.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${name.padEnd(width)} |`;
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) console.log(prefix, line);
    });
  }
  // One process ending ends the loop, so a crash is never silent.
  child.on('exit', (code) => {
    console.log(prefix, `exited with ${code}`);
    stop(code ?? 1);
  });
  return child;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
