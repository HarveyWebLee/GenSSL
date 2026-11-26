import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Select, Space } from 'antd';
import { useNavigate } from 'react-router-dom';
import { getWindowsTrustGuide } from '../api/ssl';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';

export function GuidePage() {
  const navigate = useNavigate();
  const [caId, setCaId] = useState<string | undefined>();
  const query = useQuery({
    queryKey: ['guide', caId],
    queryFn: () => getWindowsTrustGuide(caId),
  });
  const guide = query.data;

  return (
    <div className="page-stack">
      <PageHeader
        title="客户端信任"
        description="访问网站的电脑需要安装「签发当前网站证书的那棵根」的公钥，浏览器才会信任后续签发的服务器证书。不要安装、也不要分发根 CA 私钥。若已轮换到新根，需要改装新根的公钥。"
      />
      <WorkflowBar current="install" />

      <Card className="surface-card" title="选择要安装的根证书">
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Select
            style={{ maxWidth: 420 }}
            placeholder="选择根证书"
            allowClear
            value={caId}
            onChange={(value) => setCaId(value)}
            options={(guide?.cas ?? []).map((item) => ({
              value: item.id,
              label: `${item.name}（${item.status === 'active' ? '启用中' : '已停用'}，${item.publicFileName}）`,
            }))}
          />
          {guide?.selectedCa ? (
            <Alert
              type="info"
              showIcon
              title={`当前指引针对「${guide.selectedCa.name}」`}
              description={`请下载并安装 ${guide.selectedCa.publicFileName}。必须与网站服务器证书的签发根一致。`}
            />
          ) : (
            <Alert type="warning" showIcon title="还没有根证书，请先到「根 CA」页创建。" />
          )}
          <ol className="guide-steps">
            {(guide?.steps ?? []).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {guide?.warning ? (
            <Alert type="warning" showIcon title="只安装根证书公钥" description={guide.warning} />
          ) : null}
          <Button type="primary" onClick={() => navigate(guide?.selectedCa ? `/ca?id=${guide.selectedCa.id}` : '/ca')}>
            去下载根证书
          </Button>
        </Space>
      </Card>
    </div>
  );
}
