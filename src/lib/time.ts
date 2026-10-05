/** Timezone + scheduling time helpers. */

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidIsoDate(value: string): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

/**
 * Convert a wall-clock time ("YYYY-MM-DDTHH:mm" or ":ss") in a given IANA
 * timezone to the corresponding UTC instant. Handles DST transitions by
 * iterating twice against Intl offset data. Used as a server-side safety net
 * when clients send local wall time instead of an ISO instant.
 */
export function zonedWallTimeToUtc(wallTime: string, timeZone: string): Date | null {
  const m = wallTime.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m || !isValidTimeZone(timeZone)) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asIfUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s || 0)
  );
  let ts = asIfUtc;
  for (let i = 0; i < 3; i++) {
    const offset = tzOffsetMs(ts, timeZone);
    const next = asIfUtc - offset;
    if (next === ts) break;
    ts = next;
  }
  return new Date(ts);
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - utcMs;
}

/** Format a UTC instant for display inside a given timezone (server-side). */
export function formatInTimeZone(
  iso: string | Date,
  timeZone: string,
  opts?: Intl.DateTimeFormatOptions
): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : undefined,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(date);
}
