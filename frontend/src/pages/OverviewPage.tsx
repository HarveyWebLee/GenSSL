import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import {
  CloudServerOutlined,
  SafetyCertificateOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  ArrowRightOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { getOverview } from '../api/ssl';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';
import { nextWorkflowAction } from '../components/workflow';

export function OverviewPage() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['overview'],
    queryFn: getOverview,
  });

  const next =
    query.data &&
    nextWorkflowAction({
      caReady: query.data.cas.ready,
      certificateCount: query.data.certificateCount,
      serverCount: query.data.serverCount,
    });

  return (
    <div className="page-stack">
      <PageHeader
        title="概览"
        description="按下面的顺序完成配置：先创建一棵或多棵根 CA，再选择根证书为服务器 IP 签发证书。证书档案进入「证书库」，部署文件进入「服务器部署目录」，两者分开存放。客户端只需安装签发当前网站证书的那棵根的公钥。"
      />

      <WorkflowBar />

      {query.isLoading ? (
        <Card>
          <Spin description="正在读取概览…">
            <div style={{ minHeight: 120 }} />
          </Spin>
        </Card>
      ) : query.isError ? (
        <Alert
          type="error"
          showIcon
          title="无法获取概览"
          description={getApiErrorMessage(query.error, '请确认后端与 PostgreSQL 已启动后重试。')}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      ) : query.data ? (
        <>
          <div className="overview-hero">
            <h3>{query.data.cas.ready ? '继续完成配置' : '从创建根 CA 开始'}</h3>
            <p>
              {query.data.cas.ready
                ? next
                  ? `当前建议进行「${next.title}」。${next.short}。已有 ${query.data.cas.active} 棵启用中的根证书，${query.data.cas.retired} 棵已停用。`
                  : '根 CA 已就绪，可继续签发或管理证书。'
                : '根 CA 是你们自己的发证机关，可以创建多棵以便轮换。没有启用中的根，就无法签发服务器证书。'}
            </p>
            {next ? (
              <Button type="primary" onClick={() => navigate(next.path)}>
                {query.data.cas.ready ? `去${next.title}` : '去创建根 CA'}
                <ArrowRightOutlined />
              </Button>
            ) : null}
          </div>

          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card className="stat-card surface-card" hoverable onClick={() => navigate('/ca')}>
                <Statistic
                  title="根 CA"
                  value={query.data.cas.total}
                  prefix={<SafetyCertificateOutlined />}
                  suffix="棵"
                />
                <div style={{ marginTop: 10 }}>
                  <Tag color="success">启用 {query.data.cas.active}</Tag>
                  {query.data.cas.retired ? <Tag>已停用 {query.data.cas.retired}</Tag> : null}
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="stat-card surface-card" hoverable onClick={() => navigate('/certs')}>
                <Statistic
                  title="已签发服务器证书"
                  value={query.data.certificateCount}
                  prefix={<ClusterOutlined />}
                  suffix="张"
                />
                <div style={{ marginTop: 10 }}>
                  <Tag color="success">有效 {query.data.validCertificateCount}</Tag>
                  {query.data.needsReissueCount ? (
                    <Tag color="warning">需重签 {query.data.needsReissueCount}</Tag>
                  ) : null}
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="stat-card surface-card" hoverable onClick={() => navigate('/servers')}>
                <Statistic
                  title="已登记服务器"
                  value={query.data.serverCount}
                  prefix={<CloudServerOutlined />}
                  suffix="台"
                />
              </Card>
            </Col>
          </Row>

          {query.data.cas.items.length > 0 ? (
            <Card className="surface-card" title="各根证书下的服务器证书">
              <Table
                rowKey="id"
                size="middle"
                pagination={false}
                dataSource={query.data.cas.items}
                columns={[
                  { title: '根证书名称', dataIndex: 'name' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    render: (status: string) =>
                      status === 'active' ? <Tag color="success">启用中</Tag> : <Tag>已停用</Tag>,
                  },
                  { title: '下属证书', dataIndex: 'certificateCount' },
                  { title: '有效', dataIndex: 'validCertificateCount' },
                  { title: '需重签', dataIndex: 'needsReissueCount' },
                  {
                    title: '证书库',
                    render: (_, row) =>
                      row.archive.uploaded ? <Tag color="blue">已入库</Tag> : <Tag>未入库</Tag>,
                  },
                  {
                    title: '有效期至',
                    dataIndex: 'notAfter',
                    render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
                  },
                ]}
                onRow={(row) => ({
                  onClick: () => navigate(`/ca?id=${row.id}`),
                  style: { cursor: 'pointer' },
                })}
              />
            </Card>
          ) : null}

          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card
                className="surface-card"
                hoverable
                onClick={() => navigate('/archive')}
                title={
                  <Space>
                    <DatabaseOutlined />
                    证书库（管理档案）
                  </Space>
                }
              >
                <Typography.Paragraph type="secondary">
                  存放平台管理的根证书公钥、服务器证书和服务器私钥。对象前缀为{' '}
                  <code>{query.data.storage.archive.prefix}</code>。rootCA.key 不会出现在这里。
                </Typography.Paragraph>
                {query.data.storage.ready ? (
                  <Statistic title="已存对象" value={query.data.storage.archive.objectCount ?? 0} suffix="个" />
                ) : (
                  <Alert type="warning" showIcon title="RustFS 暂不可用，证书库无法写入。" />
                )}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card
                className="surface-card"
                hoverable
                onClick={() => navigate('/deploy')}
                title={
                  <Space>
                    <UploadOutlined />
                    服务器部署目录
                  </Space>
                }
              >
                <Typography.Paragraph type="secondary">
                  把要用的文件放到某台服务器的 cert 目录（或你登记的部署路径）对应前缀下。对象前缀为{' '}
                  <code>{query.data.storage.deploy.prefix}</code>，与证书库严格分开。
                </Typography.Paragraph>
                {query.data.storage.ready ? (
                  <Statistic title="已存对象" value={query.data.storage.deploy.objectCount ?? 0} suffix="个" />
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    title="RustFS 暂不可用"
                    description={
                      query.data.storage.lastError
                        ? `${query.data.storage.lastError}。请先在项目根目录执行 docker compose up -d。`
                        : '请先在项目根目录执行 docker compose up -d，再上传到证书库或部署目录。'
                    }
                  />
                )}
              </Card>
            </Col>
          </Row>
        </>
      ) : null}
    </div>
  );
}
