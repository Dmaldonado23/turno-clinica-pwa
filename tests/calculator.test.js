/**
 * Suite de Pruebas Unitarias Automatizadas para WorkCalculator y GeoService
 * Diseñado para ejecutarse en Node.js o navegador.
 */

const assert = require('assert');
const WorkCalculator = require('../js/calculator.js');
const GeoService = require('../js/geo.js');

let testsPassed = 0;
let testsFailed = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✓ PASÓ: ${description}`);
    testsPassed++;
  } catch (error) {
    console.error(`  ✗ FALLÓ: ${description}`);
    console.error(`    Detalle: ${error.message}`);
    testsFailed++;
  }
}

console.log('\n--- INICIANDO PRUEBAS UNITARIAS DE LÓGICA DE JORNADA CLÍNICA ---\n');

// 1. Turno estándar de 8 horas
it('Debe calcular correctamente un turno diurno estándar de 8 horas (08:00 a 16:00)', () => {
  const tStart = new Date('2026-11-25T08:00:00Z').getTime();
  const tEnd = new Date('2026-11-25T16:00:00Z').getTime();

  const records = [
    { id: '1', timestamp: tStart, type: 'ENTRY' },
    { id: '2', timestamp: tEnd, type: 'EXIT' }
  ];

  const { shifts } = WorkCalculator.pairShifts(records);
  assert.strictEqual(shifts.length, 1);
  assert.strictEqual(shifts[0].durationHours, 8.0);
  assert.strictEqual(shifts[0].crossesMidnight, false);
  assert.strictEqual(shifts[0].warning, null);

  const daily = WorkCalculator.aggregateByDay(shifts, 8.0);
  assert.strictEqual(daily[0].totalHours, 8.0);
  assert.strictEqual(daily[0].regularHours, 8.0);
  assert.strictEqual(daily[0].overtimeHours, 0.0);
});

// 2. Turno con horas extra
it('Debe calcular correctamente horas regulares y horas extra (08:00 a 18:30 = 10.5h)', () => {
  const tStart = new Date('2026-11-25T08:00:00Z').getTime();
  const tEnd = new Date('2026-11-25T18:30:00Z').getTime(); // 10.5 horas

  const records = [
    { id: '1', timestamp: tStart, type: 'ENTRY' },
    { id: '2', timestamp: tEnd, type: 'EXIT' }
  ];

  const { shifts } = WorkCalculator.pairShifts(records);
  assert.strictEqual(shifts[0].durationHours, 10.5);

  const daily = WorkCalculator.aggregateByDay(shifts, 8.0);
  assert.strictEqual(daily[0].totalHours, 10.5);
  assert.strictEqual(daily[0].regularHours, 8.0);
  assert.strictEqual(daily[0].overtimeHours, 2.5);
});

// 3. Turno nocturno que cruza la medianoche (22:00 a 06:00)
it('Debe calcular con precisión un turno nocturno que cruza la medianoche (22:00 a 06:00 = 8h)', () => {
  // Configuración con horas locales simuladas
  const dStart = new Date(2026, 10, 25, 22, 0, 0); // 25 Nov 22:00
  const dEnd = new Date(2026, 10, 26, 6, 0, 0);   // 26 Nov 06:00

  const records = [
    { id: '1', timestamp: dStart.getTime(), type: 'ENTRY' },
    { id: '2', timestamp: dEnd.getTime(), type: 'EXIT' }
  ];

  const { shifts } = WorkCalculator.pairShifts(records);
  assert.strictEqual(shifts.length, 1);
  assert.strictEqual(shifts[0].durationHours, 8.0);
  assert.strictEqual(shifts[0].crossesMidnight, true);

  const daily = WorkCalculator.aggregateByDay(shifts, 8.0);
  // El turno nocturno se asocia al día de inicio de jornada
  assert.strictEqual(daily.length, 1);
  assert.strictEqual(daily[0].totalHours, 8.0);
  assert.strictEqual(daily[0].dateKey, WorkCalculator.getLocalDateKey(dStart.getTime()));
});

// 4. Múltiples turnos divididos en el mismo día (Turno partido mañana + tarde)
it('Debe sumar adecuadamente turnos partidos (4h mañana + 4.5h tarde = 8.5h total, 0.5h extra)', () => {
  const mStart = new Date(2026, 10, 25, 8, 0, 0).getTime();
  const mEnd = new Date(2026, 10, 25, 12, 0, 0).getTime(); // 4.0h
  const tStart = new Date(2026, 10, 25, 14, 0, 0).getTime();
  const tEnd = new Date(2026, 10, 25, 18, 30, 0).getTime(); // 4.5h

  const records = [
    { id: '1', timestamp: mStart, type: 'ENTRY' },
    { id: '2', timestamp: mEnd, type: 'EXIT' },
    { id: '3', timestamp: tStart, type: 'ENTRY' },
    { id: '4', timestamp: tEnd, type: 'EXIT' }
  ];

  const { shifts } = WorkCalculator.pairShifts(records);
  assert.strictEqual(shifts.length, 2);

  const daily = WorkCalculator.aggregateByDay(shifts, 8.0);
  assert.strictEqual(daily[0].totalHours, 8.5);
  assert.strictEqual(daily[0].regularHours, 8.0);
  assert.strictEqual(daily[0].overtimeHours, 0.5);
  assert.strictEqual(daily[0].shifts.length, 2);
});

// 5. Protección contra doble marcación accidental
it('Debe detectar toques duplicados dentro del intervalo de cooldown (60s)', () => {
  const now = Date.now();
  const lastRecord = { id: '1', timestamp: now, type: 'ENTRY' };

  // Toque a los 10 segundos con el mismo tipo -> Doble tap detectado
  const isDupe = WorkCalculator.isDoubleTap(lastRecord, 'ENTRY', now + 10000, 60);
  assert.strictEqual(isDupe, true);

  // Toque a los 65 segundos -> No es dupe
  const isOk = WorkCalculator.isDoubleTap(lastRecord, 'ENTRY', now + 65000, 60);
  assert.strictEqual(isOk, false);

  // Toque de tipo distinto (Salida) inmediato -> No es dupe de Entrada
  const isDifferentType = WorkCalculator.isDoubleTap(lastRecord, 'EXIT', now + 5000, 60);
  assert.strictEqual(isDifferentType, false);
});

// 6. Caso borde: Salida sin entrada previa (salida huérfana)
it('Debe gestionar salidas huérfanas sin romper los cálculos y reportar advertencia', () => {
  const exitTime = new Date('2026-11-25T14:00:00Z').getTime();
  const records = [
    { id: 'orphan_1', timestamp: exitTime, type: 'EXIT' }
  ];

  const { shifts } = WorkCalculator.pairShifts(records);
  assert.strictEqual(shifts.length, 1);
  assert.strictEqual(shifts[0].isOrphanExit, true);
  assert.strictEqual(shifts[0].durationHours, 0);
  assert.strictEqual(typeof shifts[0].warning, 'string');
});

// 7. Turno actualmente activo (en curso)
it('Debe calcular el tiempo transcurrido en tiempo real para un turno actualmente activo', () => {
  const tStart = Date.now() - (3 * 3600 * 1000); // Iniciado hace 3 horas exactas
  const records = [
    { id: 'active_1', timestamp: tStart, type: 'ENTRY' }
  ];

  const { shifts, activeShift } = WorkCalculator.pairShifts(records, Date.now());
  assert.notStrictEqual(activeShift, null);
  assert.strictEqual(activeShift.isActive, true);
  assert.strictEqual(activeShift.durationHours, 3.0);
});

// 8. Agrupación semanal y mensual
it('Debe agregar correctamente días trabajados en resumen semanal y mensual', () => {
  const d1 = new Date(2026, 10, 23, 8, 0, 0).getTime(); // Lunes
  const d1End = new Date(2026, 10, 23, 16, 0, 0).getTime();
  const d2 = new Date(2026, 10, 24, 8, 0, 0).getTime(); // Martes
  const d2End = new Date(2026, 10, 24, 18, 0, 0).getTime(); // 10h (8 reg + 2 extra)

  const records = [
    { id: '1', timestamp: d1, type: 'ENTRY' },
    { id: '2', timestamp: d1End, type: 'EXIT' },
    { id: '3', timestamp: d2, type: 'ENTRY' },
    { id: '4', timestamp: d2End, type: 'EXIT' }
  ];

  const { shifts } = WorkCalculator.pairShifts(records);
  const daily = WorkCalculator.aggregateByDay(shifts, 8.0);
  const weekly = WorkCalculator.aggregateByWeek(daily);
  const monthly = WorkCalculator.aggregateByMonth(daily);

  assert.strictEqual(weekly.length, 1);
  assert.strictEqual(weekly[0].daysWorked, 2);
  assert.strictEqual(weekly[0].totalHours, 18.0);
  assert.strictEqual(weekly[0].regularHours, 16.0);
  assert.strictEqual(weekly[0].overtimeHours, 2.0);

  assert.strictEqual(monthly.length, 1);
  assert.strictEqual(monthly[0].daysWorked, 2);
  assert.strictEqual(monthly[0].totalHours, 18.0);
});

// 9. Cálculo de distancia Haversine en GeoService
it('Debe calcular distancias geográficas con precisión métrica mediante fórmula Haversine', () => {
  // Coordenadas conocidas: Clínica San Carlos de Apoquindo a ~150 metros
  const lat1 = -33.400000;
  const lon1 = -70.500000;
  // Desplazamiento aproximado de ~111 metros al norte
  const lat2 = -33.399000;
  const lon2 = -70.500000;

  const distMeters = GeoService.haversineDistanceMeters(lat1, lon1, lat2, lon2);
  // 0.001 grados de latitud son aproximadamente 111 metros
  assert(distMeters >= 110 && distMeters <= 112, `Distancia esperada ~111m, obtenida: ${distMeters}m`);
});

// 10. Formato legible de horas
it('Debe formatear decimales a formato HH:mm legible', () => {
  assert.strictEqual(WorkCalculator.formatHoursReadable(8.5), '8h 30m');
  assert.strictEqual(WorkCalculator.formatHoursReadable(0.25), '0h 15m');
  assert.strictEqual(WorkCalculator.formatHoursReadable(7.75), '7h 45m');
  assert.strictEqual(WorkCalculator.formatHoursReadable(0), '0h 00m');
});

console.log(`\n======================================================`);
console.log(`RESULTADO DE PRUEBAS: ${testsPassed} Pasadas, ${testsFailed} Fallidas`);
console.log(`======================================================\n`);

if (testsFailed > 0) {
  process.exit(1);
}
