import { Router } from "express";
import { crudHandlers } from "../utils/crud";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { videoChannelCreateSchema, videoChannelUpdateSchema } from "../validators/videoChannel.validator";

const h = crudHandlers({
  model: "videoChannel",
  searchFields: ["name", "description"],
  sortFields: ["name", "sortOrder", "createdAt"],
  defaultOrderBy: { sortOrder: "asc" },
});

const router = Router();
router.get("/", h.list);
router.get("/:id", h.get);
router.post("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(videoChannelCreateSchema), h.create);
router.put("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(videoChannelUpdateSchema), h.update);
router.delete("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), h.remove);

export default router;