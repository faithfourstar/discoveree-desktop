/**
 * Wraps async route handlers so rejections reach the central error middleware
 * (Express 4 does not catch async rejections itself). Every route uses this.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
