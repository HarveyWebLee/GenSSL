import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Space, Spin, Tag, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { getCaStatus } from '../api/ssl';
import { isCaDetails } from '../api/types';

export function OverviewPage() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['ca'],
    queryFn: getCaStatus,
  });

  const details = query.data && isCaDetails(query.data) ? query.data : undefined;
  const incomplete = query.data?.exists === true && query.data.incomplete === true;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        概览
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        查看私有根 CA 的当前状态。服务器证书签发等功能将在后续提供。
      </Typography.Paragraph>

      <Card
        title={
          <Space>
            <SafetyCertificateOutlined />
            根 CA 状态
          </Space>
        }
        extra={
          <Button type="link" onClick={() => navigate('/ca')}>
            前往根 CA
          </Button>
        }
      >
        {query.isLoading ? (
          <Spin tip="正在读取根 CA 状态…">
            <div style={{ minHeight: 80 }} />
          </Spin>
        ) : query.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法获取根 CA 状态"
            description={getApiErrorMessage(query.error, '请确认后端服务已启动后重试。')}
            action={
              <Button size="small" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        ) : details ? (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="状态">
              <Tag color="green">已创建</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="通用名称（CN）">
              {details.subject.commonName ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="有效期">
              {dayjs(details.notBefore).format('YYYY-MM-DD HH:mm:ss')}
              {' ~ '}
              {dayjs(details.notAfter).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
          </Descriptions>
        ) : incomplete ? (
          <Alert
            type="warning"
            showIcon
            message="根 CA 文件不完整"
            description={
              'message' in (query.data ?? {}) ? (query.data as { message: string }).message : undefined
            }
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="尚未创建根 CA"
            description="请先到「根 CA」页面创建私有根证书，再进行后续的服务器证书签发。"
            action={
              <Button type="primary" size="small" onClick={() => navigate('/ca')}>
                去创建
              </Button>
            }
          />
        )}
      </Card>
    </Space>
  );
}
