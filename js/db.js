/**
 * Módulo de Base de Datos Local Cifrada (IndexedDB)
 * Todos los datos confidenciales (geolocalización, notas, auditoría) se almacenan
 * como texto cifrado (AES-GCM 256) antes de tocar el almacenamiento del navegador.
 */

class SecureStorage {
  constructor() {
    this.dbName = 'ClinicaPWA_Vault_v1';
    this.dbVersion = 1;
    this.db = null;
  }

  /**
   * Abre la base de datos IndexedDB y crea las tablas/índices necesarios
   */
  async init() {
    if (this.db) return this.db;

    // Solicitar almacenamiento persistente en Safari/iOS para mitigar la purga de 7 días
    if (navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Storage] Almacenamiento persistente activado: ${isPersisted}`);
      } catch (err) {
        console.warn('[Storage] No se pudo solicitar persistencia:', err);
      }
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Tabla de credenciales de seguridad (salt, verificador de password, token biométrico)
        if (!db.objectStoreNames.contains('credentials')) {
          db.createObjectStore('credentials', { keyPath: 'id' });
        }

        // Tabla de registros de jornada laboral
        if (!db.objectStoreNames.contains('records')) {
          const recordStore = db.createObjectStore('records', { keyPath: 'id' });
          recordStore.createIndex('by_timestamp', 'timestamp', { unique: false });
          recordStore.createIndex('by_type', 'type', { unique: false });
          recordStore.createIndex('by_deleted', 'isDeleted', { unique: false });
        }

        // Tabla de bitácora de auditoría inmutable (append-only)
        if (!db.objectStoreNames.contains('audit_logs')) {
          const auditStore = db.createObjectStore('audit_logs', { keyPath: 'id' });
          auditStore.createIndex('by_recordId', 'recordId', { unique: false });
          auditStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        }

        // Tabla de configuración de la app
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(new Error(`Error al abrir IndexedDB: ${event.target.error}`));
      };
    });
  }

  /**
   * Ejecuta una transacción genérica en un store
   */
  async getStore(storeName, mode = 'readonly') {
    await this.init();
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  // ==========================================
  // GESTIÓN DE SEGURIDAD / CREDENCIALES
  // ==========================================

  async getCredentials() {
    const store = await this.getStore('credentials', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get('master_credential');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCredentials(credData) {
    const store = await this.getStore('credentials', 'readwrite');
    return new Promise((resolve, reject) => {
      const data = { id: 'master_credential', ...credData, updatedAt: Date.now() };
      const req = store.put(data);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // ==========================================
  // CONFIGURACIÓN DE LA APP (SETTINGS)
  // ==========================================

  async getSetting(key, defaultValue = null) {
    const store = await this.getStore('settings', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : defaultValue);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async setSetting(key, value) {
    const store = await this.getStore('settings', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ key, value, updatedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllSettings() {
    const store = await this.getStore('settings', 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const result = {};
        (req.result || []).forEach(item => {
          result[item.key] = item.value;
        });
        resolve(result);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ==========================================
  // REGISTROS DE JORNADA (CIFRADO EN REPOSO)
  // ==========================================

  /**
   * Guarda un nuevo registro de Entrada o Salida cifrando los detalles sensibles
   */
  async addRecord({ type, timestamp, payload, source = 'BUTTON', reason = '' }) {
    if (!window.cryptoEngine.isUnlocked()) {
      throw new Error('No es posible guardar: la bóveda está bloqueada.');
    }

    const recordId = 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    
    // Cifrar datos de ubicación, notas y contexto con AES-GCM
    const encryptedPayload = await window.cryptoEngine.encryptData({
      ...payload,
      source,
      recordedAt: new Date().toISOString()
    });

    const record = {
      id: recordId,
      timestamp: Number(timestamp) || Date.now(),
      type: type, // 'ENTRY' | 'EXIT'
      encryptedPayload: encryptedPayload.ciphertext,
      iv: encryptedPayload.iv,
      isDeleted: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const store = await this.getStore('records', 'readwrite');
    await new Promise((resolve, reject) => {
      const req = store.add(record);
      req.onsuccess = () => resolve(recordId);
      req.onerror = () => reject(req.error);
    });

    // Guardar en bitácora de auditoría
    await this.addAuditLog({
      recordId,
      action: source === 'MANUAL' ? 'MANUAL_CREATE' : 'CREATE',
      reason: reason || (source === 'MANUAL' ? 'Registro manual inicial' : 'Marcación de botón'),
      previousData: null,
      newData: { type, timestamp: record.timestamp, payload }
    });

    return recordId;
  }

  /**
   * Modifica un registro existente conservando historial obligatorio en auditoría
   */
  async updateRecord(recordId, newType, newTimestamp, newPayload, reason) {
    if (!reason || reason.trim().length < 5) {
      throw new Error('El motivo de la modificación es obligatorio (mínimo 5 caracteres).');
    }

    if (!window.cryptoEngine.isUnlocked()) {
      throw new Error('La bóveda está bloqueada.');
    }

    const store = await this.getStore('records', 'readwrite');
    const existing = await new Promise((resolve, reject) => {
      const req = store.get(recordId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!existing) {
      throw new Error('Registro no encontrado.');
    }

    // Descifrar contenido previo para archivarlo en auditoría
    let previousPayload = null;
    try {
      previousPayload = await window.cryptoEngine.decryptData(existing.encryptedPayload, existing.iv);
    } catch (e) {
      previousPayload = { error: 'No se pudo descifrar estado previo' };
    }

    const previousSnapshot = {
      type: existing.type,
      timestamp: existing.timestamp,
      payload: previousPayload
    };

    // Cifrar nuevo payload
    const encryptedPayload = await window.cryptoEngine.encryptData({
      ...newPayload,
      source: 'MANUAL_EDIT',
      editedAt: new Date().toISOString()
    });

    existing.type = newType;
    existing.timestamp = Number(newTimestamp);
    existing.encryptedPayload = encryptedPayload.ciphertext;
    existing.iv = encryptedPayload.iv;
    existing.updatedAt = Date.now();

    await new Promise((resolve, reject) => {
      const req = store.put(existing);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    // Registrar en auditoría de forma inmutable
    await this.addAuditLog({
      recordId,
      action: 'UPDATE',
      reason: reason.trim(),
      previousData: previousSnapshot,
      newData: { type: newType, timestamp: Number(newTimestamp), payload: newPayload }
    });

    return true;
  }

  /**
   * Marca como eliminado suavemente (soft-delete) para auditoría. Nada se borra físicamente.
   */
  async softDeleteRecord(recordId, reason) {
    if (!reason || reason.trim().length < 5) {
      throw new Error('El motivo de la eliminación es obligatorio (mínimo 5 caracteres).');
    }

    const store = await this.getStore('records', 'readwrite');
    const existing = await new Promise((resolve, reject) => {
      const req = store.get(recordId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!existing) throw new Error('Registro no encontrado.');

    existing.isDeleted = 1;
    existing.updatedAt = Date.now();

    await new Promise((resolve, reject) => {
      const req = store.put(existing);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    await this.addAuditLog({
      recordId,
      action: 'DELETE',
      reason: reason.trim(),
      previousData: { type: existing.type, timestamp: existing.timestamp },
      newData: { isDeleted: 1 }
    });

    return true;
  }

  /**
   * Obtiene todos los registros activos descifrados y ordenados cronológicamente
   */
  async getDecryptedRecords(includeDeleted = false) {
    if (!window.cryptoEngine.isUnlocked()) {
      throw new Error('La bóveda está bloqueada.');
    }

    const store = await this.getStore('records', 'readonly');
    const rawRecords = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const decryptedList = [];

    for (const rec of rawRecords) {
      if (!includeDeleted && rec.isDeleted === 1) {
        continue;
      }

      let payload = {};
      try {
        payload = await window.cryptoEngine.decryptData(rec.encryptedPayload, rec.iv);
      } catch (err) {
        console.error(`Error descifrando registro ${rec.id}:`, err);
        payload = { error: 'Error de descifrado' };
      }

      decryptedList.push({
        id: rec.id,
        timestamp: rec.timestamp,
        type: rec.type,
        isDeleted: rec.isDeleted === 1,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        ...payload
      });
    }

    // Ordenar de más antiguo a más reciente
    decryptedList.sort((a, b) => a.timestamp - b.timestamp);
    return decryptedList;
  }

  // ==========================================
  // BITÁCORA DE AUDITORÍA (INMUTABLE)
  // ==========================================

  async addAuditLog({ recordId, action, reason, previousData, newData }) {
    const auditId = 'aud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    
    // Cifrar los snapshots de datos para privacidad estricta
    let prevEncrypted = null;
    let nextEncrypted = null;

    if (window.cryptoEngine.isUnlocked()) {
      if (previousData) {
        const encPrev = await window.cryptoEngine.encryptData(previousData);
        prevEncrypted = encPrev;
      }
      if (newData) {
        const encNext = await window.cryptoEngine.encryptData(newData);
        nextEncrypted = encNext;
      }
    }

    const entry = {
      id: auditId,
      recordId,
      action,
      reason,
      timestamp: Date.now(),
      previousSnapshot: prevEncrypted,
      newSnapshot: nextEncrypted
    };

    const store = await this.getStore('audit_logs', 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.add(entry);
      req.onsuccess = () => resolve(auditId);
      req.onerror = () => reject(req.error);
    });
  }

  async getDecryptedAuditLogs() {
    const store = await this.getStore('audit_logs', 'readonly');
    const logs = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const decrypted = [];
    for (const log of logs) {
      let prev = null;
      let next = null;
      if (window.cryptoEngine.isUnlocked()) {
        try {
          if (log.previousSnapshot) {
            prev = await window.cryptoEngine.decryptData(log.previousSnapshot.ciphertext, log.previousSnapshot.iv);
          }
          if (log.newSnapshot) {
            next = await window.cryptoEngine.decryptData(log.newSnapshot.ciphertext, log.newSnapshot.iv);
          }
        } catch (e) {
          console.warn('No se pudo descifrar snapshot de auditoría:', e);
        }
      }

      decrypted.push({
        id: log.id,
        recordId: log.recordId,
        action: log.action,
        reason: log.reason,
        timestamp: log.timestamp,
        previousData: prev,
        newData: next
      });
    }

    decrypted.sort((a, b) => b.timestamp - a.timestamp); // Más recientes primero
    return decrypted;
  }

  // ==========================================
  // RESPALDO Y RESTAURACIÓN INTEGRAL
  // ==========================================

  async exportFullDatabaseRaw() {
    const recordsStore = await this.getStore('records', 'readonly');
    const auditStore = await this.getStore('audit_logs', 'readonly');
    const settingsStore = await this.getStore('settings', 'readonly');

    const [records, audit_logs, settings] = await Promise.all([
      new Promise(r => { const req = recordsStore.getAll(); req.onsuccess = () => r(req.result || []); }),
      new Promise(r => { const req = auditStore.getAll(); req.onsuccess = () => r(req.result || []); }),
      new Promise(r => { const req = settingsStore.getAll(); req.onsuccess = () => r(req.result || []); })
    ]);

    return { records, audit_logs, settings };
  }

  async restoreFullDatabaseRaw(data) {
    if (!data.records || !data.audit_logs || !data.settings) {
      throw new Error('Estructura de respaldo corrupta o incompatible.');
    }

    const tx = this.db.transaction(['records', 'audit_logs', 'settings'], 'readwrite');
    const rStore = tx.objectStore('records');
    const aStore = tx.objectStore('audit_logs');
    const sStore = tx.objectStore('settings');

    rStore.clear();
    aStore.clear();
    sStore.clear();

    for (const r of data.records) rStore.put(r);
    for (const a of data.audit_logs) aStore.put(a);
    for (const s of data.settings) sStore.put(s);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

window.secureStorage = new SecureStorage();
