import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { ensureFirebaseAuth, firestoreDb } from "../config.js";
import { FIRESTORE_COLLECTIONS } from "./config.js";

export async function syncUserToFirestore(user) {
  return safeSync(async () => {
    await ensureFirebaseAuth();
    const ref = doc(firestoreDb, FIRESTORE_COLLECTIONS.usuarios, user.id);
    await setDoc(
      ref,
      {
        kioscoId: user.kioscoId,
        rol: mapRoleToFirestore(user.role),
        email: user.email || `${user.username || user.id}@local.kiosco`,
        username: user.username || null,
        displayName: user.displayName || null,
        activo: true,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }, "syncUserToFirestore");
}

export async function syncLoginEventToFirestore(session) {
  return safeSync(async () => {
    await ensureFirebaseAuth();
    await addDoc(collection(firestoreDb, FIRESTORE_COLLECTIONS.sesiones), {
      kioscoId: session.kioscoId,
      userId: session.userId,
      username: session.username || null,
      role: mapRoleToFirestore(session.role),
      loggedAt: session.loggedAt || new Date().toISOString(),
      createdAt: serverTimestamp()
    });
  }, "syncLoginEventToFirestore");
}

export async function syncProductToFirestore(product) {
  return safeSync(async () => {
    await ensureFirebaseAuth();
    const ref = doc(firestoreDb, FIRESTORE_COLLECTIONS.productos, product.id);
    await setDoc(
      ref,
      {
        kioscoId: product.kioscoId,
        nombre: product.name,
        barcode: product.barcode,
        categoria: product.category || null,
        precio: Number(product.price || 0),
        costoProveedor: Number(product.providerCost || 0),
        stock: Number(product.stock || 0),
        createdBy: product.createdBy || null,
        createdAt: product.createdAt || null,
        updatedAt: product.updatedAt || null,
        updatedBy: product.updatedBy || null,
        syncedAt: serverTimestamp()
      },
      { merge: true }
    );
  }, "syncProductToFirestore");
}

export async function syncSaleToFirestore(sale, items) {
  return safeSync(async () => {
    await ensureFirebaseAuth();
    const saleRef = doc(firestoreDb, FIRESTORE_COLLECTIONS.ventas, sale.id);
    await setDoc(
      saleRef,
      {
        kioscoId: sale.kioscoId,
        userId: sale.userId,
        username: sale.username || null,
        role: mapRoleToFirestore(sale.role),
        total: Number(sale.total || 0),
        totalCost: Number(sale.totalCost || 0),
        profit: Number(sale.profit || 0),
        itemsCount: Number(sale.itemsCount || 0),
        createdAt: sale.createdAt || null,
        syncedAt: serverTimestamp()
      },
      { merge: true }
    );

    const itemWrites = (items || []).map((item) => {
      const itemRef = doc(firestoreDb, FIRESTORE_COLLECTIONS.ventaItems, item.id);
      return setDoc(
        itemRef,
        {
          saleId: sale.id,
          kioscoId: sale.kioscoId,
          userId: sale.userId,
          productId: item.productId,
          barcode: item.barcode,
          nombre: item.name,
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unitPrice || 0),
          subtotal: Number(item.subtotal || 0),
          unitProviderCost: Number(item.unitProviderCost || 0),
          subtotalCost: Number(item.subtotalCost || 0),
          createdAt: item.createdAt || sale.createdAt || null,
          syncedAt: serverTimestamp()
        },
        { merge: true }
      );
    });

    await Promise.all(itemWrites);
  }, "syncSaleToFirestore");
}

export async function syncCashClosureToFirestore(closure) {
  return safeSync(async () => {
    await ensureFirebaseAuth();
    const ref = doc(firestoreDb, FIRESTORE_COLLECTIONS.cierres, closure.id);
    await setDoc(
      ref,
      {
        kioscoId: closure.kioscoId,
        userId: closure.userId,
        role: mapRoleToFirestore(closure.role),
        username: closure.username || null,
        dateKey: closure.dateKey,
        totalAmount: Number(closure.totalAmount || 0),
        totalCost: Number(closure.totalCost || 0),
        profitAmount: Number(closure.profitAmount || 0),
        salesCount: Number(closure.salesCount || 0),
        itemsCount: Number(closure.itemsCount || 0),
        closureKey: closure.closureKey,
        createdAt: closure.createdAt || null,
        syncedAt: serverTimestamp()
      },
      { merge: true }
    );
  }, "syncCashClosureToFirestore");
}

function mapRoleToFirestore(role) {
  if (role === "dueno") return "empleador";
  return "empleado";
}

async function safeSync(fn, label) {
  try {
    await fn();
    return true;
  } catch (error) {
    console.warn(`${label} fallo:`, error?.message || error);
    return false;
  }
}
