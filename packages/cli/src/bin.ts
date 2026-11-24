#!/usr/bin/env node
import { main } from './main.js';

// A reader that stops early, such as `| head`, closes the pipe. The output
// it did not read is not an error.
process.stdout.on('error', (error) => {
  if ('code' in error && error.code === 'EPIPE') return;
  throw error;
});

// The exit code, not process.exit(), so piped output is flushed first.
process.exitCode = await main(process.argv.slice(2), process.cwd());
