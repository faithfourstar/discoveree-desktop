/**
 * Domain errors + central error middleware (ADR 002 §2).
 *
 * Handlers `throw`; this middleware is the only place that writes 500s.
 * ZodError → 400 {error, issues}; DomainError → its status; anything else →
 * 500 + log. All user-facing strings in British English.
 */
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod/v4";

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Conflict") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export class BadRequestError extends DomainError {
  constructor(message = "Bad request") {
    super(message, 400);
    this.name = "BadRequestError";
  }
}

/** A conflict that carries extra payload (e.g. the active run blocking a refresh). */
export class ConflictWithPayloadError extends ConflictError {
  constructor(
    message: string,
    public readonly payload: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ConflictWithPayloadError";
  }
}

/**
 * 422 with payload — the evidence gate's answer to a below-threshold manual
 * trigger (ADR 004 §3.3: `{ error: "insufficient_evidence", evidenceStatus }`).
 */
export class UnprocessableError extends DomainError {
  constructor(
    message = "Unprocessable",
    public readonly payload: Record<string, unknown> = {},
  ) {
    super(message, 422);
    this.name = "UnprocessableError";
  }
}

/** Unknown /api/* → 404 JSON, never the SPA. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", issues: err.issues });
    return;
  }
  if (err instanceof ConflictWithPayloadError) {
    res.status(err.status).json({ error: err.message, ...err.payload });
    return;
  }
  if (err instanceof UnprocessableError) {
    res.status(err.status).json({ error: err.message, ...err.payload });
    return;
  }
  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[HTTP] Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}
