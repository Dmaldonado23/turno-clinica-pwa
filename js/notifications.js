/**
 * Módulo de Recordatorios y Notificaciones de Fin de Turno
 * Compatible con iOS 16.4+ (PWA instalada en pantalla de inicio)
 * Soporta Notifications API nativa y alertas sonoras/en-pantalla locales
 */

class NotificationManager {
  constructor() {
    this.reminderTimerId = null;
  }

  /**
   * Comprueba si el navegador soporta notificaciones
   */
  static isSupported() {
    return 'Notification' in window;
  }

  /**
   * Solicita permisos de notificación al usuario
   */
  static async requestPermission() {
    if (!this.isSupported()) {
      alert('Tu navegador no soporta la API de notificaciones.');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (e) {
      console.warn('Error solicitando permisos de notificación:', e);
      return false;
    }
  }

  /**
   * Programa un recordatorio de salida si hay un turno activo
   * @param {number} startEpoch 
   * @param {number} standardHoursPerDay 
   * @param {number} advanceMinutesMinutos (ej: 15 min antes)
   */
  scheduleShiftExitReminder(startEpoch, standardHoursPerDay = 8.0, advanceMinutes = 15) {
    if (this.reminderTimerId) {
      clearTimeout(this.reminderTimerId);
      this.reminderTimerId = null;
    }

    const shiftTotalMs = standardHoursPerDay * 60 * 60 * 1000;
    const advanceMs = advanceMinutes * 60 * 1000;
    const targetReminderEpoch = startEpoch + shiftTotalMs - advanceMs;
    const now = Date.now();
    const delayMs = targetReminderEpoch - now;

    if (delayMs <= 0) {
      // Ya se cumplió o pasó el horario previsto de salida
      return;
    }

    console.log(`[Notification] Recordatorio programado en ${Math.round(delayMs / 60000)} minutos.`);

    this.reminderTimerId = setTimeout(() => {
      this.triggerReminderNotification(
        'Fin de Turno Próximo',
        `Faltan ${advanceMinutes} minutos para cumplir tu jornada de ${standardHoursPerDay} horas. Recuerda registrar tu salida al terminar.`
      );
    }, delayMs);
  }

  /**
   * Cancela cualquier recordatorio pendiente (al marcar salida)
   */
  cancelReminder() {
    if (this.reminderTimerId) {
      clearTimeout(this.reminderTimerId);
      this.reminderTimerId = null;
    }
  }

  /**
   * Dispara una notificación si los permisos están concedidos
   */
  triggerReminderNotification(title, body) {
    // Si tenemos Service Worker activo con registro de notificación (iOS 16.4+)
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(registration => {
        registration.showNotification(title, {
          body: body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'shift-reminder',
          vibrate: [200, 100, 200]
        });
      });
      return;
    }

    if (NotificationManager.isSupported() && Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: '/icons/icon-192.png'
      });
    } else {
      // Fallback sutil en pantalla si la app está visible
      console.log(`[Notification Fallback]: ${title} - ${body}`);
    }
  }
}

window.notificationManager = new NotificationManager();
