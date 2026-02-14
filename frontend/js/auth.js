import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDocs,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  where,
  collection
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { ensureFirebaseAuth, firebaseApp, firebaseAuth, firestoreDb } from "../config.js";
import { FIRESTORE_COLLECTIONS } from "./config.js";
import { syncLoginEventToFirestore } from "./firebase_sync.js";

let currentSession = null;
let loginSyncedForUid = null;

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const functions = getFunctions(firebaseApp);
const bootstrapGoogleUserCallable = httpsCallable(functions, "bootstrapGoogleUser");

export async function registerBusinessOwner({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) {
    return { ok: false, error: "Completa email y contrasena." };
  }
  if (normalizedPassword.length < 6) {
    return { ok: false, error: "La contrasena debe tener al menos 6 caracteres." };
  }

  await ensureFirebaseAuth();
  try {
    const existingByEmail = await getDocs(
      query(collection(firestoreDb, FIRESTORE_COLLECTIONS.usuarios), where("email", "==", normalizedEmail))
    );
    if (!existingByEmail.empty) {
      return { ok: false, error: "Este usuario ya esta registrado." };
    }

    const credential = await createUserWithEmailAndPassword(
      firebaseAuth,
      normalizedEmail,
      normalizedPassword
    );
    const authUser = credential.user;
    const kioscoId = `K-${Date.now()}`;
    const profileRef = doc(firestoreDb, FIRESTORE_COLLECTIONS.usuarios, authUser.uid);
    await setDoc(profileRef, {
      uid: authUser.uid,
      email: normalizedEmail,
      tipo: "empleador",
      role: "empleador",
      kioscoId,
      tenantId: kioscoId,
      estado: "activo",
      activo: true,
      fechaCreacion: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { ok: true, kioscoId };
  } catch (error) {
    const message = String(error?.message || "");
    const code = String(error?.code || "");
    if (code.includes("email-already-in-use")) {
      return { ok: false, error: "Este usuario ya esta registrado." };
    }
    if (code.includes("invalid-email")) {
      return { ok: false, error: "Email invalido." };
    }
    if (code.includes("weak-password")) {
      return { ok: false, error: "La contrasena es demasiado debil." };
    }
    return { ok: false, error: message || "No se pudo registrar el negocio." };
  }
}

export async function signInWithCredentials({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) {
    return { ok: false, error: "Completa email y contrasena." };
  }

  await ensureFirebaseAuth();
  try {
    await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, normalizedPassword);
    return { ok: true };
  } catch (error) {
    const code = String(error?.code || "");
    if (code.includes("invalid-credential") || code.includes("wrong-password")) {
      return { ok: false, error: "Credenciales invalidas." };
    }
    if (code.includes("user-disabled")) {
      return { ok: false, error: "Usuario deshabilitado." };
    }
    if (code.includes("user-not-found")) {
      return { ok: false, error: "Usuario no encontrado." };
    }
    return { ok: false, error: "No se pudo iniciar sesion." };
  }
}

export async function signInWithGoogle() {
  await ensureFirebaseAuth();
  await signInWithPopup(firebaseAuth, provider);
}

export async function signOutUser() {
  currentSession = null;
  loginSyncedForUid = null;
  await signOut(firebaseAuth);
}

export function getCurrentSession() {
  const authUser = firebaseAuth.currentUser;
  if (!authUser || !currentSession || currentSession.uid !== authUser.uid) {
    currentSession = null;
    return null;
  }
  return currentSession;
}

export async function ensureCurrentUserProfile() {
  await ensureFirebaseAuth();
  const authUser = firebaseAuth.currentUser;
  if (!authUser) {
    currentSession = null;
    return { ok: false, error: "No hay sesion iniciada.", requiresLogin: true };
  }

  // Para cuentas Google legacy, intenta bootstrap de claims sin bloquear login por email/password.
  try {
    await bootstrapGoogleUserCallable({});
  } catch (_) {
    // no-op
  }

  const profileRef = doc(firestoreDb, FIRESTORE_COLLECTIONS.usuarios, authUser.uid);
  const profileSnap = await getDoc(profileRef);
  if (!profileSnap.exists()) {
    currentSession = null;
    return {
      ok: false,
      error: "No existe perfil de usuario en Firestore."
    };
  }

  const profile = profileSnap.data() || {};
  const tenantId = String(profile.kioscoId || profile.tenantId || "").trim();
  const role = String(profile.tipo || profile.role || "empleado").trim();
  const estado = String(profile.estado || (profile.activo === false ? "inactivo" : "activo")).trim();

  if (!tenantId) {
    currentSession = null;
    return { ok: false, error: "El perfil no tiene kioscoId valido." };
  }

  currentSession = {
    userId: authUser.uid,
    uid: authUser.uid,
    email: authUser.email || profile.email || "",
    displayName: profile.displayName || authUser.displayName || authUser.email || "Usuario",
    role,
    tipo: role,
    tenantId,
    kioscoId: tenantId,
    estado,
    username: profile.username || authUser.email || authUser.uid,
    loggedAt: new Date().toISOString()
  };

  if (loginSyncedForUid !== authUser.uid) {
    await syncLoginEventToFirestore(currentSession);
    loginSyncedForUid = authUser.uid;
  }

  return { ok: true, user: currentSession };
}
