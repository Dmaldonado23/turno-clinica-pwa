/**
 * Módulo de Autenticación y Bloqueo Biomátrico (WebAuthn / Passkeys)
 * Soporta Face ID / Touch ID nativo en Safari iOS y contraseña maestra de respaldo.
 * Bloqueo automático al pasar a segundo plano y por inactividad.
 */

class AuthManager {
  constructor() {
    this.isLocked = true;
    this.inactivityTimeoutMs = 5 * 60 * 1000; // 5 minutos por defecto
    this.timerId = null;
    this.onLockCallbacks = [];
    this.onUnlockCallbacks = [];
  }

  /**
   * Inicializa escuchas de eventos de ciclo de vida (segundo plano, inactividad)
   */
  async init() {
    // Escucha de cambio de visibilidad (Bloqueo inmediato al cambiar de app o bloquear pantalla de iPhone)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('[Auth] App en segundo plano -> Bloqueando');
        this.lock();
      }
    });

    // Escucha de actividad del usuario para reiniciar temporizador de inactividad
    ['touchstart', 'click', 'keydown', 'scroll'].forEach(evtName => {
      window.addEventListener(evtName, () => this.resetInactivityTimer(), { passive: true });
    });

    this.resetInactivityTimer();
  }

  resetInactivityTimer() {
    if (this.timerId) clearTimeout(this.timerId);
    if (!this.isLocked) {
      this.timerId = setTimeout(() => {
        console.log('[Auth] Tiempo de inactividad superado -> Bloqueando');
        this.lock();
      }, this.inactivityTimeoutMs);
    }
  }

  /**
   * Comprueba si el dispositivo soporta Face ID / Touch ID vía WebAuthn
   */
  async isBiometricsAvailable() {
    if (window.PublicKeyCredential &&
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      try {
        return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch (e) {
        console.warn('Error verificando autenticador biométrico:', e);
        return false;
      }
    }
    return false;
  }

  /**
   * Registra una credencial biométrica WebAuthn (Face ID / Touch ID) vinculada a la clave maestra
   */
  async registerBiometrics(masterPassword) {
    const available = await this.isBiometricsAvailable();
    if (!available) {
      throw new Error('Face ID / Touch ID no disponible en este dispositivo o navegador.');
    }

    const challenge = window.cryptoEngine.getRandomBytes(32);
    const userId = window.cryptoEngine.getRandomBytes(16);

    const publicKeyOptions = {
      challenge: challenge,
      rp: {
        name: 'Registro Jornada Clínica',
        id: window.location.hostname
      },
      user: {
        id: userId,
        name: 'usuario-clinica',
        displayName: 'Personal Clínico'
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    };

    const credential = await navigator.credentials.create({ publicKey: publicKeyOptions });
    if (!credential) throw new Error('No se completó el registro biométrico.');

    // Cifrar la contraseña maestra con un secreto local generado para permitir desbloqueo biométrico
    const bioKey = window.cryptoEngine.getRandomBytes(32);
    const bioKeyDerived = await window.crypto.subtle.importKey(
      'raw',
      bioKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    const encryptedMasterPass = await window.cryptoEngine.encryptTextWithKey(masterPassword, bioKeyDerived);

    // Guardar token biométrico en IndexedDB
    const creds = await window.secureStorage.getCredentials();
    await window.secureStorage.saveCredentials({
      ...creds,
      hasBiometrics: true,
      bioCredId: window.cryptoEngine.bufferToBase64(credential.rawId),
      bioTokenKey: window.cryptoEngine.bufferToBase64(bioKey),
      bioTokenIv: encryptedMasterPass.iv,
      bioTokenCiphertext: encryptedMasterPass.ciphertext
    });

    return true;
  }

  /**
   * Desbloquea la app mediante Face ID / Touch ID
   */
  async unlockWithBiometrics() {
    const creds = await window.secureStorage.getCredentials();
    if (!creds || !creds.hasBiometrics || !creds.bioCredId) {
      throw new Error('No hay biometría configurada.');
    }

    const challenge = window.cryptoEngine.getRandomBytes(32);
    const rawId = window.cryptoEngine.base64ToBuffer(creds.bioCredId);

    const getOptions = {
      challenge: challenge,
      allowCredentials: [{
        id: rawId,
        type: 'public-key',
        transports: ['internal']
      }],
      userVerification: 'required',
      timeout: 60000
    };

    const assertion = await navigator.credentials.get({ publicKey: getOptions });
    if (!assertion) {
      throw new Error('Autenticación biométrica cancelada o fallida.');
    }

    // Si Face ID validó con éxito la presencia del usuario, recuperamos la clave
    const bioKeyBuffer = window.cryptoEngine.base64ToBuffer(creds.bioTokenKey);
    const bioKey = await window.crypto.subtle.importKey(
      'raw',
      bioKeyBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const recoveredPassword = await window.cryptoEngine.decryptTextWithKey(
      creds.bioTokenCiphertext,
      creds.bioTokenIv,
      bioKey
    );

    const success = await window.cryptoEngine.unlockWithPassword(
      recoveredPassword,
      creds.salt,
      creds.verifierIv,
      creds.verifierCiphertext
    );

    if (success) {
      this.isLocked = false;
      this.notifyUnlock();
      this.resetInactivityTimer();
      return true;
    }
    return false;
  }

  /**
   * Desbloquea con contraseña maestra
   */
  async unlockWithPassword(password) {
    const creds = await window.secureStorage.getCredentials();
    if (!creds) {
      throw new Error('No existe configuración de seguridad previa.');
    }

    const success = await window.cryptoEngine.unlockWithPassword(
      password,
      creds.salt,
      creds.verifierIv,
      creds.verifierCiphertext
    );

    if (success) {
      this.isLocked = false;
      this.notifyUnlock();
      this.resetInactivityTimer();
      return true;
    }
    return false;
  }

  /**
   * Bloquea la app y limpia las claves de la memoria
   */
  lock() {
    this.isLocked = true;
    if (this.timerId) clearTimeout(this.timerId);
    window.cryptoEngine.lock();
    this.notifyLock();
  }

  onLock(cb) {
    this.onLockCallbacks.push(cb);
  }

  onUnlock(cb) {
    this.onUnlockCallbacks.push(cb);
  }

  notifyLock() {
    this.onLockCallbacks.forEach(cb => {
      try { cb(); } catch (e) { console.error(e); }
    });
  }

  notifyUnlock() {
    this.onUnlockCallbacks.forEach(cb => {
      try { cb(); } catch (e) { console.error(e); }
    });
  }
}

window.authManager = new AuthManager();
