import axios from 'axios';

/**
 * F1 placeholder axios instance.
 * baseURL falls back to local API dev port if VITE_API_BASE_URL is not set.
 * JWT injection / response interceptors will be added in F2 alongside auth.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000',
});
