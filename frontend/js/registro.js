import { ensureFirebaseAuth, firebaseConfig } from "../config.js";
import {
  createAuthUserForRegistration,
  ensureCurrentUserProfile,
  rollbackAuthUserIfNeeded,
  signOutUser
} from "./auth.js";
import { openDatabase } from "./db.js";

const registerForm = document.getElementById("register-form");
const registerSubmitBtn = document.getElementById("register-submit-btn");
const backLoginBtn = document.getElementById("back-login-btn");
const registerFeedback = document.getElementById("register-feedback");
const countrySelect = document.getElementById("register-country");
const provinceSelect = document.getElementById("register-province");
const phoneInput = document.getElementById("register-phone");

const COUNTRY_PROVINCES = {
  AR: ["Buenos Aires", "CABA", "Cordoba", "Santa Fe", "Mendoza", "Tucuman"],
  UY: ["Montevideo", "Canelones", "Maldonado", "Colonia", "Salto"],
  CL: ["Santiago", "Valparaiso", "Biobio", "Araucania", "Antofagasta"],
  MX: ["CDMX", "Jalisco", "Nuevo Leon", "Puebla", "Yucatan"],
  ES: ["Madrid", "Cataluna", "Andalucia", "Valencia", "Galicia"]
};

init().catch((error) => {
  console.error(error);
  registerFeedback.textContent = "No se pudo iniciar el registro.";
});

async function init() {
  await ensureFirebaseAuth();
  await openDatabase();

  const result = await ensureCurrentUserProfile();
  if (result.ok) {
    window.location.href = "panel.html";
    return;
  }

  renderCountryOptions();
  countrySelect?.addEventListener("change", renderProvinceOptions);
  phoneInput?.addEventListener("input", () => {
    phoneInput.value = String(phoneInput.value || "").replace(/\D/g, "");
  });
  registerForm?.addEventListener("submit", handleRegisterSubmit);
  backLoginBtn?.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

function renderCountryOptions() {
  const options = [
    '<option value="">Selecciona un pais</option>',
    '<option value="AR">Argentina</option>',
    '<option value="UY">Uruguay</option>',
    '<option value="CL">Chile</option>',
    '<option value="MX">Mexico</option>',
    '<option value="ES">Espana</option>'
  ];
  countrySelect.innerHTML = options.join("");
  renderProvinceOptions();
}

function renderProvinceOptions() {
  const selected = String(countrySelect.value || "").trim();
  const provinces = COUNTRY_PROVINCES[selected] || [];
  provinceSelect.innerHTML = [
    '<option value="">Selecciona una provincia/estado</option>',
    ...provinces.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
  ].join("");
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  clearFieldErrors();
  registerFeedback.textContent = "";
  setDisabled(true);

  const payload = getFormPayload();
  const validation = validatePayload(payload);
  if (!validation.ok) {
    applyFieldErrors(validation.fieldErrors);
    registerFeedback.textContent = "Revisa los campos marcados.";
    setDisabled(false);
    return;
  }

  const authResult = await createAuthUserForRegistration({
    email: payload.email,
    password: payload.password
  });
  if (!authResult.ok) {
    registerFeedback.textContent = authResult.error;
    setDisabled(false);
    return;
  }

  try {
    const response = await fetch(getRegisterEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authResult.idToken}`
      },
      body: JSON.stringify({
        nombreApellido: payload.nombreApellido,
        email: payload.email,
        telefono: payload.telefono,
        nombreKiosco: payload.nombreKiosco,
        pais: payload.pais,
        provinciaEstado: payload.provinciaEstado,
        distrito: payload.distrito,
        localidad: payload.localidad,
        domicilio: payload.domicilio,
        plan: payload.plan
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (result?.fieldErrors) {
        applyFieldErrors(result.fieldErrors);
      }
      registerFeedback.textContent = result?.error || "No se pudo completar el registro.";
      await rollbackAuthUserIfNeeded();
      await signOutUser();
      setDisabled(false);
      return;
    }

    registerFeedback.textContent = "Negocio registrado correctamente.";
    window.location.href = "panel.html";
  } catch (error) {
    console.error(error);
    registerFeedback.textContent = "Error de red al registrar negocio.";
    await rollbackAuthUserIfNeeded();
    await signOutUser();
    setDisabled(false);
  }
}

function getFormPayload() {
  const formData = new FormData(registerForm);
  return {
    nombreApellido: String(formData.get("nombreApellido") || "").trim(),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    telefono: String(formData.get("telefono") || "").trim(),
    password: String(formData.get("password") || ""),
    nombreKiosco: String(formData.get("nombreKiosco") || "").trim(),
    pais: String(formData.get("pais") || "").trim(),
    provinciaEstado: String(formData.get("provinciaEstado") || "").trim(),
    distrito: String(formData.get("distrito") || "").trim(),
    localidad: String(formData.get("localidad") || "").trim(),
    domicilio: String(formData.get("domicilio") || "").trim(),
    plan: String(formData.get("plan") || "").trim()
  };
}

function validatePayload(payload) {
  const fieldErrors = {};
  if (!/^[A-Za-zÀ-ÿ\s]{3,80}$/.test(payload.nombreApellido)) {
    fieldErrors.nombreApellido = "Nombre y apellido invalido.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    fieldErrors.email = "Email invalido.";
  }
  if (!/^\d{6,20}$/.test(payload.telefono)) {
    fieldErrors.telefono = "Telefono invalido. Solo numeros.";
  }
  if (payload.password.length < 6) {
    fieldErrors.password = "La contrasena debe tener al menos 6 caracteres.";
  }
  if (!payload.nombreKiosco) {
    fieldErrors.nombreKiosco = "Nombre del kiosco obligatorio.";
  }
  if (!payload.pais) {
    fieldErrors.pais = "Pais obligatorio.";
  }
  if (!payload.provinciaEstado) {
    fieldErrors.provinciaEstado = "Provincia/Estado obligatorio.";
  }
  if (!payload.distrito) {
    fieldErrors.distrito = "Distrito obligatorio.";
  }
  if (!payload.localidad) {
    fieldErrors.localidad = "Localidad obligatoria.";
  }
  if (!payload.domicilio) {
    fieldErrors.domicilio = "Domicilio obligatorio.";
  }
  if (!["prueba", "standard", "premium"].includes(payload.plan.toLowerCase())) {
    fieldErrors.plan = "Selecciona un plan valido.";
  }

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors
  };
}

function applyFieldErrors(fieldErrors) {
  Object.entries(fieldErrors || {}).forEach(([key, message]) => {
    const node = document.getElementById(`err-${key}`);
    if (node) node.textContent = message;
  });
}

function clearFieldErrors() {
  const nodes = registerForm.querySelectorAll("[id^='err-']");
  nodes.forEach((node) => {
    node.textContent = "";
  });
}

function setDisabled(disabled) {
  const controls = registerForm.querySelectorAll("input, select, button");
  controls.forEach((node) => {
    node.disabled = disabled;
  });
}

function getRegisterEndpoint() {
  const projectId = String(firebaseConfig?.projectId || "").trim();
  return `https://us-central1-${projectId}.cloudfunctions.net/registerEmployerProfile`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
