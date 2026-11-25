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
  const [pathTarget, setPathTarget] = useState<{ server: ServerRecord; path?: ServerPath } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['servers'],
    queryFn: listServers,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['servers'] });
    await queryClient.invalidateQueries({ queryKey: ['overview'] });
  };

  const saveServer = useMutation({
    mutationFn: async (values: ServerForm) => {
      if (editing) {
        return updateServer(editing.id, values);
      }
      return createServer(values);
    },
    onSuccess: async () => {
      message.success(editing ? '服务器已更新' : '服务器已创建');
      setEditing(null);
      serverForm.resetFields();
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
      message.success('部署路径已保存');
      setPathTarget(null);
      pathForm.resetFields();
      await invalidate();
    },
    onError: (error) => message.error(getApiErrorMessage(error, '保存路径失败')),
  });

  const removePath = useMutation({
    mutationFn: ({ serverId, pathId }: { serverId: string; pathId: string }) =>
      deleteServerPath(serverId, pathId),
    onSuccess: async () => {
      message.success('部署路径已删除');
      await invalidate();
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除路径失败')),
  });

  const columns: ColumnsType<ServerRecord> = [
    { title: '名称', dataIndex: 'name' },
    { title: '主机 / IP', dataIndex: 'host', render: (value?: string | null) => value || '—' },
    { title: '说明', dataIndex: 'description', ellipsis: true, render: (value?: string | null) => value || '—' },
    {
      title: '部署路径',
      key: 'paths',
      render: (_, row) => (
        <Space direction="vertical" size={4}>
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
                title="删除该部署路径？"
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
            添加路径
          </Button>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, row) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(row);
              serverForm.setFieldsValue({
                name: row.name,
                host: row.host ?? undefined,
                description: row.description ?? undefined,
              });
            }}
          >
            编辑
          </Button>
          <Popconfirm title="删除该服务器及其路径？" onConfirm={() => removeServer.mutate(row.id)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        服务器与路径
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        登记目标服务器及其证书部署路径文件夹，例如某台机、路径 /etc/nginx/ssl。上传时会按「服务器名 / 路径」写入 RustFS 前缀。
      </Typography.Paragraph>

      <Card title={editing ? `编辑服务器：${editing.name}` : '新增服务器'}>
        <Form<ServerForm>
          form={serverForm}
          layout="vertical"
          onFinish={(values) => saveServer.mutate(values)}
        >
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请填写服务器名称' }]}>
            <Input placeholder="web-01" />
          </Form.Item>
          <Form.Item label="主机 / IP" name="host">
            <Input placeholder="192.168.99.242" />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saveServer.isPending}>
              {editing ? '保存' : '创建'}
            </Button>
            {editing ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  serverForm.resetFields();
                }}
              >
                取消编辑
              </Button>
            ) : null}
          </Space>
        </Form>
      </Card>

      <Card title="已登记服务器">
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法获取服务器列表"
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

      <Modal
        title={
          pathTarget?.path
            ? `编辑路径（${pathTarget.server.name}）`
            : pathTarget
              ? `为 ${pathTarget.server.name} 添加部署路径`
              : '部署路径'
        }
        open={Boolean(pathTarget)}
        onCancel={() => setPathTarget(null)}
        onOk={() => pathForm.submit()}
        confirmLoading={savePath.isPending}
        destroyOnHidden
      >
        <Form<PathForm> form={pathForm} layout="vertical" onFinish={(values) => savePath.mutate(values)}>
          <Form.Item
            label="路径文件夹"
            name="path"
            rules={[{ required: true, message: '请填写部署路径' }]}
            extra="例如 /etc/nginx/ssl 或 E:/nginx/ssl。上传时会映射为对象存储前缀，而不是直接 SSH 写入远程磁盘。"
          >
            <Input placeholder="/etc/nginx/ssl" />
          </Form.Item>
          <Form.Item label="备注" name="label">
            <Input placeholder="Nginx 证书目录" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
