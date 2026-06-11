import express from "express";
import {
  homePage,
  healthCheck,
  qrPage,
  handleReset // Importamos el nuevo manejador
} from "../controllers/web.controller.js";
import { adminAuth } from "../middlewares/admin.middleware.js";

const router = express.Router();

// Rutas de visualización (GET)
router.get("/", homePage);
router.get("/health", healthCheck);
// QR protegido: vincular el dispositivo no debe quedar expuesto públicamente
router.get("/qr", adminAuth, qrPage);

// Ruta de acción (POST) protegida: modifica/borra la sesión del bot
router.post("/reset", adminAuth, handleReset);

export default router;