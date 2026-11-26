import type { NginxServiceSummary } from '../api/types';

export const SERVICE_NAME_MAX_LENGTH = 128;
export const COPY_NAME_SUFFIX = '-副本';

export interface NginxServiceConflictValues {
  serverId?: string;
  name?: string;
  port?: number;
  configPath?: string;
}

export interface NginxServiceConflict {
  field: 'name' | 'port' | 'configPath';
  message: string;
}

export function suggestCopyName(name: string, takenNames: Iterable<string> = []): string {
  const taken = new Set(
    Array.from(takenNames)
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const baseName = name.trim() || '服务';

  const build = (suffix: string) => {
    const maxBase = Math.max(1, SERVICE_NAME_MAX_LENGTH - suffix.length);
    return `${baseName.slice(0, maxBase)}${suffix}`;
  };

  let candidate = build(COPY_NAME_SUFFIX);
  if (!taken.has(candidate)) {
    return candidate;
  }

  for (let index = 2; index < 1000; index += 1) {
    candidate = build(`${COPY_NAME_SUFFIX}${index}`);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  return build(`${COPY_NAME_SUFFIX}${Date.now()}`);
}

export function listNginxServiceConflicts(
  items: Array<Pick<NginxServiceSummary, 'id' | 'name' | 'port' | 'configPath'> & { server: { id: string } }>,
  values: NginxServiceConflictValues,
  excludeId?: string,
): NginxServiceConflict[] {
  const serverId = values.serverId?.trim();
  if (!serverId) {
    return [];
  }

  const name = values.name?.trim() ?? '';
  const configPath = values.configPath?.trim() ?? '';
  const siblings = items.filter((item) => item.server.id === serverId && item.id !== excludeId);
  const conflicts: NginxServiceConflict[] = [];

  if (name && siblings.some((item) => item.name === name)) {
    conflicts.push({
      field: 'name',
      message: `该服务器下已有名为「${name}」的服务。同一服务器下名称必须唯一。`,
    });
  }
  if (Number.isInteger(values.port) && siblings.some((item) => item.port === values.port)) {
    conflicts.push({
      field: 'port',
      message: `该服务器下已有端口为 ${values.port} 的服务。同一服务器下端口必须唯一，请改为未被占用的端口。`,
    });
  }
  if (configPath && siblings.some((item) => item.configPath === configPath)) {
    conflicts.push({
      field: 'configPath',
      message: `该服务器下已有配置路径「${configPath}」的服务。同一服务器下 Nginx 配置文件路径必须唯一，请改为另一条绝对路径。`,
    });
  }

  return conflicts;
}

export function conflictMessage(
  conflicts: NginxServiceConflict[],
  field: NginxServiceConflict['field'],
): string | undefined {
  return conflicts.find((item) => item.field === field)?.message;
}
