import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { userController } from "../controllers/user.controller";

const router = Router();

router.get("/me", authenticate, userController.me);
router.get("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), userController.list);
router.put("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), userController.update);
router.delete("/:id", authenticate, authorize("SUPER_ADMIN"), userController.remove);

export default router;