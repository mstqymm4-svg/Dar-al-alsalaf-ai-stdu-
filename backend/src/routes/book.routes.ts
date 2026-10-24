import { Router } from "express";
import { crudHandlers } from "../utils/crud";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { bookCreateSchema, bookUpdateSchema } from "../validators/book.validator";

const h = crudHandlers({
  model: "book",
  searchFields: ["title", "description", "authorName"],
  filterFields: ["categoryId", "authorId", "status", "language", "isFeatured"],
  sortFields: ["title", "rating", "createdAt", "updatedAt"],
  defaultOrderBy: { createdAt: "desc" },
  include: { author: true, category: true },
});

const router = Router();
router.get("/", h.list);
router.get("/:id", h.get);
router.post("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(bookCreateSchema), h.create);
router.put("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(bookUpdateSchema), h.update);
router.delete("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), h.remove);

export default router;