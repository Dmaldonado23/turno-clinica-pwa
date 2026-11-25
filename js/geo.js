/**
 * Módulo de Geolocalización y Verificación de Radio de la Clínica
 * Opera ÚNICAMENTE en el momento exacto en que el usuario presiona el botón.
 * NUNCA rastrea en segundo plano (cumpliendo límites estrictos de iOS Safari).
 */

class GeoService {
  /**
   * Calcula la distancia en metros entre dos coordenadas usando la fórmula de Haversine
   */
  static haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio medio de la Tierra en metros
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
  }

  /**
   * Obtiene la posición actual del dispositivo con alta precisión
   * @param {number} timeoutMs
   * @returns {Promise<{lat: number|null, lng: number|null, accuracy: number|null, error: string|null}>}
   */
  static async getCurrentPosition(timeoutMs = 12000) {
    if (!('geolocation' in navigator)) {
      return {
        lat: null,
        lng: null,
        accuracy: null,
        error: 'Geolocalización no soportada en este navegador'
      };
    }

    return new Promise((resolve) => {
      const options = {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0 // Siempre forzar lectura fresca del sensor GPS
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: Math.round(position.coords.accuracy),
            error: null
          });
        },
        (geoError) => {
          let errorMsg = 'Error al obtener ubicación';
          switch (geoError.code) {
            case geoError.PERMISSION_DENIED:
              errorMsg = 'Permiso de ubicación denegado';
              break;
            case geoError.POSITION_UNAVAILABLE:
              errorMsg = 'Señal de ubicación no disponible';
              break;
            case geoError.TIMEOUT:
              errorMsg = 'Tiempo de espera de GPS agotado';
              break;
          }
          resolve({
            lat: null,
            lng: null,
            accuracy: null,
            error: errorMsg
          });
        },
        options
      );
    });
  }

  /**
   * Obtiene la posición y evalúa si está dentro del radio configurado de la clínica
   * No bloquea el registro si está fuera del radio o si no hay GPS.
   */
  static async verifyClinicLocation(clinicLat, clinicLng, clinicRadiusMeters = 150) {
    const geoResult = await this.getCurrentPosition();

    if (geoResult.error || geoResult.lat === null || geoResult.lng === null) {
      return {
        lat: null,
        lng: null,
        accuracy: null,
        distanceMeters: null,
        inClinicRadius: false,
        statusText: geoResult.error || 'Sin datos GPS',
        hasGps: false
      };
    }

    // Si la clínica aún no tiene coordenadas configuradas
    if (clinicLat === null || clinicLng === null || isNaN(clinicLat) || isNaN(clinicLng)) {
      return {
        lat: geoResult.lat,
        lng: geoResult.lng,
        accuracy: geoResult.accuracy,
        distanceMeters: null,
        inClinicRadius: true,
        statusText: 'Ubicación registrada (Coordenadas de clínica no configuradas)',
        hasGps: true
      };
    }

    const distance = this.haversineDistanceMeters(
      geoResult.lat,
      geoResult.lng,
      Number(clinicLat),
      Number(clinicLng)
    );

    const inRadius = distance <= clinicRadiusMeters;

    return {
      lat: geoResult.lat,
      lng: geoResult.lng,
      accuracy: geoResult.accuracy,
      distanceMeters: distance,
      inClinicRadius: inRadius,
      statusText: inRadius
        ? `Dentro del radio (${distance} m de la clínica)`
        : `Fuera del radio (${distance} m de la clínica - límite ${clinicRadiusMeters} m)`,
      hasGps: true
    };
  }
}

// Exportar globalmente
if (typeof window !== 'undefined') {
  window.GeoService = GeoService;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeoService;
}
