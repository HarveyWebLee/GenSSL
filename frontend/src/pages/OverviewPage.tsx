import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Space, Spin, Statistic, Tag, Typography } from 'antd';
import {
  CloudServerOutlined,
  SafetyCertificateOutlined,
  ClusterOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { getOverview } from '../api/ssl';

export function OverviewPage() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['overview'],
    queryFn: getOverview,
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        概览
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        从创建根 CA、签发带 IP SAN 的服务器证书，到将文件上传到对应服务器的部署路径。
      </Typography.Paragraph>

      {query.isLoading ? (
        <Spin tip="正在读取概览…">
          <div style={{ minHeight: 120 }} />
        </Spin>
      ) : query.isError ? (
        <Alert
          type="error"
          showIcon
          message="无法获取概览"
          description={getApiErrorMessage(query.error, '请确认后端与 PostgreSQL 已启动后重试。')}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      ) : query.data ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card hoverable onClick={() => navigate('/ca')}>
                <Statistic
                  title="根 CA"
                  value={query.data.ca.ready ? (query.data.ca.commonName ?? '已创建') : '未创建'}
                  prefix={<SafetyCertificateOutlined />}
                />
                <div style={{ marginTop: 8 }}>
                  {query.data.ca.ready ? (
                    <Tag color="green">已就绪</Tag>
                  ) : query.data.ca.incomplete ? (
                    <Tag color="orange">不完整</Tag>
                  ) : (
                    <Tag>待创建</Tag>
                  )}
                </div>
                {query.data.ca.notAfter ? (
                  <Typography.Text type="secondary">
                    有效期至 {dayjs(query.data.ca.notAfter).format('YYYY-MM-DD')}
                  </Typography.Text>
                ) : null}
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card hoverable onClick={() => navigate('/certs')}>
                <Statistic
                  title="已签发服务器证书"
                  value={query.data.certificateCount}
                  prefix={<ClusterOutlined />}
                />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card hoverable onClick={() => navigate('/servers')}>
                <Statistic
                  title="目标服务器"
                  value={query.data.serverCount}
                  prefix={<CloudServerOutlined />}
                />
              </Card>
            </Col>
          </Row>

          <Card
            title={
              <Space>
                <DatabaseOutlined />
                文件服务器（RustFS）
              </Space>
            }
          >
            {query.data.storage.ready ? (
              <Alert
                type="success"
                showIcon
                message="RustFS 已连接"
                description={`S3 接口 ${query.data.storage.endpoint ?? ''}，存储桶 ${query.data.storage.bucket ?? ''}。控制台默认地址：http://127.0.0.1:19702`}
              />
            ) : (
              <Alert
                type="warning"
                showIcon
                message="RustFS 暂不可用"
                description={
                  query.data.storage.lastError
                    ? `${query.data.storage.lastError}。请先在项目根目录执行 docker compose up -d。`
                    : '请先在项目根目录执行 docker compose up -d，再进行上传部署。'
                }
              />
            )}
          </Card>

          {!query.data.ca.ready ? (
            <Alert
              type="info"
              showIcon
              message="建议先创建根 CA"
              description="没有根 CA 时无法签发服务器证书。请先到「根 CA」页面创建私有根证书。"
              action={
                <Button type="primary" size="small" onClick={() => navigate('/ca')}>
                  去创建
                </Button>
              }
            />
          ) : null}
        </>
      ) : null}
    </Space>
  );
}
