/**
 * Módulo de Sincronización Opcional con Google Sheets
 * - DESACTIVADO por defecto.
 * - Solo se activa con consentimiento explícito del usuario.
 * - FILTRADO ESTRICTO DE PRIVACIDAD: Nunca envía coordenadas geográficas,
 *   latitud, longitud, precisión GPS ni notas confidenciales.
 *   Únicamente envía la marca temporal (fecha/hora) y el tipo de evento (ENTRADA o SALIDA).
 */

class GoogleSheetsSync {
  /**
   * Envía un evento a Google Sheets mediante Webhook de Google Apps Script
   * @param {string} webhookUrl
   * @param {'ENTRY'|'EXIT'} eventType
   * @param {number} timestampEpoch
   */
  static async sendEventIfEnabled(webhookUrl, isEnabled, eventType, timestampEpoch) {
    if (!isEnabled || !webhookUrl || !webhookUrl.startsWith('https://script.google.com/')) {
      // Sincronización inactiva o URL no configurada; no se realiza ninguna petición
      return { sent: false, reason: 'Sync desactivado o URL no válida' };
    }

    const d = new Date(timestampEpoch);
    
    // Payload sanitizado: CERO datos de ubicación para proteger la privacidad
    const minimalPayload = {
      tipoEvento: eventType === 'ENTRY' ? 'ENTRADA' : 'SALIDA',
      fecha: WorkCalculator.getLocalDateKey(timestampEpoch),
      hora: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      isoTimestamp: d.toISOString()
    };

    try {
      // Se utiliza mode: 'no-cors' ya que los webhooks de Apps Script redirigen (302)
      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(minimalPayload)
      });

      console.log('[SheetsSync] Evento mínimo transmitido exitosamente a Google Sheets');
      return { sent: true };
    } catch (err) {
      console.warn('[SheetsSync] Error al enviar a Google Sheets:', err);
      return { sent: false, error: err.message };
    }
  }

  /**
   * Código de plantilla de Google Apps Script listo para copiar y pegar
   */
  static getAppsScriptTemplateCode() {
    return `
/**
 * Pega este código en extensiones -> Apps Script de tu Google Sheet
 * y haz clic en "Implementar" -> "Nueva implementación" -> "Aplicación web"
 * Configura "Quién tiene acceso" en "Cualquiera" (Anyone).
 */
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (sheet.getLastRow() === 0) {
      // Crear encabezados si la hoja está vacía
      sheet.appendRow(["Fecha", "Hora", "Tipo de Evento", "Timestamp ISO"]);
    }
    
    var data = JSON.parse(e.postData.contents);
    sheet.appendRow([
      data.fecha,
      data.hora,
      data.tipoEvento,
      data.isoTimestamp
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
`.trim();
  }
}

window.GoogleSheetsSync = GoogleSheetsSync;
