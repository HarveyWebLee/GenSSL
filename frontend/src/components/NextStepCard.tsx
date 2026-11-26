import { Button } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { WORKFLOW_STEPS, type WorkflowStepKey } from './workflow';

interface NextStepCardProps {
  after: WorkflowStepKey;
  title?: string;
  description?: string;
}

const COPY: Partial<Record<WorkflowStepKey, { title: string; description: string }>> = {
  ca: {
    title: '下一步：签发服务器证书',
    description: '选择一棵启用中的根证书，为服务器的 IP 开出可供 Nginx 使用的证书和私钥。',
  },
  issue: {
    title: '下一步：登记服务器和目录',
    description: '记下要登录的机器、SSH 方式和证书目录，上传时会通过 SFTP 写入该目录。',
  },
  servers: {
    title: '下一步：上传到对应路径',
    description: '把证书和私钥通过 SFTP 写入远程证书目录。文件服务器中会保留一份管理副本。',
  },
  deploy: {
    title: '下一步：安装到 Nginx 并让客户端信任',
    description: '确认远程目录中的证书已就位，配置 Nginx，并在客户端安装签发该证书的那棵根的公钥。',
  },
};

export function NextStepCard({ after, title, description }: NextStepCardProps) {
  const navigate = useNavigate();
  const index = WORKFLOW_STEPS.findIndex((step) => step.key === after);
  const next = index >= 0 ? WORKFLOW_STEPS[index + 1] : undefined;
  if (!next) {
    return null;
  }
  const copy = COPY[after];
  return (
    <div className="next-step-card">
      <div>
        <div className="next-step-title">{title ?? copy?.title ?? `下一步：${next.title}`}</div>
        <div className="next-step-desc">{description ?? copy?.description ?? next.short}</div>
      </div>
      <Button type="primary" onClick={() => navigate(next.path)}>
        去{next.title}
        <ArrowRightOutlined />
      </Button>
    </div>
  );
}
