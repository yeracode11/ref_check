import axios from 'axios';

// Get API URL from environment variable or use production default
// In Vite, environment variables are embedded at build time
// For production, set VITE_API_URL in .env.production or use the default
const baseURL = import.meta.env.VITE_API_URL || 'https://stellref.kz';

// Log base URL only in development
if (import.meta.env.DEV) {
  console.log('API Base URL:', baseURL);
}

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
  // Log request URL for debugging (only in development)
  if (import.meta.env.DEV) {
    const fullUrl = `${config.baseURL}${config.url}`;
    console.log(`[API Request] ${config.method?.toUpperCase()} ${fullUrl}`);
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


