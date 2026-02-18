const { HttpsError, onCall, Timestamp, db } = require("./shared/context");
const { requireEmployerContext } = require("./shared/authz");

const updateEmpleadoProductoPermission = onCall(async (request) => {
  const { tenantId } = await requireEmployerContext(request);

  const uidEmpleado = String(request.data?.uidEmpleado || "").trim();
  const puedeCrearProductos = request.data?.puedeCrearProductos;

  if (!uidEmpleado) {
    throw new HttpsError("invalid-argument", "Falta uidEmpleado.");
  }
  if (typeof puedeCrearProductos !== "boolean") {
    throw new HttpsError("invalid-argument", "puedeCrearProductos debe ser boolean.");
  }

  const empleadoRef = db.collection("empleados").doc(uidEmpleado);
  const empleadoSnap = await empleadoRef.get();
  if (!empleadoSnap.exists) {
    throw new HttpsError("not-found", "No existe el empleado.");
  }

  const empleado = empleadoSnap.data() || {};
  const comercioId = String(empleado.comercioId || empleado.tenantId || "").trim();
  if (!comercioId || comercioId !== tenantId) {
    throw new HttpsError("permission-denied", "No puedes editar un empleado de otro comercio.");
  }

  const now = Timestamp.now();
  const batch = db.batch();
  batch.update(empleadoRef, {
    puedeCrearProductos,
    updatedAt: now
  });

  const legacyRef = db.collection("usuarios").doc(uidEmpleado);
  const legacySnap = await legacyRef.get();
  if (legacySnap.exists) {
    batch.update(legacyRef, {
      puedeCrearProductos,
      updatedAt: now
    });
  }

  await batch.commit();

  return {
    ok: true,
    uidEmpleado,
    puedeCrearProductos
  };
});

module.exports = {
  updateEmpleadoProductoPermission
};

