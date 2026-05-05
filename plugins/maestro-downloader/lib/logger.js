export function createLogger({
  debugEnabled = false,
  out = process.stdout,
  err = process.stderr,
} = {}) {
  return {
    debug: (msg) => { if (debugEnabled) err.write(`[debug] ${msg}\n`); },
    info: (msg) => out.write(`${msg}\n`),
    warn: (msg) => err.write(`Warning: ${msg}\n`),
    error: (msg) => err.write(`Error: ${msg}\n`),
  };
}

const debugEnabled =
  process.env.DEBUG === 'true' || process.argv.includes('--debug');

export const logger = createLogger({ debugEnabled });
export const { debug, info, warn, error } = logger;
