import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { validateBody } from "../middleware/validate";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimit";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
} from "../validators/auth.validator";

const router = Router();

router.post("/register", authRateLimiter, validateBody(registerSchema), authController.register);
router.post("/login", authRateLimiter, validateBody(loginSchema), authController.login);
router.post("/refresh", authRateLimiter, validateBody(refreshSchema), authController.refresh);
router.post("/logout", authController.logout);
router.get("/me", authenticate, authController.me);

export default router;