import { Router } from "express";
import { crudHandlers } from "../utils/crud";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { socialChannelCreateSchema, socialChannelUpdateSchema } from "../validators/socialChannel.validator";

const h = crudHandlers({
  model: "socialChannel",
  searchFields: ["name", "description"],
  sortFields: ["name", "sortOrder", "createdAt"],
  defaultOrderBy: { sortOrder: "asc" },
});

const router = Router();
router.get("/", h.list);
router.get("/:id", h.get);
router.post("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(socialChannelCreateSchema), h.create);
router.put("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(socialChannelUpdateSchema), h.update);
router.delete("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), h.remove);

export default router;