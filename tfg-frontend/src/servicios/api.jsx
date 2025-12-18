const isDevelopment = import.meta.env.DEV;

// Configurar la URL base según el entorno
const BASE_URL = isDevelopment
  ? `http://${globalThis.location.hostname}:3000`
  : '';

// Función para generar UUID compatible
const generateUUID = () => {
    // Intentar usar crypto.randomUUID si está disponible
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    
    // Fallback: generar UUID manualmente
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, (c) => {
        const r = Math.trunc(Math.random() * 16);
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// Obtener o generar sessionId
const getSessionId = () => {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = generateUUID();
        localStorage.setItem('sessionId', sessionId);
        console.log('🆔 New sessionId generated:', sessionId);
    }
    return sessionId;
};

// Manejar respuestas de la API
const handleResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

// Función genérica para hacer peticiones API
const request = async (endpoint, options = {}) => {
  try {
    const sessionId = getSessionId();
    const url = `${BASE_URL}${endpoint}`;
    console.log('API Request:', url);

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
        ...options.headers
      },
      ...options
    });
    return handleResponse(response);
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    throw error;
  }
};

// Exportar funciones de la API
export const api = {
  // Obtener todos los presets disponibles
  fetchPresets: () => request('/api/presets'),

  // Obtener todos los formatos soportados por FFmpeg
  fetchFormats: () => request('/api/formats'),

  // Obtener todos los jobs del usuario actual
  fetchJobs: () => request('/api/jobs'),

  // Verificar salud del sistema
  fetchSystemHealth: () => request('/api/health'),

  // Obtener estado de un job específico
  fetchJob: (jobId) => request(`/api/job/${jobId}`),

  // Crear un nuevo job de conversión
  createJob: async (formData) => {
    try {
      const sessionId = getSessionId();
      console.log('Sending conversion request...');
      const url = `${BASE_URL}/api/convert`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-session-id': sessionId
        },
        body: formData
      });
      const data = await handleResponse(response);
      console.log('Conversion request successful:', data);
      return data;
    } catch (error) {
      console.error('API Error (createJob):', error);
      throw error;
    }
  },

  // Cancelar un job
  cancelJob: (jobId) => request(`/api/job/${jobId}`, {
    method: 'DELETE'
  }),

  // Descargar archivo convertido
  downloadJob: async (jobId) => {
    try {
      const sessionId = getSessionId();
      const url = `${BASE_URL}/api/download/${jobId}`;
      const response = await fetch(url, {
        headers: {
          'x-session-id': sessionId
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.blob();
    } catch (error) {
      console.error('API Error (downloadJob):', error);
      throw error;
    }
  },

  // Analizar archivo multimedia
  analyzeFile: async (file) => {
    try {
      const sessionId = getSessionId();
      const formData = new FormData();
      formData.append('media', file);
      const url = `${BASE_URL}/api/analyze`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-session-id': sessionId
        },
        body: formData
      });
      return handleResponse(response);
    } catch (error) {
      console.error('API Error (analyzeFile):', error);
      throw error;
    }
  },

  fetchMetrics: () => request('/api/metrics'),

  cleanupJobs: () => request('/api/jobs/cleanup', {
    method: 'POST'
  }),

  // Validar compatibilidad preset-formato
  validateConversion: async (preset, format) => {
    try {
      const response = await fetch(`${BASE_URL}/api/validate-conversion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ preset, format })
      });

      // Siempre devolver el JSON, incluso si hay error
      const data = await response.json();

      return {
        ok: response.ok,
        status: response.status,
        ...data
      };
    } catch (error) {
      console.error('API Error (validateConversion):', error);
      throw error;
    }
  },

  // Obtener formatos compatibles para un preset
  getPresetFormats: async (preset) => {
    try {
      return await request(`/api/preset/${preset}/formats`);
    } catch (error) {
      console.error('API Error (getPresetFormats):', error);
      throw error;
    }
  },

  // Obtener códecs compatibles para un formato
  getFormatCodecs: async (format) => {
    try {
      return await request(`/api/format/${format}/codecs`);
    } catch (error) {
      console.error('API Error (getFormatCodecs):', error);
      throw error;
    }
  }
};

