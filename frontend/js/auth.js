import { DEFAULT_KIOSCO_ID, SEED_USERS, SESSION_KEY } from "./config.js";
import { getAllUsers, getUserByKioscoAndUsername, putUser } from "./db.js";
import { syncLoginEventToFirestore, syncUserToFirestore } from "./firebase_sync.js";
import { hashText } from "./utils.js";

export async function seedInitialUsers() {
  const users = await getAllUsers();
  const usersById = new Map(users.map((user) => [user.id, user]));

  for (const user of SEED_USERS) {
    const existing = usersById.get(user.id);
    const passwordHash = await hashText(user.password);
    await putUser({
      id: user.id,
      kioscoId: user.kioscoId,
      username: user.username,
      passwordHash,
      role: user.role,
      displayName: user.displayName,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await syncUserToFirestore({
      id: user.id,
      kioscoId: user.kioscoId,
      username: user.username,
      role: user.role,
      displayName: user.displayName
    });
  }
}

export function getCurrentSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function authenticate(usernameInput, passwordInput) {
  const username = String(usernameInput || "").trim().toLowerCase();
  const password = String(passwordInput || "");

  if (!username || !password) {
    return { ok: false, error: "Completa usuario y contrasena." };
  }

  const user = await getUserByKioscoAndUsername(DEFAULT_KIOSCO_ID, username);
  if (!user) {
    return { ok: false, error: "Usuario o contrasena incorrectos." };
  }

  const candidateHash = await hashText(password);
  if (candidateHash !== user.passwordHash) {
    return { ok: false, error: "Usuario o contrasena incorrectos." };
  }

  const session = {
    userId: user.id,
    kioscoId: user.kioscoId,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    loggedAt: new Date().toISOString()
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  await syncLoginEventToFirestore(session);
  return { ok: true, user };
}

export async function getUserFromSession() {
  const session = getCurrentSession();
  if (!session) return null;
  return getUserByKioscoAndUsername(session.kioscoId, session.username);
}
