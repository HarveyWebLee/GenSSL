export type WorkflowStepKey = 'ca' | 'issue' | 'servers' | 'deploy' | 'install';

export interface WorkflowStepDef {
  key: WorkflowStepKey;
  index: number;
  title: string;
  path: string;
  short: string;
  doneLabel: string;
  todoLabel: string;
}

export const WORKFLOW_STEPS: WorkflowStepDef[] = [
  {
    key: 'ca',
    index: 1,
    title: '创建根 CA',
    path: '/ca',
    short: '可建多棵，用于轮换',
    doneLabel: '已创建',
    todoLabel: '待创建',
  },
  {
    key: 'issue',
    index: 2,
    title: '签发证书',
    path: '/issue',
    short: '先选根，再为 IP 开证',
    doneLabel: '已签发',
    todoLabel: '待签发',
  },
  {
    key: 'servers',
    index: 3,
    title: '登记服务器',
    path: '/servers',
    short: '记下登录方式和 cert 目录',
    doneLabel: '已登记',
    todoLabel: '待登记',
  },
  {
    key: 'deploy',
    index: 4,
    title: '上传部署',
    path: '/deploy',
    short: '通过 SSH 写入远程证书目录',
    doneLabel: '去上传',
    todoLabel: '待上传',
  },
  {
    key: 'install',
    index: 5,
    title: '安装使用',
    path: '/guide',
    short: '配置 Nginx，安装对应根证书',
    doneLabel: '查看指引',
    todoLabel: '查看指引',
  },
];

export function workflowStepFromPath(pathname: string): WorkflowStepKey | undefined {
  if (pathname.startsWith('/ca')) return 'ca';
  if (pathname.startsWith('/issue')) return 'issue';
  if (pathname.startsWith('/servers')) return 'servers';
  if (pathname.startsWith('/deploy')) return 'deploy';
  if (pathname.startsWith('/nginx') || pathname.startsWith('/guide') || pathname.startsWith('/archive')) {
    return 'install';
  }
  return undefined;
}

export interface WorkflowProgress {
  caReady: boolean;
  certificateCount: number;
  serverCount: number;
}

export function isStepComplete(key: WorkflowStepKey, progress?: WorkflowProgress): boolean | undefined {
  if (!progress) {
    return undefined;
  }
  if (key === 'ca') return progress.caReady;
  if (key === 'issue') return progress.certificateCount > 0;
  if (key === 'servers') return progress.serverCount > 0;
  return undefined;
}

export function nextWorkflowAction(progress: WorkflowProgress): WorkflowStepDef {
  if (!progress.caReady) {
    return WORKFLOW_STEPS[0];
  }
  if (progress.certificateCount === 0) {
    return WORKFLOW_STEPS[1];
  }
  if (progress.serverCount === 0) {
    return WORKFLOW_STEPS[2];
  }
  return WORKFLOW_STEPS[3];
}
