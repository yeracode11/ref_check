import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

export const api = axios.create({ 
  baseURL,
  timeout: 300000, // 5 минут для больших файлов
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle errors with retry logic
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    // Don't retry on 4xx errors (client errors)
    if (error.response?.status >= 400 && error.response?.status < 500) {
      if (error.response.status === 401) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // Retry on network errors or 5xx errors (up to 3 times)
    if (!config._retry && (error.code === 'ERR_NETWORK' || error.code === 'ERR_CONNECTION_CLOSED' || (error.response?.status >= 500))) {
      config._retry = true;
      config._retryCount = (config._retryCount || 0) + 1;

      if (config._retryCount <= 3) {
        console.log(`Retrying request (${config._retryCount}/3):`, config.url);
        await new Promise(resolve => setTimeout(resolve, 1000 * config._retryCount)); // Exponential backoff
        return api(config);
      }
    }

    return Promise.reject(error);
  }
);


