import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { zodMessage } from "./validation";

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function jsonError(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Map thrown errors to JSON responses for API routes. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof ZodError) {
    return jsonError(zodMessage(err), 400);
  }
  console.error("[api] unhandled error:", err);
  return jsonError("Something went wrong. Please try again.", 500);
}
