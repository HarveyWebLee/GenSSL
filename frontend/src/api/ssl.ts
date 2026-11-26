import axios from 'axios';
import { getApiErrorMessage, http } from './http';
import type {
  ArchiveLibrary,
  CaCertFormat,
  CaListResponse,
  CertificateDetail,
  CertificateSummary,
  CreateCaPayload,
  DeployRecord,
  GenerateNginxPayload,
  IssueCertPayload,
  NginxConfigResult,
  NginxReleaseDetail,
  NginxRestartResult,
  NginxServiceDetail,
  NginxServiceSummary,
  NginxServiceWritePayload,
  OverviewData,
  PublishNginxServicePayload,
  RegenerateCaPayload,
  RegenerateCertPayload,
  RegenerateCertsBatchPayload,
  RegenerateCertsBatchResult,
  RootCaSummary,
  ServerRecord,
  ServerWritePayload,
  TargetFileList,
  TestConnectionPayload,
  TestConnectionResult,
  WindowsTrustGuide,
} from './types';

export function getHealth() {
  return http.get('/health');
}

export async function getOverview(): Promise<OverviewData> {
  const { data } = await http.get<OverviewData>('/overview');
  return data;
}

export async function listCas(): Promise<CaListResponse> {
  const { data } = await http.get<CaListResponse>('/ca');
  return data;
}

export async function getCa(id: string): Promise<RootCaSummary> {
  const { data } = await http.get<RootCaSummary>(`/ca/${id}`);
  return data;
}

export async function createCa(payload: CreateCaPayload): Promise<RootCaSummary> {
  const timeout = payload.keySize === 8192 ? 300_000 : 120_000;
  const { data } = await http.post<RootCaSummary>('/ca', payload, { timeout });
  return data;
}

export async function retireCa(id: string): Promise<RootCaSummary> {
  const { data } = await http.post<RootCaSummary>(`/ca/${id}/retire`);
  return data;
}

export async function deleteCa(id: string): Promise<{ ok: true; id: string; remainingCertificateCount: number }> {
  const { data } = await http.delete<{ ok: true; id: string; remainingCertificateCount: number }>(`/ca/${id}`);
  return data;
}

export async function regenerateCa(id: string, payload: RegenerateCaPayload = {}): Promise<RootCaSummary> {
  const timeout = payload.keySize === 8192 ? 300_000 : 120_000;
  const { data } = await http.post<RootCaSummary>(`/ca/${id}/regenerate`, payload, { timeout });
  return data;
}

export async function archiveCa(id: string): Promise<RootCaSummary> {
  const { data } = await http.post<RootCaSummary>(`/ca/${id}/archive`, {}, { timeout: 60_000 });
  return data;
}

export async function downloadCaCert(
  id: string,
  options?: { filename?: string; format?: CaCertFormat },
): Promise<string> {
  return downloadBinary(
    `/ca/${id}/download`,
    { filename: options?.filename, format: options?.format },
    'Root-CA.crt',
    '下载根证书失败',
  );
}

export async function listCerts(): Promise<{ items: CertificateSummary[] }> {
  const { data } = await http.get<{ items: CertificateSummary[] }>('/certs');
  return data;
}

export async function issueCert(payload: IssueCertPayload): Promise<CertificateDetail> {
  const timeout = payload.keySize === 4096 ? 180_000 : 120_000;
  const { data } = await http.post<CertificateDetail>('/certs', payload, { timeout });
  return data;
}

export async function getCertDetail(id: string): Promise<CertificateDetail> {
  const { data } = await http.get<CertificateDetail>(`/certs/${encodeURIComponent(id)}`);
  return data;
}

export async function regenerateCert(id: string, payload: RegenerateCertPayload = {}): Promise<CertificateDetail> {
  const timeout = payload.keySize === 4096 ? 180_000 : 120_000;
  const { data } = await http.post<CertificateDetail>(
    `/certs/${encodeURIComponent(id)}/regenerate`,
    payload,
    { timeout },
  );
  return data;
}

export async function deleteCert(id: string): Promise<{ ok: true; id: string }> {
  const { data } = await http.delete<{ ok: true; id: string }>(`/certs/${id}`);
  return data;
}

export async function regenerateCertsBatch(
  payload: RegenerateCertsBatchPayload,
): Promise<RegenerateCertsBatchResult> {
  const { data } = await http.post<RegenerateCertsBatchResult>('/certs/regenerate-batch', payload, {
    timeout: 600_000,
  });
  return data;
}

export async function downloadIssuedCert(options: {
  id: string;
  part?: 'bundle' | 'cert' | 'key';
  filename?: string;
  format?: string;
}): Promise<string> {
  const fallback =
    options.part === 'key' ? 'server.key' : options.part === 'cert' ? 'server.crt' : 'server-nginx.zip';
  return downloadBinary(
    `/certs/${encodeURIComponent(options.id)}/download`,
    { part: options.part, filename: options.filename, format: options.format },
    fallback,
    '下载证书失败',
  );
}

export async function listServers(): Promise<{ items: ServerRecord[] }> {
  const { data } = await http.get<{ items: ServerRecord[] }>('/servers');
  return data;
}

export async function createServer(payload: ServerWritePayload & { name: string }): Promise<ServerRecord> {
  const { data } = await http.post<ServerRecord>('/servers', payload);
  return data;
}

export async function updateServer(id: string, payload: ServerWritePayload): Promise<ServerRecord> {
  const { data } = await http.patch<ServerRecord>(`/servers/${id}`, payload);
  return data;
}

export async function testServerConnection(
  payload: TestConnectionPayload,
  serverId?: string,
): Promise<TestConnectionResult> {
  const url = serverId ? `/servers/${serverId}/test-connection` : '/servers/test-connection';
  const { data } = await http.post<TestConnectionResult>(url, payload, { timeout: 120_000 });
  return data;
}

export async function deleteServer(id: string): Promise<void> {
  await http.delete(`/servers/${id}`);
}

export async function addServerPath(
  serverId: string,
  payload: { path: string; label?: string },
): Promise<ServerRecord> {
  const { data } = await http.post<ServerRecord>(`/servers/${serverId}/paths`, payload);
  return data;
}

export async function updateServerPath(
  serverId: string,
  pathId: string,
  payload: { path?: string; label?: string },
): Promise<ServerRecord> {
  const { data } = await http.patch<ServerRecord>(`/servers/${serverId}/paths/${pathId}`, payload);
  return data;
}

export async function deleteServerPath(serverId: string, pathId: string): Promise<ServerRecord> {
  const { data } = await http.delete<ServerRecord>(`/servers/${serverId}/paths/${pathId}`);
  return data;
}

export async function listDeploys(): Promise<{ items: DeployRecord[] }> {
  const { data } = await http.get<{ items: DeployRecord[] }>('/deploys');
  return data;
}

export async function createDeploy(payload: {
  certificateId: string;
  serverId: string;
  pathId: string;
  includeRootCaCert?: boolean;
  overwrite?: boolean;
  trustHostKey?: boolean;
}): Promise<DeployRecord> {
  const { data } = await http.post<DeployRecord>('/deploys', payload, { timeout: 120_000 });
  return data;
}

export async function listTargetFiles(serverId: string, pathId: string): Promise<TargetFileList> {
  const { data } = await http.get<TargetFileList>(`/servers/${serverId}/paths/${pathId}/files`);
  return data;
}

export async function getArchiveLibrary(): Promise<ArchiveLibrary> {
  const { data } = await http.get<ArchiveLibrary>('/archive');
  return data;
}

export async function downloadStoredObject(key: string): Promise<string> {
  return downloadBinary('/storage/objects', { key }, key.split('/').pop() || 'download', '下载文件失败');
}

export async function generateNginxConfig(payload: GenerateNginxPayload): Promise<NginxConfigResult> {
  const { data } = await http.post<NginxConfigResult>('/nginx/config', payload);
  return data;
}

export async function listNginxServices(serverId?: string): Promise<{ items: NginxServiceSummary[] }> {
  const { data } = await http.get<{ items: NginxServiceSummary[] }>('/nginx/services', {
    params: serverId ? { serverId } : undefined,
  });
  return data;
}

export async function getNginxService(id: string): Promise<NginxServiceDetail> {
  const { data } = await http.get<NginxServiceDetail>(`/nginx/services/${id}`);
  return data;
}

export async function createNginxService(
  payload: NginxServiceWritePayload & {
    serverId: string;
    name: string;
    port: number;
    configPath: string;
    configText: string;
    restartCommand: string;
  },
): Promise<NginxServiceDetail> {
  const { data } = await http.post<NginxServiceDetail>('/nginx/services', payload);
  return data;
}

export async function updateNginxService(id: string, payload: NginxServiceWritePayload): Promise<NginxServiceDetail> {
  const { data } = await http.patch<NginxServiceDetail>(`/nginx/services/${id}`, payload);
  return data;
}

export async function deleteNginxService(id: string): Promise<{ ok: true; id: string }> {
  const { data } = await http.delete<{ ok: true; id: string }>(`/nginx/services/${id}`);
  return data;
}

export async function publishNginxService(id: string, payload: PublishNginxServicePayload): Promise<NginxReleaseDetail> {
  const { data } = await http.post<NginxReleaseDetail>(`/nginx/services/${id}/publish`, payload);
  return data;
}

export async function restartNginxService(id: string, trustHostKey?: boolean): Promise<NginxRestartResult> {
  const { data } = await http.post<NginxRestartResult>(`/nginx/services/${id}/restart`, { trustHostKey });
  return data;
}

export async function listNginxReleases(serviceId: string): Promise<{ items: NginxReleaseDetail[] }> {
  const { data } = await http.get<{ items: NginxReleaseDetail[] }>(`/nginx/services/${serviceId}/releases`);
  return data;
}

export async function getNginxRelease(serviceId: string, releaseId: string): Promise<NginxReleaseDetail> {
  const { data } = await http.get<NginxReleaseDetail>(`/nginx/services/${serviceId}/releases/${releaseId}`);
  return data;
}

export async function updateNginxRelease(
  serviceId: string,
  releaseId: string,
  remark: string,
): Promise<NginxReleaseDetail> {
  const { data } = await http.patch<NginxReleaseDetail>(`/nginx/services/${serviceId}/releases/${releaseId}`, { remark });
  return data;
}

export async function deleteNginxRelease(serviceId: string, releaseId: string): Promise<{ ok: true; id: string }> {
  const { data } = await http.delete<{ ok: true; id: string }>(`/nginx/services/${serviceId}/releases/${releaseId}`);
  return data;
}

export async function republishNginxRelease(
  serviceId: string,
  releaseId: string,
  trustHostKey?: boolean,
): Promise<NginxReleaseDetail> {
  const { data } = await http.post<NginxReleaseDetail>(
    `/nginx/services/${serviceId}/releases/${releaseId}/republish`,
    { trustHostKey },
  );
  return data;
}

export async function downloadNginxRelease(serviceId: string, releaseId: string, fallbackName: string): Promise<string> {
  return downloadBinary(
    `/nginx/services/${serviceId}/releases/${releaseId}/download`,
    {},
    fallbackName,
    '下载配置文件失败',
  );
}

export async function getWindowsTrustGuide(caId?: string): Promise<WindowsTrustGuide> {
  const { data } = await http.get<WindowsTrustGuide>('/guides/windows-trust', {
    params: caId ? { caId } : undefined,
  });
  return data;
}

async function downloadBinary(
  url: string,
  params: Record<string, string | undefined>,
  fallbackName: string,
  fallbackError: string,
): Promise<string> {
  try {
    const cleanParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value?.trim()) {
        cleanParams[key] = value.trim();
      }
    }
    const response = await http.get<Blob>(url, {
      params: cleanParams,
      responseType: 'blob',
    });
    const filename = parseFilename(response.headers['content-disposition']) ?? fallbackName;
    const contentType = response.headers['content-type'];
    const blob = new Blob([response.data], {
      type: typeof contentType === 'string' && contentType ? contentType : 'application/octet-stream',
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
    throw new Error(await resolveBlobError(error, fallbackError));
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
