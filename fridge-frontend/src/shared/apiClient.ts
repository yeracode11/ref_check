import axios from 'axios';

// Get API URL from environment variable or use production default
// In Vite, environment variables are embedded at build time
// For production, set VITE_API_URL in .env.production or use the default
let baseURL = import.meta.env.VITE_API_URL || 'https://stellref.kz';

// Normalize baseURL: remove trailing slash to avoid double slashes
baseURL = baseURL.replace(/\/+$/, '');

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
  
  // Ensure Content-Type is set for POST/PUT/PATCH requests
  if (['post', 'put', 'patch'].includes(config.method?.toLowerCase() || '')) {
    if (!config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }
  }
  
  // Log request URL only in development
  if (import.meta.env.DEV) {
    const fullUrl = `${config.baseURL}${config.url}`;
    console.log(`[API Request] ${config.method?.toUpperCase()} ${fullUrl}`);
    // Log request data for login requests (without password for security)
    if (config.url?.includes('/auth/login') && config.data) {
      console.log('[API Request Data]', { 
        username: config.data.username, 
        password: '***',
        hasUsername: !!config.data.username,
        hasPassword: !!config.data.password,
        dataType: typeof config.data
      });
    }
  }
  return config;
});

// Handle errors with retry logic
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    
    // Log error details only in development
    if (import.meta.env.DEV) {
      const errorDetails = {
        url: `${config?.baseURL}${config?.url}`,
        method: config?.method,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        code: error.code,
      };
      
      console.error('[API Error]', errorDetails);
      // Log full error response data for debugging
      if (error.response?.data) {
        console.error('[API Error Data]', error.response.data);
        console.error('[API Error Data JSON]', JSON.stringify(error.response.data, null, 2));
      }
      // Log request data for login attempts
      if (config?.url?.includes('/auth/login')) {
        console.error('[API Login Request Data]', {
          username: config.data?.username,
          hasPassword: !!config.data?.password,
          passwordLength: config.data?.password?.length || 0
        });
      }
    }

    // Don't retry on 4xx errors (client errors)
    if (error.response?.status >= 400 && error.response?.status < 500) {
      if (error.response.status === 401) {
        // Don't redirect on login page - let LoginPage handle the error
        if (!config.url?.includes('/auth/login')) {
          localStorage.removeItem('token');
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    }

    // Retry on network errors or 5xx errors (up to 3 times)
    if (!config._retry && (error.code === 'ERR_NETWORK' || error.code === 'ERR_CONNECTION_CLOSED' || (error.response?.status >= 500))) {
      config._retry = true;
      config._retryCount = (config._retryCount || 0) + 1;

      if (config._retryCount <= 3) {
        if (import.meta.env.DEV) {
          console.log(`Retrying request (${config._retryCount}/3):`, config.url);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * config._retryCount)); // Exponential backoff
        return api(config);
      }
    }

    return Promise.reject(error);
  }
);


