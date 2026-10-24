import { Router } from "express";
import { crudHandlers } from "../utils/crud";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { authorCreateSchema, authorUpdateSchema } from "../validators/author.validator";

const h = crudHandlers({
  model: "author",
  searchFields: ["name", "bio"],
  sortFields: ["name", "createdAt"],
  defaultOrderBy: { name: "asc" },
});

const router = Router();
router.get("/", h.list);
router.get("/:id", h.get);
router.post("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(authorCreateSchema), h.create);
router.put("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(authorUpdateSchema), h.update);
router.delete("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), h.remove);

export default router;