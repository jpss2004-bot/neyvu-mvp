export function localAccess(env: NodeJS.ProcessEnv, host: string | null): boolean {
  // A forwarded Host must never grant access on a public Vercel deployment.
  return env.NODE_ENV === 'development' && !env.VERCEL &&
    !!host && /^(127\.0\.0\.1|localhost):3213$/.test(host);
}
export function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['moodle.acadiau.ca', 'www.notion.so', 'notion.so', 'app.notion.com', 'webwork.acadiau.ca'].includes(url.hostname)
      && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function ageMinutes(value: string | null | undefined, now = Date.now()): number | null {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && time <= now ? (now - time) / 60000 : null;
}
export function runnerState(tick: string | null | undefined, now = Date.now()) {
  const age = ageMinutes(tick, now);
  return age !== null && age <= 5 ? 'Recent heartbeat' : 'Heartbeat needs checking';
}
