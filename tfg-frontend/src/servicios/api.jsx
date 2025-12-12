const isDevelopment = import.meta.env.DEV;

// Configurar la URL base según el entorno
const BASE_URL = isDevelopment 
  ? 'http://localhost:3000'
  : '';

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
  fetchPresets: () => request('/api/presets'),
  
  fetchFormats: () => request('/api/formats'),
  
  fetchJobs: () => request('/api/jobs'),
  
  fetchSystemHealth: () => request('/api/health'),
  
  fetchJob: (jobId) => request(`/api/job/${jobId}`),
  
  createJob: async (formData) => {
    try {
      console.log('Sending conversion request...');
      const url = `${BASE_URL}/api/convert`;
      const response = await fetch(url, {
        method: 'POST',
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
  
  cancelJob: (jobId) => request(`/api/job/${jobId}`, {
    method: 'DELETE'
  }),
  
  downloadJob: async (jobId) => {
    try {
      const url = `${BASE_URL}/api/download/${jobId}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.blob();
    } catch (error) {
      console.error('API Error (downloadJob):', error);
      throw error;
    }
  },
  
  analyzeFile: async (file) => {
    try {
      const formData = new FormData();
      formData.append('media', file);
      const url = `${BASE_URL}/api/analyze`;
      const response = await fetch(url, {
        method: 'POST',
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
  
  // Valida la compatibilidad entre preset y formato antes de convertir
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

  // Obtiene los formatos compatibles para un preset específico
  getPresetFormats: async (preset) => {
    try {
      return await request(`/api/preset/${preset}/formats`);
    } catch (error) {
      console.error('API Error (getPresetFormats):', error);
      throw error;
    }
  },

  // Obtiene los códecs compatibles para un formato específico
  getFormatCodecs: async (format) => {
    try {
      return await request(`/api/format/${format}/codecs`);
    } catch (error) {
      console.error('API Error (getFormatCodecs):', error);
      throw error;
    }
  }
};