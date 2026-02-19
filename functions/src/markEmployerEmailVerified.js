const { onRequest, Timestamp, adminAuth, db } = require("./shared/context");
const ALLOWED_ORIGINS = new Set([
  "https://admin.stockfacil.com.ar",
  "https://stockfacil.com.ar"
]);

const markEmployerEmailVerified = onRequest(async (req, res) => {
  if (!setCors(req, res)) {
    res.status(403).json({ ok: false, error: "Origen no permitido." });
    return;
  }
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido." });
    return;
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: "Falta token de autenticacion." });
      return;
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const uid = String(decoded.uid || "").trim();
    if (!uid) {
      res.status(401).json({ ok: false, error: "Token invalido." });
      return;
    }
    const emailVerified = decoded.email_verified === true;

    // Sync rapido: si el token ya confirma correo verificado, persiste el estado real
    // tanto para empleador como para empleado.
    if (emailVerified) {
      const now = Timestamp.now();
      const [userSnap, employeeSnap] = await Promise.all([
        db.collection("usuarios").doc(uid).get(),
        db.collection("empleados").doc(uid).get()
      ]);

      const batch = db.batch();
      let touched = 0;

      if (userSnap.exists) {
        const userRef = userSnap.ref;
        batch.set(
          userRef,
          {
            correoVerificado: true,
            tokenCorreoVerificacion: null,
            tokenCorreoVerificacionCreatedAt: null,
            tokenCorreoVerificacionExpiresAt: null,
            updatedAt: now
          },
          { merge: true }
        );
        touched += 1;
      }

      if (employeeSnap.exists) {
        batch.set(
          employeeSnap.ref,
          {
            emailVerified: true,
            correoVerificado: true,
            updatedAt: now
          },
          { merge: true }
        );
        touched += 1;
      }

      if (touched === 0) {
        res.status(404).json({ ok: false, error: "No existe perfil de usuario." });
        return;
      }

      await batch.commit();
      res.status(200).json({ ok: true, correoVerificado: true, emailVerified: true });
      return;
    }

    const userRef = db.collection("usuarios").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ ok: false, error: "No existe perfil de usuario." });
      return;
    }

    const tokenCorreoVerificacionReq = String(req.body?.tokenCorreoVerificacion || "").trim();
    if (!tokenCorreoVerificacionReq) {
      res.status(400).json({ ok: false, error: "Falta token de verificacion de correo." });
      return;
    }

    const profile = userSnap.data() || {};
    const tokenCorreoVerificacion = profile.tokenCorreoVerificacion;
    const tokenCorreoVerificacionExpiresAt = profile.tokenCorreoVerificacionExpiresAt;
    
    if (tokenCorreoVerificacion !== tokenCorreoVerificacionReq) {
      res.status(409).json({ ok: false, error: "El token de verificacion no coincide." });
      return;
    }
    if (!tokenCorreoVerificacionExpiresAt || typeof tokenCorreoVerificacionExpiresAt.toDate !== "function") {
      res.status(409).json({ ok: false, error: "Token de verificacion invalido o sin expiracion." });
      return;
    }
    if (tokenCorreoVerificacionExpiresAt.toDate().getTime() <= Date.now()) {
      res.status(409).json({ ok: false, error: "El token de verificacion ya expiro." });
      return;
    }

    await userRef.set(
      {
        correoVerificado: true,
        tokenCorreoVerificacion: null,
        tokenCorreoVerificacionCreatedAt: null,
        tokenCorreoVerificacionExpiresAt: null,
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );

    res.status(200).json({ ok: true, correoVerificado: true });
  } catch (error) {
    console.error("markEmployerEmailVerified fallo:", error);
    res.status(500).json({ ok: false, error: "No se pudo actualizar la verificacion de correo." });
  }
});

function setCors(req, res) {
  const origin = String(req.headers?.origin || "").trim();
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return false;
  }
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return true;
}

function getBearerToken(req) {
  const authHeader = String(req.headers?.authorization || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || "").trim() : "";
}

module.exports = {
  markEmployerEmailVerified
};
