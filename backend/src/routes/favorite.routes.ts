import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { favoriteController } from "../controllers/favorite.controller";

const router = Router();

router.use(authenticate); // all favorites are per-user

router.get("/", favoriteController.list);
router.get("/ids", favoriteController.ids);
router.post("/:bookId", favoriteController.add);
router.delete("/:bookId", favoriteController.remove);

export default router;