import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firestoreDb } from "../config.js";
import {
  BUSINESS_CATALOG_DOC_PATH,
  BUSINESS_CUSTOM_LABEL_MAX,
  CUSTOM_BUSINESS_TYPE_ID,
  DEFAULT_BUSINESS_TYPE_ID,
  DEFAULT_PRODUCT_CATEGORIES
} from "./config.js";
import { getBusinessCatalogCache, putBusinessCatalogCache } from "./db.js";

let memoryCatalog = null;
let inFlightCatalogPromise = null;

const DEFAULT_CATALOG = {
  version: 1,
  updatedAt: "",
  tiposNegocio: [
    {
      id: DEFAULT_BUSINESS_TYPE_ID,
      nombre: "Kiosco",
      activo: true,
      orden: 1,
      categorias: [...DEFAULT_PRODUCT_CATEGORIES]
    }
  ]
};

export {
  BUSINESS_CUSTOM_LABEL_MAX,
  CUSTOM_BUSINESS_TYPE_ID,
  DEFAULT_BUSINESS_TYPE_ID
};

export async function loadBusinessCatalog({ forceRefresh = false } = {}) {
  if (!forceRefresh && memoryCatalog) {
    return memoryCatalog;
  }
  if (!forceRefresh && inFlightCatalogPromise) {
    return inFlightCatalogPromise;
  }

  inFlightCatalogPromise = resolveCatalog({ forceRefresh });
  try {
    const resolved = await inFlightCatalogPromise;
    memoryCatalog = resolved;
    return resolved;
  } finally {
    inFlightCatalogPromise = null;
  }
}

export async function getBusinessTypesForRegistration() {
  const catalog = await loadBusinessCatalog();
  return normalizeBusinessTypes(catalog?.tiposNegocio).filter((row) => row.activo === true);
}

export async function getCategoriesForBusinessTypeId(businessTypeIdLike) {
  const catalog = await loadBusinessCatalog();
  const businessTypeId = normalizeBusinessTypeId(businessTypeIdLike);
  const businessType = findBusinessType(catalog, businessTypeId);
  if (businessType && businessType.categorias.length > 0) {
    return [...businessType.categorias];
  }

  const fallbackType = findBusinessType(catalog, DEFAULT_BUSINESS_TYPE_ID);
  if (fallbackType && fallbackType.categorias.length > 0) {
    return [...fallbackType.categorias];
  }
  return [...DEFAULT_PRODUCT_CATEGORIES];
}

export async function getCategoriesForSession(sessionLike) {
  const businessTypeId = normalizeBusinessTypeId(sessionLike?.businessTypeId || sessionLike?.tipoNegocioId || "");
  return getCategoriesForBusinessTypeId(businessTypeId || DEFAULT_BUSINESS_TYPE_ID);
}

export function sanitizeCustomBusinessLabel(valueLike) {
  const value = String(valueLike || "").trim();
  if (!value) return "";
  const collapsed = value.replace(/\s+/g, " ");
  const sliced = collapsed;
  return sliced;
}

export function isValidCustomBusinessLabel(valueLike) {
  const value = sanitizeCustomBusinessLabel(valueLike);
  if (!value) return false;
  if (value.length > BUSINESS_CUSTOM_LABEL_MAX) return false;
  return /^[A-Za-z0-9\s\-']{1,30}$/.test(value);
}

export function normalizeBusinessTypeId(valueLike) {
  return String(valueLike || "").trim().toLowerCase();
}

async function resolveCatalog({ forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : await getBusinessCatalogCache().catch(() => null);
  const normalizedCached = normalizeCatalog(cached?.catalog || null, cached?.version);

  if (normalizedCached && !forceRefresh) {
    void refreshCatalogInBackground(normalizedCached.version).catch(() => {});
    return normalizedCached;
  }

  const remote = await loadCatalogFromFirestore().catch(() => null);
  if (remote) {
    await putBusinessCatalogCache({
      version: remote.version,
      catalog: remote,
      syncedAt: Date.now()
    }).catch(() => {});
    return remote;
  }

  if (normalizedCached) return normalizedCached;
  return normalizeCatalog(DEFAULT_CATALOG, DEFAULT_CATALOG.version);
}

async function refreshCatalogInBackground(localVersion) {
  const remote = await loadCatalogFromFirestore();
  if (!remote) return;
  if (Number(remote.version || 0) === Number(localVersion || 0)) return;

  await putBusinessCatalogCache({
    version: remote.version,
    catalog: remote,
    syncedAt: Date.now()
  }).catch(() => {});
  memoryCatalog = remote;
}

async function loadCatalogFromFirestore() {
  const ref = doc(firestoreDb, BUSINESS_CATALOG_DOC_PATH.collection, BUSINESS_CATALOG_DOC_PATH.docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return normalizeCatalog(DEFAULT_CATALOG, DEFAULT_CATALOG.version);
  }
  const data = snap.data() || {};
  return normalizeCatalog(data, data?.version);
}

function normalizeCatalog(input, versionFallback) {
  const source = input && typeof input === "object" ? input : {};
  const tiposNegocio = normalizeBusinessTypes(source.tiposNegocio);
  const hasDefault = tiposNegocio.some((row) => row.id === DEFAULT_BUSINESS_TYPE_ID);
  if (!hasDefault) {
    tiposNegocio.unshift({
      id: DEFAULT_BUSINESS_TYPE_ID,
      nombre: "Kiosco",
      activo: true,
      orden: 0,
      categorias: [...DEFAULT_PRODUCT_CATEGORIES]
    });
  }
  return {
    version: normalizeVersion(source.version, versionFallback),
    updatedAt: String(source.updatedAt || "").trim(),
    tiposNegocio
  };
}

function normalizeBusinessTypes(source) {
  const rows = Array.isArray(source) ? source : [];
  const normalized = rows
    .map((row, index) => {
      const id = normalizeBusinessTypeId(row?.id);
      if (!id || id === CUSTOM_BUSINESS_TYPE_ID) return null;
      const nombre = String(row?.nombre || id).trim() || id;
      const activo = row?.activo !== false;
      const ordenValue = Number(row?.orden);
      const categorias = normalizeCategories(row?.categorias);
      return {
        id,
        nombre,
        activo,
        orden: Number.isFinite(ordenValue) ? ordenValue : index + 1,
        categorias
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.orden - b.orden);

  return normalized;
}

function normalizeCategories(source) {
  const rows = Array.isArray(source) ? source : [];
  const cleaned = rows
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => value.slice(0, 60));
  const deduped = Array.from(new Set(cleaned));
  if (!deduped.includes("Otros")) {
    deduped.push("Otros");
  }
  return deduped;
}

function findBusinessType(catalog, businessTypeId) {
  const rows = Array.isArray(catalog?.tiposNegocio) ? catalog.tiposNegocio : [];
  return rows.find((row) => row.id === businessTypeId && row.activo !== false) || null;
}

function normalizeVersion(value, fallback) {
  const parsed = Number(value ?? fallback ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.trunc(parsed);
}

