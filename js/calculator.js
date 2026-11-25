/**
 * Motor de Cálculo de Horas de Trabajo, Turnos y Horas Extra
 * Diseñado para ser determinista, libre de efectos secundarios y 100% testeable.
 * Maneja zonas horarias, cambios de hora (DST), turnos que cruzan la medianoche
 * y situaciones anómalas (doble marcación, salidas huérfanas).
 */

class WorkCalculator {
  /**
   * Convierte milisegundos a horas decimales con precisión de 2 decimales
   */
  static msToHours(ms) {
    if (!ms || ms <= 0) return 0;
    return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
  }

  /**
   * Formatea horas decimales en texto legible (ej: 8.5 -> "8h 30m")
   */
  static formatHoursReadable(decimalHours) {
    if (decimalHours === null || decimalHours === undefined || isNaN(decimalHours)) {
      return '0h 00m';
    }
    const isNegative = decimalHours < 0;
    const abs = Math.abs(decimalHours);
    const hours = Math.floor(abs);
    const minutes = Math.round((abs - hours) * 60);
    return `${isNegative ? '-' : ''}${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  /**
   * Obtiene la clave de fecha YYYY-MM-DD en la zona horaria local
   */
  static getLocalDateKey(timestamp) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Procesa la lista de registros en pares de turnos estructurados
   * @param {Array<{id: string, timestamp: number, type: 'ENTRY'|'EXIT', isDeleted?: boolean}>} rawRecords 
   * @param {number} currentTimeEpoch (opcional para simular tiempo presente)
   * @returns {{
   *   shifts: Array<{
   *     id: string,
   *     entryRecord: any,
   *     exitRecord: any|null,
   *     startEpoch: number,
   *     endEpoch: number|null,
   *     durationMs: number,
   *     durationHours: number,
   *     crossesMidnight: boolean,
   *     isActive: boolean,
   *     isOrphanExit: boolean,
   *     warning: string|null
   *   }>,
   *   activeShift: any|null
   * }}
   */
  static pairShifts(rawRecords, currentTimeEpoch = Date.now()) {
    // Filtrar eliminados y ordenar estrictamente por timestamp ascendente
    const records = (rawRecords || [])
      .filter(r => !r.isDeleted)
      .sort((a, b) => a.timestamp - b.timestamp);

    const shifts = [];
    let pendingEntry = null;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];

      if (rec.type === 'ENTRY') {
        if (pendingEntry) {
          // Caso borde: Doble Entrada consecutiva sin registrar salida
          // Cerramos el turno anterior como incompleto con aviso
          const durationMs = Math.max(0, rec.timestamp - pendingEntry.timestamp);
          shifts.push({
            id: `shift_${pendingEntry.id}`,
            entryRecord: pendingEntry,
            exitRecord: null,
            startEpoch: pendingEntry.timestamp,
            endEpoch: null,
            durationMs: 0, // No se computan horas de turno no cerrado para no inflar totales
            durationHours: 0,
            crossesMidnight: false,
            isActive: false,
            isOrphanExit: false,
            warning: 'Entrada sin salida cerrada (seguida de nueva entrada)'
          });
        }
        pendingEntry = rec;
      } else if (rec.type === 'EXIT') {
        if (pendingEntry) {
          // Turno completo normal (o que cruza medianoche)
          const durationMs = Math.max(0, rec.timestamp - pendingEntry.timestamp);
          const durationHours = this.msToHours(durationMs);
          
          const startDateKey = this.getLocalDateKey(pendingEntry.timestamp);
          const endDateKey = this.getLocalDateKey(rec.timestamp);
          const crossesMidnight = startDateKey !== endDateKey;

          shifts.push({
            id: `shift_${pendingEntry.id}_${rec.id}`,
            entryRecord: pendingEntry,
            exitRecord: rec,
            startEpoch: pendingEntry.timestamp,
            endEpoch: rec.timestamp,
            durationMs,
            durationHours,
            crossesMidnight,
            isActive: false,
            isOrphanExit: false,
            warning: null
          });
          pendingEntry = null;
        } else {
          // Caso borde: Salida sin entrada previa (salida huérfana)
          shifts.push({
            id: `orphan_exit_${rec.id}`,
            entryRecord: null,
            exitRecord: rec,
            startEpoch: rec.timestamp,
            endEpoch: rec.timestamp,
            durationMs: 0,
            durationHours: 0,
            crossesMidnight: false,
            isActive: false,
            isOrphanExit: true,
            warning: 'Salida registrada sin entrada previa'
          });
        }
      }
    }

    // Si queda un pendingEntry al final, es el turno actualmente activo
    let activeShift = null;
    if (pendingEntry) {
      const durationMs = Math.max(0, currentTimeEpoch - pendingEntry.timestamp);
      activeShift = {
        id: `active_${pendingEntry.id}`,
        entryRecord: pendingEntry,
        exitRecord: null,
        startEpoch: pendingEntry.timestamp,
        endEpoch: null,
        durationMs,
        durationHours: this.msToHours(durationMs),
        crossesMidnight: this.getLocalDateKey(pendingEntry.timestamp) !== this.getLocalDateKey(currentTimeEpoch),
        isActive: true,
        isOrphanExit: false,
        warning: null
      };
      shifts.push(activeShift);
    }

    return { shifts, activeShift };
  }

  /**
   * Valida si un nuevo registro sería un doble clic accidental (menos de cooldownSeconds)
   */
  static isDoubleTap(lastRecord, newType, newTimestamp, cooldownSeconds = 60) {
    if (!lastRecord) return false;
    const diffSeconds = (newTimestamp - lastRecord.timestamp) / 1000;
    return diffSeconds < cooldownSeconds && lastRecord.type === newType;
  }

  /**
   * Agrupa turnos por día calendario y calcula horas regulares vs horas extra
   * La jornada base por día es configurable (default 8 horas)
   * Los turnos que cruzan la medianoche se imputan a la fecha de inicio del turno
   */
  static aggregateByDay(shifts, standardHoursPerDay = 8.0) {
    const daysMap = {};

    shifts.forEach(shift => {
      // Ignorar salidas huérfanas en el cálculo de horas
      if (shift.isOrphanExit || !shift.startEpoch) return;

      const dateKey = this.getLocalDateKey(shift.startEpoch);
      if (!daysMap[dateKey]) {
        daysMap[dateKey] = {
          dateKey,
          totalDurationMs: 0,
          totalHours: 0,
          regularHours: 0,
          overtimeHours: 0,
          shifts: []
        };
      }

      daysMap[dateKey].shifts.push(shift);
      daysMap[dateKey].totalDurationMs += shift.durationMs;
    });

    // Calcular horas normales y extras por cada día
    const daysList = Object.values(daysMap).map(day => {
      const totalHours = this.msToHours(day.totalDurationMs);
      const regularHours = Math.min(totalHours, standardHoursPerDay);
      const overtimeHours = Math.max(0, totalHours - standardHoursPerDay);

      return {
        ...day,
        totalHours: Math.round(totalHours * 100) / 100,
        regularHours: Math.round(regularHours * 100) / 100,
        overtimeHours: Math.round(overtimeHours * 100) / 100
      };
    });

    daysList.sort((a, b) => b.dateKey.localeCompare(a.dateKey)); // Días más recientes primero
    return daysList;
  }

  /**
   * Agrupa los días calculados por semana ISO (ej: 2026-W47)
   */
  static aggregateByWeek(dailySummary) {
    const weeksMap = {};

    dailySummary.forEach(day => {
      const [year, month, dNum] = day.dateKey.split('-').map(Number);
      const date = new Date(year, month - 1, dNum);
      
      // Obtener número de semana ISO
      const tempDate = new Date(date.valueOf());
      const dayNum = (date.getDay() + 6) % 7;
      tempDate.setDate(tempDate.getDate() - dayNum + 3);
      const firstThursday = tempDate.valueOf();
      tempDate.setMonth(0, 1);
      if (tempDate.getDay() !== 4) {
        tempDate.setMonth(0, 1 + ((4 - tempDate.getDay()) + 7) % 7);
      }
      const weekNumber = 1 + Math.ceil((firstThursday - tempDate) / 604800000);
      const weekKey = `${year}-S${String(weekNumber).padStart(2, '0')}`;

      if (!weeksMap[weekKey]) {
        weeksMap[weekKey] = {
          weekKey,
          daysWorked: 0,
          totalHours: 0,
          regularHours: 0,
          overtimeHours: 0,
          days: []
        };
      }

      weeksMap[weekKey].daysWorked += 1;
      weeksMap[weekKey].totalHours += day.totalHours;
      weeksMap[weekKey].regularHours += day.regularHours;
      weeksMap[weekKey].overtimeHours += day.overtimeHours;
      weeksMap[weekKey].days.push(day);
    });

    return Object.values(weeksMap).map(w => ({
      ...w,
      totalHours: Math.round(w.totalHours * 100) / 100,
      regularHours: Math.round(w.regularHours * 100) / 100,
      overtimeHours: Math.round(w.overtimeHours * 100) / 100
    })).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  }

  /**
   * Agrupa por mes calendario (ej: 2026-11)
   */
  static aggregateByMonth(dailySummary) {
    const monthsMap = {};

    dailySummary.forEach(day => {
      const monthKey = day.dateKey.substring(0, 7); // 'YYYY-MM'

      if (!monthsMap[monthKey]) {
        monthsMap[monthKey] = {
          monthKey,
          daysWorked: 0,
          totalHours: 0,
          regularHours: 0,
          overtimeHours: 0,
          days: []
        };
      }

      monthsMap[monthKey].daysWorked += 1;
      monthsMap[monthKey].totalHours += day.totalHours;
      monthsMap[monthKey].regularHours += day.regularHours;
      monthsMap[monthKey].overtimeHours += day.overtimeHours;
      monthsMap[monthKey].days.push(day);
    });

    return Object.values(monthsMap).map(m => ({
      ...m,
      totalHours: Math.round(m.totalHours * 100) / 100,
      regularHours: Math.round(m.regularHours * 100) / 100,
      overtimeHours: Math.round(m.overtimeHours * 100) / 100
    })).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }

  /**
   * Calcula el acumulado de hoy para la pantalla principal
   */
  static getTodaySummary(shifts, standardHoursPerDay = 8.0, currentTimeEpoch = Date.now()) {
    const todayKey = this.getLocalDateKey(currentTimeEpoch);
    const todayShifts = shifts.filter(s => {
      if (!s.startEpoch) return false;
      return this.getLocalDateKey(s.startEpoch) === todayKey;
    });

    let totalDurationMs = 0;
    todayShifts.forEach(s => {
      totalDurationMs += s.durationMs;
    });

    const totalHours = this.msToHours(totalDurationMs);
    const regularHours = Math.min(totalHours, standardHoursPerDay);
    const overtimeHours = Math.max(0, totalHours - standardHoursPerDay);

    return {
      dateKey: todayKey,
      totalHours: Math.round(totalHours * 100) / 100,
      regularHours: Math.round(regularHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      shiftsCount: todayShifts.length,
      shifts: todayShifts
    };
  }
}

// Compatibilidad Browser y Node.js
if (typeof window !== 'undefined') {
  window.WorkCalculator = WorkCalculator;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkCalculator;
}
