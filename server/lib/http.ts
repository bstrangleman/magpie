import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export const badRequest = (message: string) => new HTTPException(400, { message });
export const unauthorized = (message = 'Not signed in') => new HTTPException(401, { message });
export const forbidden = (message = 'Forbidden') => new HTTPException(403, { message });
export const notFound = (message = 'Not found') => new HTTPException(404, { message });
export const tooManyRequests = (message = 'Too many requests. Try again later.') => new HTTPException(429, { message });

/** Parse an unknown value with a zod schema, throwing a 400 on failure. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${where}${issue?.message ?? 'Invalid request'}`);
  }
  return result.data;
}

export function intParam(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}
