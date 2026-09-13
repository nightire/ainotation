#!/usr/bin/env node
import { runCli } from './cli-commands';
import { ProjectError } from './project';

void runCli(process.argv.slice(2)).catch((error: unknown) => {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  process.stderr.write(
    error instanceof ProjectError
      ? `Ainotation: ${error.message}\n`
      : code === 'EADDRINUSE'
        ? 'Ainotation startup failed: port already in use\n'
        : 'Ainotation startup failed: check arguments, token, origins, and store file\n',
  );
  process.exitCode = 1;
});
