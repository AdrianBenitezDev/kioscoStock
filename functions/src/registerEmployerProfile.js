const { onRequest, Timestamp, adminAuth, db } = require("./shared/context");

const ALLOWED_ORIGINS = new Set([
  "https://admin.stockfacil.com.ar",
  "https://stockfacil.com.ar",
  "https://www.stockfacil.com.ar"
]);

const BUSINESS_CUSTOM_LABEL_MAX = 30;
const CUSTOM_BUSINESS_TYPE_ID = "custom";
const DEFAULT_BUSINESS_TYPE_ID = "kiosco";

const registerEmployerProfile = onRequest(async (req, res) => {
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

    const authUser = await adminAuth.getUser(uid);
    const catalog = await loadBusinessCatalog();
    const payload = await normalizePayload(req.body || {}, authUser.email || "", catalog);
    if (!payload.ok) {
      res.status(400).json({ ok: false, error: payload.error, fieldErrors: payload.fieldErrors || {} });
      return;
    }

    const existingUser = await db.collection("usuarios").doc(uid).get();
    if (existingUser.exists) {
      res.status(409).json({ ok: false, error: "Este usuario ya esta registrado." });
      return;
    }

    const existingByEmail = await db.collection("usuarios").where("email", "==", payload.data.email).limit(1).get();
    if (!existingByEmail.empty) {
      res.status(409).json({ ok: false, error: "Este usuario ya esta registrado." });
      return;
    }

    const negocioRef = db.collection("tenants").doc();
    const kioscoId = negocioRef.id;
    const now = Timestamp.now();

    const batch = db.batch();

    batch.set(db.collection("usuarios").doc(uid), {
      uid,
      correoVerificado: false,
      email: payload.data.email,
      tipo: "empleador",
      role: "empleador",
      kioscoId,
      tenantId: kioscoId,
      estado: "activo",
      activo: true,
      nombreApellido: payload.data.nombreApellido,
      domicilio: payload.data.domicilio,
      pais: payload.data.pais,
      telefono: payload.data.telefono,
      plan: payload.data.plan,
      businessTypeId: payload.data.businessTypeId,
      businessTypeLabel: payload.data.businessTypeLabel,
      fechaCreacion: now,
      updatedAt: now
    });

    batch.set(db.collection("tenants").doc(kioscoId), {
      kioscoId,
      ownerUid: uid,
      emailOwner: payload.data.email,
      nombreKiosco: payload.data.nombreKiosco,
      pais: payload.data.pais,
      provinciaEstado: payload.data.provinciaEstado,
      distrito: payload.data.distrito,
      localidad: payload.data.localidad,
      domicilio: payload.data.domicilio,
      plan: payload.data.plan,
      businessTypeId: payload.data.businessTypeId,
      businessTypeLabel: payload.data.businessTypeLabel,
      estado: "activo",
      createdAt: now,
      updatedAt: now
    });

    await batch.commit();
    await adminAuth.setCustomUserClaims(uid, { tenantId: kioscoId, role: "empleador" });

    res.status(200).json({
      ok: true,
      kioscoId,
      nid: kioscoId
    });
  } catch (error) {
    console.error("registerEmployerProfile fallo:", error);
    res.status(500).json({ ok: false, error: "No se pudo completar el registro." });
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

async function normalizePayload(input, fallbackEmail, catalog) {
  const data = {
    nombreApellido: String(input.nombreApellido || "").trim(),
    email: String(input.email || fallbackEmail || "").trim().toLowerCase(),
    telefono: String(input.telefono || "").trim(),
    nombreKiosco: String(input.nombreKiosco || "").trim(),
    pais: String(input.pais || "").trim(),
    provinciaEstado: String(input.provinciaEstado || "").trim(),
    distrito: String(input.distrito || "").trim(),
    localidad: String(input.localidad || "").trim(),
    domicilio: String(input.domicilio || "").trim(),
    plan: String(input.plan || "").trim(),
    businessTypeId: String(input.businessTypeId || "").trim().toLowerCase(),
    businessTypeCustomLabel: sanitizeCustomBusinessLabel(input.businessTypeCustomLabel)
  };

  const fieldErrors = {};
  if (!/^[A-Za-zÀ-ÿ\s]{3,80}$/.test(data.nombreApellido)) {
    fieldErrors.nombreApellido = "Nombre y apellido invalido.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    fieldErrors.email = "Email invalido.";
  }
  if (!/^\d{6,20}$/.test(data.telefono)) {
    fieldErrors.telefono = "Telefono invalido. Solo numeros.";
  }
  if (!data.nombreKiosco) {
    fieldErrors.nombreKiosco = "Nombre del kiosco obligatorio.";
  }
  if (!data.pais) {
    fieldErrors.pais = "Pais obligatorio.";
  }
  if (!data.provinciaEstado) {
    fieldErrors.provinciaEstado = "Provincia/Estado obligatorio.";
  }
  if (!data.distrito) {
    fieldErrors.distrito = "Distrito obligatorio.";
  }
  if (!data.localidad) {
    fieldErrors.localidad = "Localidad obligatoria.";
  }
  if (!data.domicilio) {
    fieldErrors.domicilio = "Domicilio obligatorio.";
  }

  const allowedPlans = await loadAvailablePlans();
  if (!allowedPlans.size) {
    fieldErrors.plan = "No hay planes disponibles en backend.";
  } else if (!allowedPlans.has(data.plan.toLowerCase())) {
    fieldErrors.plan = "Plan invalido.";
  }

  if (!data.businessTypeId) {
    fieldErrors.businessTypeId = "Selecciona un tipo de negocio.";
  }

  if (data.businessTypeId === CUSTOM_BUSINESS_TYPE_ID) {
    if (!data.businessTypeCustomLabel) {
      fieldErrors.businessTypeCustomLabel = "Ingresa una categoria personalizada.";
    } else if (data.businessTypeCustomLabel.length > BUSINESS_CUSTOM_LABEL_MAX) {
      fieldErrors.businessTypeCustomLabel = `Maximo ${BUSINESS_CUSTOM_LABEL_MAX} caracteres.`;
    } else if (!isValidCustomBusinessLabel(data.businessTypeCustomLabel)) {
      fieldErrors.businessTypeCustomLabel = "Solo letras, numeros, espacios, guion y apostrofe.";
    }
  } else if (!catalog.activeTypeIds.has(data.businessTypeId)) {
    fieldErrors.businessTypeId = "Tipo de negocio invalido.";
  }

  const hasErrors = Object.keys(fieldErrors).length > 0;
  if (hasErrors) {
    return { ok: false, error: "Revisa los campos del formulario.", fieldErrors };
  }

  data.plan = data.plan.toLowerCase();
  data.businessTypeLabel =
    data.businessTypeId === CUSTOM_BUSINESS_TYPE_ID
      ? data.businessTypeCustomLabel
      : catalog.typeLabelById.get(data.businessTypeId) || data.businessTypeId;

  return { ok: true, data };
}

async function loadAvailablePlans() {
  try {
    const plansSnap = await db.collection("planes").get();
    if (plansSnap.empty) return new Set();

    const ids = plansSnap.docs
      .map((snap) => {
        const data = snap.data() || {};
        const activo = data.activo !== false;
        if (!activo) return "";
        return String(snap.id || data.id || "").trim().toLowerCase();
      })
      .filter(Boolean);

    return new Set(ids);
  } catch (error) {
    console.warn("registerEmployerProfile: no se pudo leer planes", error?.message || error);
    return new Set();
  }
}

async function loadBusinessCatalog() {
  try {
    const snap = await db.collection("configuraciones").doc("catalogo_negocios").get();
    if (!snap.exists) {
      return buildFallbackBusinessCatalog();
    }
    const data = snap.data() || {};
    const rows = Array.isArray(data.tiposNegocio) ? data.tiposNegocio : [];

    const activeTypeIds = new Set();
    const typeLabelById = new Map();
    for (const row of rows) {
      const id = String(row?.id || "").trim().toLowerCase();
      if (!id || id === CUSTOM_BUSINESS_TYPE_ID) continue;
      const activo = row?.activo !== false;
      if (!activo) continue;
      const nombre = String(row?.nombre || id).trim() || id;
      activeTypeIds.add(id);
      typeLabelById.set(id, nombre);
    }

    if (!activeTypeIds.size) {
      return buildFallbackBusinessCatalog();
    }

    return { activeTypeIds, typeLabelById };
  } catch (error) {
    console.warn("registerEmployerProfile: no se pudo leer catalogo_negocios", error?.message || error);
    return buildFallbackBusinessCatalog();
  }
}

function buildFallbackBusinessCatalog() {
  return {
    activeTypeIds: new Set([DEFAULT_BUSINESS_TYPE_ID]),
    typeLabelById: new Map([[DEFAULT_BUSINESS_TYPE_ID, "Kiosco"]])
  };
}

function sanitizeCustomBusinessLabel(valueLike) {
  return String(valueLike || "")
    .trim()
    .replace(/\s+/g, " ")
    ;
}

function isValidCustomBusinessLabel(valueLike) {
  const value = sanitizeCustomBusinessLabel(valueLike);
  if (!value) return false;
  return /^[A-Za-z0-9\s\-']{1,30}$/.test(value);
}

module.exports = {
  registerEmployerProfile
};

