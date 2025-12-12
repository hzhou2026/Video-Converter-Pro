const isDevelopment = import.meta.env.DEV;

// Configurar la URL base según el entorno
const BASE_URL = isDevelopment 
  ? 'http://localhost:3000'
  : '';

// Gestión de userId persistente
const getUserId = () => {
  let userId = localStorage.getItem('userId');
  if (!userId) {
    userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('userId', userId);
  }
  return userId;
};

const handleResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

const request = async (endpoint, options = {}) => {
  try {
    const url = `${BASE_URL}${endpoint}`;
    console.log('API Request:', url);
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': getUserId(), // Siempre incluir userId
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

export const api = {
  // Obtener todos los presets disponibles
  fetchPresets: () => request('/api/presets'),
  
  // Obtener todos los formatos soportados por FFmpeg
  fetchFormats: () => request('/api/formats'),
  
  // Obtener todos los códecs soportados
  fetchCodecs: () => request('/api/codecs'),
  
  // Obtener todos los jobs del usuario actual
  fetchJobs: () => request('/api/jobs'),
  
  // Verificar salud del sistema
  fetchSystemHealth: () => request('/api/health'),
  
  // Obtener estado de un job específico
  fetchJob: (jobId) => request(`/api/job/${jobId}`),
  
  // Crear un nuevo job de conversión
  createJob: async (formData) => {
    try {
      console.log('Sending conversion request...');
      const url = `${BASE_URL}/api/convert`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-user-id': getUserId() // Incluir userId en el header
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
      const url = `${BASE_URL}/api/download/${jobId}`;
      const response = await fetch(url, {
        headers: {
          'x-user-id': getUserId()
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
      const formData = new FormData();
      formData.append('media', file);
      const url = `${BASE_URL}/api/analyze`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-user-id': getUserId()
        },
        body: formData
      });
      return handleResponse(response);
    } catch (error) {
      console.error('API Error (analyzeFile):', error);
      throw error;
    }
  },
  
  // Validar compatibilidad preset-formato
  validateConversion: async (preset, format) => {
    try {
      const response = await fetch(`${BASE_URL}/api/validate-conversion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': getUserId()
        },
        body: JSON.stringify({ preset, format })
      });
      
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
  },

  // Obtener estado de usuario y sus jobs
  getUserStatus: async (userId) => {
    try {
      return await request(`/api/user/${userId || getUserId()}/status`);
    } catch (error) {
      console.error('API Error (getUserStatus):', error);
      throw error;
    }
  },

  // Obtener el userId actual
  getCurrentUserId: getUserId
};