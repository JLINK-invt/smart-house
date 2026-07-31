type LogLevel = 'info' | 'warn' | 'error';

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });

  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${entry}\n`);
}
