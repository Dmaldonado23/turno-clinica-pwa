/**
 * Módulo Criptográfico de Grado Hospitalario / Financiero
 * Implementación 100% nativa con Web Crypto API (sin librerías externas)
 * Algoritmos:
 * - Derivación de Clave: PBKDF2 (HMAC-SHA-256, 250.000 iteraciones, Salt 16 bytes)
 * - Cifrado Simétrico: AES-256-GCM (IV aleatorio de 12 bytes por operación, tag de 128 bits)
 */

class CryptoEngine {
  constructor() {
    this.activeKey = null; // Mantenido solo en memoria mientras la app está desbloqueada
    this.sessionSalt = null;
  }

  /**
   * Genera bytes criptográficamente seguros
   * @param {number} length 
   * @returns {Uint8Array}
   */
  getRandomBytes(length) {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Convierte ArrayBuffer a Base64
   */
  bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Convierte Base64 a ArrayBuffer
   */
  base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Deriva una CryptoKey AES-GCM desde una contraseña usando PBKDF2
   * @param {string} password 
   * @param {Uint8Array} salt 
   * @param {number} iterations 
   * @returns {Promise<CryptoKey>}
   */
  async deriveKeyFromPassword(password, salt, iterations = 250000) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    // Importar contraseña como key material
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // Derivar clave simétrica AES-GCM de 256 bits
    const derivedKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256'
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: 256
      },
      false, // La clave de cifrado NO es exportable desde memoria
      ['encrypt', 'decrypt']
    );

    return derivedKey;
  }

  /**
   * Inicializa la bóveda con una nueva contraseña maestra
   * Retorna metadatos para guardar en IndexedDB (salt, verifierIv, verifierCiphertext)
   */
  async initializeVault(password) {
    const salt = this.getRandomBytes(16);
    const key = await this.deriveKeyFromPassword(password, salt);
    this.activeKey = key;
    this.sessionSalt = salt;

    // Generar un token de prueba para verificar contraseñas futuras sin almacenar el password
    const testPayload = JSON.stringify({ marker: 'CLINICA_VAULT_OK', timestamp: Date.now() });
    const encryptedVerifier = await this.encryptTextWithKey(testPayload, key);

    return {
      salt: this.bufferToBase64(salt),
      verifierIv: encryptedVerifier.iv,
      verifierCiphertext: encryptedVerifier.ciphertext
    };
  }

  /**
   * Desbloquea la bóveda verificando la contraseña ingresada
   * @param {string} password 
   * @param {string} saltBase64 
   * @param {string} verifierIv 
   * @param {string} verifierCiphertext 
   * @returns {Promise<boolean>}
   */
  async unlockWithPassword(password, saltBase64, verifierIv, verifierCiphertext) {
    try {
      const salt = new Uint8Array(this.base64ToBuffer(saltBase64));
      const key = await this.deriveKeyFromPassword(password, salt);
      
      const decryptedText = await this.decryptTextWithKey(verifierCiphertext, verifierIv, key);
      const parsed = JSON.parse(decryptedText);

      if (parsed && parsed.marker === 'CLINICA_VAULT_OK') {
        this.activeKey = key;
        this.sessionSalt = salt;
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Error al verificar contraseña:', err);
      return false;
    }
  }

  /**
   * Cierra la bóveda y borra la clave de la memoria RAM
   */
  lock() {
    this.activeKey = null;
    this.sessionSalt = null;
  }

  /**
   * Consulta si la bóveda se encuentra actualmente desbloqueada
   */
  isUnlocked() {
    return this.activeKey !== null;
  }

  /**
   * Cifra un texto arbitrario usando una clave específica
   */
  async encryptTextWithKey(plainText, key) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plainText);
    const iv = this.getRandomBytes(12); // 96 bits recomendado para AES-GCM

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      data
    );

    return {
      iv: this.bufferToBase64(iv),
      ciphertext: this.bufferToBase64(ciphertextBuffer)
    };
  }

  /**
   * Descifra un texto cifrado usando una clave específica
   */
  async decryptTextWithKey(ciphertextBase64, ivBase64, key) {
    const ciphertextBuffer = this.base64ToBuffer(ciphertextBase64);
    const ivBuffer = this.base64ToBuffer(ivBase64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(ivBuffer)
      },
      key,
      ciphertextBuffer
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  }

  /**
   * Cifra cualquier objeto/dato sensible con la clave activa en sesión
   * @param {any} dataObject 
   * @returns {Promise<{iv: string, ciphertext: string}>}
   */
  async encryptData(dataObject) {
    if (!this.activeKey) {
      throw new Error('La bóveda está bloqueada. No hay clave criptográfica disponible.');
    }
    const jsonStr = JSON.stringify(dataObject);
    return await this.encryptTextWithKey(jsonStr, this.activeKey);
  }

  /**
   * Descifra un objeto sensible usando la clave activa en sesión
   * @param {string} ciphertextBase64 
   * @param {string} ivBase64 
   * @returns {Promise<any>}
   */
  async decryptData(ciphertextBase64, ivBase64) {
    if (!this.activeKey) {
      throw new Error('La bóveda está bloqueada. No hay clave criptográfica disponible.');
    }
    const jsonStr = await this.decryptTextWithKey(ciphertextBase64, ivBase64, this.activeKey);
    return JSON.parse(jsonStr);
  }

  /**
   * Genera un paquete de respaldo exportable completamente cifrado con una contraseña arbitraria
   */
  async createEncryptedBackup(fullDatabaseDump, backupPassword) {
    const salt = this.getRandomBytes(16);
    const backupKey = await this.deriveKeyFromPassword(backupPassword, salt, 250000);
    const jsonDump = JSON.stringify(fullDatabaseDump);
    const encrypted = await this.encryptTextWithKey(jsonDump, backupKey);

    return {
      version: 1,
      app: 'RegistroClinicaPWA',
      timestamp: new Date().toISOString(),
      crypto: {
        algo: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations: 250000,
        salt: this.bufferToBase64(salt),
        iv: encrypted.iv
      },
      payload: encrypted.ciphertext
    };
  }

  /**
   * Restaura un paquete de respaldo cifrado solicitando la contraseña con la que fue creado
   */
  async restoreEncryptedBackup(backupFileJson, backupPassword) {
    if (!backupFileJson || !backupFileJson.crypto || !backupFileJson.payload) {
      throw new Error('Formato de archivo de respaldo inválido.');
    }

    const salt = new Uint8Array(this.base64ToBuffer(backupFileJson.crypto.salt));
    const iterations = backupFileJson.crypto.iterations || 250000;
    const backupKey = await this.deriveKeyFromPassword(backupPassword, salt, iterations);

    const decryptedJson = await this.decryptTextWithKey(
      backupFileJson.payload,
      backupFileJson.crypto.iv,
      backupKey
    );

    return JSON.parse(decryptedJson);
  }
}

// Instancia única exportada en ámbito global o módulo
window.cryptoEngine = new CryptoEngine();
