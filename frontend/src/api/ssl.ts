import axios from 'axios';
import { getApiErrorMessage, http } from './http';
import type {
  CaCertFormat,
  CaStatus,
  CreateCaPayload,
  GenerateNginxPayload,
  IssueCertPayload,
} from './types';

export function getHealth() {
  return http.get('/health');
}

export async function getCaStatus(): Promise<CaStatus> {
  const { data } = await http.get<CaStatus>('/ca');
  return data;
}

export async function createCa(payload: CreateCaPayload): Promise<CaStatus> {
  const timeout = payload.keySize === 8192 ? 300_000 : 120_000;
  const { data } = await http.post<CaStatus>('/ca', payload, { timeout });
  return data;
}

export async function downloadCaCert(options?: {
  filename?: string;
  format?: CaCertFormat;
}): Promise<string> {
  try {
    const params: { filename?: string; format?: CaCertFormat } = {};
    if (options?.filename?.trim()) {
      params.filename = options.filename.trim();
    }
    if (options?.format) {
      params.format = options.format;
    }

    const response = await http.get<Blob>('/ca/download', {
      params,
      responseType: 'blob',
    });

    const filename =
      parseFilename(response.headers['content-disposition']) ??
      options?.filename?.trim() ??
      'Root-CA.crt';
    const contentType = response.headers['content-type'];
    const blob = new Blob([response.data], {
      type: typeof contentType === 'string' && contentType
        ? contentType
        : 'application/x-x509-ca-cert',
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
    return filename;
  } catch (error) {
    throw new Error(await resolveBlobError(error, '下载根证书失败'));
  }
}

function parseFilename(disposition: unknown): string | undefined {
  if (typeof disposition !== 'string') {
    return undefined;
  }
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]);
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1];
}

async function resolveBlobError(error: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const text = await error.response.data.text();
      const json = JSON.parse(text) as { message?: string | string[] };
      if (Array.isArray(json.message)) {
        return json.message.join('；');
      }
      if (typeof json.message === 'string' && json.message.trim()) {
        return json.message;
      }
    } catch {
      // 响应不是 JSON 时回退到通用错误
    }
  }
  return getApiErrorMessage(error, fallback);
}

export function listCerts() {
  return http.get('/certs');
}

export function issueCert(payload: IssueCertPayload) {
  return http.post('/certs', payload);
}

export function getCertDetail(name: string) {
  return http.get(`/certs/${encodeURIComponent(name)}`);
}

export function generateNginxConfig(payload: GenerateNginxPayload) {
  return http.post('/nginx/config', payload);
}

export function getWindowsTrustGuide() {
  return http.get('/guides/windows-trust');
}
