import axios from 'axios';
import useAuthStore from '../store/authStore';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5002/api/v1';

/**
 * Create axios instance with base configuration
 */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor: Add authorization token to requests
 */
apiClient.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState().getTokens();

    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor: Handle 401/403 errors
 * 401: Token expired or invalid - attempt refresh
 * 403: Forbidden - user lacks permissions
 */
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  isRefreshing = false;
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const { status, data } = error.response || {};
    const originalRequest = error.config;

    // Handle 401 - Unauthorized (token expired)
    if (status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue this request to retry after token refresh
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { refreshToken } = useAuthStore.getState().getTokens();

        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        // Attempt to refresh token
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken, groupId: refreshedGroupId } = response.data;

        // Update store with new tokens
        useAuthStore.getState().updateAccessToken(accessToken);
        if (newRefreshToken) {
          useAuthStore.setState({
            refreshToken: newRefreshToken,
          });
        }
        if (Object.prototype.hasOwnProperty.call(response.data, 'groupId')) {
          useAuthStore.getState().setUser({
            groupId: refreshedGroupId,
            activeGroupId: refreshedGroupId,
            currentGroupId: refreshedGroupId,
          });
        }

        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        processQueue(null, accessToken);

        return apiClient(originalRequest);
      } catch (refreshError) {
        // Token refresh failed - clear auth and redirect to login
        useAuthStore.getState().clearAuth();
        processQueue(refreshError, null);

        // Redirect to login page
        window.location.href = '/auth/login';

        return Promise.reject(refreshError);
      }
    }

    // Handle 403 - Forbidden (insufficient permissions)
    if (status === 403) {
      const forbiddenError = new Error(data?.message || 'Access forbidden');
      forbiddenError.code = data?.code || 'FORBIDDEN';
      forbiddenError.response = error.response;
      forbiddenError.status = status;
      return Promise.reject(forbiddenError);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
