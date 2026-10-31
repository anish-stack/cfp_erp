import axios from 'axios';
import { usePatient } from '@/store/patient';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1', timeout: 20000 });

api.interceptors.request.use((cfg) => {
  const t = usePatient.getState().token;
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && usePatient.getState().token && !e.config.url.includes('/auth/')) usePatient.getState().logout();
    return Promise.reject(e);
  }
);

export const get = (url, params) => api.get(url, { params }).then((r) => r.data.data);
export const post = (url, body) => api.post(url, body).then((r) => r.data.data);
export const patch = (url, body) => api.patch(url, body).then((r) => r.data.data);
