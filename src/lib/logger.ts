import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function runLogger(runId: string, sourceKey: string) {
  return logger.child({ runId, sourceKey });
}
