import { Router } from "express";
import { crudHandlers } from "../utils/crud";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { videoCreateSchema, videoUpdateSchema } from "../validators/video.validator";

const h = crudHandlers({
  model: "video",
  searchFields: ["title", "description", "channelName"],
  filterFields: ["videoChannelId", "category", "videoType", "isFeatured", "visible"],
  sortFields: ["title", "sortOrder", "createdAt"],
  defaultOrderBy: { sortOrder: "asc" },
  include: { channel: true },
});

const router = Router();
router.get("/", h.list);
router.get("/:id", h.get);
router.post("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(videoCreateSchema), h.create);
router.put("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), validateBody(videoUpdateSchema), h.update);
router.delete("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), h.remove);

export default router;