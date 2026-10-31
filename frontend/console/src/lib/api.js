import axios from 'axios';
import { useAuth } from '@/store/auth';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

export const api = axios.create({ baseURL: API_URL, withCredentials: true, timeout: 30000 });

api.interceptors.request.use((cfg) => {
  const { token, branchId } = useAuth.getState();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  if (branchId && !cfg.headers['x-branch-id'] && cfg.branchScoped !== false) cfg.headers['x-branch-id'] = branchId;
  return cfg;
});

let refreshing = null;
export async function refreshToken() {
  refreshing ||= axios
    .post(`${API_URL}/auth/staff/refresh`, {}, { withCredentials: true })
    .then((r) => {
      useAuth.getState().setToken(r.data.data.accessToken);
      return r.data.data.accessToken;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config;
    const isAuthCall = cfg?.url?.includes('/auth/staff/');
    if (err.response?.status === 401 && !cfg._retry && !isAuthCall) {
      cfg._retry = true;
      try {
        const t = await refreshToken();
        cfg.headers.Authorization = `Bearer ${t}`;
        return api(cfg);
      } catch {
        useAuth.getState().logout(false);
      }
    }
    return Promise.reject(err);
  }
);

/** unwrap {success,data} */
export const get = (url, params, cfg) => api.get(url, { params, ...cfg }).then((r) => r.data.data);
export const getPaged = (url, params) => api.get(url, { params }).then((r) => ({ items: r.data.data, meta: r.data.meta }));
export const post = (url, body, cfg) => api.post(url, body, cfg).then((r) => r.data.data);
export const patch = (url, body) => api.patch(url, body).then((r) => r.data.data);
export const put = (url, body) => api.put(url, body).then((r) => r.data.data);
export const del = (url) => api.delete(url).then((r) => r.data.data);

/** Fetch binary (PDF/CSV) with auth and open/download */
export async function openFile(url, { download, filename, params } = {}) {
  const r = await api.get(url, { responseType: 'blob', params });
  const blobUrl = URL.createObjectURL(r.data);
  if (download) {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'download';
    a.click();
  } else window.open(blobUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
