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

  const data = query.data;
  const next =
    data &&
    nextWorkflowAction({
      caReady: data.cas.ready,
      certificateCount: data.certificateCount,
      serverCount: data.serverCount,
    });

  return (
    <div className="page-stack">
      <PageHeader
        title="概览"
        description="按下面的顺序完成配置：先创建一棵或多棵根 CA，再选择根证书为服务器 IP 签发证书。证书档案进入「证书库」，上传部署会通过 SFTP 写入远程证书目录，并在文件服务器中保留管理副本。客户端只需安装签发当前网站证书的那棵根的公钥。"
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
      ) : data ? (
        <>
          <div className="overview-hero">
            <h3>{data.cas.ready ? '继续完成配置' : '从创建根 CA 开始'}</h3>
            <p>
              {data.cas.ready
                ? next
                  ? `当前建议进行「${next.title}」。${next.short}。已有 ${data.cas.active} 棵启用中的根证书，${data.cas.retired} 棵已停用。`
                  : '根 CA 已就绪，可继续签发或管理证书。'
                : '根 CA 是你们自己的发证机关，可以创建多棵以便轮换。没有启用中的根，就无法签发服务器证书。'}
            </p>
            {next ? (
              <Button type="primary" onClick={() => navigate(next.path)}>
                {data.cas.ready ? `去${next.title}` : '去创建根 CA'}
                <ArrowRightOutlined />
              </Button>
            ) : null}
          </div>

          {data.needsRegenerateCount > 0 ? (
            <Alert
              type="error"
              showIcon
              title={`有 ${data.needsRegenerateCount} 张服务器证书因根证书被覆盖而不可用`}
              description="这些证书由旧的根私钥签发，和新根对不上。请先重新生成并覆盖，再重新上传到部署目录。覆盖不会自动改写部署目录。"
              action={
                <Button size="small" type="primary" onClick={() => navigate('/certs?status=needs_regenerate')}>
                  去重新生成并覆盖
                </Button>
              }
            />
          ) : null}
          {data.needsReissueCount > 0 ? (
            <Alert
              type="warning"
              showIcon
              title={`有 ${data.needsReissueCount} 张服务器证书因根证书停用而需重签`}
              description="所属根已停用，不能再重新生成。请改用一棵启用中的根证书重新签发。"
              action={
                <Button size="small" onClick={() => navigate('/certs?status=needs_reissue')}>
                  查看需重签证书
                </Button>
              }
            />
          ) : null}
          {data.regeneratedActiveCaCount > 0 ? (
            <Alert
              type="warning"
              showIcon
              title="根证书已重新生成，客户端需安装新的公钥"
              description="已经把旧的根公钥装到电脑上的用户，必须改下这次新生成的公钥，否则浏览器不会信任新签发的服务器证书。"
              action={
                <Button size="small" onClick={() => navigate('/guide')}>
                  查看客户端安装指引
                </Button>
              }
            />
          ) : null}
          {data.staleDeployCount > 0 ? (
            <Alert
              type="warning"
              showIcon
              title={`有 ${data.staleDeployCount} 条部署记录已过时`}
              description="证书被重新生成或变为不可用后，部署目录里的旧文件不会自动更新。处理完证书后，请重新上传并打开「覆盖已有文件」，远程服务器上的同名文件也会被覆盖。"
              action={
                <Button size="small" onClick={() => navigate('/deploy')}>
                  去重新上传部署
                </Button>
              }
            />
          ) : null}

          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card className="stat-card surface-card" hoverable onClick={() => navigate('/ca')}>
                <Statistic
                  title="根 CA"
                  value={data.cas.total}
                  prefix={<SafetyCertificateOutlined />}
                  suffix="棵"
                />
                <div style={{ marginTop: 10 }}>
                  <Tag color="success">启用 {data.cas.active}</Tag>
                  {data.cas.retired ? <Tag>已停用 {data.cas.retired}</Tag> : null}
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="stat-card surface-card" hoverable onClick={() => navigate('/certs')}>
                <Statistic
                  title="已签发服务器证书"
                  value={data.certificateCount}
                  prefix={<ClusterOutlined />}
                  suffix="张"
                />
                <div style={{ marginTop: 10 }}>
                  <Tag color="success">有效 {data.validCertificateCount}</Tag>
                  {data.needsReissueCount ? (
                    <Tag
                      color="warning"
                      style={{ cursor: 'pointer' }}
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate('/certs?status=needs_reissue');
                      }}
                    >
                      需重签 {data.needsReissueCount}
                    </Tag>
                  ) : null}
                  {data.needsRegenerateCount ? (
                    <Tag
                      color="error"
                      style={{ cursor: 'pointer' }}
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate('/certs?status=needs_regenerate');
                      }}
                    >
                      需重新生成并覆盖 {data.needsRegenerateCount}
                    </Tag>
                  ) : null}
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="stat-card surface-card" hoverable onClick={() => navigate('/servers')}>
                <Statistic
                  title="已登记服务器"
                  value={data.serverCount}
                  prefix={<CloudServerOutlined />}
                  suffix="台"
                />
              </Card>
            </Col>
          </Row>

          {data.cas.items.length > 0 ? (
            <Card className="surface-card" title="各根证书下的服务器证书">
              <Table
                rowKey="id"
                size="middle"
                pagination={false}
                dataSource={data.cas.items}
                columns={[
                  { title: '根证书名称', dataIndex: 'name' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    render: (status: string, row) => (
                      <Space size={4} wrap>
                        {status === 'active' ? <Tag color="success">启用中</Tag> : <Tag>已停用</Tag>}
                        {status === 'active' && (row.generation ?? 1) > 1 ? (
                          <Tag color="warning">已覆盖，需改装公钥</Tag>
                        ) : null}
                      </Space>
                    ),
                  },
                  { title: '下属证书', dataIndex: 'certificateCount' },
                  { title: '有效', dataIndex: 'validCertificateCount' },
                  {
                    title: '需重签',
                    dataIndex: 'needsReissueCount',
                    render: (count: number, row) =>
                      count ? (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/certs?caId=${row.id}&status=needs_reissue`);
                          }}
                        >
                          {count}
                        </Button>
                      ) : (
                        0
                      ),
                  },
                  {
                    title: '需重新生成并覆盖',
                    dataIndex: 'needsRegenerateCount',
                    render: (count: number, row) =>
                      count ? (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/certs?caId=${row.id}&status=needs_regenerate`);
                          }}
                        >
                          {count}
                        </Button>
                      ) : (
                        0
                      ),
                  },
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
                  <code>{data.storage.archive.prefix}</code>。rootCA.key 不会出现在这里。
                </Typography.Paragraph>
                {data.storage.ready ? (
                  <Statistic title="已存对象" value={data.storage.archive.objectCount ?? 0} suffix="个" />
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
                  通过 SFTP 把证书写入远程服务器的证书目录。文件服务器中会保留管理副本，对象前缀为{' '}
                  <code>{data.storage.deploy.prefix}</code>，与证书库严格分开。
                </Typography.Paragraph>
                {data.storage.ready ? (
                  <Space orientation="vertical" size={8}>
                    <Statistic title="已存对象" value={data.storage.deploy.objectCount ?? 0} suffix="个" />
                    {data.staleDeployCount > 0 ? (
                      <Tag color="warning">已过时部署 {data.staleDeployCount} 条</Tag>
                    ) : null}
                  </Space>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    title="RustFS 暂不可用"
                    description={
                      data.storage.lastError
                        ? `${data.storage.lastError}。请先在项目根目录执行 docker compose up -d。`
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
