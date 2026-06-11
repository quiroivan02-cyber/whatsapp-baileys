/**
 * Protege rutas sensibles (QR y reset) con HTTP Basic Auth.
 *
 * El QR permite vincular WhatsApp y /reset borra la sesión: expuestos sin protección en
 * una URL pública, cualquiera podría secuestrar o resetear el bot. La contraseña es
 * ADMIN_TOKEN (el usuario puede ser cualquiera). Fail-closed: si ADMIN_TOKEN no está
 * configurado, se bloquea el acceso en lugar de exponer las rutas.
 */
import { config } from "../config/config.js";

export function adminAuth(req, res, next) {
    const token = config.adminToken;

    if (!token) {
        return res
            .status(503)
            .send("ADMIN_TOKEN no está configurado en el servidor. Define la variable de entorno para acceder.");
    }

    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");

    if (scheme === "Basic" && encoded) {
        const decoded = Buffer.from(encoded, "base64").toString();
        const password = decoded.slice(decoded.indexOf(":") + 1);
        if (password === token) {
            return next();
        }
    }

    res.set("WWW-Authenticate", 'Basic realm="Panel de Control"');
    return res.status(401).send("Autenticación requerida.");
}
