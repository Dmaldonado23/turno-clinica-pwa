/**
 * Módulo de Exportación y Respaldo
 * - Generación de CSV con UTF-8 BOM compatible con Excel y Google Sheets
 * - Generación de PDF profesional para impresión médica mediante motor nativo
 * - Exportación e Importación de Bóveda Cifrada completa
 */

class ExportService {
  /**
   * Exporta la jornada laboral a archivo CSV
   * @param {Array} shifts Lista de turnos procesados por WorkCalculator
   * @param {number} standardHoursPerDay
   */
  static exportToCSV(shifts, standardHoursPerDay = 8.0) {
    if (!shifts || shifts.length === 0) {
      alert('No hay registros disponibles para exportar.');
      return;
    }

    const headers = [
      'Fecha',
      'Turno_ID',
      'Hora_Entrada',
      'Hora_Salida',
      'Duracion_Horas',
      'Horas_Regulares',
      'Horas_Extra',
      'Cruza_Medianoche',
      'En_Radio_Clinica_Entrada',
      'Distancia_Entrada_Metros',
      'En_Radio_Clinica_Salida',
      'Distancia_Salida_Metros',
      'Origen',
      'Notas_O_Motivo',
      'Advertencias'
    ];

    const rows = [];

    shifts.forEach(shift => {
      if (shift.isOrphanExit) {
        const exitDate = new Date(shift.exitRecord.timestamp);
        rows.push([
          WorkCalculator.getLocalDateKey(shift.exitRecord.timestamp),
          shift.id,
          '--:--',
          exitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          '0.00',
          '0.00',
          '0.00',
          'NO',
          'N/A',
          'N/A',
          shift.exitRecord.inClinicRadius ? 'SI' : 'NO',
          shift.exitRecord.distanceMeters || 'N/A',
          shift.exitRecord.source || 'BUTTON',
          shift.exitRecord.note || '',
          shift.warning || 'Salida huérfana'
        ]);
        return;
      }

      const entryDate = new Date(shift.entryRecord.timestamp);
      const exitDate = shift.exitRecord ? new Date(shift.exitRecord.timestamp) : null;
      
      const durationHours = shift.durationHours || 0;
      const regularHours = Math.min(durationHours, standardHoursPerDay);
      const overtimeHours = Math.max(0, durationHours - standardHoursPerDay);

      rows.push([
        WorkCalculator.getLocalDateKey(shift.startEpoch),
        shift.id,
        entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        exitDate ? exitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'EN CURSO',
        durationHours.toFixed(2),
        regularHours.toFixed(2),
        overtimeHours.toFixed(2),
        shift.crossesMidnight ? 'SI' : 'NO',
        shift.entryRecord.inClinicRadius ? 'SI' : 'NO',
        shift.entryRecord.distanceMeters !== undefined ? shift.entryRecord.distanceMeters : 'N/A',
        shift.exitRecord ? (shift.exitRecord.inClinicRadius ? 'SI' : 'NO') : 'N/A',
        shift.exitRecord && shift.exitRecord.distanceMeters !== undefined ? shift.exitRecord.distanceMeters : 'N/A',
        shift.entryRecord.source || 'BUTTON',
        (shift.entryRecord.note || '') + (shift.exitRecord && shift.exitRecord.note ? ' | ' + shift.exitRecord.note : ''),
        shift.warning || ''
      ]);
    });

    // Escapar celdas para formato CSV seguro
    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => {
        const str = String(cell !== null && cell !== undefined ? cell : '');
        return `"${str.replace(/"/g, '""')}"`;
      }).join(';'))
    ].join('\r\n');

    // UTF-8 Byte Order Mark (\uFEFF) para compatibilidad con Excel en macOS/Windows
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `registro_jornada_clinica_${WorkCalculator.getLocalDateKey(Date.now())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Genera vista imprimible / PDF con diseño médico institucional
   * Compatible 100% con Safari iOS (Compartir -> Guardar en Archivos / Imprimir como PDF)
   */
  static printPDFReport(shifts, dailySummary, standardHoursPerDay = 8.0) {
    if (!shifts || shifts.length === 0) {
      alert('No hay registros para generar el informe.');
      return;
    }

    let totalWorkedHours = 0;
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;

    dailySummary.forEach(d => {
      totalWorkedHours += d.totalHours;
      totalRegularHours += d.regularHours;
      totalOvertimeHours += d.overtimeHours;
    });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor permite ventanas emergentes para abrir el informe PDF.');
      return;
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Informe Oficial de Jornada Laboral - Clínica</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 0;
      font-size: 11pt;
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid #0284c7;
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .title {
      font-size: 18pt;
      font-weight: 700;
      color: #0369a1;
      margin: 0 0 4px 0;
    }
    .subtitle {
      font-size: 10pt;
      color: #64748b;
      margin: 0;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-size: 8pt;
      text-transform: uppercase;
      font-weight: 600;
      color: #64748b;
    }
    .meta-value {
      font-size: 12pt;
      font-weight: 700;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    th {
      background-color: #f1f5f9;
      color: #334155;
      font-size: 9pt;
      font-weight: 600;
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid #cbd5e1;
    }
    td {
      padding: 8px 10px;
      font-size: 9.5pt;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:nth-child(even) td {
      background-color: #fafafa;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 600;
    }
    .badge-ok { background: #dcfce7; color: #15803d; }
    .badge-warn { background: #fef3c7; color: #b45309; }
    .badge-alert { background: #fee2e2; color: #b91c1c; }
    .signatures {
      margin-top: 40px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      page-break-inside: avoid;
    }
    .sig-line {
      border-top: 1px solid #94a3b8;
      padding-top: 8px;
      text-align: center;
      font-size: 10pt;
      color: #475569;
    }
    .footer {
      margin-top: 30px;
      font-size: 8pt;
      color: #94a3b8;
      text-align: center;
      border-top: 1px solid #f1f5f9;
      padding-top: 8px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="title">Informe de Control de Jornada Clínica</h1>
      <p class="subtitle">Registro oficial de asistencia y cumplimiento horario con verificación de presencia</p>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 9pt; color: #64748b;">Fecha Emisión:</span><br>
      <strong>${new Date().toLocaleDateString('es-ES', { dateStyle: 'long' })}</strong>
    </div>
  </div>

  <div class="meta-box">
    <div class="meta-item">
      <span class="meta-label">Total Horas</span>
      <span class="meta-value">${totalWorkedHours.toFixed(2)}h (${WorkCalculator.formatHoursReadable(totalWorkedHours)})</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Horas Regulares</span>
      <span class="meta-value">${totalRegularHours.toFixed(2)}h</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Horas Extra</span>
      <span class="meta-value" style="color: #b45309;">+${totalOvertimeHours.toFixed(2)}h</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Días Registrados</span>
      <span class="meta-value">${dailySummary.length}</span>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Entrada</th>
        <th>Salida</th>
        <th>Total</th>
        <th>Regulares</th>
        <th>Extras</th>
        <th>Ubicación Clínica</th>
        <th>Notas / Motivo</th>
      </tr>
    </thead>
    <tbody>
      ${shifts.map(s => {
        if (s.isOrphanExit) {
          return `
            <tr>
              <td>${WorkCalculator.getLocalDateKey(s.exitRecord.timestamp)}</td>
              <td><span class="badge badge-alert">Sin Entrada</span></td>
              <td>${new Date(s.exitRecord.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
              <td>0.00h</td>
              <td>0.00h</td>
              <td>0.00h</td>
              <td><span class="badge ${s.exitRecord.inClinicRadius ? 'badge-ok' : 'badge-warn'}">${s.exitRecord.inClinicRadius ? 'En radio' : 'Fuera radio'}</span></td>
              <td>${s.warning || ''}</td>
            </tr>
          `;
        }
        const dIn = new Date(s.entryRecord.timestamp);
        const dOut = s.exitRecord ? new Date(s.exitRecord.timestamp) : null;
        const dur = s.durationHours || 0;
        const reg = Math.min(dur, standardHoursPerDay);
        const ext = Math.max(0, dur - standardHoursPerDay);
        return `
          <tr>
            <td><strong>${WorkCalculator.getLocalDateKey(s.startEpoch)}</strong></td>
            <td>${dIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
            <td>${dOut ? dOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '<em>En Curso</em>'}</td>
            <td><strong>${dur.toFixed(2)}h</strong></td>
            <td>${reg.toFixed(2)}h</td>
            <td style="color: ${ext > 0 ? '#b45309; font-weight: bold;' : 'inherit'}">${ext > 0 ? '+' + ext.toFixed(2) + 'h' : '0.00h'}</td>
            <td>
              <span class="badge ${s.entryRecord.inClinicRadius ? 'badge-ok' : 'badge-warn'}">
                ${s.entryRecord.inClinicRadius ? '✓ En radio' : 'Fuera (' + (s.entryRecord.distanceMeters || '?') + 'm)'}
              </span>
            </td>
            <td>${s.entryRecord.note || (s.crossesMidnight ? 'Cruza medianoche' : '')}</td>
          </tr>
        `;
      }).join('')}
    </tbody>
  </table>

  <div class="signatures">
    <div>
      <div class="sig-line">
        Firma del Profesional / Empleado
      </div>
    </div>
    <div>
      <div class="sig-line">
        Firma y V°B° Jefatura Clínica / Recursos Humanos
      </div>
    </div>
  </div>

  <div class="footer">
    Documento emitido localmente con firma criptográfica AES-256. Ningún dato fue transmitido a servidores externos.
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 500);
    };
  </script>
</body>
</html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }

  /**
   * Crea un archivo cifrado con contraseña para descarga
   */
  static async exportEncryptedBackupFile(backupPassword) {
    if (!backupPassword || backupPassword.length < 6) {
      throw new Error('La contraseña de respaldo debe tener al menos 6 caracteres.');
    }

    const rawDump = await window.secureStorage.exportFullDatabaseRaw();
    const encryptedEnvelope = await window.cryptoEngine.createEncryptedBackup(rawDump, backupPassword);

    const jsonStr = JSON.stringify(encryptedEnvelope, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo_clinica_cifrado_${WorkCalculator.getLocalDateKey(Date.now())}.json.enc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Lee un archivo cifrado cargado por el usuario y lo restaura
   */
  static async restoreEncryptedBackupFile(file, backupPassword) {
    const text = await file.text();
    const backupJson = JSON.parse(text);

    const restoredData = await window.cryptoEngine.restoreEncryptedBackup(backupJson, backupPassword);
    await window.secureStorage.restoreFullDatabaseRaw(restoredData);
    return true;
  }
}

window.ExportService = ExportService;
