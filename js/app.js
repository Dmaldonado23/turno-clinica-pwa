/**
 * Controlador Principal de la Aplicación de Registro de Jornada Clínica
 * Orquesta la interfaz, estado de la bóveda, eventos del usuario y sincronizaciones.
 */

class AppController {
  constructor() {
    this.currentView = 'tab-registro';
    this.activeShiftTimer = null;
    this.cachedRecords = [];
    this.cachedShifts = [];
    this.activeShift = null;
    this.currentSettings = {
      clinicLat: null,
      clinicLng: null,
      clinicRadius: 150,
      standardHours: 8.0,
      reminderEnabled: true,
      advanceMinutes: 15,
      sheetsEnabled: false,
      sheetsUrl: ''
    };
  }

  async init() {
    console.log('[App] Inicializando sistema...');

    // 1. Inicializar base de datos
    await window.secureStorage.init();

    // 2. Registrar Service Worker para PWA Offline
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[ServiceWorker] Registrado:', reg.scope))
        .catch(err => console.warn('[ServiceWorker] Error:', err));
    }

    // 3. Vincular manejador de autenticación
    window.authManager.onLock(() => this.showLockScreen());
    window.authManager.onUnlock(() => this.onUnlocked());
    await window.authManager.init();

    // 4. Configurar escuchas de interfaz de usuario
    this.bindEvents();

    // 5. Verificar si existe configuración de seguridad previa
    const creds = await window.secureStorage.getCredentials();
    if (!creds) {
      // Primera vez: mostrar modal de inicialización de contraseña maestra
      this.showSetupModal();
    } else {
      // Mostrar pantalla de bloqueo para autenticar
      this.showLockScreen();
      // Si tiene Face ID habilitado, intentar desbloqueo biométrico automático
      if (creds.hasBiometrics) {
        setTimeout(() => this.tryBiometricUnlock(), 300);
      }
    }
  }

  /**
   * Se ejecuta una vez que la bóveda fue descifrada exitosamente
   */
  async onUnlocked() {
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('setup-modal').classList.remove('active');
    
    await this.loadSettings();
    await this.refreshData();
    this.startLiveTimer();
  }

  /**
   * Muestra la pantalla de bloqueo
   */
  showLockScreen() {
    this.stopLiveTimer();
    const lockScreen = document.getElementById('lock-screen');
    lockScreen.style.display = 'flex';
    document.getElementById('lock-password-input').value = '';
    document.getElementById('lock-error-msg').textContent = '';

    // Comprobar si el botón biométrico debe mostrarse
    window.secureStorage.getCredentials().then(creds => {
      const bioBtn = document.getElementById('btn-biometric-unlock');
      if (creds && creds.hasBiometrics) {
        bioBtn.style.display = 'flex';
      } else {
        bioBtn.style.display = 'none';
      }
    });
  }

  /**
   * Muestra el modal de bienvenida y configuración de contraseña
   */
  showSetupModal() {
    const modal = document.getElementById('setup-modal');
    modal.classList.add('active');
  }

  /**
   * Carga la configuración guardada del usuario
   */
  async loadSettings() {
    const settings = await window.secureStorage.getAllSettings();
    if (settings.clinicLat !== undefined) this.currentSettings.clinicLat = settings.clinicLat;
    if (settings.clinicLng !== undefined) this.currentSettings.clinicLng = settings.clinicLng;
    if (settings.clinicRadius !== undefined) this.currentSettings.clinicRadius = Number(settings.clinicRadius);
    if (settings.standardHours !== undefined) this.currentSettings.standardHours = Number(settings.standardHours);
    if (settings.reminderEnabled !== undefined) this.currentSettings.reminderEnabled = Boolean(settings.reminderEnabled);
    if (settings.sheetsEnabled !== undefined) this.currentSettings.sheetsEnabled = Boolean(settings.sheetsEnabled);
    if (settings.sheetsUrl !== undefined) this.currentSettings.sheetsUrl = String(settings.sheetsUrl);

    // Actualizar campos en vista de Ajustes
    document.getElementById('setting-radius').value = this.currentSettings.clinicRadius;
    document.getElementById('radius-val-display').textContent = `${this.currentSettings.clinicRadius} m`;
    document.getElementById('setting-hours').value = this.currentSettings.standardHours;
    document.getElementById('hours-val-display').textContent = `${this.currentSettings.standardHours} h`;
    document.getElementById('setting-reminder').checked = this.currentSettings.reminderEnabled;
    document.getElementById('setting-sheets-toggle').checked = this.currentSettings.sheetsEnabled;
    document.getElementById('setting-sheets-url').value = this.currentSettings.sheetsUrl;

    if (this.currentSettings.clinicLat && this.currentSettings.clinicLng) {
      document.getElementById('clinic-coords-display').textContent = 
        `Lat: ${Number(this.currentSettings.clinicLat).toFixed(5)}, Lng: ${Number(this.currentSettings.clinicLng).toFixed(5)}`;
    } else {
      document.getElementById('clinic-coords-display').textContent = 'No configurada (presiona el botón para fijar)';
    }
  }

  /**
   * Carga y procesa todos los registros descifrados desde IndexedDB
   */
  async refreshData() {
    if (!window.cryptoEngine.isUnlocked()) return;

    this.cachedRecords = await window.secureStorage.getDecryptedRecords(false);
    const { shifts, activeShift } = WorkCalculator.pairShifts(this.cachedRecords, Date.now());
    this.cachedShifts = shifts;
    this.activeShift = activeShift;

    this.updateDashboard();
    this.renderHistory();
    this.renderAuditLogs();
  }

  /**
   * Actualiza los elementos visuales de la pantalla principal
   */
  updateDashboard() {
    const heroBtn = document.getElementById('btn-hero-action');
    const heroLabel = document.getElementById('hero-action-label');
    const heroSub = document.getElementById('hero-action-sub');
    const statusText = document.getElementById('live-status-text');
    const statusDot = document.getElementById('live-status-dot');

    const today = WorkCalculator.getTodaySummary(this.cachedShifts, this.currentSettings.standardHours);
    document.getElementById('metric-today-total').textContent = WorkCalculator.formatHoursReadable(today.totalHours);
    document.getElementById('metric-today-regular').textContent = `${today.regularHours.toFixed(1)}h`;
    document.getElementById('metric-today-overtime').textContent = today.overtimeHours > 0 ? `+${today.overtimeHours.toFixed(1)}h` : '0.0h';

    if (this.activeShift) {
      // Estamos EN TURNO -> Botón para marcar SALIDA
      heroBtn.className = 'btn-hero btn-exit';
      heroLabel.textContent = 'REGISTRAR SALIDA';
      const entryTime = new Date(this.activeShift.startEpoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      heroSub.textContent = `Turno en curso desde ${entryTime}`;

      statusDot.className = 'status-dot active';
      statusText.textContent = `En turno desde ${entryTime}`;
    } else {
      // Estamos FUERA DE TURNO -> Botón para marcar ENTRADA
      heroBtn.className = 'btn-hero btn-entry';
      heroLabel.textContent = 'REGISTRAR ENTRADA';
      heroSub.textContent = 'Presiona para iniciar tu jornada';

      statusDot.className = 'status-dot';
      statusText.textContent = 'Fuera de turno';
    }

    this.updateLiveHeroTimer();
  }

  /**
   * Temporizador en vivo para el contador de horas transcurridas
   */
  startLiveTimer() {
    this.stopLiveTimer();
    this.activeShiftTimer = setInterval(() => {
      if (this.activeShift) {
        const elapsedMs = Math.max(0, Date.now() - this.activeShift.startEpoch);
        this.activeShift.durationMs = elapsedMs;
        this.activeShift.durationHours = WorkCalculator.msToHours(elapsedMs);
        this.updateLiveHeroTimer();

        // Actualizar total hoy en vivo
        const today = WorkCalculator.getTodaySummary(this.cachedShifts, this.currentSettings.standardHours);
        document.getElementById('metric-today-total').textContent = WorkCalculator.formatHoursReadable(today.totalHours);
      }
    }, 1000);
  }

  stopLiveTimer() {
    if (this.activeShiftTimer) {
      clearInterval(this.activeShiftTimer);
      this.activeShiftTimer = null;
    }
  }

  updateLiveHeroTimer() {
    const timerElem = document.getElementById('hero-live-timer');
    if (this.activeShift) {
      const elapsedMs = Math.max(0, Date.now() - this.activeShift.startEpoch);
      const totalSec = Math.floor(elapsedMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      timerElem.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else {
      timerElem.textContent = '00:00:00';
    }
  }

  /**
   * Manejador del toque en el botón gigante (Entrada / Salida)
   */
  async handleHeroAction() {
    const heroBtn = document.getElementById('btn-hero-action');
    if (heroBtn.disabled) return;

    // Prevención de doble toque rápido
    heroBtn.disabled = true;
    setTimeout(() => { heroBtn.disabled = false; }, 1500);

    // Retroalimentación háptica nativa en iPhone
    if (navigator.vibrate) navigator.vibrate(50);

    const isExit = this.activeShift !== null;
    const eventType = isExit ? 'EXIT' : 'ENTRY';
    const now = Date.now();

    // Verificación de doble marcación por tiempo
    const lastRecord = this.cachedRecords[this.cachedRecords.length - 1];
    if (WorkCalculator.isDoubleTap(lastRecord, eventType, now, 60)) {
      alert('Ya registraste este evento hace un momento.');
      return;
    }

    // Actualizar indicador temporal de GPS
    const geoStatusBadge = document.getElementById('geo-status-badge');
    const geoStatusText = document.getElementById('geo-status-text');
    geoStatusText.textContent = 'Consultando señal GPS precisa...';

    // Obtener ubicación y verificar radio de clínica
    const geoResult = await GeoService.verifyClinicLocation(
      this.currentSettings.clinicLat,
      this.currentSettings.clinicLng,
      this.currentSettings.clinicRadius
    );

    // Actualizar tarjeta visual de ubicación
    geoStatusText.textContent = geoResult.statusText;
    if (geoResult.hasGps) {
      geoStatusBadge.className = `geo-badge ${geoResult.inClinicRadius ? 'in-radius' : 'out-radius'}`;
      geoStatusBadge.textContent = geoResult.inClinicRadius ? '✓ Dentro del Radio' : '⚠ Fuera de Radio';
      geoStatusBadge.style.display = 'inline-block';
    } else {
      geoStatusBadge.style.display = 'none';
    }

    // Guardar registro cifrado en IndexedDB
    try {
      await window.secureStorage.addRecord({
        type: eventType,
        timestamp: now,
        payload: {
          lat: geoResult.lat,
          lng: geoResult.lng,
          accuracy: geoResult.accuracy,
          distanceMeters: geoResult.distanceMeters,
          inClinicRadius: geoResult.inClinicRadius,
          note: ''
        },
        source: 'BUTTON'
      });

      // Gestionar recordatorio de salida
      if (eventType === 'ENTRY' && this.currentSettings.reminderEnabled) {
        window.notificationManager.scheduleShiftExitReminder(
          now,
          this.currentSettings.standardHours,
          this.currentSettings.advanceMinutes
        );
      } else if (eventType === 'EXIT') {
        window.notificationManager.cancelReminder();
      }

      // Sincronización opcional con Google Sheets (Sanitizada y sin coordenadas)
      if (this.currentSettings.sheetsEnabled && this.currentSettings.sheetsUrl) {
        window.GoogleSheetsSync.sendEventIfEnabled(
          this.currentSettings.sheetsUrl,
          true,
          eventType,
          now
        );
      }

      await this.refreshData();
    } catch (err) {
      alert(`Error al registrar jornada: ${err.message}`);
    }
  }

  /**
   * Renderiza la vista de Historial (Día, Semana, Mes)
   */
  renderHistory(filterMode = 'day') {
    const listContainer = document.getElementById('history-shifts-list');
    listContainer.innerHTML = '';

    const dailySummary = WorkCalculator.aggregateByDay(this.cachedShifts, this.currentSettings.standardHours);

    if (filterMode === 'day') {
      if (dailySummary.length === 0) {
        listContainer.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 30px;">No hay jornadas registradas.</p>';
        return;
      }

      dailySummary.forEach(day => {
        const dayCard = document.createElement('div');
        dayCard.className = 'shift-item';

        const dateParts = day.dateKey.split('-');
        const dateObj = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));
        const dateFormatted = dateObj.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

        dayCard.innerHTML = `
          <div class="shift-header">
            <span class="shift-date">${dateFormatted.toUpperCase()} (${day.dateKey})</span>
            <span class="shift-duration">${day.totalHours.toFixed(2)}h (${WorkCalculator.formatHoursReadable(day.totalHours)})</span>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
            Regulares: <strong>${day.regularHours.toFixed(2)}h</strong> 
            ${day.overtimeHours > 0 ? `| Extras: <strong style="color: var(--warning-color);">+${day.overtimeHours.toFixed(2)}h</strong>` : ''}
          </div>
          <div class="shift-sublist">
            ${day.shifts.map(s => {
              if (s.isOrphanExit) {
                return `
                  <div style="font-size: 11px; padding: 4px 0; color: var(--danger-color);">
                    ⚠ Salida huérfana: ${new Date(s.exitRecord.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    <button class="btn-icon" style="display:inline; width:auto; height:auto; padding:2px 6px;" onclick="window.appController.openEditModal('${s.exitRecord.id}', '${s.exitRecord.type}', ${s.exitRecord.timestamp})">Editar</button>
                  </div>
                `;
              }
              const dIn = new Date(s.entryRecord.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const dOut = s.exitRecord ? new Date(s.exitRecord.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'En curso';
              const radiusBadge = s.entryRecord.inClinicRadius ? '<span style="color: var(--success-color);">✓ En radio</span>' : '<span style="color: var(--warning-color);">⚠ Fuera</span>';
              return `
                <div style="font-size: 12px; display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-top: 1px dashed var(--border-subtle);">
                  <span>🕒 ${dIn} ➔ ${dOut} (${radiusBadge})</span>
                  <div>
                    <button class="btn-icon" style="width: 28px; height: 28px;" onclick="window.appController.openEditModal('${s.entryRecord.id}', '${s.entryRecord.type}', ${s.entryRecord.timestamp})">✏️</button>
                    ${s.exitRecord ? `<button class="btn-icon" style="width: 28px; height: 28px;" onclick="window.appController.openEditModal('${s.exitRecord.id}', '${s.exitRecord.type}', ${s.exitRecord.timestamp})">✏️</button>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
        listContainer.appendChild(dayCard);
      });
    } else if (filterMode === 'week') {
      const weekly = WorkCalculator.aggregateByWeek(dailySummary);
      if (weekly.length === 0) {
        listContainer.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 30px;">No hay jornadas semanales.</p>';
        return;
      }
      weekly.forEach(w => {
        const item = document.createElement('div');
        item.className = 'shift-item';
        item.innerHTML = `
          <div class="shift-header">
            <span class="shift-date">Semana ${w.weekKey} (${w.daysWorked} días)</span>
            <span class="shift-duration">${w.totalHours.toFixed(2)}h</span>
          </div>
          <div style="font-size: 13px; color: var(--text-secondary);">
            Horas Regulares: <strong>${w.regularHours.toFixed(2)}h</strong> | Horas Extra: <strong style="color: var(--warning-color);">+${w.overtimeHours.toFixed(2)}h</strong>
          </div>
        `;
        listContainer.appendChild(item);
      });
    } else if (filterMode === 'month') {
      const monthly = WorkCalculator.aggregateByMonth(dailySummary);
      if (monthly.length === 0) {
        listContainer.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 30px;">No hay jornadas mensuales.</p>';
        return;
      }
      monthly.forEach(m => {
        const item = document.createElement('div');
        item.className = 'shift-item';
        item.innerHTML = `
          <div class="shift-header">
            <span class="shift-date">Mes ${m.monthKey} (${m.daysWorked} días trabajados)</span>
            <span class="shift-duration">${m.totalHours.toFixed(2)}h</span>
          </div>
          <div style="font-size: 13px; color: var(--text-secondary);">
            Horas Regulares: <strong>${m.regularHours.toFixed(2)}h</strong> | Horas Extra: <strong style="color: var(--warning-color);">+${m.overtimeHours.toFixed(2)}h</strong>
          </div>
        `;
        listContainer.appendChild(item);
      });
    }
  }

  /**
   * Renderiza la bitácora inmutable de auditoría
   */
  async renderAuditLogs() {
    const container = document.getElementById('audit-logs-list');
    if (!container) return;

    const logs = await window.secureStorage.getDecryptedAuditLogs();
    if (logs.length === 0) {
      container.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 30px;">Sin eventos de auditoría registrados.</p>';
      return;
    }

    container.innerHTML = logs.map(l => {
      const date = new Date(l.timestamp).toLocaleString();
      let badgeClass = 'badge-ok';
      if (l.action === 'UPDATE') badgeClass = 'badge-warn';
      if (l.action === 'DELETE') badgeClass = 'badge-alert';

      return `
        <div class="card" style="margin-bottom: 10px; font-size: 13px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span class="badge-tag ${badgeClass}">ACCION: ${l.action}</span>
            <span style="font-size: 11px; color: var(--text-muted);">${date}</span>
          </div>
          <p style="margin-bottom: 6px;"><strong>Motivo:</strong> ${l.reason}</p>
          <div style="font-size: 11px; color: var(--text-muted);">ID Registro: ${l.recordId}</div>
        </div>
      `;
    }).join('');
  }

  /**
   * Apertura y manejo de modales
   */
  openManualEntryModal() {
    const modal = document.getElementById('manual-entry-modal');
    const now = new Date();
    document.getElementById('manual-date').value = WorkCalculator.getLocalDateKey(now.getTime());
    document.getElementById('manual-time').value = now.toTimeString().substring(0, 5);
    document.getElementById('manual-reason').value = '';
    modal.classList.add('active');
  }

  async saveManualEntry() {
    const type = document.getElementById('manual-type').value;
    const dateStr = document.getElementById('manual-date').value;
    const timeStr = document.getElementById('manual-time').value;
    const reason = document.getElementById('manual-reason').value;

    if (!reason || reason.trim().length < 5) {
      alert('Debes ingresar un motivo obligatorio de al menos 5 caracteres.');
      return;
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateObj = new Date(year, month - 1, day, hours, minutes, 0);

    await window.secureStorage.addRecord({
      type,
      timestamp: dateObj.getTime(),
      payload: {
        lat: null,
        lng: null,
        distanceMeters: null,
        inClinicRadius: false,
        note: `Registro manual: ${reason.trim()}`
      },
      source: 'MANUAL',
      reason: reason.trim()
    });

    document.getElementById('manual-entry-modal').classList.remove('active');
    await this.refreshData();
  }

  openEditModal(recordId, type, timestamp) {
    const modal = document.getElementById('edit-entry-modal');
    document.getElementById('edit-record-id').value = recordId;
    document.getElementById('edit-type').value = type;

    const dateObj = new Date(timestamp);
    document.getElementById('edit-date').value = WorkCalculator.getLocalDateKey(timestamp);
    document.getElementById('edit-time').value = dateObj.toTimeString().substring(0, 5);
    document.getElementById('edit-reason').value = '';
    modal.classList.add('active');
  }

  async saveEditEntry() {
    const recordId = document.getElementById('edit-record-id').value;
    const type = document.getElementById('edit-type').value;
    const dateStr = document.getElementById('edit-date').value;
    const timeStr = document.getElementById('edit-time').value;
    const reason = document.getElementById('edit-reason').value;

    if (!reason || reason.trim().length < 5) {
      alert('El motivo del cambio es obligatorio (mínimo 5 caracteres).');
      return;
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateObj = new Date(year, month - 1, day, hours, minutes, 0);

    try {
      await window.secureStorage.updateRecord(
        recordId,
        type,
        dateObj.getTime(),
        { note: `Modificado: ${reason.trim()}` },
        reason.trim()
      );

      document.getElementById('edit-entry-modal').classList.remove('active');
      await this.refreshData();
    } catch (e) {
      alert(`Error al actualizar: ${e.message}`);
    }
  }

  async deleteCurrentEditEntry() {
    const recordId = document.getElementById('edit-record-id').value;
    const reason = document.getElementById('edit-reason').value;

    if (!reason || reason.trim().length < 5) {
      alert('Para anular el registro debes indicar un motivo obligatorio (mínimo 5 caracteres).');
      return;
    }

    if (!confirm('¿Confirmas anular este registro? Quedará archivado en la bitácora de auditoría.')) {
      return;
    }

    await window.secureStorage.softDeleteRecord(recordId, reason.trim());
    document.getElementById('edit-entry-modal').classList.remove('active');
    await this.refreshData();
  }

  /**
   * Intento de desbloqueo biométrico
   */
  async tryBiometricUnlock() {
    const errorEl = document.getElementById('lock-error-msg');
    try {
      errorEl.textContent = 'Verificando Face ID / Touch ID...';
      const success = await window.authManager.unlockWithBiometrics();
      if (!success) {
        errorEl.textContent = 'Verificación biométrica no superada. Ingresa tu contraseña.';
      }
    } catch (err) {
      errorEl.textContent = 'Usa tu contraseña maestra de respaldo.';
    }
  }

  /**
   * Vinculación de todos los eventos del DOM
   */
  bindEvents() {
    // 1. Botón gigante de registro Entrada/Salida
    document.getElementById('btn-hero-action').addEventListener('click', () => this.handleHeroAction());

    // 2. Navegación inferior por pestañas
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetViewId = tab.dataset.view;
        document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
        document.getElementById(targetViewId).classList.add('active');
        this.currentView = targetViewId;
      });
    });

    // 3. Filtros de historial (Día, Semana, Mes)
    document.querySelectorAll('.filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderHistory(btn.dataset.filter);
      });
    });

    // 4. Modal de desbloqueo por contraseña
    document.getElementById('btn-unlock-password').addEventListener('click', async () => {
      const pass = document.getElementById('lock-password-input').value;
      const errorEl = document.getElementById('lock-error-msg');
      if (!pass) return;

      errorEl.textContent = 'Descifrando bóveda...';
      const ok = await window.authManager.unlockWithPassword(pass);
      if (!ok) {
        errorEl.textContent = 'Contraseña incorrecta. Inténtalo de nuevo.';
      }
    });

    // Desbloqueo con tecla Enter
    document.getElementById('lock-password-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-unlock-password').click();
    });

    document.getElementById('btn-biometric-unlock').addEventListener('click', () => this.tryBiometricUnlock());

    // 5. Modal de configuración inicial de contraseña maestra
    document.getElementById('btn-setup-save').addEventListener('click', async () => {
      const pass1 = document.getElementById('setup-pass1').value;
      const pass2 = document.getElementById('setup-pass2').value;
      const enableBio = document.getElementById('setup-enable-bio').checked;

      if (!pass1 || pass1.length < 8) {
        alert('La contraseña maestra debe tener al menos 8 caracteres.');
        return;
      }
      if (pass1 !== pass2) {
        alert('Las contraseñas no coinciden.');
        return;
      }

      const credData = await window.cryptoEngine.initializeVault(pass1);
      await window.secureStorage.saveCredentials(credData);

      if (enableBio) {
        try {
          await window.authManager.registerBiometrics(pass1);
        } catch (e) {
          console.warn('No se pudo registrar biometría inicial:', e);
          alert('Bóveda configurada, pero no se pudo activar Face ID. Podrás usar tu contraseña.');
        }
      }

      window.authManager.isLocked = false;
      this.onUnlocked();
    });

    // 6. Botones de modales de registro manual y edición
    document.getElementById('btn-open-manual-entry').addEventListener('click', () => this.openManualEntryModal());
    document.getElementById('btn-save-manual').addEventListener('click', () => this.saveManualEntry());
    document.getElementById('btn-save-edit').addEventListener('click', () => this.saveEditEntry());
    document.getElementById('btn-delete-edit').addEventListener('click', () => this.deleteCurrentEditEntry());

    // Cierre de modales
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    // 7. Exportación y Respaldo
    document.getElementById('btn-open-export').addEventListener('click', () => {
      document.getElementById('export-modal').classList.add('active');
    });

    document.getElementById('btn-export-csv').addEventListener('click', () => {
      ExportService.exportToCSV(this.cachedShifts, this.currentSettings.standardHours);
    });

    document.getElementById('btn-export-pdf').addEventListener('click', () => {
      const daily = WorkCalculator.aggregateByDay(this.cachedShifts, this.currentSettings.standardHours);
      ExportService.printPDFReport(this.cachedShifts, daily, this.currentSettings.standardHours);
    });

    document.getElementById('btn-export-backup').addEventListener('click', async () => {
      const pass = prompt('Ingresa una contraseña para cifrar el archivo de respaldo:');
      if (pass) {
        try {
          await ExportService.exportEncryptedBackupFile(pass);
          alert('Copia de seguridad cifrada descargada correctamente.');
        } catch (e) {
          alert(`Error al generar respaldo: ${e.message}`);
        }
      }
    });

    document.getElementById('btn-restore-backup').addEventListener('click', () => {
      document.getElementById('backup-file-input').click();
    });

    document.getElementById('backup-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const pass = prompt('Ingresa la contraseña con la que fue cifrado este archivo de respaldo:');
      if (pass) {
        try {
          await ExportService.restoreEncryptedBackupFile(file, pass);
          alert('Bóveda restaurada con éxito. La app se recargará.');
          window.location.reload();
        } catch (err) {
          alert(`Error al restaurar respaldo: ${err.message}`);
        }
      }
    });

    // 8. Vista de Ajustes
    document.getElementById('btn-set-current-coords').addEventListener('click', async () => {
      const btn = document.getElementById('btn-set-current-coords');
      btn.textContent = 'Obteniendo GPS...';
      const pos = await GeoService.getCurrentPosition();
      btn.textContent = 'Fijar mi ubicación actual';

      if (pos.error || !pos.lat) {
        alert(`No se pudo obtener ubicación: ${pos.error}`);
        return;
      }

      await window.secureStorage.setSetting('clinicLat', pos.lat);
      await window.secureStorage.setSetting('clinicLng', pos.lng);
      this.currentSettings.clinicLat = pos.lat;
      this.currentSettings.clinicLng = pos.lng;
      document.getElementById('clinic-coords-display').textContent = `Lat: ${pos.lat.toFixed(5)}, Lng: ${pos.lng.toFixed(5)}`;
      alert('Ubicación de la clínica actualizada.');
    });

    document.getElementById('setting-radius').addEventListener('input', async (e) => {
      const val = Number(e.target.value);
      document.getElementById('radius-val-display').textContent = `${val} m`;
      this.currentSettings.clinicRadius = val;
      await window.secureStorage.setSetting('clinicRadius', val);
    });

    document.getElementById('setting-hours').addEventListener('input', async (e) => {
      const val = Number(e.target.value);
      document.getElementById('hours-val-display').textContent = `${val} h`;
      this.currentSettings.standardHours = val;
      await window.secureStorage.setSetting('standardHours', val);
      await this.refreshData();
    });

    document.getElementById('setting-reminder').addEventListener('change', async (e) => {
      const isChecked = e.target.checked;
      if (isChecked) {
        const granted = await NotificationManager.requestPermission();
        if (!granted) {
          e.target.checked = false;
          return;
        }
      }
      this.currentSettings.reminderEnabled = isChecked;
      await window.secureStorage.setSetting('reminderEnabled', isChecked);
    });

    document.getElementById('setting-sheets-toggle').addEventListener('change', async (e) => {
      this.currentSettings.sheetsEnabled = e.target.checked;
      await window.secureStorage.setSetting('sheetsEnabled', e.target.checked);
    });

    document.getElementById('setting-sheets-url').addEventListener('change', async (e) => {
      this.currentSettings.sheetsUrl = e.target.value.trim();
      await window.secureStorage.setSetting('sheetsUrl', this.currentSettings.sheetsUrl);
    });

    document.getElementById('btn-view-apps-script').addEventListener('click', () => {
      const code = GoogleSheetsSync.getAppsScriptTemplateCode();
      navigator.clipboard.writeText(code).then(() => {
        alert('Código de Google Apps Script copiado al portapapeles. Pégalo en tu Google Sheet.');
      });
    });

    document.getElementById('btn-lock-now').addEventListener('click', () => {
      window.authManager.lock();
    });

    // Conmutador de Modo Oscuro / Claro
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
    });
  }
}

// Iniciar aplicación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
  window.appController = new AppController();
  window.appController.init();
});
