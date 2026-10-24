import { Router } from "express";
import { crudHandlers } from "../utils/crud";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { categoryCreateSchema, categoryUpdateSchema } from "../validators/category.validator";

function slugify(name: string) {
  return name
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-آ-ي]+/g, "")
    .slice(0, 100);
}

const h = crudHandlers({
  model: "category",
  searchFields: ["name"],
  sortFields: ["name", "sortOrder", "createdAt"],
  defaultOrderBy: { sortOrder: "asc" },
  beforeCreate: (data) => ({ ...data, slug: data.slug || slugify(data.name) }),
});

const router = Router();
router.get("/", h.list);
router.get("/:id", h.get);
router.post("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(categoryCreateSchema), h.create);
router.put("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(categoryUpdateSchema), h.update);
router.delete("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), h.remove);

export default router;