import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prismaClient.js';

/**
 * OAuth2-style refresh token rotation with family reuse detection.
 *
 * Security model:
 * - The refresh token is a JWT carrying a `typ: 'refresh'` discriminator plus
 *   `fid` (family id) and `jti` (per-token id) claims. The access-token
 *   verifier rejects `typ: 'refresh'`, so a refresh token can never be used as
 *   an access token.
 * - Only the SHA-256 hash of the token is ever persisted. Plaintext never hits
 *   the database and is never logged.
 * - Each login/signup starts a new family. Each successful refresh atomically
 *   marks the presented token `rotatedAt` and inserts a fresh sibling in the
 *   same family (a rotation chain).
 * - Presenting a token that has already been rotated (or a token whose family
 *   was revoked) is treated as reuse: the ENTIRE family is revoked, forcing a
 *   full re-login. This is the classic "stolen token after victim refreshed"
 *   defense.
 */

export const REFRESH_TOKEN_TTL_DAYS = 7;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/** One-way SHA-256 hash of a token (hex). Never store plaintext tokens. */
export const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

/** Hash of an arbitrary low-sensitivity value (IP / user-agent) for audit without storing PII. */
const hashValue = (value) =>
  value ? crypto.createHash('sha256').update(String(value)).digest('hex') : null;

const buildRefreshJwt = (user, familyId, jti) => {
  const payload = {
    id: user.id,
    role: user.role,
    typ: 'refresh',
    fid: familyId,
    jti,
  };
  if (user.planTier) payload.planTier = user.planTier;
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
  });
};

const requestFingerprint = (req) => {
  if (!req) return { userAgentHash: null, ipHash: null };
  const ua = req.headers?.['user-agent'] || null;
  const ip = req.ip || req.headers?.['x-forwarded-for'] || null;
  return { userAgentHash: hashValue(ua), ipHash: hashValue(ip) };
};

/**
 * Issue a refresh token and persist only its hash.
 * @returns {Promise<{ token: string, familyId: string, jti: string }>}
 */
export const issueRefreshToken = async ({ user, familyId, req, deviceLabel } = {}) => {
  const resolvedFamilyId = familyId || crypto.randomUUID();
  const jti = crypto.randomUUID();
  const token = buildRefreshJwt(user, resolvedFamilyId, jti);
  const { userAgentHash, ipHash } = requestFingerprint(req);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId: resolvedFamilyId,
      tokenHash: hashToken(token),
      deviceLabel: deviceLabel ?? null,
      userAgentHash,
      ipHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { token, familyId: resolvedFamilyId, jti };
};

/** Revoke every non-revoked token in a family (reuse detection / logout). */
export const revokeFamily = async (familyId) => {
  if (!familyId) return 0;
  const { count } = await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
};

/** Revoke every non-revoked token for a user across all families (logout-all). */
export const revokeAllForUser = async (userId) => {
  if (userId === undefined || userId === null) return 0;
  const { count } = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
};

/**
 * Revoke the family that owns a given presented refresh token (logout).
 * Returns the number of rows revoked (0 if the token is unknown).
 */
export const revokeTokenFamily = async (presentedToken) => {
  if (!presentedToken) return 0;
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presentedToken) },
  });
  if (!row) return 0;
  return revokeFamily(row.familyId);
};

/**
 * Rotate a presented refresh token.
 *
 * Result statuses:
 * - 'rotated'        → { status, user, refreshToken } new sibling issued, old marked rotated
 * - 'reuse'          → { status, familyId } already-rotated/revoked token replayed; family revoked
 * - 'expired'        → server-side row expired
 * - 'invalid'        → unknown token hash
 * - 'user_not_found' → owning user no longer exists
 */
export const rotateRefreshToken = async ({ presentedToken, req } = {}) => {
  const tokenHash = hashToken(presentedToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!row) return { status: 'invalid' };

  // A revoked token means its family was already killed (prior reuse or logout).
  // Replaying it is a reuse signal; make sure the whole family stays dead.
  if (row.revokedAt) {
    await revokeFamily(row.familyId);
    return { status: 'reuse', familyId: row.familyId };
  }

  // Already-rotated token presented again → classic reuse. Burn the family.
  if (row.rotatedAt) {
    await revokeFamily(row.familyId);
    return { status: 'reuse', familyId: row.familyId };
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return { status: 'expired' };
  }

  // Atomically claim the rotation. Only one concurrent request can flip
  // rotatedAt from null, guaranteeing a single winner (no split-brain minting).
  const claim = await prisma.refreshToken.updateMany({
    where: { id: row.id, rotatedAt: null, revokedAt: null },
    data: { rotatedAt: new Date() },
  });

  if (claim.count === 0) {
    // Lost the race (or concurrently reused). Re-read to decide.
    const fresh = await prisma.refreshToken.findUnique({ where: { id: row.id } });
    if (fresh && (fresh.rotatedAt || fresh.revokedAt)) {
      await revokeFamily(row.familyId);
      return { status: 'reuse', familyId: row.familyId };
    }
    return { status: 'invalid' };
  }

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) {
    return { status: 'user_not_found' };
  }

  const { token: refreshToken } = await issueRefreshToken({
    user,
    familyId: row.familyId,
    req,
  });

  return { status: 'rotated', user, refreshToken };
};

export default {
  hashToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  revokeTokenFamily,
  REFRESH_TOKEN_TTL_DAYS,
};
