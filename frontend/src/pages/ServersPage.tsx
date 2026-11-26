import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Table,
  Tag,
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
  testServerConnection,
  updateServer,
  updateServerPath,
} from '../api/ssl';
import type { ServerPath, ServerRecord, ServerWritePayload, SshAuthMethod } from '../api/types';
import { FieldHint } from '../components/FieldHint';
import { NextStepCard } from '../components/NextStepCard';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';

interface ServerForm {
  name: string;
  host?: string;
  description?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthMethod?: SshAuthMethod;
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  sshTimeoutMs?: number;
  clearSshCredentials?: boolean;
  resetSshHostKey?: boolean;
  testRemotePath?: string;
}

interface PathForm {
  path: string;
  label?: string;
}

function buildServerPayload(values: ServerForm): ServerWritePayload & { name: string } {
  const payload: ServerWritePayload & { name: string } = {
    name: values.name,
    host: values.host,
    description: values.description,
    sshPort: values.sshPort,
    sshUsername: values.sshUsername,
    sshAuthMethod: values.sshAuthMethod,
    sshTimeoutMs: values.sshTimeoutMs,
  };
  if (values.sshPassword?.trim()) {
    payload.sshPassword = values.sshPassword;
  }
  if (values.sshPrivateKey?.trim()) {
    payload.sshPrivateKey = values.sshPrivateKey;
  }
  if (values.sshPassphrase?.trim()) {
    payload.sshPassphrase = values.sshPassphrase;
  }
  if (values.clearSshCredentials) {
    payload.clearSshCredentials = true;
  }
  if (values.resetSshHostKey) {
    payload.resetSshHostKey = true;
  }
  return payload;
}

export function ServersPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [serverForm] = Form.useForm<ServerForm>();
  const [pathForm] = Form.useForm<PathForm>();
  const [editing, setEditing] = useState<ServerRecord | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [pathTarget, setPathTarget] = useState<{ server: ServerRecord; path?: ServerPath } | null>(
    null,
  );
  const authMethod = Form.useWatch('sshAuthMethod', serverForm) ?? 'password';

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
      const payload = buildServerPayload(values);
      if (editing) {
        const { name, ...rest } = payload;
        return updateServer(editing.id, { name, ...rest });
      }
      return createServer(payload);
    },
    onSuccess: async () => {
      message.success(editing ? '服务器已更新' : '服务器已登记');
      closeServerModal();
      await invalidate();
    },
    onError: (error) => message.error(getApiErrorMessage(error, '保存失败')),
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const values = await serverForm.validateFields(['name', 'host', 'sshUsername', 'sshAuthMethod']);
      const all = serverForm.getFieldsValue();
      const payload = {
        ...buildServerPayload({ ...values, ...all }),
        remotePath: all.testRemotePath?.trim() || undefined,
      };
      return testServerConnection(payload, editing?.id);
    },
    onSuccess: (result) => {
      message.success(result.message);
    },
    onError: (error) => {
      const text = getApiErrorMessage(error, '测试连接失败');
      if (text.includes('主机密钥与已锁定的指纹不一致')) {
        modal.confirm({
          title: '主机密钥已变化，要重新信任吗？',
          content: `${text} 请确认这确实是你要登录的那台机器后再继续。重新信任会锁定新的主机密钥。`,
          okText: '重新信任并再测一次',
          cancelText: '取消',
          onOk: async () => {
            const values = serverForm.getFieldsValue();
            const payload = {
              ...buildServerPayload(values),
              remotePath: values.testRemotePath?.trim() || undefined,
              trustHostKey: true,
            };
            const result = await testServerConnection(payload, editing?.id);
            message.success(result.message);
            await invalidate();
          },
        });
        return;
      }
      message.error(text);
    },
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
    serverForm.setFieldsValue({
      sshPort: 22,
      sshAuthMethod: 'password',
      sshTimeoutMs: 15000,
    });
    setServerOpen(true);
  };

  const openEdit = (row: ServerRecord) => {
    setEditing(row);
    serverForm.resetFields();
    serverForm.setFieldsValue({
      name: row.name,
      host: row.host ?? undefined,
      description: row.description ?? undefined,
      sshPort: row.sshPort ?? 22,
      sshUsername: row.sshUsername ?? undefined,
      sshAuthMethod: row.sshAuthMethod ?? 'password',
      sshTimeoutMs: row.sshTimeoutMs ?? 15000,
      testRemotePath: row.paths[0]?.path,
      clearSshCredentials: false,
      resetSshHostKey: false,
    });
    setServerOpen(true);
  };

  const columns: ColumnsType<ServerRecord> = [
    {
      title: '管理名称',
      dataIndex: 'name',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    { title: '主机地址', dataIndex: 'host', render: (value?: string | null) => value || '—' },
    {
      title: 'SSH',
      key: 'ssh',
      render: (_, row) =>
        row.sshReady ? (
          <Space orientation="vertical" size={0}>
            <Tag color="success">已配置</Tag>
            <Typography.Text type="secondary">
              {row.sshUsername}@{row.host}:{row.sshPort}
            </Typography.Text>
          </Space>
        ) : (
          <Tag color="warning" title={row.sshReadyReason ?? undefined}>
            未就绪
          </Tag>
        ),
    },
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
        description="登记机器的管理名称、SSH 登录方式和证书要写入的远程目录。上传部署时，平台会通过 SFTP 把证书写到该目录，并在文件服务器中保留一份管理副本。"
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
            <p>
              先给机器起一个管理名称，填写可以 SSH 登录的主机地址、账号和凭据，并添加证书要放到的远程目录，例如
              /etc/nginx/ssl。
            </p>
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

      {servers.some((item) => !item.sshReady) ? (
        <Alert
          type="warning"
          showIcon
          title="有服务器尚未配置远程登录"
          description={servers
            .filter((item) => !item.sshReady)
            .map((item) => `${item.name}：${item.sshReadyReason ?? '缺少 SSH 配置'}`)
            .join(' ')}
        />
      ) : null}

      {servers.some((item) => item.paths.length > 0) ? <NextStepCard after="servers" /> : null}

      <Modal
        title={editing ? `编辑服务器：${editing.name}` : '登记服务器'}
        open={serverOpen}
        onCancel={closeServerModal}
        confirmLoading={saveServer.isPending}
        destroyOnHidden
        width={680}
        footer={
          <Space>
            <Button onClick={() => testConnection.mutate()} loading={testConnection.isPending}>
              测试连接
            </Button>
            <Button onClick={closeServerModal}>取消</Button>
            <Button type="primary" loading={saveServer.isPending} onClick={() => serverForm.submit()}>
              {editing ? '保存' : '登记'}
            </Button>
          </Space>
        }
      >
        <Form<ServerForm>
          form={serverForm}
          layout="vertical"
          onFinish={(values) => saveServer.mutate(values)}
        >
          <Form.Item
            label="管理名称"
            name="name"
            rules={[{ required: true, message: '请填写管理名称' }]}
            extra={
              <FieldHint example="web-01">
                这台机器在本系统里叫什么。用于列表识别，以及文件服务器管理副本的目录前缀。不是 Nginx 的 hostname，也不会写进证书。
              </FieldHint>
            }
          >
            <Input placeholder="例：web-01" />
          </Form.Item>
          <Form.Item
            label="主机地址"
            name="host"
            extra={
              <FieldHint example="192.168.99.242">
                SSH 登录使用的主机名或 IP。远程部署必须填写。更改主机或端口后，已锁定的主机密钥会被清除，需重新测试连接。
              </FieldHint>
            }
          >
            <Input placeholder="例：192.168.99.242" />
          </Form.Item>
          <Form.Item label="说明（可选）" name="description">
            <Input.TextArea rows={2} placeholder="可选，仅供备注" />
          </Form.Item>

          <Typography.Title level={5}>SSH 远程登录</Typography.Title>
          <Space orientation="vertical" size={0} style={{ width: '100%' }}>
            <Form.Item label="端口" name="sshPort">
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="用户名"
              name="sshUsername"
              extra={<FieldHint example="root">用于 SSH/SFTP 登录的系统账号，需要有证书目录的写权限。</FieldHint>}
            >
              <Input placeholder="例：root" autoComplete="off" />
            </Form.Item>
            <Form.Item label="认证方式" name="sshAuthMethod">
              <Radio.Group
                options={[
                  { value: 'password', label: '密码' },
                  { value: 'privateKey', label: '私钥' },
                ]}
              />
            </Form.Item>
            {authMethod === 'password' ? (
              <Form.Item
                label="密码"
                name="sshPassword"
                extra={
                  editing?.hasPassword
                    ? '已保存密码。留空表示保持不变，不会回显已保存的密码。'
                    : '密码将加密后存入数据库，不会出现在接口返回或页面回显中。'
                }
              >
                <Input.Password placeholder={editing?.hasPassword ? '已保存，留空则保持不变' : 'SSH 密码'} autoComplete="new-password" />
              </Form.Item>
            ) : (
              <>
                <Form.Item
                  label="私钥"
                  name="sshPrivateKey"
                  extra={
                    editing?.hasPrivateKey
                      ? '已保存私钥。留空表示保持不变，不会回显已保存的私钥内容。'
                      : '粘贴 OpenSSH 或 PEM 格式私钥。私钥将加密后存入数据库，不会回显。'
                  }
                >
                  <Input.TextArea
                    rows={5}
                    placeholder={
                      editing?.hasPrivateKey
                        ? '已保存，留空则保持不变'
                        : '-----BEGIN OPENSSH PRIVATE KEY-----'
                    }
                    autoComplete="off"
                  />
                </Form.Item>
                <Form.Item
                  label="私钥口令（可选）"
                  name="sshPassphrase"
                  extra={
                    editing?.hasPassphrase
                      ? '已保存口令。留空表示保持不变。'
                      : '若私钥本身有口令，请填写。不是 SSH 登录密码。'
                  }
                >
                  <Input.Password
                    placeholder={editing?.hasPassphrase ? '已保存，留空则保持不变' : '可选'}
                    autoComplete="new-password"
                  />
                </Form.Item>
              </>
            )}
            <Form.Item
              label="连接超时（毫秒）"
              name="sshTimeoutMs"
              extra="默认 15000。超时后测试连接和上传部署会失败并给出说明。"
            >
              <InputNumber min={1000} max={120000} step={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="测试时检查的目录（可选）"
              name="testRemotePath"
              extra="只检查该目录是否存在、能否列出，不会创建目录，也不会上传证书。"
            >
              <Input placeholder="例：/etc/nginx/ssl" />
            </Form.Item>
            {editing ? (
              <Form.Item name="clearSshCredentials" valuePropName="checked">
                <Checkbox>清除已保存的 SSH 凭据</Checkbox>
              </Form.Item>
            ) : null}
            {editing?.sshHostKeyPinned ? (
              <>
                <Alert
                  type="info"
                  showIcon
                  title={`已锁定主机密钥 ${editing.sshHostKeyFingerprint}`}
                  description="首次成功的测试连接或上传部署会记录并锁定该主机的 SSH 主机密钥。之后若密钥变化将拒绝连接，除非你确认后重新信任。"
                />
                <Form.Item name="resetSshHostKey" valuePropName="checked">
                  <Checkbox>重新信任主机密钥（清除已锁定的指纹，下次连接再锁定）</Checkbox>
                </Form.Item>
              </>
            ) : (
              <Alert
                type="info"
                showIcon
                title="首次成功连接将锁定主机密钥"
                description="测试连接或上传部署第一次成功时，会记录该机器的 SSH 主机密钥指纹，之后只接受同一指纹，以避免连到被替换的主机。测试连接不会上传任何证书。"
              />
            )}
          </Space>
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
                证书将通过 SFTP 写入这台机器上的这个绝对路径，例如 /etc/nginx/ssl 或 C:/nginx/ssl。请先在服务器上创建该目录。平台不会自动创建，也不会写入 rootCA.key。
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
