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
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { downloadIssuedCert, getCertDetail, listCerts } from '../api/ssl';
import type { CertificateDetail, CertificateSummary } from '../api/types';

function ValidityTag({ ok, label }: { ok: boolean; label: string }) {
  return <Tag color={ok ? 'green' : 'red'}>{label}</Tag>;
}

export function CertsPage() {
  const { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();
  const selectedName = params.get('name');
  const [detail, setDetail] = useState<CertificateDetail | null>(null);

  const query = useQuery({
    queryKey: ['certs'],
    queryFn: listCerts,
  });

  const detailQuery = useQuery({
    queryKey: ['certs', selectedName],
    queryFn: () => getCertDetail(selectedName as string),
    enabled: Boolean(selectedName),
  });

  useEffect(() => {
    if (detailQuery.data) {
      setDetail(detailQuery.data);
    }
  }, [detailQuery.data]);

  const download = useMutation({
    mutationFn: (options: { name: string; part: 'bundle' | 'cert' | 'key' }) =>
      downloadIssuedCert(options),
    onSuccess: (filename) => message.success(`已开始下载 ${filename}`),
    onError: (error) => message.error(error instanceof Error ? error.message : '下载失败'),
  });

  const confirmKeyDownload = (name: string) => {
    modal.confirm({
      title: '下载服务器私钥？',
      content:
        '此文件是该服务器的 Nginx 私钥（server.key），只用于部署到对应服务器，不要分发给客户端，也不要与 rootCA.key 混淆。根 CA 私钥不会提供下载。',
      okText: '我明白，继续下载',
      cancelText: '取消',
      onOk: () => download.mutateAsync({ name, part: 'key' }),
    });
  };

  const columns: ColumnsType<CertificateSummary> = [
    { title: '名称', dataIndex: 'name', ellipsis: true },
    { title: 'CN', dataIndex: 'commonName', ellipsis: true },
    {
      title: 'IP SAN',
      dataIndex: 'ips',
      render: (ips: string[]) => ips.join(', '),
    },
    {
      title: '有效期至',
      dataIndex: 'notAfter',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    {
      title: '公共文件名',
      dataIndex: 'publicFileName',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => setParams({ name: row.name })}>
            详情
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => download.mutate({ name: row.name, part: 'bundle' })}
          >
            部署包
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        证书管理
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        查看已签发证书的详情与校验结果，并本地下载 Nginx 部署所需的 server 证书和私钥。下载包绝不包含 rootCA.key。
      </Typography.Paragraph>

      <Card>
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法获取证书列表"
            description={getApiErrorMessage(query.error, '请确认后端与数据库已启动。')}
          />
        ) : (
          <Table
            rowKey="id"
            loading={query.isLoading}
            columns={columns}
            dataSource={query.data?.items ?? []}
            pagination={false}
          />
        )}
      </Card>

      <Drawer
        title={detail ? `证书详情：${detail.name}` : '证书详情'}
        open={Boolean(selectedName)}
        width={720}
        onClose={() => {
          setParams({});
          setDetail(null);
        }}
      >
        {detailQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法读取证书详情"
            description={getApiErrorMessage(detailQuery.error, '请稍后重试。')}
          />
        ) : detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={detail.verification.ok ? 'success' : 'warning'}
              showIcon
              message={detail.verification.ok ? '校验通过' : '校验存在问题'}
              description={
                <Space wrap>
                  <ValidityTag ok={detail.verification.chainValid} label="证书链" />
                  <ValidityTag ok={detail.verification.sanValid} label="SAN" />
                  <ValidityTag ok={detail.verification.periodValid} label="有效期" />
                  <ValidityTag ok={detail.verification.keyMatch} label="私钥匹配" />
                  {detail.verification.messages.length > 0 ? (
                    <Typography.Text type="danger">
                      {detail.verification.messages.join('；')}
                    </Typography.Text>
                  ) : null}
                </Space>
              }
            />
            <Card size="small" title="Subject Alternative Name">
              <pre style={{ margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                {detail.sanDisplay}
              </pre>
            </Card>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="通用名称">{detail.commonName}</Descriptions.Item>
              <Descriptions.Item label="序列号">{detail.serialNumber}</Descriptions.Item>
              <Descriptions.Item label="指纹（SHA-256）">{detail.fingerprintSha256}</Descriptions.Item>
              <Descriptions.Item label="有效期">
                {dayjs(detail.notBefore).format('YYYY-MM-DD HH:mm:ss')}
                {' ~ '}
                {dayjs(detail.notAfter).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="密钥">{`RSA ${detail.publicKeyBits}`}</Descriptions.Item>
              <Descriptions.Item label="公共文件名">{detail.publicFileName}</Descriptions.Item>
              <Descriptions.Item label="私钥文件名">{detail.keyFileName}</Descriptions.Item>
            </Descriptions>
            <Space wrap>
              <Button onClick={() => download.mutate({ name: detail.name, part: 'cert' })}>
                下载证书
              </Button>
              <Button onClick={() => confirmKeyDownload(detail.name)}>下载私钥</Button>
              <Button type="primary" onClick={() => download.mutate({ name: detail.name, part: 'bundle' })}>
                下载 Nginx 部署包
              </Button>
            </Space>
            <Alert
              type="warning"
              showIcon
              message="私钥使用提醒"
              description="server.key 只用于部署到对应 Nginx 服务器，不要分发给客户端。rootCA.key 不会出现在任何下载中。"
            />
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
