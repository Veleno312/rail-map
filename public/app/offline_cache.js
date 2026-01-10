const OFFLINE_DB_NAME = "rail-sim-offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_STORE_NAME = "cache";

function openOfflineDB() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB not supported"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        db.createObjectStore(OFFLINE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, mode);
    const store = tx.objectStore(OFFLINE_STORE_NAME);
    const req = callback(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function datasetKey(prefix, datasetVersion) {
  return `${prefix}:${datasetVersion || "unknown"}`;
}

async function offlineCache_putEntry(key, value) {
  const payload = {
    key,
    value,
    storedAt: new Date().toISOString()
  };
  await withStore("readwrite", (store) => store.put(payload));
  return payload;
}

async function offlineCache_getEntry(key) {
  return withStore("readonly", (store) => store.get(key));
}

async function offlineCache_getAll(prefix) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, "readonly");
    const store = tx.objectStore(OFFLINE_STORE_NAME);
    const entries = [];
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        entries.sort((a,b) => (b.storedAt || "").localeCompare(a.storedAt || ""));
        resolve(entries);
        return;
      }
      if (cursor.key.startsWith(prefix)) {
        entries.push(cursor.value);
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function offlineCache_clear() {
  return withStore("readwrite", (store) => store.clear());
}

function normalizeDatasetVersion(source) {
  return String(source || "").trim() || "unknown";
}

async function offlineCache_saveManifest(manifest) {
  if (!manifest || !manifest.datasetVersion) {
    throw new Error("Manifest missing datasetVersion");
  }
  const key = datasetKey("manifest", normalizeDatasetVersion(manifest.datasetVersion));
  return offlineCache_putEntry(key, manifest);
}

async function offlineCache_savePack(pack) {
  const version =
    pack?.manifest?.datasetVersion ||
    pack?.meta?.datasetVersion ||
    pack?.datasetVersion;
  if (!version) {
    throw new Error("Pack missing datasetVersion");
  }
  const key = datasetKey("pack", normalizeDatasetVersion(version));
  return offlineCache_putEntry(key, pack);
}

async function offlineCache_getLatestManifest() {
  const entries = await offlineCache_getAll("manifest:");
  return entries[0] || null;
}

async function offlineCache_getPackForDataset(datasetVersion) {
  const key = datasetKey("pack", normalizeDatasetVersion(datasetVersion));
  const entry = await offlineCache_getEntry(key);
  return entry || null;
}

async function offlineCache_listManifests() {
  return offlineCache_getAll("manifest:");
}

window.offlineCache_saveManifest = offlineCache_saveManifest;
window.offlineCache_savePack = offlineCache_savePack;
window.offlineCache_getLatestManifest = offlineCache_getLatestManifest;
window.offlineCache_getPackForDataset = offlineCache_getPackForDataset;
window.offlineCache_listManifests = offlineCache_listManifests;
window.offlineCache_clear = offlineCache_clear;
