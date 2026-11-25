import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '../api/http';
import { getCaStatus, issueCert } from '../api/ssl';
import { isCaDetails, type CertificateDetail, type IssueCertPayload } from '../api/types';

interface FormValues {
  name?: string;
  ipsText: string;
  dnsText?: string;
  country?: string;
  stateOrProvince?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  days: number;
  keySize: 2048 | 4096;
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
  publicFileName?: string;
  overwrite?: boolean;
}

function parseList(text?: string): string[] {
  if (!text?.trim()) {
    return [];
  }
  return text
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatSanPreview(ips: string[], dnsNames: string[]): string {
  if (ips.length === 0 && dnsNames.length === 0) {
    return 'Subject Alternative Name:';
  }
  const lines = ['Subject Alternative Name:'];
  for (const ip of ips) {
    lines.push(`    IP Address: ${ip}`);
  }
  for (const dns of dnsNames) {
    lines.push(`    DNS: ${dns}`);
  }
  return lines.join('\n');
}

export function IssueCertPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const ipsText = Form.useWatch('ipsText', form) ?? '';
  const dnsText = Form.useWatch('dnsText', form) ?? '';
  const [issued, setIssued] = useState<CertificateDetail | null>(null);

  const caQuery = useQuery({
    queryKey: ['ca'],
    queryFn: getCaStatus,
  });
  const caReady = caQuery.data ? isCaDetails(caQuery.data) : false;

  const preview = useMemo(
    () => formatSanPreview(parseList(ipsText), parseList(dnsText)),
    [ipsText, dnsText],
  );

  const mutation = useMutation({
    mutationFn: (payload: IssueCertPayload) => issueCert(payload),
    onSuccess: async (detail) => {
      setIssued(detail);
      await queryClient.invalidateQueries({ queryKey: ['certs'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      message.success('服务器证书签发成功');
    },
    onError: (error) => {
      message.error(getApiErrorMessage(error, '签发失败'));
    },
  });

  const submit = async (values: FormValues) => {
    const ips = parseList(values.ipsText);
    if (ips.length === 0) {
      message.error('请至少填写一个服务器 IP 地址');
      return;
    }
    const payload: IssueCertPayload = {
      ips,
      days: values.days,
      keySize: values.keySize,
      hashAlgorithm: values.hashAlgorithm,
      overwrite: values.overwrite,
    };
    const dnsNames = parseList(values.dnsText);
    if (dnsNames.length) payload.dnsNames = dnsNames;
    if (values.name?.trim()) payload.name = values.name.trim();
    if (values.country?.trim()) payload.country = values.country.trim().toUpperCase();
    if (values.stateOrProvince?.trim()) payload.stateOrProvince = values.stateOrProvince.trim();
    if (values.locality?.trim()) payload.locality = values.locality.trim();
    if (values.organization?.trim()) payload.organization = values.organization.trim();
    if (values.organizationalUnit?.trim()) payload.organizationalUnit = values.organizationalUnit.trim();
    if (values.commonName?.trim()) payload.commonName = values.commonName.trim();
    if (values.publicFileName?.trim()) payload.publicFileName = values.publicFileName.trim();

    if (values.overwrite) {
      modal.confirm({
        title: '确认覆盖已有服务器证书？',
        content: '覆盖会替换该名称下已有的 server.crt 与 server.key，不会改动根 CA，也不会下载或上传 rootCA.key。',
        okText: '确认覆盖并签发',
        cancelText: '取消',
        async onOk() {
          await mutation.mutateAsync(payload);
        },
      });
      return;
    }
    await mutation.mutateAsync(payload);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        签发服务器证书
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        使用当前根 CA 签发局域网 HTTPS 证书。SAN 中的 IP 一律写成
        IP Address 类型，不能写成 DNS；也不要把端口写入证书。默认 RSA 2048、有效期 397 天。
      </Typography.Paragraph>

      {!caQuery.isLoading && !caReady ? (
        <Alert
          type="warning"
          showIcon
          message="尚未创建根 CA"
          description="请先到「根 CA」页面创建私有根证书，再签发服务器证书。"
          action={
            <Button type="primary" size="small" onClick={() => navigate('/ca')}>
              去创建根 CA
            </Button>
          }
        />
      ) : null}

      <Card title="证书配置">
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{
            days: 397,
            keySize: 2048,
            hashAlgorithm: 'sha256',
            country: 'CN',
          }}
          onFinish={(values) => void submit(values)}
          disabled={!caReady || mutation.isPending}
        >
          <Form.Item
            label="服务器 IP（必填，可多个）"
            name="ipsText"
            extra="每行一个，或用逗号分隔。不要附带端口，例如 192.168.99.242 而不是 192.168.99.242:3089。"
            rules={[{ required: true, message: '请填写至少一个 IP 地址' }]}
          >
            <Input.TextArea rows={4} placeholder={'192.168.99.242\n192.168.99.243\n192.168.99.244'} />
          </Form.Item>
          <Form.Item
            label="DNS 名称（可选）"
            name="dnsText"
            extra="仅用于主机名。IP 请写在上面的 IP 列表中，系统不会把 IP 写成 DNS。"
          >
            <Input.TextArea rows={2} placeholder="app.local" />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            message="签发后的 Subject Alternative Name 将如下所示"
            description={
              <pre style={{ margin: '8px 0 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                {preview}
              </pre>
            }
            style={{ marginBottom: 16 }}
          />

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="证书名称" name="name" extra="用于本地存储目录与管理列表。留空则按 CN 或首个 IP 生成。">
                <Input placeholder="web-192-168-99-242" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="通用名称（CN）" name="commonName" extra="留空则使用第一个 IP。">
                <Input placeholder="192.168.99.242" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item label="国家" name="country">
                <Input maxLength={2} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="省/州" name="stateOrProvince">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="城市" name="locality">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="组织" name="organization">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="组织单位" name="organizationalUnit">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="有效期（天）" name="days" extra="默认 397 天（接近浏览器常见上限）。">
                <InputNumber min={1} max={825} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="密钥长度" name="keySize">
                <Select
                  options={[
                    { value: 2048, label: 'RSA 2048（推荐）' },
                    { value: 4096, label: 'RSA 4096' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="签名算法" name="hashAlgorithm">
                <Select
                  options={[
                    { value: 'sha256', label: 'SHA-256' },
                    { value: 'sha384', label: 'SHA-384' },
                    { value: 'sha512', label: 'SHA-512' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item label="公共文件名" name="publicFileName" extra="可选。不填则按名称或 IP 生成，例如 192.168.99.242.crt。对应私钥为同名 .key。">
                <Input placeholder="192.168.99.242.crt" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="overwrite" label="覆盖已有同名证书" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            签发证书
          </Button>
        </Form>
      </Card>

      {issued ? (
        <Card
          title="签发结果"
          extra={
            <Button type="link" onClick={() => navigate(`/certs?name=${encodeURIComponent(issued.name)}`)}>
              查看详情
            </Button>
          }
        >
          <Alert
            type={issued.verification.ok ? 'success' : 'error'}
            showIcon
            message={issued.verification.ok ? '校验通过（证书链、SAN、有效期、私钥匹配）' : '校验未完全通过'}
            description={
              <pre style={{ margin: '8px 0 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                {issued.sanDisplay}
              </pre>
            }
          />
        </Card>
      ) : null}
    </Space>
  );
}
