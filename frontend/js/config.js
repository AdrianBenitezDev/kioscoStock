export const DB_NAME = "kioscoStockDB";
export const DB_VERSION = 7;

export const STORES = {
  users: "users",
  products: "products",
  sales: "sales",
  saleItems: "saleItems",
  cashClosures: "cashClosures",
  businessCatalog: "businessCatalog"
};

export const FIRESTORE_COLLECTIONS = {
  tenants: "tenants",
  usuarios: "usuarios",
  empleados: "empleados",
  productos: "productos",
  ventas: "ventas",
  ventaItems: "venta_items",
  cierres: "cierres",
  sesiones: "sesiones"
};

export const BUSINESS_CATALOG_DOC_PATH = {
  collection: "configuraciones",
  docId: "catalogo_negocios"
};

export const DEFAULT_BUSINESS_TYPE_ID = "kiosco";
export const CUSTOM_BUSINESS_TYPE_ID = "custom";
export const BUSINESS_CUSTOM_LABEL_MAX = 30;

export const DEFAULT_PRODUCT_CATEGORIES = [
  "Bebidas",
  "Bebidas Alcoholicas",
  "Almacen",
  "Golosinas",
  "Snacks",
  "Cigarrillos",
  "Limpieza",
  "Perfumeria",
  "Lacteos",
  "Panificados",
  "Congelados",
  "Enlatados",
  "Fiambreria",
  "Articulos Escolares",
  "Recargas",
  "Otros"
];
