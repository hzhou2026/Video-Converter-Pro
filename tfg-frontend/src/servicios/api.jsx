const BASE_URL = 'http://localhost:3000';

/**
 * Maneja errores de las peticiones HTTP
 */
const handleResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

/**
 * Realiza una petición HTTP
 */
const request = async (endpoint, options = {}) => {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
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

/**
 * API service para interactuar con el backend
 */
export const api = {
  /**
   * Obtiene los presets de conversión disponibles
   */
  fetchPresets: () => request('/api/presets'),

  /**
   * Obtiene los formatos de video soportados
   */
  fetchFormats: () => request('/api/formats'),

  /**
   * Obtiene todos los trabajos de conversión
   */
  fetchJobs: () => request('/api/jobs'),

  /**
   * Obtiene el estado de salud del sistema
   */
  fetchSystemHealth: () => request('/api/health'),

  /**
   * Obtiene un trabajo específico por ID
   * @param {string} jobId - ID del trabajo
   */
  fetchJob: (jobId) => request(`/api/job/${jobId}`),

  /**
   * Crea un nuevo trabajo de conversión
   * @param {FormData} formData - Datos del formulario con el archivo y configuración
   */
  createJob: async (formData) => {
    try {
      const response = await fetch(`${BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData // No establecer Content-Type para FormData
      });
      return handleResponse(response);
    } catch (error) {
      console.error('API Error (createJob):', error);
      throw error;
    }
  },

  /**
   * Cancela un trabajo de conversión
   * @param {string} jobId - ID del trabajo a cancelar
   */
  cancelJob: (jobId) => request(`/api/job/${jobId}`, {
    method: 'DELETE'
  }),

  /**
   * Descarga el archivo convertido
   * @param {string} jobId - ID del trabajo
   * @returns {Promise<Blob>} - Archivo como Blob
   */
  downloadJob: async (jobId) => {
    try {
      const response = await fetch(`${BASE_URL}/api/download/${jobId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.blob();
    } catch (error) {
      console.error('API Error (downloadJob):', error);
      throw error;
    }
  },

  /**
   * Obtiene métricas del sistema
   */
  fetchMetrics: () => request('/api/metrics'),

  /**
   * Limpia trabajos antiguos completados
   */
  cleanupJobs: () => request('/api/jobs/cleanup', {
    method: 'POST'
  })
};