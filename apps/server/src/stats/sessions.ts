export const SESSION_GAP_MS = 15 * 60_000;

/**
 * Play time: hands whose gap to the previous hand is under `gapMs` belong to one session;
 * seconds = sum of each session's span (first start to last end).
 */
export function playSessions(hands: { startedAt: Date; endedAt: Date }[], gapMs = SESSION_GAP_MS): { sessions: number; seconds: number } {
  const sorted = [...hands].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  let sessions = 0;
  let ms = 0;
  let start = 0;
  let end = 0;
  for (const h of sorted) {
    const s = h.startedAt.getTime();
    const e = h.endedAt.getTime();
    if (sessions > 0 && s - end < gapMs) {
      end = Math.max(end, e);
    } else {
      if (sessions > 0) ms += end - start;
      sessions++;
      start = s;
      end = e;
    }
  }
  if (sessions > 0) ms += end - start;
  return { sessions, seconds: Math.round(ms / 1000) };
}
