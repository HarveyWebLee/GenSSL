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
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getApiErrorMessage } from '../api/http';
import { archiveCa, createCa, deleteCa, downloadCaCert, listCas, regenerateCa, retireCa } from '../api/ssl';
import type {
  CaCertFormat,
  CaHashAlgorithm,
  CaKeySize,
  CreateCaPayload,
  RegenerateCaPayload,
  RootCaSummary,
} from '../api/types';
import { AdvancedOptions } from '../components/AdvancedOptions';
import { FieldHint } from '../components/FieldHint';
import { NamePreview } from '../components/NamePreview';
import { NextStepCard } from '../components/NextStepCard';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';
import { suggestCaPublicFileName, withCertExtension } from '../utils/names';
import { MAX_CERT_VALIDITY_DAYS } from '../utils/cert-validity';

interface RegenFormValues {
  days: number;
  keySize: CaKeySize;
  hashAlgorithm: CaHashAlgorithm;
  notBefore?: Dayjs;
}

function hashFromSignature(signature: string): CaHashAlgorithm {
  const value = signature.toLowerCase();
  if (value.includes('sha384')) return 'sha384';
  if (value.includes('sha512')) return 'sha512';
  return 'sha256';
}

function validityDays(notBefore: string, notAfter: string): number {
  return Math.max(1, Math.round((dayjs(notAfter).valueOf() - dayjs(notBefore).valueOf()) / (24 * 60 * 60 * 1000)));
}

interface CaFormValues {
  name: string;
  country: string;
  stateOrProvince?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  emailAddress?: string;
  keySize: CaKeySize;
  days: number;
  notBefore?: Dayjs;
  hashAlgorithm: CaHashAlgorithm;
  pathLenConstraint?: number | null;
  publicFileName?: string;
}

const DEFAULT_VALUES: CaFormValues = {
  name: '',
  country: 'CN',
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

function buildPayload(values: CaFormValues): CreateCaPayload {
  const payload: CreateCaPayload = {
    name: values.name.trim(),
    keySize: values.keySize,
    days: values.days,
    hashAlgorithm: values.hashAlgorithm,
  };
  if (values.country?.trim()) payload.country = values.country.trim().toUpperCase();
  if (values.stateOrProvince?.trim()) payload.stateOrProvince = values.stateOrProvince.trim();
  if (values.locality?.trim()) payload.locality = values.locality.trim();
  if (values.organization?.trim()) payload.organization = values.organization.trim();
  if (values.organizationalUnit?.trim()) payload.organizationalUnit = values.organizationalUnit.trim();
  if (values.commonName?.trim()) payload.commonName = values.commonName.trim();
  if (values.emailAddress?.trim()) payload.emailAddress = values.emailAddress.trim();
  if (values.notBefore) payload.notBefore = values.notBefore.toISOString();
  if (typeof values.pathLenConstraint === 'number') payload.pathLenConstraint = values.pathLenConstraint;
  if (values.publicFileName?.trim()) {
    payload.publicFileName = withCertExtension(values.publicFileName, values.name.trim() || 'Root-CA');
  }
  return payload;
}

export function RootCaPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const [creating, setCreating] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [form] = Form.useForm<CaFormValues>();
  const [regenForm] = Form.useForm<RegenFormValues>();

  const query = useQuery({ queryKey: ['cas'], queryFn: listCas });
  const items = query.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const createMutation = useMutation({
    mutationFn: createCa,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['cas'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      message.success(
        created.archive.uploaded
          ? '根证书已创建，公钥已写入证书库。私钥只保存在数据库中。'
          : '根证书已创建。私钥只保存在数据库中。证书库暂不可用，可稍后在详情中重试入库。',
      );
      setCreating(false);
      form.resetFields();
      setParams({ id: created.id });
    },
    onError: (error) => message.error(getApiErrorMessage(error, '创建根证书失败')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCa,
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ['cas'] });
      await queryClient.invalidateQueries({ queryKey: ['certs'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      await queryClient.invalidateQueries({ queryKey: ['archive'] });
      await queryClient.invalidateQueries({ queryKey: ['guide'] });
      message.success('根证书已从列表中移除。私钥、历史和证书库档案仍保留，下属未删除的签发证书不会被一并删除。');
      if (selectedId === id) {
        setParams({});
      }
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除失败')),
  });

  const retireMutation = useMutation({
    mutationFn: retireCa,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cas'] });
      await queryClient.invalidateQueries({ queryKey: ['certs'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      message.success('该根证书已停用。它签过的服务器证书将显示为失效、需要重签。私钥和历史仍保留。');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '停用失败')),
  });

  const regenMutation = useMutation({
    mutationFn: (payload: RegenerateCaPayload) => regenerateCa(selectedId as string, payload),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ['cas'] });
      await queryClient.invalidateQueries({ queryKey: ['certs'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      await queryClient.invalidateQueries({ queryKey: ['archive'] });
      await queryClient.invalidateQueries({ queryKey: ['deploys'] });
      await queryClient.invalidateQueries({ queryKey: ['target-files'] });
      await queryClient.invalidateQueries({ queryKey: ['guide'] });
      setRegenOpen(false);
      message.success(
        updated.needsRegenerateCount
          ? `根证书已重新生成并覆盖。已安装旧公钥的客户端必须改装新的根证书，否则浏览器不会信任新签发的服务器证书。另有 ${updated.needsRegenerateCount} 张服务器证书已变为不可用，需要重新生成并覆盖。`
          : '根证书已重新生成并覆盖。已安装旧公钥的客户端必须改装新的根证书，否则浏览器不会信任新签发的服务器证书。',
      );
    },
    onError: (error) => message.error(getApiErrorMessage(error, '重新生成并覆盖失败')),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveCa,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cas'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      await queryClient.invalidateQueries({ queryKey: ['archive'] });
      message.success('根证书公钥已上传到证书库。私钥不会上传。');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '上传到证书库失败')),
  });

  const openRegenerate = (row: RootCaSummary) => {
    const keySize: CaKeySize =
      row.publicKeyBits === 2048 || row.publicKeyBits === 4096 || row.publicKeyBits === 8192
        ? row.publicKeyBits
        : 4096;
    regenForm.setFieldsValue({
      days: validityDays(row.notBefore, row.notAfter),
      keySize,
      hashAlgorithm: hashFromSignature(row.signatureAlgorithm),
      notBefore: undefined,
    });
    setRegenOpen(true);
  };

  const submitRegenerate = (values: RegenFormValues) => {
    const payload: RegenerateCaPayload = {
      days: values.days,
      keySize: values.keySize,
      hashAlgorithm: values.hashAlgorithm,
    };
    if (values.notBefore) payload.notBefore = values.notBefore.toISOString();
    regenMutation.mutate(payload);
  };

  const confirmDelete = (row: RootCaSummary) => {
    const extra = row.certificateCount
      ? `该根下仍有 ${row.certificateCount} 张未删除的签发证书。删除不会把这些证书一并删掉；它们仍会留在证书列表中，但无法再使用此根签发、重新生成或部署。`
      : '当前没有未删除的下属签发证书。';
    modal.confirm({
      title: `删除根证书「${row.name}」？`,
      content: `${extra}这是假删除：页面上将不再显示该根，私钥、历史记录和证书库档案都会保留。删除后可以使用相同名称再创建一棵新的根证书。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(row.id),
    });
  };

  const confirmRetire = (row: RootCaSummary) => {
    modal.confirm({
      title: `停用根证书「${row.name}」？`,
      content:
        '停用后不能再用它签发新的服务器证书，它已经签出的证书会显示为「已失效（需重签）」。私钥、历史记录和证书库中的公钥都会保留，直到客户端和 Nginx 都切走后再自行决定如何处理。这不是覆盖或删除。',
      okText: '确认停用',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => retireMutation.mutateAsync(row.id),
    });
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="根 CA"
        description="可以创建多棵根证书，用于轮换。每张服务器证书都归属于签发它的那棵根。根 CA 私钥只保存在数据库中，不会上传到 RustFS，也不会提供下载。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            创建根证书
          </Button>
        }
      />
      <WorkflowBar current="ca" />

      {query.isLoading ? (
        <Card>
          <Spin description="正在读取根证书…">
            <div style={{ minHeight: 120 }} />
          </Spin>
        </Card>
      ) : query.isError ? (
        <Alert type="error" showIcon title="无法读取根证书列表" description={getApiErrorMessage(query.error, '请稍后重试。')} />
      ) : (
        <Card className="surface-card">
          <Table
            rowKey="id"
            dataSource={items}
            pagination={false}
            locale={{ emptyText: '还没有根证书。先创建一个，才能签发服务器证书。' }}
            columns={[
              { title: '根证书名称', dataIndex: 'name' },
              { title: '主体 CN', dataIndex: 'commonName' },
              {
                title: '状态',
                dataIndex: 'status',
                render: (status: string) =>
                  status === 'active' ? <Tag color="success">启用中</Tag> : <Tag>已停用</Tag>,
              },
              { title: '下属证书', dataIndex: 'certificateCount' },
              { title: '需重签', dataIndex: 'needsReissueCount' },
              { title: '需重新生成并覆盖', dataIndex: 'needsRegenerateCount' },
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
              onClick: () => setParams({ id: row.id }),
              style: { cursor: 'pointer' },
            })}
          />
        </Card>
      )}

      <Drawer
        title="创建根证书"
        size={720}
        open={creating}
        onClose={() => setCreating(false)}
        destroyOnHidden
      >
        <CaCreateForm form={form} loading={createMutation.isPending} onSubmit={(values) => createMutation.mutate(buildPayload(values))} />
      </Drawer>

      <Drawer
        title={selected ? selected.name : '根证书详情'}
        size={780}
        open={Boolean(selected)}
        onClose={() => setParams({})}
      >
        {selected ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            {selected.status === 'retired' ? (
              <Alert
                type="warning"
                showIcon
                title="此根证书已停用"
                description={`停用时间：${dayjs(selected.retiredAt).format('YYYY-MM-DD HH:mm')}。不能再签发或重新生成服务器证书。已有 ${selected.needsReissueCount} 张服务器证书需要改用其他根重新签发。私钥仍保留在数据库中。`}
              />
            ) : null}
            {selected.status === 'active' && (selected.generation ?? 1) > 1 ? (
              <Alert
                type="error"
                showIcon
                title="客户端必须重新安装这棵根的新公钥"
                description={
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <span>
                      此根已重新生成并覆盖（第 {selected.generation} 代
                      {selected.regeneratedAt ? `，${dayjs(selected.regeneratedAt).format('YYYY-MM-DD HH:mm')}` : ''}
                      ）。已经安装过旧版 {selected.publicFileName} 的电脑必须改下这次的新公钥，否则浏览器不会信任之后新签发的服务器证书。旧公钥无法校验新证书。
                    </span>
                    <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/guide?caId=${selected.id}`)}>
                      查看客户端安装指引
                    </Button>
                  </Space>
                }
              />
            ) : null}
            {selected.status === 'active' && selected.needsRegenerateCount > 0 ? (
              <Alert
                type="warning"
                showIcon
                title="下属服务器证书不可用，需重新生成并覆盖"
                description={
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <span>
                      此根仍为启用中，但它已重新生成（第 {selected.generation} 代
                      {selected.regeneratedAt ? `，${dayjs(selected.regeneratedAt).format('YYYY-MM-DD HH:mm')}` : ''}
                      ）。覆盖前签发的 {selected.needsRegenerateCount} 张服务器证书与新的根私钥对不上，即使仍在有效期内也不可用。证书库中的旧档案会保留为不可用状态；部署目录不会自动改写，重新生成后还需再部署。
                    </span>
                    <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/certs?caId=${selected.id}`)}>
                      去重新生成这些证书
                    </Button>
                  </Space>
                }
              />
            ) : null}
            <CaDetailsView details={selected} />
            <CaDownloadPanel details={selected} />
            <Card className="surface-card" title="证书库（管理档案）">
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  title="这里上传的是根证书公钥 rootCA.crt，进入证书库 archive/cas/<id>/，不是部署到某台服务器的 cert 目录。"
                  description="根 CA 私钥不会上传。"
                />
                {selected.archive.uploaded ? (
                  <Typography.Text>
                    已入库：<code>{selected.archive.objectKey}</code>
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">尚未写入证书库。</Typography.Text>
                )}
                <Button onClick={() => archiveMutation.mutate(selected.id)} loading={archiveMutation.isPending}>
                  {selected.archive.uploaded ? '重新上传到证书库' : '上传到证书库'}
                </Button>
              </Space>
            </Card>
            <Space wrap>
              {selected.status === 'active' ? (
                <>
                  <Button onClick={() => openRegenerate(selected)} loading={regenMutation.isPending}>
                    重新生成并覆盖
                  </Button>
                  <Button danger onClick={() => confirmRetire(selected)} loading={retireMutation.isPending}>
                    停用此根证书
                  </Button>
                </>
              ) : null}
              <Button danger onClick={() => confirmDelete(selected)} loading={deleteMutation.isPending}>
                删除此根证书
              </Button>
            </Space>
            {selected.status === 'active' ? <NextStepCard after="ca" /> : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title={selected ? `重新生成并覆盖「${selected.name}」？` : '重新生成并覆盖'}
        open={regenOpen}
        onCancel={() => setRegenOpen(false)}
        onOk={() => regenForm.submit()}
        okText="确认重新生成并覆盖"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        confirmLoading={regenMutation.isPending}
        destroyOnHidden
      >
        <Form form={regenForm} layout="vertical" onFinish={submitRegenerate}>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title="会换成新的密钥和证书，已安装的旧根公钥将失效"
            description="覆盖后这棵根仍保持启用，但会使用新的密钥和证书（同一 caId，不是另建一棵根）。已经把旧的根公钥（例如 rootCA.crt）装到电脑上的用户，必须改装下面即将生成的新公钥，否则浏览器不会信任之后新签发的服务器证书。该根下已签发的服务器证书将全部变为不可用，需要重新生成并覆盖。这与「停用根」不是同一操作。部署目录不会自动改写。"
          />
          <Form.Item
            label="有效期（天）"
            name="days"
            rules={[{ required: true, message: '请填写有效期' }]}
            extra="可在覆盖时调整。默认沿用当前有效期天数，最长 50 年（18250 天）。"
          >
            <InputNumber min={1} max={MAX_CERT_VALIDITY_DAYS} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="生效时间" name="notBefore" extra="留空则使用当前时间。">
            <DatePicker showTime style={{ width: '100%' }} placeholder="默认为现在" />
          </Form.Item>
          <Form.Item label="密钥长度" name="keySize" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 2048, label: '2048 位' },
                { value: 4096, label: '4096 位（推荐）' },
                { value: 8192, label: '8192 位（较慢）' },
              ]}
            />
          </Form.Item>
          <Form.Item label="签名算法" name="hashAlgorithm" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'sha256', label: 'SHA-256' },
                { value: 'sha384', label: 'SHA-384' },
                { value: 'sha512', label: 'SHA-512' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function CaCreateForm({
  form,
  loading,
  onSubmit,
}: {
  form: ReturnType<typeof Form.useForm<CaFormValues>>[0];
  loading: boolean;
  onSubmit: (values: CaFormValues) => void;
}) {
  const name = Form.useWatch('name', form) ?? '';
  const commonName = Form.useWatch('commonName', form);
  const publicFileName = Form.useWatch('publicFileName', form);
  const previewName = useMemo(
    () =>
      publicFileName?.trim()
        ? withCertExtension(publicFileName, name || 'Root-CA')
        : suggestCaPublicFileName(commonName || name),
    [name, commonName, publicFileName],
  );

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={DEFAULT_VALUES}
      onFinish={onSubmit}
    >
      <Form.Item
        label="根证书名称"
        name="name"
        rules={[{ required: true, message: '请填写根证书名称' }]}
        extra={<FieldHint example="Lan-Root-CA">用于在本平台中区分不同的根证书，创建后不可与其他根重名。不填主体通用名称时，也会用作证书的 CN。</FieldHint>}
      >
        <Input maxLength={128} placeholder="例如 Lan-Root-CA" />
      </Form.Item>
      <NamePreview
        title="将自动生成"
        items={[
          { label: '主体 CN（可在高级选项中改）', value: commonName?.trim() || name || '（与根证书名称相同）' },
          { label: '下载 / 分发文件名', value: previewName },
        ]}
        footnote="内部公钥文件在证书库中固定为 rootCA.crt。私钥只写入数据库，名为 rootCA.key 的材料不会出现在 RustFS 中。"
      />
      <AdvancedOptions>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="主体通用名称（CN）" name="commonName" extra="不填则使用根证书名称。">
              <Input maxLength={128} placeholder="可选" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="组织" name="organization" extra={<FieldHint example="我的公司">写入证书主体的组织字段，可不填。</FieldHint>}>
              <Input maxLength={64} placeholder="可选" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="部门" name="organizationalUnit">
              <Input maxLength={64} placeholder="可选" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="国家代码"
              name="country"
              rules={[{ pattern: /^[A-Za-z]{0,2}$/, message: '国家代码必须是 2 位字母' }]}
              normalize={(value: string) => (value ? value.toUpperCase() : value)}
              extra={<FieldHint example="CN">两位国家代码，默认 CN。</FieldHint>}
            >
              <Input maxLength={2} placeholder="CN" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="省 / 州" name="stateOrProvince">
              <Input maxLength={128} placeholder="可选" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="城市" name="locality">
              <Input maxLength={128} placeholder="可选" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="邮箱" name="emailAddress" rules={[{ type: 'email', message: '请输入有效的邮箱地址' }]}>
              <Input maxLength={128} placeholder="可选" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="密钥长度" name="keySize" extra="4096 位生成可能需要数十秒，8192 位可能需要数分钟。" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 2048, label: '2048 位' },
                  { value: 4096, label: '4096 位（推荐）' },
                  { value: 8192, label: '8192 位（较慢）' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="有效期（天）"
              name="days"
              rules={[{ required: true }]}
              extra="默认 3650 天（10 年），最长 50 年（18250 天）。"
            >
              <InputNumber min={1} max={MAX_CERT_VALIDITY_DAYS} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="生效时间" name="notBefore" extra="留空则使用当前时间。">
              <DatePicker showTime style={{ width: '100%' }} placeholder="默认为现在" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="签名算法" name="hashAlgorithm" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'sha256', label: 'SHA-256' },
                  { value: 'sha384', label: 'SHA-384' },
                  { value: 'sha512', label: 'SHA-512' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="路径长度约束" name="pathLenConstraint" extra="可选。0 表示只能签发终端证书。">
              <InputNumber min={0} style={{ width: '100%' }} placeholder="不设置" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              label="下载文件名"
              name="publicFileName"
              extra={<FieldHint example="Lan-Root-CA.crt">只影响客户端安装和分发时的文件名。不填则根据根证书名称自动生成。</FieldHint>}
            >
              <Input maxLength={200} placeholder={previewName} />
            </Form.Item>
          </Col>
        </Row>
      </AdvancedOptions>
      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          创建根证书
        </Button>
      </Form.Item>
    </Form>
  );
}

function CaDetailsView({ details }: { details: RootCaSummary }) {
  return (
    <Descriptions bordered size="middle" column={{ xs: 1, sm: 1, md: 2 }} styles={{ label: { width: 160 } }}>
      <Descriptions.Item label="根证书名称">{details.name}</Descriptions.Item>
      <Descriptions.Item label="下载文件名">{details.publicFileName}</Descriptions.Item>
      <Descriptions.Item label="状态">
        {details.status === 'active' ? <Tag color="success">启用中</Tag> : <Tag>已停用</Tag>}
      </Descriptions.Item>
      <Descriptions.Item label="代数">{details.generation}</Descriptions.Item>
      <Descriptions.Item label="最近覆盖">
        {details.regeneratedAt ? dayjs(details.regeneratedAt).format('YYYY-MM-DD HH:mm:ss') : '尚未覆盖'}
      </Descriptions.Item>
      <Descriptions.Item label="是否为 CA">
        {details.isCA ? <Tag color="success">CA:TRUE</Tag> : <Tag color="error">CA:FALSE</Tag>}
      </Descriptions.Item>
      <Descriptions.Item label="国家">{details.subject.country ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="组织">{details.subject.organization ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="部门">{details.subject.organizationalUnit ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="邮箱">{details.subject.emailAddress ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="颁发者">{details.issuer.commonName ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="序列号">
        <Typography.Text copyable={{ text: details.serialNumber }}>{details.serialNumber}</Typography.Text>
      </Descriptions.Item>
      <Descriptions.Item label="生效时间">{dayjs(details.notBefore).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
      <Descriptions.Item label="到期时间">{dayjs(details.notAfter).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
      <Descriptions.Item label="签名算法">{details.signatureAlgorithm}</Descriptions.Item>
      <Descriptions.Item label="公钥">
        {details.publicKeyAlgorithm} {details.publicKeyBits} 位
      </Descriptions.Item>
      <Descriptions.Item label="密钥用法">
        {details.keyUsage.length ? details.keyUsage.map((item) => KEY_USAGE_LABELS[item] ?? item).join('，') : '—'}
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

function CaDownloadPanel({ details }: { details: RootCaSummary }) {
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

  const preview = `${(stem.trim() || initial.stem)}.${format}`;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const filename = await downloadCaCert(details.id, { filename: stem.trim() || undefined, format });
      message.success(`已开始下载 ${filename}`);
    } catch (error) {
      message.error(getApiErrorMessage(error, '下载根证书失败'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="surface-card" title="下载根证书公钥">
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {(details.generation ?? 1) > 1 ? (
          <Alert
            type="error"
            showIcon
            title="请分发这次下载的新公钥"
            description={`此根已重新生成并覆盖（第 ${details.generation} 代）。已经安装过旧版 ${details.publicFileName} 的电脑必须改装这次下载的文件，旧公钥无法校验新签发的服务器证书。不会下载 rootCA.key。`}
          />
        ) : (
          <Alert
            type="info"
            showIcon
            title="下载的是根证书公钥，用来安装到访问网站的电脑上。不会下载 rootCA.key。"
          />
        )}
        <Row gutter={16}>
          <Col xs={24} md={14}>
            <Space.Compact block>
              <Input value={stem} onChange={(event) => setStem(event.target.value)} />
              <Input value={`.${format}`} readOnly tabIndex={-1} style={{ width: 88, textAlign: 'center' }} />
            </Space.Compact>
          </Col>
          <Col xs={24} md={10}>
            <Select value={format} onChange={setFormat} options={CERT_FORMAT_OPTIONS} style={{ width: '100%' }} />
          </Col>
        </Row>
        <Typography.Text type="secondary">将下载为 {preview}</Typography.Text>
        <Button type="primary" icon={<DownloadOutlined />} loading={downloading} onClick={() => void handleDownload()}>
          下载根证书
        </Button>
      </Space>
    </Card>
  );
}
