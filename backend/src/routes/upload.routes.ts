import { Router } from "express";
import { upload } from "../config/multer";
import { authenticate, authorize } from "../middleware/auth";
import { uploadController } from "../controllers/upload.controller";

const router = Router();

// Public read of media metadata is optional; here uploads require auth (admin).
router.post("/:kind?", authenticate, authorize("ADMIN", "SUPER_ADMIN"), upload.single("file"), uploadController.upload);
router.delete("/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), uploadController.delete);

export default router;