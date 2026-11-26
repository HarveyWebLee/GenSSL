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
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '../api/http';
import { issueCert, listCas } from '../api/ssl';
import type { CertificateDetail, IssueCertPayload } from '../api/types';
import { AdvancedOptions } from '../components/AdvancedOptions';
import { FieldHint } from '../components/FieldHint';
import { NamePreview } from '../components/NamePreview';
import { NextStepCard } from '../components/NextStepCard';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';
import { parseList, suggestServerCertNames } from '../utils/names';
import { MAX_CERT_VALIDITY_DAYS } from '../utils/cert-validity';

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
  caId: string;
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
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const ipsText = Form.useWatch('ipsText', form) ?? '';
  const dnsText = Form.useWatch('dnsText', form) ?? '';
  const name = Form.useWatch('name', form);
  const commonName = Form.useWatch('commonName', form);
  const publicFileName = Form.useWatch('publicFileName', form);
  const [issued, setIssued] = useState<CertificateDetail | null>(null);

  const caQuery = useQuery({
    queryKey: ['cas'],
    queryFn: listCas,
  });
  const activeCas = (caQuery.data?.items ?? []).filter((item) => item.status === 'active');
  const caReady = activeCas.length > 0;

  const ips = parseList(ipsText);
  const dnsNames = parseList(dnsText);
  const preview = useMemo(() => formatSanPreview(ips, dnsNames), [ipsText, dnsText]);
  const suggested = suggestServerCertNames({
    firstIp: ips[0],
    name,
    commonName,
    publicFileName,
  });

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
    const nextIps = parseList(values.ipsText);
    if (nextIps.length === 0) {
      message.error('请至少填写一个服务器 IP 地址');
      return;
    }
    const derived = suggestServerCertNames({
      firstIp: nextIps[0],
      name: values.name,
      commonName: values.commonName,
      publicFileName: values.publicFileName,
    });
    if (!values.caId) {
      message.error('请选择用于签发的根证书');
      return;
    }
    const payload: IssueCertPayload = {
      caId: values.caId,
      ips: nextIps,
      name: derived.name,
      commonName: derived.commonName,
      publicFileName: derived.publicFileName,
      days: values.days,
      keySize: values.keySize,
      hashAlgorithm: values.hashAlgorithm,
    };
    const nextDns = parseList(values.dnsText);
    if (nextDns.length) payload.dnsNames = nextDns;
    if (values.country?.trim()) payload.country = values.country.trim().toUpperCase();
    if (values.stateOrProvince?.trim()) payload.stateOrProvince = values.stateOrProvince.trim();
    if (values.locality?.trim()) payload.locality = values.locality.trim();
    if (values.organization?.trim()) payload.organization = values.organization.trim();
    if (values.organizationalUnit?.trim()) payload.organizationalUnit = values.organizationalUnit.trim();

    await mutation.mutateAsync(payload);
  };

  if (caQuery.isLoading || !caReady) {
    return (
      <div className="page-stack">
        <PageHeader
          title="签发服务器证书"
          description="使用根 CA 为服务器 IP 开出证书和私钥。浏览器会核对证书是否由根 CA 签发，以及当前访问的 IP 是否写在证书里。"
        />
        <WorkflowBar current="issue" />
        <Card className="surface-card">
          {caQuery.isLoading ? (
            <div className="empty-panel">
              <p>正在确认根 CA 状态…</p>
            </div>
          ) : (
            <div className="empty-panel">
              <h4>还不能签发证书</h4>
              <p>
                签发前需要至少一棵启用中的根 CA。请先创建根证书；若旧根已停用，请改用新根。
              </p>
              <Button type="primary" onClick={() => navigate('/ca')}>
                去创建根 CA
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="签发服务器证书"
        description="先选择一棵启用中的根证书，再填写服务器 IP。签发与「部署到服务器 cert 目录」是分开的步骤；签发成功后，证书和服务器私钥会进入证书库，而不会自动部署。"
      />
      <WorkflowBar current="issue" />

      <Card className="surface-card" title="填写服务器地址">
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{
            days: 397,
            keySize: 2048,
            hashAlgorithm: 'sha256',
            country: 'CN',
            caId: activeCas.length === 1 ? activeCas[0].id : undefined,
          }}
          onFinish={(values) => void submit(values)}
          disabled={!caReady || mutation.isPending}
        >
          <Form.Item
            label="签发所用的根证书"
            name="caId"
            rules={[{ required: true, message: '请选择一棵启用中的根证书' }]}
            extra={<FieldHint example="Lan-Root-CA">每张服务器证书都归属于签发它的那棵根。已停用的根不会出现在这里。</FieldHint>}
          >
            <Select
              placeholder="请选择根证书"
              options={activeCas.map((item) => ({
                value: item.id,
                label: `${item.name}（${item.publicFileName}）`,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="服务器 IP"
            name="ipsText"
            rules={[{ required: true, message: '请填写至少一个 IP 地址' }]}
            extra={
              <FieldHint example="192.168.99.242">
                必填，可写多个：每行一个，或用逗号分隔。不要附带端口，也不要把 IP 写成域名。
              </FieldHint>
            }
          >
            <Input.TextArea rows={4} placeholder={'192.168.99.242\n192.168.99.243\n192.168.99.244'} />
          </Form.Item>
          <Form.Item
            label="域名（可选）"
            name="dnsText"
            extra={
              <FieldHint example="app.local">
                仅在还要用主机名访问时填写。IP 请写在上面，系统不会把 IP 写成域名。
              </FieldHint>
            }
          >
            <Input.TextArea rows={2} placeholder="可选，例如 app.local" />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            title="签发后的 Subject Alternative Name 将如下所示"
            description={<pre className="san-preview">{preview}</pre>}
            style={{ marginBottom: 16 }}
          />

          <NamePreview
            title="无需再单独起名，将按第一个 IP 自动生成"
            items={[
              { label: '列表中的记录名', value: suggested.name },
              { label: '证书主体名称', value: suggested.commonName },
              { label: '下载的证书文件', value: suggested.publicFileName },
              { label: '下载的私钥文件', value: suggested.keyFileName },
            ]}
            footnote="文件不必叫 server.crt / server.key，Nginx 只认配置里写的路径。可在高级选项中修改这些名称。"
          />

          <AdvancedOptions>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  label="列表记录名"
                  name="name"
                  extra={
                    <FieldHint example="web-192-168-99-242">
                      只用于本系统的列表，不会写进证书。不填则按第一个 IP 生成。同一棵根下名称不可重复。
                    </FieldHint>
                  }
                >
                  <Input placeholder={suggested.name} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="证书主体名称"
                  name="commonName"
                  extra={
                    <FieldHint example="192.168.99.242">
                      写入证书主体（CN）。浏览器主要核验上面的 IP 列表，此项不填则使用第一个 IP。
                    </FieldHint>
                  }
                >
                  <Input placeholder={suggested.commonName} />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item
                  label="下载文件名"
                  name="publicFileName"
                  extra={
                    <FieldHint example="192.168.99.242.crt">
                      签发后下载和上传时使用的文件名，不强制叫 server.crt。不填则按第一个 IP
                      生成，对应私钥为同名 .key。
                    </FieldHint>
                  }
                >
                  <Input placeholder={suggested.publicFileName} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item label="国家" name="country" extra={<FieldHint example="CN">两位国家代码。</FieldHint>}>
                  <Input maxLength={2} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item label="省 / 州" name="stateOrProvince">
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
              <Col xs={24} md={8}>
                <Form.Item label="部门" name="organizationalUnit">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  label="有效期（天）"
                  name="days"
                  extra="默认 397 天，最长 50 年（18250 天）。"
                >
                  <InputNumber min={1} max={MAX_CERT_VALIDITY_DAYS} style={{ width: '100%' }} />
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
</Row>
          </AdvancedOptions>

          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            签发证书
          </Button>
        </Form>
      </Card>

      {issued ? (
        <>
          <Card
            className="surface-card"
            title="签发结果"
            extra={
              <Button type="link" onClick={() => navigate(`/certs?id=${encodeURIComponent(issued.id)}`)}>
                查看详情
              </Button>
            }
          >
            <Alert
              type={issued.verification.ok ? 'success' : 'error'}
              showIcon
              title={issued.verification.ok ? '校验通过（证书链、SAN、有效期、私钥匹配）' : '校验未完全通过'}
              description={
                <div>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    由根证书 {issued.ca.name} 签发。记录名 {issued.name}，下载文件 {issued.publicFileName} / {issued.keyFileName}。已进入证书库，不会自动部署到服务器 cert 目录。
                  </div>
                  <pre className="san-preview">{issued.sanDisplay}</pre>
                </div>
              }
            />
          </Card>
          <NextStepCard after="issue" />
        </>
      ) : null}
    </div>
  );
}
