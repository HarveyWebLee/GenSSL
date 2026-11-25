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
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
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

interface DeployForm {
  certificateId: string;
  serverId: string;
  pathId: string;
  includeRootCaCert: boolean;
  overwrite: boolean;
}

export function DeployPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<DeployForm>();
  const serverId = Form.useWatch('serverId', form);
  const pathId = Form.useWatch('pathId', form);
  const [lastResult, setLastResult] = useState<DeployRecord | null>(null);

  const certsQuery = useQuery({ queryKey: ['certs'], queryFn: listCerts });
  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const deploysQuery = useQuery({ queryKey: ['deploys'], queryFn: listDeploys });

  const selectedServer = useMemo(
    () => serversQuery.data?.items.find((item) => item.id === serverId),
    [serversQuery.data, serverId],
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
      message.success('已上传到文件服务器');
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
          '将覆盖 RustFS 中该服务器/路径前缀下的同名文件。上传包包含服务器证书和服务器私钥；可选包含根 CA 公钥。绝不会上传 rootCA.key。',
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
      title: '路径',
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        上传部署
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        将已签发证书上传到 RustFS 中对应的「服务器 / 部署路径」前缀。至少包含服务器证书和服务器私钥；可选上传根
        CA 公钥。禁止上传 rootCA.key。当前不会通过 SSH 直接写入远程机器磁盘。
      </Typography.Paragraph>

      <Alert
        type="warning"
        showIcon
        message="私钥只用于部署到对应 Nginx"
        description="上传包中的 .key 是服务器私钥，不要分发给客户端。根 CA 私钥始终只保存在本机 data 目录。"
      />

      <Card title="执行上传">
        <Form<DeployForm>
          form={form}
          layout="vertical"
          initialValues={{ includeRootCaCert: false, overwrite: false }}
          onFinish={submit}
        >
          <Form.Item label="证书" name="certificateId" rules={[{ required: true, message: '请选择证书' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={certsQuery.isLoading}
              options={(certsQuery.data?.items ?? []).map((item) => ({
                value: item.id,
                label: `${item.name}（${item.ips.join(', ')}）`,
              }))}
            />
          </Form.Item>
          <Form.Item label="目标服务器" name="serverId" rules={[{ required: true, message: '请选择服务器' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={serversQuery.isLoading}
              options={(serversQuery.data?.items ?? []).map((item) => ({
                value: item.id,
                label: item.host ? `${item.name}（${item.host}）` : item.name,
              }))}
              onChange={() => form.setFieldValue('pathId', undefined)}
            />
          </Form.Item>
          <Form.Item label="目标路径" name="pathId" rules={[{ required: true, message: '请选择部署路径' }]}>
            <Select
              options={(selectedServer?.paths ?? []).map((item) => ({
                value: item.id,
                label: item.label ? `${item.path}（${item.label}）` : item.path,
              }))}
              placeholder={serverId ? '请选择路径' : '请先选择服务器'}
            />
          </Form.Item>
          <Form.Item name="includeRootCaCert" valuePropName="checked">
            <Checkbox>同时上传根 CA 公钥（rootCA.crt / 公共文件名），便于客户端安装信任</Checkbox>
          </Form.Item>
          <Form.Item name="overwrite" label="覆盖已有文件" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={deploy.isPending}>
            上传到目标路径
          </Button>
        </Form>
      </Card>

      {lastResult ? (
        <Card title="最近一次上传结果">
          <Alert
            type="success"
            showIcon
            message={`已写入前缀 ${lastResult.objectPrefix}`}
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
      ) : null}

      <Card
        title="目标路径中的文件"
        extra={
          <Button
            size="small"
            disabled={!serverId || !pathId}
            onClick={() => void filesQuery.refetch()}
          >
            刷新
          </Button>
        }
      >
        {serverId && pathId ? (
          filesQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message="无法列出目标文件"
              description={getApiErrorMessage(filesQuery.error, '请确认 RustFS 已启动。')}
            />
          ) : (
            <>
              {filesQuery.data?.prefix ? (
                <Typography.Paragraph type="secondary">
                  前缀：{filesQuery.data.prefix}
                </Typography.Paragraph>
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
          <Typography.Text type="secondary">选择服务器和路径后，将显示该前缀下已上传的文件。</Typography.Text>
        )}
      </Card>

      <Card title="上传记录">
        <Table
          rowKey="id"
          loading={deploysQuery.isLoading}
          columns={historyColumns}
          dataSource={deploysQuery.data?.items ?? []}
          pagination={{ pageSize: 8 }}
        />
      </Card>
    </Space>
  );
}
