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
import type { DeployRecord, TargetFileList } from '../api/types';
import { FieldHint } from '../components/FieldHint';
import { NextStepCard } from '../components/NextStepCard';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';

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
  const [lastResult, setLastResult] = useState<DeployRecord | null>(null);

  const certsQuery = useQuery({ queryKey: ['certs'], queryFn: listCerts });
  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const deploysQuery = useQuery({ queryKey: ['deploys'], queryFn: listDeploys });

  const certs = certsQuery.data?.items ?? [];
  const servers = serversQuery.data?.items ?? [];

  const selectedServer = useMemo(
    () => servers.find((item) => item.id === serverId),
    [servers, serverId],
  );

  const filesQuery = useQuery({
    queryKey: ['target-files', serverId, pathId],
    queryFn: () => listTargetFiles(serverId, pathId),
    enabled: Boolean(serverId && pathId),
  });

  const deploy = useMutation({
    mutationFn: createDeploy,
    onSuccess: async (result) => {
      setLastResult(result);
      message.success('已部署到服务器 cert 目录（deploy/ 前缀）');
      await queryClient.invalidateQueries({ queryKey: ['deploys'] });
      await queryClient.invalidateQueries({ queryKey: ['target-files'] });
    },
    onError: (error) => message.error(getApiErrorMessage(error, '上传失败')),
  });

  const download = useMutation({
    mutationFn: downloadStoredObject,
    onSuccess: (filename) => message.success(`已开始下载 ${filename}`),
    onError: (error) => message.error(error instanceof Error ? error.message : '下载失败'),
  });

  const submit = (values: DeployForm) => {
    const run = () =>
      deploy.mutate({
        certificateId: values.certificateId,
        serverId: values.serverId,
        pathId: values.pathId,
        includeRootCaCert: values.includeRootCaCert,
        overwrite: values.overwrite,
      });

    if (values.overwrite) {
      modal.confirm({
        title: '确认覆盖目标路径下的已有文件？',
        content:
          '将覆盖「服务器部署目录」（deploy/ 前缀）下的同名文件。这与证书库（archive/）不是同一处。上传包包含服务器证书和服务器私钥；可选包含该证书所属根的公钥。绝不会上传 rootCA.key。',
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
        content: '此文件只用于部署到对应 Nginx，不要分发给客户端。',
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
          下载
        </Button>
      ),
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
      title: '服务器',
      dataIndex: 'server',
      render: (value: DeployRecord['server']) => value.name ?? value.id,
    },
    {
      title: '目录',
      dataIndex: 'path',
      render: (value: DeployRecord['path']) => value.path ?? value.id,
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
  ];

  const missingPrereq = !certsQuery.isLoading && !serversQuery.isLoading && (certs.length === 0 || servers.length === 0);

  return (
    <div className="page-stack">
      <PageHeader
        title="上传部署"
        description="把要用的文件部署到某台服务器的 cert 目录（或你登记的部署路径）在 RustFS 中对应的前缀下，以 deploy/ 开头。这与「证书库」完全分开，也不会通过 SSH 写入远程磁盘，下载后再自行拷到 Nginx。"
      />
      <WorkflowBar current="deploy" />

      <Alert
        type="warning"
        showIcon
        title="私钥只用于部署到对应 Nginx"
        description="上传包中的 .key 是服务器私钥，不要分发给客户端。根 CA 私钥只保存在数据库中，绝不会被上传或下载。"
      />

      {missingPrereq ? (
        <Card className="surface-card">
          <div className="empty-panel">
            <h4>还不能部署到服务器目录</h4>
            <p>
              {certs.length === 0
                ? '请先签发一张服务器证书，再登记服务器和部署目录。'
                : '请先登记服务器，并为其添加部署目录，例如 /etc/nginx/ssl。'}
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
              extra={<FieldHint>选择一张已签发的服务器证书。会同时放入它的证书文件和私钥。若所属根已停用，该证书会显示为需重签，仅建议在迁移期间临时使用。</FieldHint>}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={certsQuery.isLoading}
                options={certs.map((item) => ({
                  value: item.id,
                  label: `${item.publicFileName}（${item.ips.join(', ')}）`,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="目标服务器"
              name="serverId"
              rules={[{ required: true, message: '请选择服务器' }]}
              extra={<FieldHint example="web-01">这里选择的是登记时的管理名称，用作文件服务器中的目录前缀。</FieldHint>}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={serversQuery.isLoading}
                options={servers.map((item) => ({
                  value: item.id,
                  label: item.host ? `${item.name}（${item.host}）` : item.name,
                }))}
                onChange={() => form.setFieldValue('pathId', undefined)}
              />
            </Form.Item>
            <Form.Item
              label="目标目录"
              name="pathId"
              rules={[{ required: true, message: '请选择部署目录' }]}
              extra={
                <FieldHint example="/etc/nginx/ssl">
                  对应这台机器上的 cert 目录或你登记的部署路径。文件会存到 deploy/服务器名/该目录 前缀下，需再拷到机器上的真实路径。
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
              extra="若该目录前缀下已有同名文件，需要打开此项才会替换。"
            >
              <Switch />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={deploy.isPending}>
              部署到服务器 cert 目录
            </Button>
          </Form>
        </Card>
      )}

      {lastResult ? (
        <>
          <Card className="surface-card" title="最近一次部署结果（服务器部署目录）">
            <Alert
              type="success"
              showIcon
              title={`已写入前缀 ${lastResult.objectPrefix}`}
              description={lastResult.warning}
            />
            <Table
              style={{ marginTop: 16 }}
              rowKey="objectKey"
              pagination={false}
              dataSource={lastResult.files}
              columns={[
                { title: '文件名', dataIndex: 'fileName' },
                { title: '对象键', dataIndex: 'objectKey' },
                { title: '大小', dataIndex: 'size', render: (size: number) => `${size} B` },
              ]}
            />
          </Card>
          <NextStepCard after="deploy" />
        </>
      ) : null}

      <Card
        className="surface-card"
        title="该服务器部署目录中的文件"
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
              description={getApiErrorMessage(filesQuery.error, '请确认 RustFS 已启动。')}
            />
          ) : (
            <>
              {filesQuery.data?.prefix ? (
                <Typography.Paragraph type="secondary">前缀：{filesQuery.data.prefix}</Typography.Paragraph>
              ) : null}
              <Table
                rowKey="key"
                loading={filesQuery.isLoading}
                columns={fileColumns}
                dataSource={filesQuery.data?.files ?? []}
                pagination={false}
              />
            </>
          )
        ) : (
          <Typography.Text type="secondary">选择服务器和目录后，将显示 deploy/ 前缀下已部署的文件。证书库中的档案不会出现在这里。</Typography.Text>
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
