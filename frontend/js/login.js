import { openDatabase } from "./db.js";
import {
  ensureCurrentUserProfile,
  registerBusinessOwner,
  signInWithCredentials,
  signOutUser
} from "./auth.js";
import { ensureFirebaseAuth } from "../config.js";

const registerBtn = document.getElementById("register-business-btn");
const employerBtn = document.getElementById("login-employer-btn");
const employeeBtn = document.getElementById("login-employee-btn");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authEmailInput = document.getElementById("auth-email");
const authPasswordInput = document.getElementById("auth-password");
const loginFeedback = document.getElementById("login-feedback");

let mode = "empleador-login";

init().catch((error) => {
  console.error(error);
  loginFeedback.textContent = "No se pudo iniciar la app.";
});

async function init() {
  await ensureFirebaseAuth();
  await openDatabase();

  const result = await ensureCurrentUserProfile();
  if (result.ok) {
    redirectToPanel();
    return;
  }

  registerBtn?.addEventListener("click", () => setMode("empleador-register"));
  employerBtn?.addEventListener("click", () => setMode("empleador-login"));
  employeeBtn?.addEventListener("click", () => setMode("empleado-login"));
  authForm?.addEventListener("submit", handleSubmit);
  setMode("empleador-login");
}

function setMode(nextMode) {
  mode = nextMode;
  loginFeedback.textContent = "";
  authForm.classList.remove("hidden");

  if (mode === "empleador-register") {
    authTitle.textContent = "Registrar Negocio";
    authSubmitBtn.textContent = "Crear cuenta empleador";
    return;
  }
  if (mode === "empleador-login") {
    authTitle.textContent = "Acceder Empleador";
    authSubmitBtn.textContent = "Ingresar como empleador";
    return;
  }
  authTitle.textContent = "Acceder Empleado";
  authSubmitBtn.textContent = "Ingresar como empleado";
}

async function handleSubmit(event) {
  event.preventDefault();
  loginFeedback.textContent = "";
  setFormDisabled(true);

  const email = String(authEmailInput.value || "").trim().toLowerCase();
  const password = String(authPasswordInput.value || "");

  try {
    if (mode === "empleador-register") {
      const registerResult = await registerBusinessOwner({ email, password });
      if (!registerResult.ok) {
        loginFeedback.textContent = registerResult.error;
        return;
      }
      loginFeedback.textContent = "Negocio registrado correctamente.";
      redirectToPanel();
      return;
    }

    const signInResult = await signInWithCredentials({ email, password });
    if (!signInResult.ok) {
      loginFeedback.textContent = signInResult.error;
      return;
    }

    const profileResult = await ensureCurrentUserProfile();
    if (!profileResult.ok || !profileResult.user) {
      loginFeedback.textContent = profileResult.error || "No se pudo cargar tu perfil.";
      await signOutUser();
      return;
    }

    const expectedRole = mode === "empleador-login" ? "empleador" : "empleado";
    const role = normalizeRole(profileResult.user.tipo || profileResult.user.role);
    const estado = String(profileResult.user.estado || "").trim().toLowerCase();
    const kioscoId = String(profileResult.user.kioscoId || profileResult.user.tenantId || "").trim();

    if (role !== expectedRole || estado !== "activo" || !kioscoId) {
      loginFeedback.textContent = "No tienes permisos para este acceso o tu cuenta no esta activa.";
      await signOutUser();
      return;
    }

    redirectToPanel();
  } catch (error) {
    console.error(error);
    loginFeedback.textContent = "Ocurrio un error al procesar el acceso.";
  } finally {
    setFormDisabled(false);
  }
}

function setFormDisabled(disabled) {
  authEmailInput.disabled = disabled;
  authPasswordInput.disabled = disabled;
  authSubmitBtn.disabled = disabled;
  registerBtn.disabled = disabled;
  employerBtn.disabled = disabled;
  employeeBtn.disabled = disabled;
}

function normalizeRole(roleValue) {
  const role = String(roleValue || "").trim().toLowerCase();
  if (role === "dueno") return "empleador";
  return role;
}

function redirectToPanel() {
  window.location.href = "panel.html";
}
