import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDyYK9NtitNWkIiK-UIPUKCZ3PwJ1a10t0",
  authDomain: "kiosco-stock-493c6.firebaseapp.com",
  projectId: "kiosco-stock-493c6",
  storageBucket: "kiosco-stock-493c6.firebasestorage.app",
  messagingSenderId: "997147264141",
  appId: "1:997147264141:web:be41c9744767e474750ec4"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firestoreDb = getFirestore(firebaseApp);

let authReadyPromise = null;

export async function ensureFirebaseAuth() {
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser;
  if (!authReadyPromise) {
    authReadyPromise = signInAnonymously(firebaseAuth)
      .then((result) => result.user)
      .catch((error) => {
        console.warn("Firebase auth anonimo no disponible:", error?.message || error);
        return null;
      });
  }
  return authReadyPromise;
}
