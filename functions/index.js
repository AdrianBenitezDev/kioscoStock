const { onUserCreated } = require("firebase-functions/v2/auth");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { v4: uuidv4 } = require("uuid");

initializeApp();
const db = getFirestore();

exports.crearKioscoAlRegistrar = onUserCreated(async (event) => {
  const user = event.data;

  const uid = user.uid;
  const email = user.email;

  // Generamos ID único para el kiosco
  const kioscoId = uuidv4();

  // 1️⃣ Crear kiosco
  await db.collection("kioscos").doc(kioscoId).set({
    nombre: "Mi Kiosco",
    ownerUid: uid,
    activo: true,
    createdAt: new Date()
  });

  // 2️⃣ Crear documento usuario
  await db.collection("usuarios").doc(uid).set({
    email: email,
    kioscoId: kioscoId,
    rol: "empleador",
    activo: true,
    createdAt: new Date()
  });

  console.log("Kiosco creado para:", email);
});
