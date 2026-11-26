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
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { createNginxService, deleteNginxService, listNginxServices, listServers } from '../api/ssl';
import type { NginxServiceSummary, ServerRecord } from '../api/types';
import { FieldHint } from '../components/FieldHint';
import { NginxExampleCard } from '../components/NginxExampleCard';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';
import { readConfFile, validateNginxConfigPath, validateRestartCommand } from '../utils/nginx-path';

interface ServiceFormValues {
  serverId: string;
  name: string;
  port: number;
  configPath: string;
  configText: string;
  restartCommand: string;
}

function serverLabel(server: ServerRecord): string {
  return server.host ? `${server.name}（${server.host}:${server.sshPort}）` : server.name;
}

export function NginxPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [serverFilter, setServerFilter] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<ServiceFormValues>();
  const port = Form.useWatch('port', form);
  const serverId = Form.useWatch('serverId', form);

  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const servicesQuery = useQuery({
    queryKey: ['nginx-services', serverFilter],
    queryFn: () => listNginxServices(serverFilter),
  });
  const servers = serversQuery.data?.items ?? [];
  const items = servicesQuery.data?.items ?? [];
  const selectedServer = servers.find((item) => item.id === serverId);

  const createMutation = useMutation({
    mutationFn: createNginxService,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['nginx-services'] });
      message.success(
        created.archive.uploaded
          ? '服务已创建，配置已写入文件服务器管理副本。向服务器发布前请再确认路径和重启命令。'
          : created.warning || '服务已创建。管理副本未能写入文件服务器，但不影响之后向服务器发布。',
      );
      if (created.warning && created.archive.uploaded === false) {
        message.warning(created.warning);
      }
      setCreating(false);
      form.resetFields();
      navigate(`/nginx/${created.id}`);
    },
    onError: (error) => message.error(getApiErrorMessage(error, '创建服务失败')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNginxService,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nginx-services'] });
      message.success('服务已从列表中移除。这是假删除，历史发布记录仍保留在数据库中。');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除服务失败')),
  });

  const confirmDelete = (row: NginxServiceSummary) => {
    modal.confirm({
      title: `删除服务「${row.name}」？`,
      content: `页面上将不再显示该服务及其版本时间线。这是假删除，不会删除服务器上的 ${row.configPath}，也不会销毁文件服务器中的管理副本。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(row.id),
    });
  };

  const insertExample = (config: string) => {
    form.setFieldValue('configText', config);
    message.success('已将示例插入配置编辑器，可按实际路径再修改。');
  };

  const uploadProps = useMemo(
    () => ({
      accept: '.conf',
      showUploadList: false,
      beforeUpload: async (file: File) => {
        try {
          const text = await readConfFile(file);
          form.setFieldValue('configText', text);
          message.success(`已载入 ${file.name}，请检查后保存。`);
        } catch (error) {
          message.error(error instanceof Error ? error.message : '读取配置文件失败');
        }
        return false;
      },
    }),
    [form, message],
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="Nginx 配置"
        description="针对已登记的服务器管理各端口服务的 Nginx 配置：在线编辑或上传 .conf，保存后写入文件服务器管理副本，发布时再覆盖到服务器上的真实路径并执行该服务配置的重启命令。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} disabled={servers.length === 0} onClick={() => setCreating(true)}>
            新建服务
          </Button>
        }
      />
      <WorkflowBar current="install" />

      {servers.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="还没有已登记的服务器"
          description="请先在「服务器与路径」中登记服务器并配置 SSH，再为该服务器添加端口服务。"
          action={
            <Button type="primary" onClick={() => navigate('/servers')}>
              去登记服务器
            </Button>
          }
        />
      ) : null}

      <Card
        className="surface-card"
        title="服务列表"
        extra={
          <Space wrap>
            <span className="muted">按服务器筛选</span>
            <Select
              allowClear
              placeholder="全部服务器"
              style={{ minWidth: 240 }}
              value={serverFilter}
              onChange={(value) => setServerFilter(value)}
              options={servers.map((item) => ({ value: item.id, label: serverLabel(item) }))}
            />
          </Space>
        }
      >
        {servicesQuery.isLoading ? (
          <Spin description="正在读取服务列表…">
            <div style={{ minHeight: 120 }} />
          </Spin>
        ) : servicesQuery.isError ? (
          <Alert
            type="error"
            showIcon
            title="无法读取服务列表"
            description={getApiErrorMessage(servicesQuery.error, '请稍后重试。')}
          />
        ) : (
          <Table
            rowKey="id"
            dataSource={items}
            pagination={false}
            locale={{
              emptyText: serverFilter
                ? '这台服务器下还没有 Nginx 服务。可以点击「新建服务」为它添加端口配置。'
                : '还没有 Nginx 服务。请选择一台已登记的服务器，为其添加端口和配置文件。',
            }}
            columns={[
              {
                title: '服务器',
                render: (_, row) => (
                  <div>
                    <div>{row.server.name}</div>
                    <Typography.Text type="secondary">
                      {row.server.host ? `${row.server.host}:${row.server.sshPort}` : '未填写主机'}
                    </Typography.Text>
                  </div>
                ),
              },
              { title: '名称', dataIndex: 'name' },
              { title: '端口', dataIndex: 'port', width: 88 },
              {
                title: '配置路径',
                dataIndex: 'configPath',
                render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
              },
              {
                title: '当前版本',
                render: (_, row) =>
                  row.currentRelease ? (
                    <Space size={6} wrap>
                      <Tag color={row.currentRelease.status === 'success' ? 'success' : row.currentRelease.status === 'partial' ? 'warning' : 'error'}>
                        {row.currentRelease.version}
                      </Tag>
                      <Typography.Text type="secondary">{row.currentRelease.statusLabel}</Typography.Text>
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">尚未发布</Typography.Text>
                  ),
              },
              {
                title: '最近发布',
                render: (_, row) =>
                  row.currentRelease
                    ? dayjs(row.currentRelease.publishedAt).format('YYYY-MM-DD HH:mm')
                    : '—',
              },
              {
                title: '操作',
                width: 220,
                render: (_, row) => (
                  <Space wrap>
                    <Button type="link" size="small" onClick={() => navigate(`/nginx/${row.id}`)}>
                      详情
                    </Button>
                    <Button type="link" size="small" onClick={() => navigate(`/nginx/${row.id}?publish=1`)}>
                      发布
                    </Button>
                    <Button type="link" size="small" danger onClick={() => confirmDelete(row)}>
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
            onRow={(row) => ({
              onClick: (event) => {
                const target = event.target as HTMLElement;
                if (target.closest('button, a')) {
                  return;
                }
                navigate(`/nginx/${row.id}`);
              },
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </Card>

      {creating ? (
        <Card className="surface-card" title="新建 Nginx 服务">
          <Form
            form={form}
            layout="vertical"
            initialValues={{ port: 443, restartCommand: 'docker restart nginx' }}
            onFinish={(values) =>
              createMutation.mutate({
                serverId: values.serverId,
                name: values.name.trim(),
                port: values.port,
                configPath: values.configPath.trim(),
                configText: values.configText,
                restartCommand: values.restartCommand.trim(),
              })
            }
          >
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  label="所属服务器"
                  name="serverId"
                  rules={[{ required: true, message: '请选择已登记的服务器。' }]}
                  extra={<FieldHint>只显示已经登记的服务器。发布和重启都会通过这台机器上的 SSH 执行。</FieldHint>}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={servers.map((item) => ({
                      value: item.id,
                      label: item.sshReady ? serverLabel(item) : `${serverLabel(item)}（未配置远程登录）`,
                    }))}
                    placeholder="选择服务器"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="服务名称"
                  name="name"
                  rules={[{ required: true, message: '请填写服务名称。' }]}
                  extra={<FieldHint example="avatar">同一服务器下名称必须唯一，便于在列表中识别。</FieldHint>}
                >
                  <Input placeholder="avatar" maxLength={128} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  label="端口"
                  name="port"
                  rules={[{ required: true, message: '请填写 1 到 65535 之间的端口。' }]}
                  extra={<FieldHint example="8080">同一服务器下端口必须唯一。</FieldHint>}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item
                  label="Nginx 配置文件路径"
                  name="configPath"
                  rules={[
                    {
                      validator: async (_, value) => {
                        const error = validateNginxConfigPath(String(value ?? ''));
                        if (error) throw new Error(error);
                      },
                    },
                  ]}
                  extra={
                    <FieldHint example="/data/smartsecurity/nginx/vhost/avatar.conf">
                      必须是服务器上的绝对路径，并以 .conf 结尾。同一服务器下路径必须唯一。平台不会自动创建目录。
                    </FieldHint>
                  }
                >
                  <Input placeholder="/data/smartsecurity/nginx/vhost/avatar.conf" />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item
                  label="重启服务命令"
                  name="restartCommand"
                  rules={[
                    {
                      validator: async (_, value) => {
                        const error = validateRestartCommand(String(value ?? ''));
                        if (error) throw new Error(error);
                      },
                    },
                  ]}
                  extra={
                    <FieldHint example="docker restart nginx">
                      保存在服务配置中，发布、手动重启和重新发布都会使用这条命令。命令将在目标服务器上通过 SSH 执行，不会在本平台本机执行。
                    </FieldHint>
                  }
                >
                  <Input placeholder="docker restart nginx" maxLength={500} />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item
                  label="配置文件内容"
                  name="configText"
                  rules={[{ required: true, message: '请填写或上传 Nginx 配置文件内容。' }]}
                  extra={<FieldHint>可直接编辑，也可上传 .conf 文件，或用下方示例生成后插入。</FieldHint>}
                >
                  <Input.TextArea className="nginx-editor" autoSize={{ minRows: 14, maxRows: 28 }} spellCheck={false} />
                </Form.Item>
                <Space wrap style={{ marginTop: -8, marginBottom: 16 }}>
                  <Upload {...uploadProps}>
                    <Button icon={<UploadOutlined />}>上传 .conf 文件</Button>
                  </Upload>
                </Space>
              </Col>
            </Row>
            <NginxExampleCard
              compact
              defaultPort={port}
              defaultServerName={selectedServer?.host || selectedServer?.name}
              onInsert={insertExample}
            />
            <Space wrap style={{ marginTop: 16 }}>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
                创建服务
              </Button>
              <Button
                onClick={() => {
                  setCreating(false);
                  form.resetFields();
                }}
              >
                取消
              </Button>
            </Space>
          </Form>
        </Card>
      ) : null}
    </div>
  );
}
