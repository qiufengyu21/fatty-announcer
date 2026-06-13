function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info: (...args: unknown[]) => console.log(`[${ts()}]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${ts()}] [警告]`, ...args),
  error: (...args: unknown[]) => console.error(`[${ts()}] [错误]`, ...args),
};
