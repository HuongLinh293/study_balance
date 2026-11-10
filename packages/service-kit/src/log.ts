type Level = 'info' | 'warn' | 'error';

/** JSON log line with service name. Never pass tokens, passwords or private content. */
export function createLogger(service: string) {
  const write = (level: Level, event: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service, event, ...fields });
    (level === 'error' ? console.error : console.log)(line);
  };
  return {
    info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
  };
}
export type Logger = ReturnType<typeof createLogger>;
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
