import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { downloadIssuedCert, getCertDetail, listCerts } from '../api/ssl';
import type { CertificateDetail, CertificateSummary } from '../api/types';
import { PageHeader } from '../components/PageHeader';

function ValidityTag({ ok, label }: { ok: boolean; label: string }) {
  return <Tag color={ok ? 'success' : 'error'}>{label}</Tag>;
}

export function CertsPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const [detail, setDetail] = useState<CertificateDetail | null>(null);

  const query = useQuery({
    queryKey: ['certs'],
    queryFn: listCerts,
  });

  const items = query.data?.items ?? [];

  const detailQuery = useQuery({
    queryKey: ['certs', selectedId],
    queryFn: () => getCertDetail(selectedId as string),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (detailQuery.data) {
      setDetail(detailQuery.data);
    }
  }, [detailQuery.data]);

  const download = useMutation({
    mutationFn: (options: { id: string; part: 'bundle' | 'cert' | 'key' }) =>
      downloadIssuedCert(options),
    onSuccess: (filename) => message.success(`已开始下载 ${filename}`),
    onError: (error) => message.error(error instanceof Error ? error.message : '下载失败'),
  });

  const confirmKeyDownload = (id: string) => {
    modal.confirm({
      title: '下载服务器私钥？',
      content:
        '此文件是该服务器的 Nginx 私钥，只用于部署到对应服务器，不要分发给客户端，也不要与 rootCA.key 混淆。根 CA 私钥不会提供下载。',
      okText: '我明白，继续下载',
      cancelText: '取消',
      onOk: () => download.mutateAsync({ id, part: 'key' }),
    });
  };

  const columns: ColumnsType<CertificateSummary> = [
    {
      title: '状态',
      dataIndex: 'statusLabel',
      render: (label: string, row) => (
        <Tag color={row.status === 'valid' ? 'success' : row.status === 'needs_reissue' ? 'warning' : 'default'}>
          {label}
        </Tag>
      ),
    },
    {
      title: '所属根证书',
      dataIndex: ['ca', 'name'],
      render: (_: string, row) => (
        <div>
          <div>{row.ca.name || '—'}</div>
          {row.ca.status === 'retired' ? <Tag>根已停用</Tag> : null}
        </div>
      ),
    },
    {
      title: '绑定的 IP',
      dataIndex: 'ips',
      render: (ips: string[], row) => (
        <div>
          <div>{ips.join(', ') || '—'}</div>
          {row.dnsNames?.length ? (
            <Typography.Text type="secondary">{row.dnsNames.join(', ')}</Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: '下载文件名',
      dataIndex: 'publicFileName',
    },
    {
      title: '有效期至',
      dataIndex: 'notAfter',
      width: 140,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => setParams({ id: row.id })}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => download.mutate({ id: row.id, part: 'bundle' })}>
            部署包
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="证书列表"
        description="查看已签发证书及其所属根、状态（停用根后会显示为需重签），并下载供 Nginx 使用的证书和私钥。下载包绝不包含 rootCA.key。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/issue')}>
            签发新证书
          </Button>
        }
      />

      <Card className="surface-card">
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            title="无法获取证书列表"
            description={getApiErrorMessage(query.error, '请确认后端与数据库已启动。')}
          />
        ) : !query.isLoading && items.length === 0 ? (
          <div className="empty-panel">
            <h4>还没有签发过证书</h4>
            <p>先确认根 CA 已创建，然后为服务器 IP 签发证书。列表名和下载文件名都会按 IP 自动生成。</p>
            <Button type="primary" onClick={() => navigate('/issue')}>
              去签发证书
            </Button>
          </div>
        ) : (
          <Table
            rowKey="id"
            loading={query.isLoading}
            columns={columns}
            dataSource={items}
            pagination={false}
          />
        )}
      </Card>

      <Drawer
        title={detail ? `证书详情：${detail.ips.join(', ') || detail.name}` : '证书详情'}
        open={Boolean(selectedId)}
        size={720}
        onClose={() => {
          setParams({});
          setDetail(null);
        }}
      >
        {detailQuery.isError ? (
          <Alert
            type="error"
            showIcon
            title="无法读取证书详情"
            description={getApiErrorMessage(detailQuery.error, '请稍后重试。')}
          />
        ) : detail ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={detail.verification.ok ? 'success' : 'warning'}
              showIcon
              title={detail.verification.ok ? '校验通过' : '校验存在问题'}
              description={
                <Space wrap>
                  <ValidityTag ok={detail.verification.chainValid} label="证书链" />
                  <ValidityTag ok={detail.verification.sanValid} label="SAN" />
                  <ValidityTag ok={detail.verification.periodValid} label="有效期" />
                  <ValidityTag ok={detail.verification.keyMatch} label="私钥匹配" />
                  {detail.verification.messages.length > 0 ? (
                    <Typography.Text type="danger">{detail.verification.messages.join('；')}</Typography.Text>
                  ) : null}
                </Space>
              }
            />
            <Card size="small" title="Subject Alternative Name">
              <pre className="san-preview" style={{ margin: 0 }}>
                {detail.sanDisplay}
              </pre>
            </Card>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="状态">{detail.statusLabel}</Descriptions.Item>
              <Descriptions.Item label="所属根证书">{detail.ca.name}{detail.ca.status === 'retired' ? '（已停用）' : ''}</Descriptions.Item>
              <Descriptions.Item label="列表记录名">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="证书主体名称">{detail.commonName}</Descriptions.Item>
              <Descriptions.Item label="序列号">{detail.serialNumber}</Descriptions.Item>
              <Descriptions.Item label="指纹（SHA-256）">{detail.fingerprintSha256}</Descriptions.Item>
              <Descriptions.Item label="有效期">
                {dayjs(detail.notBefore).format('YYYY-MM-DD HH:mm:ss')}
                {' ~ '}
                {dayjs(detail.notAfter).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="密钥">{`RSA ${detail.publicKeyBits}`}</Descriptions.Item>
              <Descriptions.Item label="证书文件名">{detail.publicFileName}</Descriptions.Item>
              <Descriptions.Item label="私钥文件名">{detail.keyFileName}</Descriptions.Item>
            </Descriptions>
            <Space wrap>
              <Button onClick={() => download.mutate({ id: detail.id, part: 'cert' })}>下载证书</Button>
              <Button onClick={() => confirmKeyDownload(detail.id)}>下载私钥</Button>
              <Button type="primary" onClick={() => download.mutate({ id: detail.id, part: 'bundle' })}>
                下载 Nginx 部署包
              </Button>
            </Space>
            <Alert
              type="warning"
              showIcon
              title="私钥使用提醒"
              description="服务器私钥只用于部署到对应 Nginx，不要分发给客户端。rootCA.key 不会出现在任何下载中。"
            />
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
