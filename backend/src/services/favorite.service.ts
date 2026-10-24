import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";

export const favoriteService = {
  async list(userId: string) {
    return prisma.favorite.findMany({
      where: { userId },
      include: { book: true },
      orderBy: { createdAt: "desc" },
    });
  },

  async add(userId: string, bookId: string) {
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw ApiError.notFound("Book not found");

    const existing = await prisma.favorite.findUnique({
      where: { userId_bookId: { userId, bookId } },
    });
    if (existing) return existing; // idempotent

    return prisma.favorite.create({ data: { userId, bookId }, include: { book: true } });
  },

  async remove(userId: string, bookId: string) {
    try {
      await prisma.favorite.delete({ where: { userId_bookId: { userId, bookId } } });
    } catch {
      // idempotent — already removed
    }
    return { ok: true };
  },

  async ids(userId: string) {
    const rows = await prisma.favorite.findMany({ where: { userId }, select: { bookId: true } });
    return rows.map((r) => r.bookId);
  },
};