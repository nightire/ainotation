import { parseArgs } from 'node:util';
import { startSharedService, defaultServiceDirectory } from './shared-service';
import { stopSharedService } from './service-discovery';

export async function startSharedServiceCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      'data-dir': { type: 'string', default: defaultServiceDirectory() },
      port: { type: 'string', default: '0' },
      help: { type: 'boolean', default: false },
      stop: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: ainotation-mcp service [--data-dir PATH] [--port 0] [--stop]\nRuns a shared local service in the foreground. Port 0 selects an available port.\nUse --stop to stop the verified running service before an upgrade.\nLocal Node integrations discover it through the private connection.json file.\n',
    );
    return;
  }
  if (values.stop) {
    process.stdout.write(
      (await stopSharedService(values['data-dir']))
        ? 'Shared service stopped.\n'
        : 'No running shared service found.\n',
    );
    return;
  }
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid service port');
  const service = await startSharedService({ directory: values['data-dir'], port });
  const stop = () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    void service.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stderr.write(
    `Ainotation shared service: ${service.connection.url}\nService directory: ${service.directory}\n`,
  );
}
