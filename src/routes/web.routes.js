import express from "express";
import {
  homePage,
  healthCheck,
  qrPage,
  handleReset // Importamos el nuevo manejador
} from "../controllers/web.controller.js";

const router = express.Router();

// Rutas de visualización (GET)
router.get("/", homePage);
router.get("/health", healthCheck);
router.get("/qr", qrPage);

// Ruta de acción (POST)
// Usamos POST por seguridad, ya que modifica el estado del bot
router.post("/reset", handleReset);

export default router;