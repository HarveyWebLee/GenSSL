import axios from 'axios';

export const http = axios.create({
  baseURL: '/api',
  timeout: 30_000,
});

export function getApiErrorMessage(error: unknown, fallback = '请求失败，请稍后重试'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    const msg = data?.message;
    if (Array.isArray(msg)) {
      return msg.join('；');
    }
    if (typeof msg === 'string' && msg.trim()) {
      return msg;
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
