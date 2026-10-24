import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { hashPassword, verifyPassword, hashToken } from "../utils/hash";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt";
import type { RegisterInput, LoginInput } from "../validators/auth.validator";
import { env } from "../config/env";

async function issueTokens(userId: string, email: string, role: string, ctx: { userAgent?: string; ip?: string }) {
  const access = signAccessToken({ sub: userId, email, role });
  const jti = crypto.randomUUID();
  const refresh = signRefreshToken({ sub: userId, jti });

  // Decode exp without exposing secrets (jwt.decode does not verify).
  const decoded = jwt.decode(refresh) as { exp: number };
  const expiresAt = new Date((decoded?.exp ?? 0) * 1000);

  await prisma.refreshToken.create({
    data: {
      id: jti,
      tokenHash: hashToken(refresh),
      userId,
      expiresAt,
      userAgent: ctx.userAgent,
      ip: ctx.ip,
    },
  });

  return { accessToken: access, refreshToken: refresh, expiresIn: env.jwt.accessExpiresIn };
}

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw ApiError.conflict("Email already registered");

    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: { email: input.email, passwordHash, fullName: input.fullName ?? null },
    });

    const tokens = await issueTokens(user.id, user.email, user.role, {});
    return { user: sanitize(user), ...tokens };
  },

  async login(input: LoginInput, ctx: { userAgent?: string; ip?: string }) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw ApiError.unauthorized("Invalid credentials");
    if (!user.isActive) throw ApiError.forbidden("Account is disabled");

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw ApiError.unauthorized("Invalid credentials");

    const tokens = await issueTokens(user.id, user.email, user.role, ctx);
    return { user: sanitize(user), ...tokens };
  },

  async refresh(refreshToken: string, ctx: { userAgent?: string; ip?: string }) {
    let payload: { sub: string; jti: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw ApiError.unauthorized("Invalid refresh token");
    }

    const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!stored) throw ApiError.unauthorized("Refresh token not recognised");
    if (stored.revokedAt) throw ApiError.unauthorized("Refresh token revoked");
    if (stored.tokenHash !== hashToken(refreshToken)) throw ApiError.unauthorized("Refresh token mismatch");
    if (stored.expiresAt < new Date()) throw ApiError.unauthorized("Refresh token expired");

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw ApiError.unauthorized();

    // Rotate: revoke the used token, issue a new one.
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const tokens = await issueTokens(user.id, user.email, user.role, ctx);
    return { user: sanitize(user), ...tokens };
  },

  async logout(refreshToken: string) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // silent — logout should always succeed for the client
    }
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound("User not found");
    return sanitize(user);
  },
};

function sanitize(user: any) {
  const { passwordHash, ...rest } = user;
  return rest;
}