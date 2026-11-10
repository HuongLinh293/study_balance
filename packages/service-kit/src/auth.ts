import type { RequestHandler, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { HttpError } from './errors.js';

const ISSUER = 'studybalance-user-service';
const AUDIENCE = 'studybalance';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export async function signAccessToken(secret: Uint8Array, userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}
/** Each service verifies the token itself; the gateway is not trusted for auth. */
export function requireAuth(secret: Uint8Array): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Missing access token'));
    try {
      const { payload } = await jwtVerify(token, secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub) throw new Error('No subject');
      res.locals.userId = payload.sub;
      next();
    } catch {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired access token'));
    }
  };
}
export const userIdOf = (res: Response): string => res.locals.userId as string;
