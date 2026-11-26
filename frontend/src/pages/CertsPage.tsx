import { useEffect, useMemo, useState, type Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  InputNumber,
  Modal,
  Select,
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
import { deleteCert, downloadIssuedCert, getCertDetail, listCerts, regenerateCert, regenerateCertsBatch } from '../api/ssl';
import type { CertificateDetail, CertificateLifecycleStatus, CertificateSummary } from '../api/types';
import { DisabledHint } from '../components/DisabledHint';
import { PageHeader } from '../components/PageHeader';
import { MAX_CERT_VALIDITY_DAYS } from '../utils/cert-validity';
import { certStatusColor, REGENERATE_DISABLED_REASON } from '../utils/cert-status';

const CA_DELETED_REASON = '所属根证书已从列表中删除，不能再重新生成或部署。';

function regenerateDisabledReason(row: { ca: { status: string; deleted?: boolean } }): string | undefined {
  if (row.ca.deleted) return CA_DELETED_REASON;
  if (row.ca.status === 'retired') return REGENERATE_DISABLED_REASON;
  return undefined;
}

function ValidityTag({ ok, label }: { ok: boolean; label: string }) {
  return <Tag color={ok ? 'success' : 'error'}>{label}</Tag>;
}

interface RegenFormValues {
  days: number;
}

export function CertsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const filterCaId = params.get('caId');
  const filterStatus = params.get('status') as CertificateLifecycleStatus | null;
  const [detail, setDetail] = useState<CertificateDetail | null>(null);
  const [redeployHint, setRedeployHint] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [regenTarget, setRegenTarget] = useState<CertificateSummary | null>(null);
  const [regenForm] = Form.useForm<RegenFormValues>();

  const query = useQuery({
    queryKey: ['certs'],
    queryFn: listCerts,
  });

  const items = useMemo(() => {
    const all = query.data?.items ?? [];
    const byCa = filterCaId ? all.filter((item) => item.ca.id === filterCaId) : all;
    return filterStatus ? byCa.filter((item) => item.status === filterStatus) : byCa;
  }, [query.data?.items, filterCaId, filterStatus]);

  const needsRegenerateItems = items.filter((item) => item.status === 'needs_regenerate');
  const filterCaName =
    (query.data?.items ?? []).find((item) => item.ca.id === filterCaId)?.ca.name ?? filterCaId;

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

  const invalidateCertQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ['certs'] });
    await queryClient.invalidateQueries({ queryKey: ['cas'] });
    await queryClient.invalidateQueries({ queryKey: ['overview'] });
    await queryClient.invalidateQueries({ queryKey: ['archive'] });
    await queryClient.invalidateQueries({ queryKey: ['deploys'] });
    await queryClient.invalidateQueries({ queryKey: ['target-files'] });
  };

  const regenMutation = useMutation({
    mutationFn: ({ id, days }: { id: string; days?: number }) => regenerateCert(id, days ? { days } : {}),
    onSuccess: async (updated) => {
      await invalidateCertQueries();
      setRegenTarget(null);
      if (selectedId === updated.id) {
        setDetail(updated);
      }
      setRedeployHint('服务器证书已重新生成并覆盖，已恢复为可用。部署目录中的旧文件不会自动更新，需要重新上传部署。');
      message.success(updated.warning || '服务器证书已重新生成并覆盖，已恢复为可用。部署目录未改动，需要重新上传部署。');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '重新生成并覆盖失败')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCert,
    onSuccess: async (_data, id) => {
      await invalidateCertQueries();
      message.success('签发证书已从列表中移除。证书库档案仍保留，这是假删除。');
      if (selectedId === id) {
        setParamValue('id');
        setDetail(null);
      }
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除失败')),
  });

  const batchMutation = useMutation({
    mutationFn: (payload: { ids?: string[]; caId?: string }) => regenerateCertsBatch(payload),
    onSuccess: async (result) => {
      await invalidateCertQueries();
      setSelectedRowKeys([]);
      if (result.failed.length === 0) {
        setRedeployHint(`已重新生成并覆盖 ${result.items.length} 张证书。部署目录中的旧文件不会自动更新，需要重新上传部署。`);
        message.success(`已重新生成并覆盖 ${result.items.length} 张证书。部署目录未改动，需要重新上传部署。`);
      } else {
        setRedeployHint(
          result.items.length
            ? `成功 ${result.items.length} 张，失败 ${result.failed.length} 张。已成功覆盖的证书需要重新上传部署。`
            : null,
        );
        message.warning(
          `成功 ${result.items.length} 张，失败 ${result.failed.length} 张：${result.failed
            .map((item) => item.message)
            .join('；')}`,
        );
      }
    },
    onError: (error) => message.error(getApiErrorMessage(error, '批量重新生成失败')),
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

  const confirmDeleteCert = (row: CertificateSummary) => {
    modal.confirm({
      title: `删除签发证书「${row.name}」？`,
      content:
        '这是假删除：页面上将不再显示该证书，不能再下载或部署，证书库中的档案仍会保留。删除后，同一根下可以使用相同名称再签发新的证书。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(row.id),
    });
  };

  const openRegenerate = (row: CertificateSummary) => {
    if (row.ca.deleted) {
      message.error(CA_DELETED_REASON);
      return;
    }
    if (row.ca.status === 'retired') {
      message.error('所属根证书已停用，不能重新生成。请改用一棵启用中的根证书重新签发。');
      return;
    }
    regenForm.setFieldsValue({ days: row.days });
    setRegenTarget(row);
  };

  const confirmBatch = (ids?: string[]) => {
    const count = ids?.length ?? needsRegenerateItems.length;
    modal.confirm({
      title: `重新生成并覆盖 ${count} 张证书？`,
      content:
        '将用当前启用中的根私钥，按原 IP、DNS 和名称重新签发，并覆盖证书库中的证书和私钥。部署目录不会自动改写，成功后需要重新上传部署。停用根下的证书不会被重新生成。',
      okText: '确认重新生成并覆盖',
      cancelText: '取消',
      onOk: () =>
        batchMutation.mutateAsync(
          ids?.length ? { ids } : filterCaId ? { caId: filterCaId } : { ids: needsRegenerateItems.map((item) => item.id) },
        ),
    });
  };

  const setParamValue = (key: string, value?: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const columns: ColumnsType<CertificateSummary> = [
    {
      title: '状态',
      dataIndex: 'statusLabel',
      render: (label: string, row) => <Tag color={certStatusColor(row.status)}>{label}</Tag>,
    },
    {
      title: '所属根证书',
      dataIndex: ['ca', 'name'],
      render: (_: string, row) => (
        <div>
          <div>{row.ca.name || '—'}</div>
          {row.ca.deleted ? <Tag color="error">所属根已删除</Tag> : row.ca.status === 'retired' ? <Tag>根已停用</Tag> : null}
          {row.status === 'needs_regenerate' ? <Tag color="error">根已覆盖</Tag> : null}
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
      width: 250,
      render: (_, row) => (
        <Space wrap>
          <Button type="link" size="small" onClick={() => setParamValue('id', row.id)}>
            详情
          </Button>
          <DisabledHint title={regenerateDisabledReason(row)}>
            <Button
              type="link"
              size="small"
              disabled={Boolean(regenerateDisabledReason(row))}
              onClick={() => openRegenerate(row)}
            >
              重新生成并覆盖
            </Button>
          </DisabledHint>
          <Button type="link" size="small" onClick={() => download.mutate({ id: row.id, part: 'bundle' })}>
            部署包
          </Button>
          <Button type="link" size="small" danger onClick={() => confirmDeleteCert(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="证书列表"
        description="查看已签发证书及其所属根、状态。根被停用后显示为需重签；根被重新生成覆盖后显示为不可用，需重新生成并覆盖。下载包绝不包含 rootCA.key。"
        extra={
          <Space wrap>
            {needsRegenerateItems.length > 0 ? (
              <Button
                onClick={() => confirmBatch()}
                loading={batchMutation.isPending}
              >
                重新生成全部不可用证书（{needsRegenerateItems.length}）
              </Button>
            ) : null}
            {selectedRowKeys.length > 0 ? (
              <Button
                onClick={() => confirmBatch(selectedRowKeys.map((key) => String(key)))}
                loading={batchMutation.isPending}
              >
                重新生成所选（{selectedRowKeys.length}）
              </Button>
            ) : null}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/issue')}>
              签发新证书
            </Button>
          </Space>
        }
      />

      <Space wrap style={{ width: '100%' }} align="center">
        <span>状态筛选</span>
        <Select
          allowClear
          placeholder="全部状态"
          style={{ minWidth: 240 }}
          value={filterStatus ?? undefined}
          onChange={(value) => setParamValue('status', value)}
          options={[
            { value: 'valid', label: '有效' },
            { value: 'needs_regenerate', label: '不可用，需重新生成并覆盖' },
            { value: 'needs_reissue', label: '已失效（需重签）' },
            { value: 'expired', label: '已过期' },
            { value: 'not_yet_valid', label: '尚未生效' },
          ]}
        />
        {filterCaId ? (
          <Button type="link" style={{ padding: 0 }} onClick={() => setParamValue('caId')}>
            清除根证书筛选（{filterCaName}）
          </Button>
        ) : null}
      </Space>

      {redeployHint ? (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setRedeployHint(null)}
          title={redeployHint}
          action={
            <Button size="small" type="primary" onClick={() => navigate('/deploy')}>
              去重新上传部署
            </Button>
          }
        />
      ) : null}

      {needsRegenerateItems.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title="有服务器证书因根证书被覆盖而不可用"
          description="这些证书由旧的根私钥签发，和新根对不上，即使仍在有效期内也不可用。请逐张或批量「重新生成并覆盖」。覆盖只更新证书库，部署目录需要之后再上传。"
        />
      ) : null}

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
            loading={query.isLoading || batchMutation.isPending}
            columns={columns}
            dataSource={items}
            pagination={false}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              getCheckboxProps: (row) => ({
                disabled: Boolean(regenerateDisabledReason(row)),
                title: regenerateDisabledReason(row),
              }),
            }}
          />
        )}
      </Card>

      <Drawer
        title={detail ? `证书详情：${detail.ips.join(', ') || detail.name}` : '证书详情'}
        open={Boolean(selectedId)}
        size={720}
        onClose={() => {
          setParamValue('id');
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
            {detail.status === 'needs_regenerate' ? (
              <Alert
                type="error"
                showIcon
                title="不可用，需重新生成并覆盖"
                description="所属根证书已被重新生成并覆盖，这张证书由旧私钥签发，和新根对不上。重新生成后会覆盖证书库中的文件，但不会改写部署目录。"
              />
            ) : null}
            {detail.status === 'needs_reissue' ? (
              <Alert
                type="warning"
                showIcon
                title="已失效（需重签）"
                description="所属根证书已停用，不能再重新生成。请改用一棵启用中的根证书重新签发。"
              />
            ) : null}
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
              <Descriptions.Item label="状态">
                <Tag color={certStatusColor(detail.status)}>{detail.statusLabel}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="所属根证书">
                {detail.ca.name}
                {detail.ca.deleted ? '（已删除）' : detail.ca.status === 'retired' ? '（已停用）' : ''}
              </Descriptions.Item>
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
              <DisabledHint title={regenerateDisabledReason(detail)}>
                <Button
                  disabled={Boolean(regenerateDisabledReason(detail))}
                  onClick={() => openRegenerate(detail)}
                  loading={regenMutation.isPending}
                >
                  重新生成并覆盖
                </Button>
              </DisabledHint>
              <Button onClick={() => download.mutate({ id: detail.id, part: 'cert' })}>下载证书</Button>
              <Button onClick={() => confirmKeyDownload(detail.id)}>下载私钥</Button>
              <Button onClick={() => download.mutate({ id: detail.id, part: 'bundle' })}>
                下载 Nginx 部署包
              </Button>
              {detail.status === 'valid' && !detail.ca.deleted ? (
                <Button type="primary" onClick={() => navigate('/deploy')}>
                  去重新上传部署
                </Button>
              ) : null}
              <Button danger onClick={() => confirmDeleteCert(detail)} loading={deleteMutation.isPending}>
                删除此证书
              </Button>
            </Space>
            <Alert
              type="warning"
              showIcon
              title="私钥使用提醒"
              description="服务器私钥只用于部署到对应 Nginx，不要分发给客户端。rootCA.key 不会出现在任何下载中。重新生成并覆盖后，还需要重新上传到部署目录。"
            />
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title={regenTarget ? `重新生成并覆盖「${regenTarget.name}」？` : '重新生成并覆盖'}
        open={Boolean(regenTarget)}
        onCancel={() => setRegenTarget(null)}
        onOk={() => regenForm.submit()}
        okText="确认重新生成并覆盖"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        confirmLoading={regenMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={regenForm}
          layout="vertical"
          onFinish={(values) => {
            if (!regenTarget) return;
            regenMutation.mutate({ id: regenTarget.id, days: values.days });
          }}
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title="将用当前根证书重新签发并覆盖档案"
            description="会按原 IP、DNS 和名称生成新的密钥和证书，覆盖证书库中的 crt/key。同一条记录会被更新（新的序列号、指纹和有效期）。部署目录不会自动改写，成功后需要重新上传部署。"
          />
          <Form.Item
            label="有效期（天）"
            name="days"
            rules={[{ required: true, message: '请填写有效期' }]}
            extra="可在覆盖时调整。最长 50 年（18250 天）。"
          >
            <InputNumber min={1} max={MAX_CERT_VALIDITY_DAYS} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
