import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseAuth, firebaseConfig, firestoreDb } from "../config.js";
import { ensureCurrentUserProfile, getCurrentSession } from "./auth.js";

const plansCards = document.getElementById("plans-cards");
const plansFeedback = document.getElementById("plans-feedback");
const cancelSubscriptionBtn = document.getElementById("cancel-subscription-btn");

let cancelSubscriptionInProgress = false;
let latestSubscriptionState = {
  subscriptionStatus: "",
  hasPreapproval: false
};

init().catch((error) => {
  console.error("No se pudo inicializar la pantalla de planes:", error);
  setFeedback("No se pudieron cargar los planes. Revisa tu conexion e intentalo nuevamente.");
});

async function init() {
  if (!plansCards || !plansFeedback) return;
  cancelSubscriptionBtn?.addEventListener("click", handleCancelSubscriptionClick);
  updateCancelButtonState(latestSubscriptionState);
  setFeedback("Validando sesion...");

  const profileResult = await ensureCurrentUserProfile();
  if (!profileResult?.ok) {
    setFeedback(profileResult?.error || "Sesion invalida.");
    window.setTimeout(() => {
      window.location.href = "index.html";
    }, 800);
    return;
  }

  const session = getCurrentSession();
  if (!session?.tenantId) {
    setFeedback("No se pudo identificar el negocio de tu cuenta.");
    return;
  }

  setFeedback("Cargando planes...");
  const [plans, tenantSnapshot] = await Promise.all([
    loadPlans(),
    resolveTenantSnapshot(session)
  ]);
  const currentPlanId = tenantSnapshot.currentPlanId;
  latestSubscriptionState = {
    subscriptionStatus: tenantSnapshot.subscriptionStatus,
    hasPreapproval: tenantSnapshot.hasPreapproval
  };
  updateCancelButtonState(latestSubscriptionState);

  if (!plans.length) {
    plansCards.innerHTML = "";
    setFeedback("No hay planes disponibles en este momento.");
    return;
  }

  renderPlanCards(plans, currentPlanId);
  if (currentPlanId) {
    const currentPlanLabel = resolvePlanLabel(plans, currentPlanId);
    const subscriptionStatusLabel = getSubscriptionStatusLabel(tenantSnapshot.subscriptionStatus);
    const summary = [`Plan actual: ${currentPlanLabel}.`];
    if (subscriptionStatusLabel) {
      summary.push(`Estado de suscripcion: ${subscriptionStatusLabel}.`);
    }
    setFeedback(summary.join(" "));
  } else {
    setFeedback("No se pudo identificar el plan actual.");
  }
}

async function loadPlans() {
  const snap = await getDocs(collection(firestoreDb, "planes"));
  const data = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  return normalizePlans(data);
}

async function resolveCurrentPlanId(session) {
  const snapshot = await resolveTenantSnapshot(session);
  return snapshot.currentPlanId;
}

async function resolveTenantSnapshot(session) {
  const candidates = [session?.planActual];
  let subscriptionStatus = "";
  let preapprovalId = "";

  try {
    const tenantRef = doc(firestoreDb, "tenants", String(session?.tenantId || "").trim());
    const tenantSnap = await getDoc(tenantRef);
    if (tenantSnap.exists()) {
      const tenant = tenantSnap.data() || {};
      candidates.push(
        tenant?.plan,
        tenant?.planId,
        tenant?.planActual,
        tenant?.subscription?.planId,
        tenant?.suscripcion?.planId
      );
      subscriptionStatus = normalizeSubscriptionStatus(
        tenant?.subscriptionStatus || tenant?.subscription?.status || tenant?.suscripcion?.status || ""
      );
      preapprovalId = String(
        tenant?.subscription?.preapprovalId || tenant?.suscripcion?.preapprovalId || ""
      ).trim();
    }
  } catch (error) {
    // Los permisos del negocio pueden variar por regla; usamos fallback con session.planActual.
    console.warn("No se pudo leer el plan del negocio, se usa fallback de sesion:", error?.message || error);
  }

  let currentPlanId = "";
  for (const value of candidates) {
    const normalized = normalizePlanId(value);
    if (normalized) {
      currentPlanId = normalized;
      break;
    }
  }

  return {
    currentPlanId,
    subscriptionStatus,
    preapprovalId,
    hasPreapproval: Boolean(preapprovalId)
  };
}

function normalizePlans(source) {
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      const id = normalizePlanId(item?.id);
      return {
        id,
        titulo: String(item?.titulo || item?.nombre || id || "").trim(),
        precio: String(item?.precio || item?.precioMensual || "").trim(),
        descripcion: String(item?.descripcion || "").trim(),
        maxEmpleados: resolveMaxEmployees(item),
        caracteristicas: Array.isArray(item?.caracteristicas)
          ? item.caracteristicas.map((entry) => String(entry || "").trim()).filter(Boolean)
          : [],
        activo: toBoolean(item?.activo, true),
        orden: Number(item?.orden || 0)
      };
    })
    .filter((item) => item.activo && Boolean(item.id))
    .sort((a, b) => a.orden - b.orden);
}

function resolveMaxEmployees(item) {
  const value = Number(item?.maxEmpleados ?? item?.maxEmployees ?? item?.empleadosMax ?? item?.limiteEmpleados ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

function renderPlanCards(plans, currentPlanId) {
  plansCards.innerHTML = plans
    .map((plan) => {
      const isCurrent = plan.id === currentPlanId;
      const employeesLine = plan.maxEmpleados > 0 ? `Hasta ${plan.maxEmpleados} empleados` : "Limite de empleados no definido";
      const featuresLine = plan.caracteristicas.length ? plan.caracteristicas.map((entry) => escapeHtml(entry)).join(" | ") : "Sin caracteristicas cargadas";
      return [
        `<article class="plan-card${isCurrent ? " is-selected" : ""}" data-plan-id="${escapeHtml(plan.id)}">`,
        `<span class="plan-card-title">${escapeHtml(plan.titulo || plan.id)}</span>`,
        `<span class="plan-card-price">${escapeHtml(plan.precio || "-")}</span>`,
        `<span class="plan-card-description">${escapeHtml(plan.descripcion || employeesLine)}</span>`,
        `<span class="plan-card-features">${escapeHtml(employeesLine)}</span>`,
        `<span class="plan-card-features">${featuresLine}</span>`,
        isCurrent ? '<span class="plan-card-current">Plan actual</span>' : "",
        "</article>"
      ].join("");
    })
    .join("");
}

function normalizePlanId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("prueba") || raw === "trial") return "prueba";
  if (raw.includes("basico") || raw === "basic" || raw.includes("standard")) return "standard";
  if (raw === "pro" || raw.includes("premium")) return "premium";
  return raw;
}

function toBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function setFeedback(message) {
  if (!plansFeedback) return;
  plansFeedback.textContent = String(message || "");
}

function updateCancelButtonState({ subscriptionStatus, hasPreapproval }) {
  if (!cancelSubscriptionBtn) return;

  const status = normalizeSubscriptionStatus(subscriptionStatus);
  const isCancelled = status === "cancelled";
  const isCancellableState =
    status === "active" ||
    status === "authorized" ||
    status === "pending_authorization" ||
    status === "pending";
  const canCancel = Boolean(hasPreapproval && (isCancellableState || !status));

  if (cancelSubscriptionInProgress) {
    cancelSubscriptionBtn.disabled = true;
    cancelSubscriptionBtn.textContent = "Cancelando suscripcion...";
    return;
  }

  if (isCancelled) {
    cancelSubscriptionBtn.disabled = true;
    cancelSubscriptionBtn.textContent = "Suscripcion cancelada";
    return;
  }

  cancelSubscriptionBtn.disabled = !canCancel;
  cancelSubscriptionBtn.textContent = canCancel
    ? "Cancelar suscripcion"
    : "No hay suscripcion activa para cancelar";
}

async function handleCancelSubscriptionClick() {
  if (cancelSubscriptionInProgress) return;

  const authUser = firebaseAuth.currentUser;
  if (!authUser) {
    setFeedback("Tu sesion expiro. Vuelve a iniciar sesion.");
    return;
  }

  const confirmed = window.confirm(
    "Vas a cancelar la suscripcion de este negocio. Se detendran futuras renovaciones. Deseas continuar?"
  );
  if (!confirmed) return;

  cancelSubscriptionInProgress = true;
  updateCancelButtonState(latestSubscriptionState);

  try {
    const idToken = await authUser.getIdToken();
    const result = await requestCancelSubscription(idToken);
    latestSubscriptionState = {
      subscriptionStatus: normalizeSubscriptionStatus(result?.subscriptionStatus || "cancelled"),
      hasPreapproval: true
    };
    setFeedback(result?.alreadyCancelled ? "Tu suscripcion ya estaba cancelada." : "Suscripcion cancelada correctamente.");
  } catch (error) {
    console.error("No se pudo cancelar la suscripcion:", error);
    setFeedback(mapCancelSubscriptionError(error));
  } finally {
    cancelSubscriptionInProgress = false;
    updateCancelButtonState(latestSubscriptionState);
  }
}

async function requestCancelSubscription(idToken) {
  const response = await fetch(getCancelSubscriptionEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      reason: "cancelada_desde_planes"
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.ok) {
    const backendError = String(result?.error || "").trim().toLowerCase();
    if (response.status === 401) {
      throw new Error("Tu sesion expiro. Vuelve a iniciar sesion.");
    }
    if (response.status === 403) {
      throw new Error("No tienes permisos para cancelar esta suscripcion.");
    }
    if (response.status === 404 || backendError.includes("tenant")) {
      throw new Error("No encontramos el negocio asociado a tu cuenta.");
    }
    if (backendError.includes("preapprovalid") || backendError.includes("suscripcion actual")) {
      throw new Error("No hay una suscripcion activa para cancelar.");
    }
    throw new Error("No pudimos cancelar la suscripcion en este momento. Intenta nuevamente.");
  }
  return result;
}

function getCancelSubscriptionEndpoint() {
  const projectId = String(firebaseConfig?.projectId || "").trim();
  return `https://us-central1-${projectId}.cloudfunctions.net/cancelSubscription`;
}

function normalizeSubscriptionStatus(valueLike) {
  return String(valueLike || "").trim().toLowerCase();
}

function getSubscriptionStatusLabel(statusLike) {
  const status = normalizeSubscriptionStatus(statusLike);
  if (!status) return "";
  if (status === "active" || status === "authorized") return "Activa";
  if (status === "pending" || status === "pending_authorization") return "Pendiente de confirmacion";
  if (status === "cancelled") return "Cancelada";
  if (status === "paused") return "Pausada";
  if (status === "payment_rejected") return "Pago rechazado";
  if (status === "failed" || status === "expired") return "Con incidencia";
  return "En revision";
}

function resolvePlanLabel(plans, currentPlanId) {
  const planId = normalizePlanId(currentPlanId);
  const fromCatalog = Array.isArray(plans)
    ? plans.find((plan) => normalizePlanId(plan?.id) === planId)
    : null;
  const title = String(fromCatalog?.titulo || "").trim();
  if (title) return title;

  if (planId === "prueba") return "Prueba";
  if (planId === "standard") return "Estandar";
  if (planId === "premium") return "Premium";
  if (planId === "admin") return "Admin";
  return "No definido";
}

function mapCancelSubscriptionError(errorLike) {
  const message = String(errorLike?.message || "").trim();
  if (!message) return "No pudimos cancelar la suscripcion. Intenta nuevamente.";
  return message;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
