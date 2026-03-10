const { onRequest, Timestamp, adminAuth, db } = require("./shared/context");
const { sendSubscriptionStatusEmail } = require("./sendSubscriptionStatusEmail");

const ALLOWED_ORIGINS = new Set([
  "https://admin.stockfacil.com.ar",
  "https://stockfacil.com.ar",
  "https://www.stockfacil.com.ar"
]);

const cancelSubscription = onRequest(
  { secrets: ["MERCADOPAGO_ACCESS_TOKEN", "RESEND_API_KEY"] },
  async (req, res) => {
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

      const userRef = db.collection("usuarios").doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        res.status(403).json({ ok: false, error: "Tu usuario no existe en la base." });
        return;
      }

      const userData = userSnap.data() || {};
      const role = normalizeRole(userData.role || userData.tipo || decoded.role || "");
      const tenantId = String(decoded.tenantId || userData.tenantId || userData.kioscoId || "").trim();
      if (role !== "empleador" || !tenantId) {
        res.status(403).json({ ok: false, error: "Solo el empleador puede cancelar la suscripcion." });
        return;
      }

      const tenantRef = db.collection("tenants").doc(tenantId);
      const tenantSnap = await tenantRef.get();
      if (!tenantSnap.exists) {
        res.status(404).json({ ok: false, error: "No se encontro el tenant." });
        return;
      }

      const tenantData = tenantSnap.data() || {};
      const ownerUid = String(tenantData.ownerUid || "").trim();
      if (ownerUid && ownerUid !== uid) {
        res.status(403).json({ ok: false, error: "No eres el owner del tenant." });
        return;
      }

      const reason = String(req.body?.reason || req.body?.motivoCancelacion || "").trim();
      const tenantSubscription = asObject(tenantData.subscription);
      const userSubscription = asObject(userData.subscription);
      const preapprovalId = String(
        tenantSubscription.preapprovalId || userSubscription.preapprovalId || ""
      ).trim();
      const currentStatus = normalizeStatus(
        tenantSubscription.status ||
          tenantData.subscriptionStatus ||
          userSubscription.status ||
          userData.subscriptionStatus ||
          ""
      );

      if (currentStatus === "cancelled") {
        res.status(200).json({
          ok: true,
          alreadyCancelled: true,
          tenantId,
          preapprovalId,
          subscriptionStatus: "cancelled"
        });
        return;
      }

      if (!preapprovalId) {
        res.status(400).json({
          ok: false,
          error: "No se encontro preapprovalId para la suscripcion actual."
        });
        return;
      }

      const mpPreapproval = await updateMercadoPagoPreapprovalStatus({
        preapprovalId,
        status: "cancelled"
      });
      const providerStatus = normalizeStatus(mpPreapproval?.status || "", "cancelled");
      if (providerStatus !== "cancelled") {
        throw {
          status: 502,
          message: `Mercado Pago devolvio estado inesperado al cancelar: ${providerStatus || "desconocido"}`
        };
      }

      const now = Timestamp.now();
      const normalizedPlanId = normalizePlanId(
        tenantSubscription.planId ||
          tenantData.plan ||
          tenantData.planId ||
          userData.plan ||
          userSubscription.planId ||
          ""
      );
      const provider = String(
        tenantSubscription.provider || userSubscription.provider || "mercadopago"
      )
        .trim()
        .toLowerCase();

      const nextTenantSubscription = {
        ...tenantSubscription,
        provider,
        status: "cancelled",
        preapprovalId,
        planId: normalizedPlanId,
        cancelReason: reason,
        cancelledAt: now,
        cancelledByUid: uid,
        lastProviderStatus: providerStatus,
        updatedAt: now
      };
      const nextUserSubscription = {
        ...userSubscription,
        provider,
        status: "cancelled",
        preapprovalId,
        planId: normalizedPlanId,
        cancelReason: reason,
        cancelledAt: now,
        updatedAt: now
      };

      const batch = db.batch();
      batch.set(
        tenantRef,
        {
          subscription: nextTenantSubscription,
          subscriptionStatus: "cancelled",
          updatedAt: now
        },
        { merge: true }
      );
      batch.set(
        userRef,
        {
          subscription: nextUserSubscription,
          subscriptionStatus: "cancelled",
          updatedAt: now
        },
        { merge: true }
      );
      await batch.commit();

      let emailError = "";
      const recipient = String(userData.email || decoded.email || "").trim().toLowerCase();
      if (recipient) {
        try {
          await sendSubscriptionStatusEmail({
            to: recipient,
            registrationId: tenantId,
            planId: normalizedPlanId,
            businessName: String(tenantData.nombreKiosco || "").trim(),
            registrationStatus: "activated",
            subscriptionStatus: "cancelled",
            errorReason: reason
          });
        } catch (error) {
          emailError = String(error?.message || "email_error");
          console.error("cancelSubscription: fallo envio email de cancelacion", {
            tenantId,
            preapprovalId,
            error: emailError
          });
        }
      }

      if (emailError) {
        await tenantRef
          .set(
            {
              subscriptionLastEmailError: emailError,
              updatedAt: Timestamp.now()
            },
            { merge: true }
          )
          .catch(() => null);
      }

      res.status(200).json({
        ok: true,
        tenantId,
        preapprovalId,
        subscriptionStatus: "cancelled",
        alreadyCancelled: false,
        emailError: emailError || null
      });
    } catch (error) {
      console.error("cancelSubscription fallo:", error);
      const status = Number(error?.status || 500);
      res.status(status).json({ ok: false, error: error?.message || "No se pudo cancelar la suscripcion." });
    }
  }
);

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

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeStatus(valueLike, fallback = "") {
  const value = String(valueLike || "").trim().toLowerCase();
  return value || String(fallback || "").trim().toLowerCase();
}

function normalizePlanId(valueLike) {
  return String(valueLike || "").trim().toLowerCase();
}

function normalizeRole(valueLike) {
  const value = String(valueLike || "").trim().toLowerCase();
  return value === "dueno" ? "empleador" : value;
}

async function updateMercadoPagoPreapprovalStatus({ preapprovalId, status }) {
  const accessToken = String(process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    throw { status: 500, message: "Falta MERCADOPAGO_ACCESS_TOKEN en la configuracion." };
  }

  const targetId = String(preapprovalId || "").trim();
  if (!targetId) {
    throw { status: 400, message: "preapprovalId invalido para cancelacion." };
  }

  const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(targetId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: String(status || "").trim().toLowerCase() })
  });

  const text = await response.text().catch(() => "");
  const payload = safeParseJson(text);
  if (!response.ok) {
    const detail =
      String(payload?.message || payload?.error || text || "").trim() || `HTTP ${response.status}`;
    throw { status: 502, message: `Mercado Pago rechazo la cancelacion: ${detail}` };
  }

  return payload || {};
}

function safeParseJson(valueLike) {
  try {
    return JSON.parse(String(valueLike || ""));
  } catch (_) {
    return null;
  }
}

module.exports = {
  cancelSubscription
};
