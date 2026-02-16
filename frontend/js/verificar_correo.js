import { applyActionCode, reload } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ensureFirebaseAuth, firebaseAuth, firebaseConfig } from "../config.js";

const targetNode = document.getElementById("verify-email-target");
const statusNode = document.getElementById("verify-status");
const refreshBtn = document.getElementById("verify-refresh-btn");
const loginBtn = document.getElementById("verify-login-btn");

init().catch((error) => {
  console.error(error);
  statusNode.textContent = "No se pudo iniciar la verificacion.";
});

async function init() {
  await ensureFirebaseAuth();

  const params = new URLSearchParams(window.location.search);
  const email = String(params.get("email") || firebaseAuth.currentUser?.email || "").trim();
  const status = String(params.get("status") || "").trim().toLowerCase();
  const mode = String(params.get("mode") || "").trim();
  const oobCode = String(params.get("oobCode") || "").trim();

  targetNode.innerHTML = `<strong>Correo:</strong> ${escapeHtml(email || "-")}`;

  if (status === "error") {
    statusNode.textContent = "No se pudo enviar el correo automaticamente. Intenta de nuevo desde el login.";
  } else {
    statusNode.textContent = "Te enviamos un correo para verificar tu cuenta.";
  }

  if (mode === "verifyEmail" && oobCode) {
    await applyEmailVerificationCode(oobCode);
  }

  refreshBtn?.addEventListener("click", async () => {
    await syncVerifiedEmailStatus();
  });
  loginBtn?.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

async function applyEmailVerificationCode(oobCode) {
  try {
    await applyActionCode(firebaseAuth, oobCode);
    statusNode.textContent = "Correo verificado en Firebase. Actualizando tu perfil...";
    await syncVerifiedEmailStatus();
  } catch (error) {
    console.error(error);
    statusNode.textContent = "El enlace de verificacion no es valido o ya expiro.";
  }
}

async function syncVerifiedEmailStatus() {
  const authUser = firebaseAuth.currentUser;
  if (!authUser) {
    statusNode.textContent = "Inicia sesion para completar la verificacion del perfil.";
    return;
  }

  try {
    await reload(authUser);
    if (!authUser.emailVerified) {
      statusNode.textContent = "Tu correo aun no figura verificado. Revisa el enlace del email.";
      return;
    }

    const idToken = await authUser.getIdToken(true);
    const response = await fetch(getMarkVerifiedEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      statusNode.textContent = result?.error || "No se pudo actualizar el estado de verificacion.";
      return;
    }

    statusNode.textContent = "Correo verificado correctamente. Ya puedes ingresar al panel.";
  } catch (error) {
    console.error(error);
    statusNode.textContent = "Fallo la validacion de correo. Intenta nuevamente.";
  }
}

function getMarkVerifiedEndpoint() {
  const projectId = String(firebaseConfig?.projectId || "").trim();
  return `https://us-central1-${projectId}.cloudfunctions.net/markEmployerEmailVerified`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
