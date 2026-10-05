import { z } from "zod";
import { isValidIsoDate, isValidTimeZone, zonedWallTimeToUtc } from "./time";

export const CAPTION_MAX = 2200; // Instagram hard limit

const isoInstant = z
  .string()
  .refine(isValidIsoDate, "Invalid date/time");

const localWallTime = z.string().refine(
  (v) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(v),
  "Invalid local date/time"
);

/**
 * A post schedule can be expressed either as:
 *  - scheduledAt: ISO instant (UTC) + timezone (IANA), or
 *  - scheduledLocal: wall time in `timezone` (converted server-side).
 */
function resolveScheduledAt(input: {
  timezone?: string;
  scheduledAt?: string;
  scheduledLocal?: string;
}): { scheduledAt: Date; timezone: string } {
  const timezone = input.timezone ?? "UTC";
  let date: Date | null = null;
  if (input.scheduledAt) date = new Date(input.scheduledAt);
  else if (input.scheduledLocal) date = zonedWallTimeToUtc(input.scheduledLocal, timezone);
  if (!date || Number.isNaN(date.getTime())) {
    throw new z.ZodError([
      { code: "custom", path: ["scheduledAt"], message: "Could not resolve publish time" },
    ]);
  }
  return { scheduledAt: date, timezone };
}

export const postCreateSchema = z
  .object({
    imageUrl: z.string().url("Image is required").max(2048),
    imagePublicId: z.string().max(512).optional(),
    imageWidth: z.number().int().positive().optional(),
    imageHeight: z.number().int().positive().optional(),
    caption: z
      .string()
      .max(CAPTION_MAX, `Caption is limited to ${CAPTION_MAX} characters`)
      .default(""),
    timezone: z.string().refine(isValidTimeZone, "Unknown timezone").default("UTC"),
    scheduledAt: isoInstant.optional(),
    scheduledLocal: localWallTime.optional(),
  })
  .transform((val) => {
    const { scheduledAt, timezone } = resolveScheduledAt(val);
    return { ...val, scheduledAt, timezone };
  });

export const postUpdateSchema = z
  .object({
    imageUrl: z.string().url().max(2048).optional(),
    imagePublicId: z.string().max(512).optional(),
    imageWidth: z.number().int().positive().optional(),
    imageHeight: z.number().int().positive().optional(),
    caption: z.string().max(CAPTION_MAX).optional(),
    timezone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
    scheduledAt: isoInstant.optional(),
    scheduledLocal: localWallTime.optional(),
  })
  .transform((val) => {
    const hasTime = Boolean(val.scheduledAt || val.scheduledLocal);
    if (!hasTime) return { ...val, scheduledAt: undefined, timezone: undefined };
    const { scheduledAt, timezone } = resolveScheduledAt(val);
    return { ...val, scheduledAt, timezone };
  });

export const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email").max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().max(80).optional(),
});

export function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}
