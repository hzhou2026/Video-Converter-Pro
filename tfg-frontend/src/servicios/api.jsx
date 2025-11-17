const BASE_URL = `${globalThis.location.protocol}//${globalThis.location.hostname}:3000`;

const handleResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

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

export const api = {
  fetchPresets: () => request('/api/presets'),
  
  fetchFormats: () => request('/api/formats'),
  
  fetchJobs: () => request('/api/jobs'),
  
  fetchSystemHealth: () => request('/api/health'),
  
  fetchJob: (jobId) => request(`/api/job/${jobId}`),
  
  createJob: async (formData) => {
    try {
      console.log('📤 Sending conversion request...');
      const response = await fetch(`${BASE_URL}/api/convert`, {
        method: 'POST',
        body: formData
      });
      const data = await handleResponse(response);
      console.log('✅ Conversion request successful:', data);
      return data;
    } catch (error) {
      console.error('❌ API Error (createJob):', error);
      throw error;
    }
  },
  
  cancelJob: (jobId) => request(`/api/job/${jobId}`, {
    method: 'DELETE'
  }),
  
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
  
  analyzeFile: async (file) => {
    try {
      const formData = new FormData();
      formData.append('media', file);
      const response = await fetch(`${BASE_URL}/api/analyze`, {
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
  })
};