import { PRODUCT_CATEGORIES } from "./config.js";
import { clearSession, getUserFromSession, seedInitialUsers } from "./auth.js";
import { openDatabase } from "./db.js";
import { dom } from "./dom.js";
import {
  createProduct,
  findProductByBarcodeForCurrentKiosco,
  listProductsForCurrentKiosco,
  updateProductStock
} from "./products.js";
import { isScannerReady, isScannerRunning, startScanner, stopScanner } from "./scanner.js";
import { createKeyboardScanner } from "./keyboard_scanner.js";
import { chargeSale } from "./sales.js";
import { closeTodayShift, getCashSnapshotForToday } from "./cash.js";
import {
  clearAddScanFeedback,
  clearCashFeedback,
  clearScanFeedback,
  clearProductFeedback,
  clearStockFeedback,
  renderCashClosuresTable,
  renderCashClosureStatus,
  renderCashSalesTable,
  renderCashScopeLabel,
  renderCashSummary,
  renderCategoryOptions,
  renderCurrentSale,
  renderStockCategoryOptions,
  renderStockTable,
  setAddScanFeedback,
  setCashFeedback,
  setScanFeedback,
  setStockFeedback,
  setMode,
  setProductFeedbackError,
  setProductFeedbackSuccess,
  showAppShell
} from "./ui.js";

const currentSaleItems = [];
let scannerMode = null;
let currentUser = null;
let allStockProducts = [];
const isMobile = window.matchMedia("(pointer: coarse)").matches;
const keyboardScanner = createKeyboardScanner(handleKeyboardBarcode);

init().catch((error) => {
  console.error(error);
  redirectToLogin();
});

async function init() {
  await openDatabase();
  await seedInitialUsers();

  const user = await getUserFromSession();
  if (!user) {
    redirectToLogin();
    return;
  }
  currentUser = user;

  showAppShell(user);
  renderCategoryOptions(PRODUCT_CATEGORIES);
  renderStockCategoryOptions(PRODUCT_CATEGORIES);
  setupDeviceSpecificUI();
  renderCurrentSale(currentSaleItems);
  await refreshStock();
  await refreshCashPanel();
  wireEvents();
}

function wireEvents() {
  dom.logoutBtn.addEventListener("click", handleLogout);
  dom.addModeBtn.addEventListener("click", () => switchMode("add"));
  dom.sellModeBtn.addEventListener("click", () => switchMode("sell"));
  dom.stockModeBtn.addEventListener("click", async () => {
    await switchMode("stock");
    await refreshStock();
  });
  dom.cashModeBtn.addEventListener("click", async () => {
    await switchMode("cash");
    await refreshCashPanel();
  });
  dom.addProductForm.addEventListener("submit", handleAddProductSubmit);
  dom.stockSearchInput.addEventListener("input", applyStockFilters);
  dom.stockCategoryFilter.addEventListener("change", applyStockFilters);
  dom.startAddScanBtn.addEventListener("click", handleStartAddBarcodeScanner);
  dom.stopAddScanBtn.addEventListener("click", handleStopAddBarcodeScanner);
  dom.startScanBtn.addEventListener("click", handleStartScanner);
  dom.stopScanBtn.addEventListener("click", handleStopScanner);
  dom.startStockScanBtn.addEventListener("click", handleStartStockScanner);
  dom.stopStockScanBtn.addEventListener("click", handleStopStockScanner);
  dom.clearSaleBtn.addEventListener("click", handleClearSale);
  dom.checkoutSaleBtn.addEventListener("click", handleCheckoutSale);
  dom.closeShiftBtn.addEventListener("click", handleCloseShift);
  dom.refreshCashBtn.addEventListener("click", refreshCashPanel);
}

async function handleLogout() {
  await stopAnyScanner();
  keyboardScanner.setEnabled(false);
  clearSession();
  redirectToLogin();
}

async function handleAddProductSubmit(event) {
  event.preventDefault();
  clearProductFeedback();

  const result = await createProduct(new FormData(dom.addProductForm));
  if (!result.ok) {
    setProductFeedbackError(result.error);
    if (result.requiresLogin) {
      redirectToLogin();
    }
    return;
  }

  dom.addProductForm.reset();
  renderCategoryOptions(PRODUCT_CATEGORIES);
  setProductFeedbackSuccess(result.message);
  await refreshStock();
}

async function refreshStock() {
  allStockProducts = await listProductsForCurrentKiosco();
  applyStockFilters();
}

function applyStockFilters() {
  const search = String(dom.stockSearchInput.value || "").trim().toLowerCase();
  const selectedCategory = String(dom.stockCategoryFilter.value || "").trim();

  const filtered = allStockProducts.filter((product) => {
    const matchCategory = !selectedCategory || product.category === selectedCategory;
    const haystack = `${product.barcode || ""} ${product.name || ""}`.toLowerCase();
    const matchSearch = !search || haystack.includes(search);
    return matchCategory && matchSearch;
  });

  renderStockTable(filtered, { canEditStock: currentUser?.role === "dueno" });
  wireStockRowEvents();
}

async function switchMode(mode) {
  if (mode !== "sell" && mode !== "add" && mode !== "stock") {
    await stopAnyScanner();
  }
  if (mode === "add" && scannerMode === "sell") {
    await stopAnyScanner();
  }
  if (mode === "add" && scannerMode === "stock") {
    await stopAnyScanner();
  }
  if (mode === "sell" && scannerMode === "add") {
    await stopAnyScanner();
  }
  if (mode === "sell" && scannerMode === "stock") {
    await stopAnyScanner();
  }
  if (mode === "stock" && scannerMode === "sell") {
    await stopAnyScanner();
  }
  if (mode === "stock" && scannerMode === "add") {
    await stopAnyScanner();
  }
  setMode(mode);
  keyboardScanner.setEnabled(mode === "sell" || mode === "stock");
}

async function handleStartScanner() {
  clearScanFeedback();
  if (!isScannerReady()) {
    setScanFeedback("No se pudo cargar la libreria de escaneo.");
    return;
  }

  try {
    await stopAnyScanner();
    await startScanner({
      elementId: "scanner-reader",
      onCode: handleDetectedCode
    });
    scannerMode = "sell";
    setScanFeedback("Camara iniciada. Escanea un codigo.", "success");
  } catch (error) {
    console.error(error);
    setScanFeedback("No se pudo iniciar la camara. Verifica permisos.");
  }
}

async function handleStopScanner() {
  await stopAnyScanner({ targetMode: "sell", showMessage: true });
}

function handleClearSale() {
  currentSaleItems.length = 0;
  renderCurrentSale(currentSaleItems);
  setScanFeedback("Venta actual limpiada.", "success");
}

async function handleStartAddBarcodeScanner() {
  clearAddScanFeedback();
  if (!isScannerReady()) {
    setAddScanFeedback("No se pudo cargar la libreria de escaneo.");
    return;
  }

  try {
    await stopAnyScanner();
    dom.addScannerReader.classList.remove("hidden");
    await startScanner({
      elementId: "add-scanner-reader",
      onCode: handleDetectedAddBarcode
    });
    scannerMode = "add";
    setAddScanFeedback("Camara iniciada. Escanea el codigo del producto.", "success");
  } catch (error) {
    console.error(error);
    setAddScanFeedback("No se pudo iniciar la camara.");
  }
}

async function handleStopAddBarcodeScanner() {
  await stopAnyScanner({ targetMode: "add", showMessage: true });
}

async function handleDetectedCode(barcode) {
  await processSaleBarcode(barcode);
}

async function processSaleBarcode(barcode) {
  const product = await findProductByBarcodeForCurrentKiosco(barcode);
  if (!product) {
    setScanFeedback(`Codigo ${barcode} no encontrado en stock.`);
    return;
  }

  const existing = currentSaleItems.find((item) => item.productId === product.id);
  const nextQuantity = existing ? existing.quantity + 1 : 1;
  if (nextQuantity > Number(product.stock || 0)) {
    setScanFeedback(`Stock insuficiente para ${product.name}. Disponible: ${product.stock}.`);
    return;
  }

  if (existing) {
    existing.quantity = nextQuantity;
    existing.subtotal = existing.quantity * existing.price;
  } else {
    currentSaleItems.push({
      productId: product.id,
      barcode: product.barcode,
      name: product.name,
      quantity: 1,
      price: Number(product.price || 0),
      subtotal: Number(product.price || 0)
    });
  }

  renderCurrentSale(currentSaleItems);
  setScanFeedback(`Escaneado: ${product.name}`, "success");
}

async function handleCheckoutSale() {
  const result = await chargeSale(currentSaleItems);
  if (!result.ok) {
    setScanFeedback(result.error);
    if (result.requiresLogin) {
      redirectToLogin();
    }
    return;
  }

  currentSaleItems.length = 0;
  renderCurrentSale(currentSaleItems);
  setScanFeedback(
    `Venta cobrada. Items: ${result.itemsCount}. Total: $${result.total.toFixed(2)}. Ganancia: $${result.profit.toFixed(2)}.`,
    "success"
  );
  await refreshStock();
  await refreshCashPanel();
}

async function handleDetectedAddBarcode(barcode) {
  dom.barcodeInput.value = barcode;
  setAddScanFeedback(`Codigo capturado: ${barcode}`, "success");
  await stopAnyScanner({ targetMode: "add" });
}

async function stopAnyScanner({ targetMode = null, showMessage = false } = {}) {
  if (!isScannerRunning()) return;
  if (targetMode && scannerMode !== targetMode) return;

  try {
    await stopScanner();

    if (scannerMode === "add") {
      dom.addScannerReader.classList.add("hidden");
      if (showMessage) setAddScanFeedback("Camara detenida.", "success");
    }

    if (scannerMode === "sell" && showMessage) {
      setScanFeedback("Camara detenida.", "success");
    }
    if (scannerMode === "stock") {
      dom.stockScannerReader.classList.add("hidden");
      if (showMessage) setStockFeedback("Camara detenida.", "success");
    }

    scannerMode = null;
  } catch (error) {
    console.error(error);
    if (targetMode === "add" || scannerMode === "add") {
      setAddScanFeedback("No se pudo detener la camara.");
    } else if (targetMode === "stock" || scannerMode === "stock") {
      setStockFeedback("No se pudo detener la camara.");
    } else {
      setScanFeedback("No se pudo detener la camara.");
    }
  }
}

async function handleStartStockScanner() {
  clearStockFeedback();
  if (!isScannerReady()) {
    setStockFeedback("No se pudo cargar la libreria de escaneo.");
    return;
  }
  try {
    await stopAnyScanner();
    dom.stockScannerReader.classList.remove("hidden");
    await startScanner({
      elementId: "stock-scanner-reader",
      onCode: handleDetectedStockCode
    });
    scannerMode = "stock";
    setStockFeedback("Camara iniciada. Escanea para buscar producto.", "success");
  } catch (error) {
    console.error(error);
    setStockFeedback("No se pudo iniciar la camara.");
  }
}

async function handleStopStockScanner() {
  await stopAnyScanner({ targetMode: "stock", showMessage: true });
}

async function handleDetectedStockCode(barcode) {
  dom.stockSearchInput.value = barcode;
  applyStockFilters();
  setStockFeedback(`Busqueda por codigo: ${barcode}`, "success");
  await stopAnyScanner({ targetMode: "stock" });
}

async function refreshCashPanel() {
  clearCashFeedback();
  dom.closeShiftBtn.disabled = false;
  const snapshot = await getCashSnapshotForToday();
  if (!snapshot.ok) {
    if (snapshot.requiresLogin) {
      redirectToLogin();
      return;
    }
    setCashFeedback(snapshot.error);
    return;
  }

  renderCashScopeLabel(snapshot.scopeLabel);
  renderCashSummary(snapshot.summary);
  renderCashSalesTable(snapshot.sales);
  renderCashClosureStatus(snapshot.todayClosure);
  renderCashClosuresTable(snapshot.recentClosures);
  dom.closeShiftBtn.disabled = Boolean(snapshot.todayClosure);
}

async function handleCloseShift() {
  const result = await closeTodayShift();
  if (!result.ok) {
    if (result.requiresLogin) {
      redirectToLogin();
      return;
    }
    setCashFeedback(result.error);
    return;
  }

  setCashFeedback(
    `Turno cerrado. Debes entregar $${result.summary.totalAmount.toFixed(2)}. Ganancia del dia: $${result.summary.profitAmount.toFixed(2)}.`,
    "success"
  );
  await refreshCashPanel();
}

function wireStockRowEvents() {
  const buttons = document.querySelectorAll("[data-save-stock-id]");
  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const productId = button.getAttribute("data-save-stock-id");
      const input = document.querySelector(`[data-stock-input-id="${productId}"]`);
      if (!input) return;

      const result = await updateProductStock(productId, input.value);
      if (!result.ok) {
        setStockFeedback(result.error);
        if (result.requiresLogin) {
          redirectToLogin();
        }
        return;
      }

      setStockFeedback(result.message, "success");
      await refreshStock();
    });
  });
}

function setupDeviceSpecificUI() {
  const showCameraControls = isMobile;
  dom.addCameraControls.classList.toggle("hidden", !showCameraControls);
  dom.startScanBtn.classList.toggle("hidden", !showCameraControls);
  dom.stopScanBtn.classList.toggle("hidden", !showCameraControls);
  dom.stockCameraControls.classList.toggle("hidden", !showCameraControls);
  dom.saleScannerReader.classList.toggle("hidden", !showCameraControls);
  dom.saleDeviceHint.classList.toggle("hidden", showCameraControls);
}

async function handleKeyboardBarcode(barcode) {
  if (dom.sellPanel && !dom.sellPanel.classList.contains("hidden")) {
    await processSaleBarcode(barcode);
    return;
  }
  if (dom.stockPanel && !dom.stockPanel.classList.contains("hidden")) {
    dom.stockSearchInput.value = barcode;
    applyStockFilters();
    setStockFeedback(`Busqueda por codigo: ${barcode}`, "success");
  }
}

function redirectToLogin() {
  window.location.href = "index.html";
}
