import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { generateNginxConfig, listCas } from '../api/ssl';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';

export function NginxPage() {
  const navigate = useNavigate();
  const casQuery = useQuery({ queryKey: ['cas'], queryFn: listCas });
  const configQuery = useQuery({
    queryKey: ['nginx-config'],
    queryFn: () => generateNginxConfig({ listenPort: 443 }),
  });
  const cas = casQuery.data?.items ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        title="Nginx 配置"
        description="把已部署到服务器 cert 目录的证书和私钥拷到真实机器后，用下面的片段指向它们。客户端必须安装签发该服务器证书的那棵根的公钥。"
      />
      <WorkflowBar current="install" />

      <Card className="surface-card" title="需要信任的根证书">
        {cas.length === 0 ? (
          <Typography.Text type="secondary">尚未创建根证书。</Typography.Text>
        ) : (
          <ul className="guide-steps">
            {cas.map((item) => (
              <li key={item.id}>
                {item.name}（{item.publicFileName}，{item.status === 'active' ? '启用中' : '已停用'}）
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="surface-card" title="配置示例">
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <ol className="guide-steps">
            <li>从「上传部署」下载的是服务器部署目录中的文件，从「证书库」下载的是管理档案，请不要混用路径。</li>
            <li>把证书和私钥拷到服务器上登记过的目录，例如 /etc/nginx/ssl 或 cert。</li>
            <li>文件名不必叫 server.crt / server.key，只要配置指向实际文件即可。</li>
          </ol>
          {configQuery.data?.config ? <pre className="san-preview">{configQuery.data.config}</pre> : null}
          {configQuery.data?.note ? <Alert type="info" showIcon title={configQuery.data.note} /> : null}
          <Button type="primary" onClick={() => navigate('/guide')}>
            查看客户端安装指引
          </Button>
        </Space>
      </Card>
    </div>
  );
}
