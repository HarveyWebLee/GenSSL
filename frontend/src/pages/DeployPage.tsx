import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import {
  createDeploy,
  downloadStoredObject,
  listCerts,
  listDeploys,
  listServers,
  listTargetFiles,
} from '../api/ssl';
import type { CertificateSummary, DeployRecord, TargetFileList } from '../api/types';
import { DisabledHint } from '../components/DisabledHint';
import { FieldHint } from '../components/FieldHint';
import { NextStepCard } from '../components/NextStepCard';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';
import { certStatusColor, DEPLOY_BLOCKED_REASON, DEPLOY_REISSUE_WARNING } from '../utils/cert-status';

interface DeployForm {
  certificateId: string;
  serverId: string;
  pathId: string;
  includeRootCaCert: boolean;
  overwrite: boolean;
}

export function DeployPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<DeployForm>();
  const serverId = Form.useWatch('serverId', form);
  const pathId = Form.useWatch('pathId', form);
  const certificateId = Form.useWatch('certificateId', form);
  const [lastResult, setLastResult] = useState<DeployRecord | null>(null);

  const certsQuery = useQuery({ queryKey: ['certs'], queryFn: listCerts });
  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const deploysQuery = useQuery({ queryKey: ['deploys'], queryFn: listDeploys });

  const certs = certsQuery.data?.items ?? [];
  const servers = serversQuery.data?.items ?? [];
  const selectedCert = certs.find((item) => item.id === certificateId);

  const selectedServer = useMemo(
    () => servers.find((item) => item.id === serverId),
    [servers, serverId],
  );
  const selectedPath = selectedServer?.paths.find((item) => item.id === pathId);
  const sshBlockedReason = selectedServer && !selectedServer.sshReady ? selectedServer.sshReadyReason : undefined;

  const filesQuery = useQuery({
    queryKey: ['target-files', serverId, pathId],
    queryFn: () => listTargetFiles(serverId, pathId),
    enabled: Boolean(serverId && pathId),
  });

  const deploy = useMutation({
    mutationFn: createDeploy,
    onSuccess: async (result) => {
      setLastResult(result);
      message.success(
        result.remote?.destination
          ? `已将文件写入 ${result.remote.destination}`
          : '已完成部署',
      );
      await queryClient.invalidateQueries({ queryKey: ['deploys'] });
      await queryClient.invalidateQueries({ queryKey: ['target-files'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (error) => message.error(getApiErrorMessage(error, '上传失败')),
  });

  const download = useMutation({
    mutationFn: downloadStoredObject,
    onSuccess: (filename) => message.success(`已开始下载 ${filename}`),
    onError: (error) => message.error(error instanceof Error ? error.message : '下载失败'),
  });

  const certLabel = (item: CertificateSummary) => {
    const statusNote = item.status === 'valid' ? '' : ` · ${item.statusLabel}`;
    return `${item.publicFileName}（${item.ips.join(', ')}）${statusNote}`;
  };

  const overwriteContent =
    '将覆盖远程服务器证书目录中的同名文件，同时覆盖文件服务器里该路径的管理副本。上传包包含服务器证书和服务器私钥；可选包含该证书所属根的公钥。绝不会上传 rootCA.key。';

  const submit = (values: DeployForm) => {
    const cert = certs.find((item) => item.id === values.certificateId);
    if (cert?.status === 'needs_regenerate') {
      message.error(DEPLOY_BLOCKED_REASON);
      return;
    }
    const server = servers.find((item) => item.id === values.serverId);
    if (server && !server.sshReady) {
      message.error(server.sshReadyReason || '尚未配置远程登录，无法上传。');
      return;
    }
    const run = () =>
      deploy.mutate({
        certificateId: values.certificateId,
        serverId: values.serverId,
        pathId: values.pathId,
        includeRootCaCert: values.includeRootCaCert,
        overwrite: values.overwrite,
      });

    if (cert?.status === 'needs_reissue') {
      modal.confirm({
        title: '该证书已失效（需重签），仍要部署吗？',
        content: DEPLOY_REISSUE_WARNING + '远程目录不会因为证书状态变化而自动改写。',
        okText: '仍要临时部署',
        cancelText: '取消',
        onOk: () => {
          if (values.overwrite) {
            modal.confirm({
              title: '确认覆盖远程目录中的已有文件？',
              content: overwriteContent,
              okText: '确认覆盖并上传',
              cancelText: '取消',
              onOk: run,
            });
            return;
          }
          run();
        },
      });
      return;
    }

    if (values.overwrite) {
      modal.confirm({
        title: '确认覆盖远程目录中的已有文件？',
        content: overwriteContent,
        okText: '确认覆盖并上传',
        cancelText: '取消',
        onOk: run,
      });
      return;
    }
    run();
  };

  const confirmObjectDownload = (record: { key: string; fileName: string; kind?: string }) => {
    if (record.kind === 'server-key' || /\.key$/i.test(record.fileName)) {
      modal.confirm({
        title: '下载服务器私钥？',
        content: '此文件只用于部署到对应 Nginx，不要分发给客户端。这是文件服务器中的管理副本。',
        okText: '继续下载',
        cancelText: '取消',
        onOk: () => download.mutateAsync(record.key),
      });
      return;
    }
    download.mutate(record.key);
  };

  const fileColumns: ColumnsType<TargetFileList['files'][number]> = [
    { title: '文件名', dataIndex: 'fileName' },
    {
      title: '类型',
      dataIndex: 'kind',
      render: (kind: string) => {
        const map: Record<string, string> = {
          'server-cert': '服务器证书',
          'server-key': '服务器私钥',
          'ca-cert': '根 CA 公钥',
        };
        return map[kind] ?? kind;
      },
    },
    { title: '对象键', dataIndex: 'key', ellipsis: true },
    { title: '大小', dataIndex: 'size', render: (size: number) => `${size} B` },
    {
      title: '更新时间',
      dataIndex: 'lastModified',
      render: (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => confirmObjectDownload(row)}>
          下载副本
        </Button>
      ),
    },
  ];

  const remoteColumns: ColumnsType<NonNullable<TargetFileList['remote']>['files'][number]> = [
    { title: '文件名', dataIndex: 'fileName' },
    {
      title: '类型',
      dataIndex: 'kind',
      render: (kind: string) => {
        const map: Record<string, string> = {
          'server-cert': '服务器证书',
          'server-key': '服务器私钥',
          'ca-cert': '根 CA 公钥',
        };
        return map[kind] ?? kind;
      },
    },
    { title: '远程路径', dataIndex: 'path', ellipsis: true },
    { title: '大小', dataIndex: 'size', render: (size: number) => `${size} B` },
    {
      title: '更新时间',
      dataIndex: 'lastModified',
      render: (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—'),
    },
  ];

  const historyColumns: ColumnsType<DeployRecord> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '证书',
      dataIndex: 'certificate',
      render: (value: DeployRecord['certificate']) => value.name ?? value.id,
    },
    {
      title: '目标',
      key: 'destination',
      render: (_, row) => row.remote?.destination ?? row.server.name ?? row.server.id,
    },
    {
      title: '文件',
      dataIndex: 'files',
      render: (files: DeployRecord['files']) => files.map((item) => item.fileName).join('，'),
    },
    {
      title: '覆盖',
      dataIndex: 'overwritten',
      render: (value: boolean) => (value ? <Tag color="orange">覆盖</Tag> : <Tag>新增</Tag>),
    },
    {
      title: '状态',
      key: 'stale',
      render: (_, row) =>
        row.status === 'failed' ? (
          <Tag color="error">失败</Tag>
        ) : row.stale ? (
          <Tag color="warning">{row.staleLabel || '已过时'}</Tag>
        ) : row.certificate.status && row.certificate.status !== 'valid' ? (
          <Tag color={certStatusColor(row.certificate.status)}>{row.certificate.statusLabel}</Tag>
        ) : (
          <Tag color="success">当前有效</Tag>
        ),
    },
  ];

  const missingPrereq = !certsQuery.isLoading && !serversQuery.isLoading && (certs.length === 0 || servers.length === 0);
  const deployDisabled = Boolean(sshBlockedReason) || selectedCert?.status === 'needs_regenerate';
  const deployDisabledReason =
    selectedCert?.status === 'needs_regenerate' ? DEPLOY_BLOCKED_REASON : sshBlockedReason;

  return (
    <div className="page-stack">
      <PageHeader
        title="上传部署"
        description="把要用的证书和私钥通过 SFTP 写入你登记的远程证书目录。文件服务器中会保留一份管理副本（deploy/ 前缀），与「证书库」完全分开。签发或重新生成成功后不会自动部署。"
      />
      <WorkflowBar current="deploy" />

      <Alert
        type="warning"
        showIcon
        title="私钥只用于部署到对应 Nginx"
        description="上传包中的 .key 是服务器私钥，不要分发给客户端。根 CA 私钥只保存在数据库中，绝不会被上传到远程服务器、文件服务器，也不会提供下载。"
      />

      {missingPrereq ? (
        <Card className="surface-card">
          <div className="empty-panel">
            <h4>还不能部署到服务器目录</h4>
            <p>
              {certs.length === 0
                ? '请先签发一张服务器证书，再登记服务器、SSH 登录方式和部署目录。'
                : '请先登记服务器，配置 SSH 登录，并添加部署目录，例如 /etc/nginx/ssl。'}
            </p>
            <Button type="primary" onClick={() => navigate(certs.length === 0 ? '/issue' : '/servers')}>
              {certs.length === 0 ? '去签发证书' : '去登记服务器'}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="surface-card" title="选择证书和目标目录">
          <Form<DeployForm>
            form={form}
            layout="vertical"
            initialValues={{ includeRootCaCert: false, overwrite: false }}
            onFinish={submit}
          >
            <Form.Item
              label="要部署的证书"
              name="certificateId"
              rules={[{ required: true, message: '请选择证书' }]}
              extra={
                <FieldHint>
                  选择一张已签发的服务器证书。会同时放入它的证书文件和私钥。因根证书被覆盖而不可用的证书不能部署，需先重新生成并覆盖。所属根已停用的证书仅建议在迁移期间临时使用。
                </FieldHint>
              }
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={certsQuery.isLoading}
                options={certs.map((item) => ({
                  value: item.id,
                  label: certLabel(item),
                  disabled: item.status === 'needs_regenerate',
                  title: item.status === 'needs_regenerate' ? DEPLOY_BLOCKED_REASON : undefined,
                }))}
              />
            </Form.Item>
            {selectedCert?.status === 'needs_reissue' ? (
              <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={DEPLOY_REISSUE_WARNING} />
            ) : null}
            {selectedCert?.status === 'needs_regenerate' ? (
              <Alert type="error" showIcon style={{ marginBottom: 16 }} title={DEPLOY_BLOCKED_REASON} />
            ) : null}
            <Form.Item
              label="目标服务器"
              name="serverId"
              rules={[{ required: true, message: '请选择服务器' }]}
              extra={<FieldHint example="web-01">选择已配置 SSH 的服务器。未配置主机、用户名或凭据时，无法上传。</FieldHint>}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={serversQuery.isLoading}
                options={servers.map((item) => ({
                  value: item.id,
                  label: item.sshReady
                    ? `${item.name}（${item.host}:${item.sshPort}）`
                    : `${item.name}（未配置远程登录）`,
                }))}
                onChange={() => form.setFieldValue('pathId', undefined)}
              />
            </Form.Item>
            {sshBlockedReason ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                title={sshBlockedReason}
                action={
                  <Button size="small" onClick={() => navigate('/servers')}>
                    去配置 SSH
                  </Button>
                }
              />
            ) : null}
            <Form.Item
              label="目标目录"
              name="pathId"
              rules={[{ required: true, message: '请选择部署目录' }]}
              extra={
                <FieldHint example="/etc/nginx/ssl">
                  文件将写入这台机器上的这个绝对路径。请先在服务器上创建该目录。文件名沿用证书的公钥和私钥文件名。
                </FieldHint>
              }
            >
              <Select
                options={(selectedServer?.paths ?? []).map((item) => ({
                  value: item.id,
                  label: item.label ? `${item.path}（${item.label}）` : item.path,
                }))}
                placeholder={serverId ? '请选择目录' : '请先选择服务器'}
              />
            </Form.Item>
            <Form.Item name="includeRootCaCert" valuePropName="checked">
              <Checkbox>同时放入签发该证书的那棵根的公钥，方便之后拷到客户端安装。不会上传 rootCA.key。</Checkbox>
            </Form.Item>
            <Form.Item
              name="overwrite"
              label="覆盖已有文件"
              valuePropName="checked"
              extra="若远程目录或管理副本中已有同名文件，或证书已重新生成需要替换过时文件，请打开此项。"
            >
              <Switch />
            </Form.Item>
            <DisabledHint title={deployDisabled ? deployDisabledReason ?? undefined : undefined}>
              <Button type="primary" htmlType="submit" loading={deploy.isPending} disabled={deployDisabled}>
                上传到远程服务器
              </Button>
            </DisabledHint>
          </Form>
        </Card>
      )}

      {lastResult ? (
        <>
          <Card className="surface-card" title="最近一次部署结果">
            <Alert
              type={lastResult.status === 'failed' ? 'error' : 'success'}
              showIcon
              title={
                lastResult.remote?.destination
                  ? `已写入 ${lastResult.remote.destination}`
                  : `已写入前缀 ${lastResult.objectPrefix}`
              }
              description={lastResult.warning}
            />
            <Table
              style={{ marginTop: 16 }}
              rowKey={(row) => row.remotePath || row.objectKey}
              pagination={false}
              dataSource={lastResult.files}
              columns={[
                { title: '文件名', dataIndex: 'fileName' },
                { title: '远程路径', dataIndex: 'remotePath', render: (value?: string) => value || '—' },
                { title: '管理副本', dataIndex: 'objectKey' },
                { title: '大小', dataIndex: 'size', render: (size: number) => `${size} B` },
              ]}
            />
          </Card>
          <NextStepCard after="deploy" />
        </>
      ) : null}

      <Card
        className="surface-card"
        title="远程目录与管理副本"
        extra={
          <Button size="small" disabled={!serverId || !pathId} onClick={() => void filesQuery.refetch()}>
            刷新
          </Button>
        }
      >
        {serverId && pathId ? (
          filesQuery.isError ? (
            <Alert
              type="error"
              showIcon
              title="无法列出目标文件"
              description={getApiErrorMessage(filesQuery.error, '请确认服务器 SSH 配置和文件服务器可用。')}
            />
          ) : (
            <>
              {filesQuery.data?.remote?.destination ? (
                <Typography.Paragraph type="secondary">
                  远程目标：{filesQuery.data.remote.destination}
                </Typography.Paragraph>
              ) : selectedPath ? (
                <Typography.Paragraph type="secondary">远程目录：{selectedPath.path}</Typography.Paragraph>
              ) : null}
              {filesQuery.data?.deployStale ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  title={filesQuery.data.deployStaleLabel || '该目录中的文件已过时'}
                  description="重新生成或根证书覆盖后，远程目录和管理副本中的旧文件都不会自动更新。请选择当前可用的证书，打开「覆盖已有文件」后重新上传。"
                />
              ) : null}
              {filesQuery.data?.remote?.error ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  title="无法列出远程目录"
                  description={filesQuery.data.remote.error}
                />
              ) : (
                <Table
                  rowKey="path"
                  loading={filesQuery.isLoading}
                  columns={remoteColumns}
                  dataSource={filesQuery.data?.remote?.files ?? []}
                  pagination={false}
                  locale={{ emptyText: filesQuery.data?.remote?.exists === false ? '远程目录不存在或无法访问' : '远程目录中还没有文件' }}
                />
              )}
              <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                管理副本前缀：{filesQuery.data?.prefix ?? '—'}
              </Typography.Paragraph>
              {filesQuery.data?.rustfsError ? (
                <Alert type="warning" showIcon title="无法列出管理副本" description={filesQuery.data.rustfsError} />
              ) : (
                <Table
                  rowKey="key"
                  loading={filesQuery.isLoading}
                  columns={fileColumns}
                  dataSource={filesQuery.data?.files ?? []}
                  pagination={false}
                />
              )}
            </>
          )
        ) : (
          <Typography.Text type="secondary">
            选择服务器和目录后，将显示远程目录中的文件，以及文件服务器中对应的管理副本。证书库中的档案不会出现在这里。
          </Typography.Text>
        )}
      </Card>

      <Card className="surface-card" title="部署记录">
        <Table
          rowKey="id"
          loading={deploysQuery.isLoading}
          columns={historyColumns}
          dataSource={deploysQuery.data?.items ?? []}
          pagination={{ pageSize: 8 }}
        />
      </Card>
    </div>
  );
}
