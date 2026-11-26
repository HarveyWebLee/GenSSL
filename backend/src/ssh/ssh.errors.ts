import { BadRequestException } from '@nestjs/common';

export function wrapSshError(error: unknown, context: { host: string; port: number }): never {
  const message = extractMessage(error);
  const code = extractCode(error);
  const lowered = message.toLowerCase();

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || lowered.includes('getaddrinfo')) {
    throw new BadRequestException(`无法解析主机地址 ${context.host}。请检查主机名或 IP 是否填写正确。`);
  }
  if (code === 'ECONNREFUSED') {
    throw new BadRequestException(
      `连接被拒绝（${context.host}:${context.port}）。请确认该地址的 SSH 服务已启动，且端口正确。`,
    );
  }
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || lowered.includes('timed out')) {
    throw new BadRequestException(
      `连接超时，无法在限定时间内连上 ${context.host}:${context.port}。请检查网络、防火墙和超时设置。`,
    );
  }
  if (code === 'ECONNRESET' || lowered.includes('connection reset')) {
    throw new BadRequestException(`与 ${context.host}:${context.port} 的连接被中断。`);
  }
  if (
    lowered.includes('all configured authentication methods failed') ||
    lowered.includes('authentication') && lowered.includes('failed') ||
    lowered.includes('permission denied (publickey') ||
    lowered.includes('invalid password') ||
    lowered.includes('no more authentication methods')
  ) {
    throw new BadRequestException('身份验证失败，请检查用户名、密码或私钥（以及私钥口令）是否正确。');
  }
  if (lowered.includes('cannot parse privatekey') || lowered.includes('encrypted private key') || lowered.includes('passphrase')) {
    throw new BadRequestException('无法使用该私钥登录。请确认私钥格式正确，若私钥有口令请一并填写。');
  }
  if (error instanceof BadRequestException) {
    throw error;
  }
  throw new BadRequestException(`SSH 连接失败：${sanitizeErrorMessage(message)}`);
}

export function wrapSftpError(error: unknown, remotePath?: string): never {
  if (error instanceof BadRequestException) {
    throw error;
  }
  const message = extractMessage(error);
  const code = extractCode(error);
  const lowered = message.toLowerCase();
  const where = remotePath ? `（${remotePath}）` : '';

  if (isNotFoundError(error) || code === 'ENOENT' || lowered.includes('no such file')) {
    throw new BadRequestException(`远程目录或文件不存在${where}。请确认路径已创建，且填写的是绝对路径。`);
  }
  if (code === 'EACCES' || lowered.includes('permission denied')) {
    throw new BadRequestException(`没有权限访问或写入远程路径${where}。请确认该 SSH 账号对证书目录有写权限。`);
  }
  if (lowered.includes('is a directory') || lowered.includes('not a directory')) {
    throw new BadRequestException(`远程路径类型不正确${where}。请确认部署目录指向一个文件夹。`);
  }
  throw new BadRequestException(`远程文件操作失败${where}：${sanitizeErrorMessage(message)}`);
}

export function isNotFoundError(error: unknown): boolean {
  const code = extractCode(error);
  const message = extractMessage(error).toLowerCase();
  return (
    code === 'ENOENT' ||
    code === 2 ||
    message.includes('no such file') ||
    message.includes('not exist')
  );
}

export function extractCode(error: unknown): string | number | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string | number }).code;
    return code;
  }
  return undefined;
}

export function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '未知错误';
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/-----BEGIN[\s\S]+?-----END[^-]+-----/g, '[已隐藏私钥]')
    .replace(/(password|passphrase|secret)\s*[:=]\s*\S+/gi, '$1=[已隐藏]')
    .slice(0, 300);
}
