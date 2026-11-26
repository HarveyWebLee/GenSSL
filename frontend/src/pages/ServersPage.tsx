import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { getApiErrorMessage } from '../api/http';
import {
  addServerPath,
  createServer,
  deleteServer,
  deleteServerPath,
  listServers,
  updateServer,
  updateServerPath,
} from '../api/ssl';
import type { ServerPath, ServerRecord } from '../api/types';
import { FieldHint } from '../components/FieldHint';
import { NextStepCard } from '../components/NextStepCard';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';

interface ServerForm {
  name: string;
  host?: string;
  description?: string;
}

interface PathForm {
  path: string;
  label?: string;
}

export function ServersPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [serverForm] = Form.useForm<ServerForm>();
  const [pathForm] = Form.useForm<PathForm>();
  const [editing, setEditing] = useState<ServerRecord | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [pathTarget, setPathTarget] = useState<{ server: ServerRecord; path?: ServerPath } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['servers'],
    queryFn: listServers,
  });

  const servers = query.data?.items ?? [];

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['servers'] });
    await queryClient.invalidateQueries({ queryKey: ['overview'] });
  };

  const closeServerModal = () => {
    setServerOpen(false);
    setEditing(null);
    serverForm.resetFields();
  };

  const saveServer = useMutation({
    mutationFn: async (values: ServerForm) => {
      if (editing) {
        return updateServer(editing.id, values);
      }
      return createServer(values);
    },
    onSuccess: async () => {
      message.success(editing ? '服务器已更新' : '服务器已登记');
      closeServerModal();
      await invalidate();
    },
    onError: (error) => message.error(getApiErrorMessage(error, '保存失败')),
  });

  const removeServer = useMutation({
    mutationFn: deleteServer,
    onSuccess: async () => {
      message.success('服务器已删除');
      await invalidate();
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除失败')),
  });

  const savePath = useMutation({
    mutationFn: async (values: PathForm) => {
      if (!pathTarget) {
        throw new Error('未选择服务器');
      }
      if (pathTarget.path) {
        return updateServerPath(pathTarget.server.id, pathTarget.path.id, values);
      }
      return addServerPath(pathTarget.server.id, values);
    },
    onSuccess: async () => {
      message.success('部署目录已保存');
      setPathTarget(null);
      pathForm.resetFields();
      await invalidate();
    },
    onError: (error) => message.error(getApiErrorMessage(error, '保存目录失败')),
  });

  const removePath = useMutation({
    mutationFn: ({ serverId, pathId }: { serverId: string; pathId: string }) =>
      deleteServerPath(serverId, pathId),
    onSuccess: async () => {
      message.success('部署目录已删除');
      await invalidate();
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除目录失败')),
  });

  const openCreate = () => {
    setEditing(null);
    serverForm.resetFields();
    setServerOpen(true);
  };

  const openEdit = (row: ServerRecord) => {
    setEditing(row);
    serverForm.setFieldsValue({
      name: row.name,
      host: row.host ?? undefined,
      description: row.description ?? undefined,
    });
    setServerOpen(true);
  };

  const columns: ColumnsType<ServerRecord> = [
    {
      title: '管理名称',
      dataIndex: 'name',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    { title: '实际地址', dataIndex: 'host', render: (value?: string | null) => value || '—' },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (value?: string | null) => value || '—',
    },
    {
      title: '部署目录',
      key: 'paths',
      render: (_, row) => (
        <Space orientation="vertical" size={4}>
          {(row.paths ?? []).map((item) => (
            <Space key={item.id} wrap>
              <Typography.Text code>{item.path}</Typography.Text>
              {item.label ? <Typography.Text type="secondary">{item.label}</Typography.Text> : null}
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setPathTarget({ server: row, path: item });
                  pathForm.setFieldsValue({ path: item.path, label: item.label ?? undefined });
                }}
              >
                编辑
              </Button>
              <Popconfirm
                title="删除该部署目录？"
                onConfirm={() => removePath.mutate({ serverId: row.id, pathId: item.id })}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ))}
          <Button
            type="link"
            size="small"
            onClick={() => {
              setPathTarget({ server: row });
              pathForm.resetFields();
            }}
          >
            添加目录
          </Button>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="删除该服务器及其目录？" onConfirm={() => removeServer.mutate(row.id)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="服务器与路径"
        description="在这里登记的是管理用的机器名称和证书准备放置的目录。名称用于列表识别，以及上传到文件服务器时的目录前缀，并不是 Nginx 自己的主机名。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            登记服务器
          </Button>
        }
      />
      <WorkflowBar current="servers" />

      <Card className="surface-card" title="已登记的服务器">
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            title="无法获取服务器列表"
            description={getApiErrorMessage(query.error, '请确认后端与数据库已启动。')}
          />
        ) : !query.isLoading && servers.length === 0 ? (
          <div className="empty-panel">
            <h4>还没有登记服务器</h4>
            <p>先给机器起一个管理名称，并添加证书要放到的目录，例如 /etc/nginx/ssl。上传部署时会按「管理名称 / 目录」存放文件。</p>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              登记服务器
            </Button>
          </div>
        ) : (
          <Table
            rowKey="id"
            loading={query.isLoading}
            columns={columns}
            dataSource={servers}
            pagination={false}
          />
        )}
      </Card>

      {servers.some((item) => item.paths.length > 0) ? <NextStepCard after="servers" /> : null}

      <Modal
        title={editing ? `编辑服务器：${editing.name}` : '登记服务器'}
        open={serverOpen}
        onCancel={closeServerModal}
        onOk={() => serverForm.submit()}
        confirmLoading={saveServer.isPending}
        destroyOnHidden
        okText={editing ? '保存' : '登记'}
      >
        <Form<ServerForm> form={serverForm} layout="vertical" onFinish={(values) => saveServer.mutate(values)}>
          <Form.Item
            label="管理名称"
            name="name"
            rules={[{ required: true, message: '请填写管理名称' }]}
            extra={
              <FieldHint example="web-01">
                这台机器在本系统里叫什么。用于列表识别，以及上传到文件服务器时的目录前缀。不是 Nginx 的 hostname，也不会写进证书。
              </FieldHint>
            }
          >
            <Input placeholder="例：web-01" />
          </Form.Item>
          <Form.Item
            label="实际地址（可选）"
            name="host"
            extra={
              <FieldHint example="192.168.99.242">
                方便辨认这台机器，不会写入证书，也不影响 Nginx 配置。
              </FieldHint>
            }
          >
            <Input placeholder="例：192.168.99.242" />
          </Form.Item>
          <Form.Item label="说明（可选）" name="description">
            <Input.TextArea rows={2} placeholder="可选，仅供备注" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          pathTarget?.path
            ? `编辑目录（${pathTarget.server.name}）`
            : pathTarget
              ? `为 ${pathTarget.server.name} 添加部署目录`
              : '部署目录'
        }
        open={Boolean(pathTarget)}
        onCancel={() => setPathTarget(null)}
        onOk={() => pathForm.submit()}
        confirmLoading={savePath.isPending}
        destroyOnHidden
      >
        <Form<PathForm> form={pathForm} layout="vertical" onFinish={(values) => savePath.mutate(values)}>
          <Form.Item
            label="部署目录"
            name="path"
            rules={[{ required: true, message: '请填写部署目录' }]}
            extra={
              <FieldHint example="/etc/nginx/ssl">
                证书准备放到这台机器上的哪个文件夹。上传时会按「管理名称 / 这个目录」存到文件服务器，不会通过 SSH
                直接写入远程磁盘。
              </FieldHint>
            }
          >
            <Input placeholder="例：/etc/nginx/ssl" />
          </Form.Item>
          <Form.Item
            label="备注（可选）"
            name="label"
            extra={<FieldHint example="Nginx 证书目录">仅方便你辨认这条路径，可不填。</FieldHint>}
          >
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
