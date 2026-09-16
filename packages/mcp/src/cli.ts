#!/usr/bin/env node
import { runCli } from './cli-commands';
import { ProjectError } from './project';

void runCli(process.argv.slice(2)).catch((error: unknown) => {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  process.stderr.write(
    error instanceof ProjectError
      ? `Ainotation: ${error.message}\n`
      : code === 'AINOTATION_STORAGE_DAMAGED'
        ? 'Ainotation: storage is damaged. Run ainotation-mcp doctor, then repair; damaged files are preserved.\n'
        : code === 'ENOSPC'
          ? 'Ainotation: disk is full. Free space, then retry the operation.\n'
          : ['EACCES', 'EPERM', 'EROFS'].includes(String(code))
            ? 'Ainotation: storage is not writable. Check directory permissions and run ainotation-mcp doctor.\n'
            : code === 'EADDRINUSE'
              ? 'Ainotation startup failed: port already in use\n'
              : 'Ainotation startup failed: check arguments, token, origins, and store file\n',
  );
  process.exitCode = 1;
});
