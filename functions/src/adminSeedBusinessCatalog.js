const { onRequest, adminAuth, db, Timestamp } = require("./shared/context");

const ALLOWED_ADMIN_EMAILS = new Set([
  "artbenitezdev@gmail.com",
  "admin@stockfacil.com.ar"
]);

const MAX_TYPES = 60;
const MAX_CATEGORIES_PER_TYPE = 200;

const adminSeedBusinessCatalog = onRequest(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    await assertAdminRequest(req);
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Metodo no permitido." });
      return;
    }

    const normalized = normalizeCatalog(req.body?.catalog || req.body || {});
    const payload = {
      version: normalized.version,
      tiposNegocio: normalized.tiposNegocio,
      updatedAt: Timestamp.now()
    };

    await db.collection("configuraciones").doc("catalogo_negocios").set(payload, { merge: true });
    res.status(200).json({
      ok: true,
      version: normalized.version,
      businessTypesCount: normalized.tiposNegocio.length
    });
  } catch (error) {
    console.error("adminSeedBusinessCatalog fallo:", error);
    const status = Number(error?.status || 500);
    res.status(status).json({ ok: false, error: error?.message || "Error interno." });
  }
});

async function assertAdminRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw { status: 401, message: "Falta token de autenticacion." };
  }
  const decoded = await adminAuth.verifyIdToken(token);
  const email = String(decoded?.email || "").trim().toLowerCase();
  if (!ALLOWED_ADMIN_EMAILS.has(email)) {
    throw { status: 403, message: "Acceso denegado." };
  }
}

function normalizeCatalog(input) {
  const source = input && typeof input === "object" ? input : {};
  const version = toPositiveInteger(source.version, 1);
  const rawTypes = Array.isArray(source.tiposNegocio) ? source.tiposNegocio : [];
  if (!rawTypes.length) {
    throw { status: 400, message: "tiposNegocio es obligatorio." };
  }

  const seenTypeIds = new Set();
  const tiposNegocio = rawTypes
    .slice(0, MAX_TYPES)
    .map((row, index) => normalizeBusinessType(row, index + 1))
    .filter((row) => {
      if (seenTypeIds.has(row.id)) return false;
      seenTypeIds.add(row.id);
      return true;
    });

  if (!tiposNegocio.length) {
    throw { status: 400, message: "No se encontraron tipos validos para guardar." };
  }

  return { version, tiposNegocio };
}

function normalizeBusinessType(raw, fallbackOrder) {
  const id = String(raw?.id || "")
    .trim()
    .toLowerCase();
  if (!id || !/^[a-z0-9_-]{2,40}$/.test(id)) {
    throw { status: 400, message: `Tipo de negocio invalido: ${String(raw?.id || "")}` };
  }
  const nombre = String(raw?.nombre || "").trim();
  if (!nombre || nombre.length > 80) {
    throw { status: 400, message: `Nombre invalido para tipo: ${id}` };
  }
  const orden = toPositiveInteger(raw?.orden, fallbackOrder);
  const activo = raw?.activo !== false;
  const categorias = normalizeCategories(raw?.categorias, id);
  return { id, nombre, activo, orden, categorias };
}

function normalizeCategories(source, typeId) {
  const rows = Array.isArray(source) ? source : [];
  if (!rows.length) {
    throw { status: 400, message: `El tipo ${typeId} debe tener al menos una categoria.` };
  }
  const cleaned = rows
    .slice(0, MAX_CATEGORIES_PER_TYPE)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => value.slice(0, 60));

  const deduped = Array.from(new Set(cleaned));
  if (!deduped.length) {
    throw { status: 400, message: `El tipo ${typeId} no tiene categorias validas.` };
  }
  if (!deduped.includes("Otros")) deduped.push("Otros");
  return deduped;
}

function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.trunc(Number(fallback || 0));
  return Math.trunc(parsed);
}

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getBearerToken(req) {
  const authHeader = String(req.headers?.authorization || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || "").trim() : "";
}

module.exports = {
  adminSeedBusinessCatalog
};
