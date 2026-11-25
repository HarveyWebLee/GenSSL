import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { DownloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { createCa, downloadCaCert, getCaStatus } from '../api/ssl';
import {
  isCaDetails,
  type CaCertFormat,
  type CaDetails,
  type CaHashAlgorithm,
  type CaKeySize,
  type CreateCaPayload,
} from '../api/types';

interface CaFormValues {
  country: string;
  stateOrProvince?: string;
  locality?: string;
  organization: string;
  organizationalUnit: string;
  commonName: string;
  emailAddress?: string;
  keySize: CaKeySize;
  days: number;
  notBefore?: Dayjs;
  hashAlgorithm: CaHashAlgorithm;
  pathLenConstraint?: number | null;
  publicFileName?: string;
}

const DEFAULT_VALUES: CaFormValues = {
  country: 'CN',
  organization: 'MyCompany',
  organizationalUnit: 'IT',
  commonName: 'MyCompany Local Root CA',
  keySize: 4096,
  days: 3650,
  hashAlgorithm: 'sha256',
};

const KEY_USAGE_LABELS: Record<string, string> = {
  keyCertSign: '证书签发（keyCertSign）',
  cRLSign: 'CRL 签发（cRLSign）',
  digitalSignature: '数字签名',
  keyEncipherment: '密钥加密',
};

function buildPayload(values: CaFormValues, overwrite?: boolean): CreateCaPayload {
  const payload: CreateCaPayload = {
    country: values.country.trim().toUpperCase(),
    organization: values.organization.trim(),
    organizationalUnit: values.organizationalUnit.trim(),
    commonName: values.commonName.trim(),
    keySize: values.keySize,
    days: values.days,
    hashAlgorithm: values.hashAlgorithm,
  };

  if (values.stateOrProvince?.trim()) {
    payload.stateOrProvince = values.stateOrProvince.trim();
  }
  if (values.locality?.trim()) {
    payload.locality = values.locality.trim();
  }
  if (values.emailAddress?.trim()) {
    payload.emailAddress = values.emailAddress.trim();
  }
  if (values.notBefore) {
    payload.notBefore = values.notBefore.toISOString();
  }
  if (values.pathLenConstraint !== undefined && values.pathLenConstraint !== null) {
    payload.pathLenConstraint = values.pathLenConstraint;
  }
  if (values.publicFileName?.trim()) {
    payload.publicFileName = values.publicFileName.trim();
  }
  if (overwrite) {
    payload.overwrite = true;
  }
  return payload;
}

function detailsToFormValues(details: CaDetails): CaFormValues {
  const durationDays = Math.max(
    1,
    Math.round(
      (new Date(details.notAfter).getTime() - new Date(details.notBefore).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );

  const keySize: CaKeySize =
    details.publicKeyBits === 2048 || details.publicKeyBits === 8192
      ? details.publicKeyBits
      : 4096;

  const hashAlgorithm: CaHashAlgorithm = details.signatureAlgorithm.includes('sha512')
    ? 'sha512'
    : details.signatureAlgorithm.includes('sha384')
      ? 'sha384'
      : 'sha256';

  return {
    country: details.subject.country ?? 'CN',
    stateOrProvince: details.subject.stateOrProvince,
    locality: details.subject.locality,
    organization: details.subject.organization ?? 'MyCompany',
    organizationalUnit: details.subject.organizationalUnit ?? 'IT',
    commonName: details.subject.commonName ?? 'MyCompany Local Root CA',
    emailAddress: details.subject.emailAddress,
    keySize,
    days: Math.min(3650, durationDays),
    hashAlgorithm,
    pathLenConstraint: details.pathLenConstraint,
    publicFileName: details.publicFileName,
  };
}

function CaCreateForm({
  initialValues,
  submitText,
  danger,
  loading,
  onSubmit,
}: {
  initialValues: CaFormValues;
  submitText: string;
  danger?: boolean;
  loading: boolean;
  onSubmit: (values: CaFormValues) => void;
}) {
  const [form] = Form.useForm<CaFormValues>();

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={onSubmit}
      disabled={loading}
    >
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item
            label="国家（C）"
            name="country"
            rules={[
              { required: true, message: '请填写国家代码' },
              { pattern: /^[A-Za-z]{2}$/, message: '国家代码必须是 2 位字母（ISO 3166-1）' },
            ]}
            normalize={(value: string) => (value ? value.toUpperCase() : value)}
          >
            <Input maxLength={2} placeholder="CN" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label="省 / 州（ST）" name="stateOrProvince">
            <Input maxLength={128} placeholder="可选" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label="城市（L）" name="locality">
            <Input maxLength={128} placeholder="可选" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label="组织（O）" name="organization">
            <Input maxLength={64} placeholder="MyCompany" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label="组织单位（OU）" name="organizationalUnit">
            <Input maxLength={64} placeholder="IT" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="通用名称（CN）"
            name="commonName"
            rules={[{ required: true, message: '请填写通用名称（CN）' }]}
          >
            <Input maxLength={128} placeholder="MyCompany Local Root CA" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="邮箱"
            name="emailAddress"
            rules={[{ type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input maxLength={128} placeholder="可选" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="密钥长度"
            name="keySize"
            extra="4096 位生成可能需要数十秒，8192 位可能需要数分钟。"
            rules={[{ required: true, message: '请选择密钥长度' }]}
          >
            <Select
              options={[
                { value: 2048, label: '2048 位' },
                { value: 4096, label: '4096 位（推荐）' },
                { value: 8192, label: '8192 位（较慢）' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="有效期（天）"
            name="days"
            rules={[{ required: true, message: '请填写有效期' }]}
          >
            <InputNumber min={1} max={3650} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="生效时间"
            name="notBefore"
            extra="留空则使用当前时间。"
          >
            <DatePicker showTime style={{ width: '100%' }} placeholder="默认为现在" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="签名算法"
            name="hashAlgorithm"
            rules={[{ required: true, message: '请选择签名算法' }]}
          >
            <Select
              options={[
                { value: 'sha256', label: 'SHA-256' },
                { value: 'sha384', label: 'SHA-384' },
                { value: 'sha512', label: 'SHA-512' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="路径长度约束"
            name="pathLenConstraint"
            extra="可选。限制本 CA 下方还可有几级中间 CA，0 表示只能签发终端证书。"
          >
            <InputNumber min={0} style={{ width: '100%' }} placeholder="不设置" />
          </Form.Item>
        </Col>
        <Col xs={24} md={16}>
          <Form.Item
            label="公共文件名"
            name="publicFileName"
            extra="可选。用于客户端安装和分发时的下载文件名，不填写则根据通用名称或「组织-Root-CA」自动生成，默认扩展名为 .crt。内部存储文件名仍为 rootCA.crt，不会改变。支持 .crt、.cer、.pem。"
          >
            <Input maxLength={200} placeholder="例如 MyCompany-Root-CA.crt" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} danger={danger}>
          {submitText}
        </Button>
      </Form.Item>
    </Form>
  );
}

function CaDetailsView({ details }: { details: CaDetails }) {
  return (
    <Descriptions
      bordered
      size="middle"
      column={{ xs: 1, sm: 1, md: 2 }}
      styles={{ label: { width: 160 } }}
    >
      <Descriptions.Item label="通用名称（CN）">
        {details.subject.commonName ?? '—'}
      </Descriptions.Item>
      <Descriptions.Item label="公共文件名">{details.publicFileName}</Descriptions.Item>
      <Descriptions.Item label="是否为 CA">
        {details.isCA ? <Tag color="green">CA:TRUE</Tag> : <Tag color="red">CA:FALSE</Tag>}
      </Descriptions.Item>
      <Descriptions.Item label="国家（C）">{details.subject.country ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="省 / 州（ST）">
        {details.subject.stateOrProvince ?? '—'}
      </Descriptions.Item>
      <Descriptions.Item label="城市（L）">{details.subject.locality ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="组织（O）">
        {details.subject.organization ?? '—'}
      </Descriptions.Item>
      <Descriptions.Item label="组织单位（OU）">
        {details.subject.organizationalUnit ?? '—'}
      </Descriptions.Item>
      <Descriptions.Item label="邮箱">{details.subject.emailAddress ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="颁发者">
        {details.issuer.commonName ?? '—'}
        {details.issuer.organization ? ` / ${details.issuer.organization}` : ''}
      </Descriptions.Item>
      <Descriptions.Item label="序列号">
        <Typography.Text copyable={{ text: details.serialNumber }}>
          {details.serialNumber}
        </Typography.Text>
      </Descriptions.Item>
      <Descriptions.Item label="生效时间">
        {dayjs(details.notBefore).format('YYYY-MM-DD HH:mm:ss')}
      </Descriptions.Item>
      <Descriptions.Item label="到期时间">
        {dayjs(details.notAfter).format('YYYY-MM-DD HH:mm:ss')}
      </Descriptions.Item>
      <Descriptions.Item label="签名算法">{details.signatureAlgorithm}</Descriptions.Item>
      <Descriptions.Item label="公钥">
        {details.publicKeyAlgorithm} {details.publicKeyBits} 位
      </Descriptions.Item>
      <Descriptions.Item label="密钥用法">
        {details.keyUsage.length
          ? details.keyUsage.map((item) => KEY_USAGE_LABELS[item] ?? item).join('，')
          : '—'}
      </Descriptions.Item>
      <Descriptions.Item label="路径长度约束">
        {details.pathLenConstraint === null ? '未设置' : details.pathLenConstraint}
      </Descriptions.Item>
      <Descriptions.Item label="SHA-256 指纹" span={2}>
        <Typography.Text copyable={{ text: details.fingerprintSha256 }} code>
          {details.fingerprintSha256}
        </Typography.Text>
      </Descriptions.Item>
    </Descriptions>
  );
}

const CERT_FORMAT_OPTIONS: Array<{ value: CaCertFormat; label: string }> = [
  { value: 'crt', label: '.crt（默认）' },
  { value: 'cer', label: '.cer（Windows 常用）' },
  { value: 'pem', label: '.pem' },
];

function splitPublicName(name: string): { stem: string; format: CaCertFormat } {
  const match = name.trim().match(/^(.*)\.(crt|cer|pem)$/i);
  if (match?.[1] && match[2]) {
    return { stem: match[1], format: match[2].toLowerCase() as CaCertFormat };
  }
  return { stem: name.trim(), format: 'crt' };
}

function previewPublicFileName(
  input: string,
  format: CaCertFormat,
  fallbackName: string,
): string {
  const stem = input.trim().replace(/\.(crt|cer|pem)$/i, '');
  if (stem) {
    return `${stem}.${format}`;
  }
  const fallbackStem = splitPublicName(fallbackName).stem;
  return `${fallbackStem}.${format}`;
}

function CaDownloadPanel({ details }: { details: CaDetails }) {
  const { message } = App.useApp();
  const initial = splitPublicName(details.publicFileName);
  const [stem, setStem] = useState(initial.stem);
  const [format, setFormat] = useState<CaCertFormat>(initial.format);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const next = splitPublicName(details.publicFileName);
    setStem(next.stem);
    setFormat(next.format);
  }, [details.publicFileName]);

  const preview = previewPublicFileName(stem, format, details.publicFileName);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const filename = await downloadCaCert({
        filename: stem.trim() || undefined,
        format,
      });
      message.success(`已开始下载 ${filename}`);
    } catch (error) {
      message.error(getApiErrorMessage(error, '下载根证书失败'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card title="下载根证书">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="下载的是同一份 PEM 公钥证书，仅文件名和扩展名不同，可用于客户端安装与分发。不会下载 rootCA.key。"
        />
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Typography.Text strong>公共文件名</Typography.Text>
            <Input
              style={{ marginTop: 8 }}
              value={stem}
              maxLength={200}
              placeholder={splitPublicName(details.suggestedFileName).stem}
              onChange={(event) => setStem(event.target.value)}
              addonAfter={
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => {
                    const suggested = splitPublicName(details.suggestedFileName);
                    setStem(suggested.stem);
                    setFormat(suggested.format);
                  }}
                >
                  使用建议名
                </Button>
              }
            />
          </Col>
          <Col xs={24} md={6}>
            <Typography.Text strong>格式</Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 8 }}
              value={format}
              options={CERT_FORMAT_OPTIONS}
              onChange={(value) => setFormat(value)}
            />
          </Col>
        </Row>
        <div>
          <Typography.Text type="secondary">最终文件名预览：</Typography.Text>
          <Typography.Text code style={{ marginLeft: 8 }}>
            {preview}
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={downloading}
          onClick={() => void handleDownload()}
        >
          下载 {preview}
        </Button>
      </Space>
    </Card>
  );
}

export function RootCaPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['ca'],
    queryFn: getCaStatus,
  });

  const mutation = useMutation({
    mutationFn: createCa,
    onSuccess: async () => {
      message.success('根 CA 创建成功');
      await queryClient.invalidateQueries({ queryKey: ['ca'] });
    },
    onError: (error: unknown) => {
      message.error(getApiErrorMessage(error, '创建根 CA 失败'));
    },
  });

  const status = query.data;
  const details = status && isCaDetails(status) ? status : undefined;
  const incomplete = status?.exists === true && status.incomplete === true;

  const createInitialValues = useMemo(() => DEFAULT_VALUES, []);
  const overwriteInitialValues = useMemo(
    () => (details ? detailsToFormValues(details) : DEFAULT_VALUES),
    [details],
  );

  const handleCreate = (values: CaFormValues) => {
    message.loading({
      content: '正在生成密钥并签发根证书，请稍候…',
      key: 'create-ca',
      duration: 0,
    });
    mutation.mutate(buildPayload(values), {
      onSettled: () => message.destroy('create-ca'),
    });
  };

  const handleOverwrite = (values: CaFormValues) => {
    modal.confirm({
      title: '确认覆盖现有根 CA？',
      content: (
        <div>
          <p>重新创建将替换现有的根证书和私钥，此操作不可撤销。</p>
          <p>
            已经使用该根 CA 签发的服务器证书将全部失效，客户端需要重新安装新的根证书后才能信任新签发的证书。
          </p>
        </div>
      ),
      okText: '确认覆盖',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () =>
        new Promise<void>((resolve, reject) => {
          message.loading({
            content: '正在重新生成根 CA，请稍候…',
            key: 'create-ca',
            duration: 0,
          });
          mutation.mutate(buildPayload(values, true), {
            onSuccess: () => resolve(),
            onError: (error) => reject(error),
            onSettled: () => message.destroy('create-ca'),
          });
        }).catch(() => {
          // 错误已在 mutation.onError 中提示，阻止 Modal 抛出未捕获异常
        }),
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        <SafetyCertificateOutlined style={{ marginRight: 8 }} />
        根 CA
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        创建并管理私有根证书颁发机构。根 CA 私钥只保存在本机服务器，接口不会返回或提供
        rootCA.key 下载。
      </Typography.Paragraph>

      {query.isLoading ? (
        <Card>
          <Spin tip="正在读取根 CA 状态…">
            <div style={{ minHeight: 120 }} />
          </Spin>
        </Card>
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
        <>
          <Card title="证书详情">
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`请将下载的根证书（例如 ${details.publicFileName}）安装到客户端的「受信任的根证书颁发机构」。内部私钥 rootCA.key 仅保存在服务器，不会提供下载。`}
            />
            <CaDetailsView details={details} />
          </Card>
          <CaDownloadPanel details={details} />
          <Card title="重新创建 / 覆盖根 CA">
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="覆盖现有根 CA 会使已经签发的服务器证书全部失效，提交前需要二次确认。"
            />
            <CaCreateForm
              initialValues={overwriteInitialValues}
              submitText="覆盖并重新创建"
              danger
              loading={mutation.isPending}
              onSubmit={handleOverwrite}
            />
          </Card>
        </>
      ) : (
        <Card title="创建根 CA">
          {incomplete ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={status && 'message' in status ? status.message : '根 CA 文件不完整'}
            />
          ) : (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="尚未创建根 CA。请填写下列配置后创建，默认值与实施文档中的私有根 CA 主体一致。"
            />
          )}
          <CaCreateForm
            initialValues={createInitialValues}
            submitText={incomplete ? '覆盖并创建根 CA' : '创建根 CA'}
            danger={incomplete}
            loading={mutation.isPending}
            onSubmit={incomplete ? handleOverwrite : handleCreate}
          />
        </Card>
      )}
    </Space>
  );
}
