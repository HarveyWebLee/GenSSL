import { useMemo } from 'react';
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
  Typography,
  Upload,
} from 'antd';
import { ArrowLeftOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getApiErrorMessage } from '../api/http';
import { createNginxService, getNginxService, listNginxServices, listServers } from '../api/ssl';
import type { ServerRecord } from '../api/types';
import { FieldHint } from '../components/FieldHint';
import { NginxExampleCard } from '../components/NginxExampleCard';
import { PageHeader } from '../components/PageHeader';
import { readConfFile, validateNginxConfigPath, validateRestartCommand } from '../utils/nginx-path';
import {
  SERVICE_NAME_MAX_LENGTH,
  conflictMessage,
  listNginxServiceConflicts,
  suggestCopyName,
} from '../utils/nginx-service-copy';

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

export function NginxServiceNewPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const copyFrom = params.get('copyFrom')?.trim() || undefined;
  const [form] = Form.useForm<ServiceFormValues>();
  const port = Form.useWatch('port', form);
  const serverId = Form.useWatch('serverId', form);
  const name = Form.useWatch('name', form);
  const configPath = Form.useWatch('configPath', form);

  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const servicesQuery = useQuery({
    queryKey: ['nginx-services'],
    queryFn: () => listNginxServices(),
  });
  const sourceQuery = useQuery({
    queryKey: ['nginx-service', copyFrom],
    queryFn: () => getNginxService(copyFrom as string),
    enabled: Boolean(copyFrom),
  });

  const servers = serversQuery.data?.items ?? [];
  const services = servicesQuery.data?.items ?? [];
  const source = sourceQuery.data;
  const selectedServer = servers.find((item) => item.id === serverId);
  const isCopy = Boolean(copyFrom);

  const takenNames = useMemo(
    () =>
      services
        .filter((item) => item.server.id === (source?.server.id ?? serverId))
        .map((item) => item.name),
    [services, source?.server.id, serverId],
  );

  const initialValues = useMemo<Partial<ServiceFormValues>>(() => {
    if (source) {
      return {
        serverId: source.server.id,
        name: suggestCopyName(source.name, takenNames),
        port: source.port,
        configPath: source.configPath,
        configText: source.configText,
        restartCommand: source.restartCommand,
      };
    }
    return { port: 443, restartCommand: 'docker restart nginx' };
  }, [source, takenNames]);

  const conflicts = listNginxServiceConflicts(services, {
    serverId,
    name,
    port,
    configPath,
  });

  const createMutation = useMutation({
    mutationFn: createNginxService,
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['nginx-services'] }),
        queryClient.invalidateQueries({ queryKey: ['nginx-service', created.id] }),
      ]);
      message.success(
        isCopy
          ? `已复制新建服务「${created.name}」。原服务未改动，新服务尚无发布记录。`
          : created.archive.uploaded
            ? '服务已创建，配置已写入文件服务器管理副本。向服务器发布前请再确认路径和重启命令。'
            : created.warning || '服务已创建。管理副本未能写入文件服务器，但不影响之后向服务器发布。',
      );
      if (created.warning && created.archive.uploaded === false) {
        message.warning(created.warning);
      }
      navigate(`/nginx/${created.id}`);
    },
    onError: (error) => message.error(getApiErrorMessage(error, isCopy ? '复制新建失败' : '创建服务失败')),
  });

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

  const confirmLeave = () => {
    if (!form.isFieldsTouched()) {
      navigate('/nginx');
      return;
    }
    modal.confirm({
      title: '离开当前页面？',
      content: isCopy
        ? '尚未保存这条复制新建的服务。离开后已填写的内容不会保存，原服务也不会被改动。'
        : '尚未保存这条新服务。离开后已填写的内容不会保存。',
      okText: '离开',
      cancelText: '继续编辑',
      onOk: () => navigate('/nginx'),
    });
  };

  const submit = (values: ServiceFormValues) => {
    const currentConflicts = listNginxServiceConflicts(services, values);
    if (currentConflicts.length > 0) {
      void form.setFields(
        currentConflicts.map((item) => ({
          name: item.field,
          errors: [item.message],
        })),
      );
      message.error(currentConflicts.map((item) => item.message).join(' '));
      return;
    }
    createMutation.mutate({
      serverId: values.serverId,
      name: values.name.trim(),
      port: values.port,
      configPath: values.configPath.trim(),
      configText: values.configText,
      restartCommand: values.restartCommand.trim(),
    });
  };

  if (copyFrom && (sourceQuery.isPending || servicesQuery.isPending)) {
    return (
      <div className="page-stack">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/nginx')}>
          返回服务列表
        </Button>
        <Card className="surface-card">
          <Spin description="正在读取要复制的服务…">
            <div style={{ minHeight: 160 }} />
          </Spin>
        </Card>
      </div>
    );
  }

  if (copyFrom && (sourceQuery.isError || !source)) {
    return (
      <div className="page-stack">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/nginx')}>
          返回服务列表
        </Button>
        <Alert
          type="error"
          showIcon
          title="无法读取要复制的服务"
          description={getApiErrorMessage(sourceQuery.error, '该服务可能已被删除，或暂时无法访问。请返回列表后重试。')}
          action={
            <Button type="primary" onClick={() => navigate('/nginx')}>
              返回服务列表
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={
          <Space size={12} align="center">
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={confirmLeave}>
              返回
            </Button>
            <span>{isCopy ? '复制新建 Nginx 服务' : '新建 Nginx 服务'}</span>
          </Space>
        }
        description={
          isCopy && source
            ? `正在根据「${source.name}」复制新建一条独立服务，保存后不会覆盖原服务，也不会带入发布记录。`
            : '选择已登记的服务器，填写端口、配置路径和重启命令。保存后会写入文件服务器管理副本，发布时再覆盖到服务器上的真实路径。'
        }
      />

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

      {isCopy && source ? (
        <Alert
          type="info"
          showIcon
          title="这是复制新建，不是在修改原服务"
          description={
            <Space orientation="vertical" size={4}>
              <Typography.Text>
                已带入「{source.name}」的所属服务器、配置文件内容和重启命令。名称已加上「-副本」后缀。端口和配置路径先沿用原值，同一服务器下这两项都会与原服务冲突，请改成未被占用的值；系统不会自动改端口。
              </Typography.Text>
              <Typography.Text type="secondary">
                新服务将从空白的版本时间线开始，不会复制发布记录或当前版本。保存后原服务仍保留在列表中。
              </Typography.Text>
            </Space>
          }
        />
      ) : null}

      {conflicts.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title="当前填写的内容与已有服务冲突"
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {conflicts.map((item) => (
                <li key={item.field}>{item.message}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Card className="surface-card" title={isCopy ? '编辑后保存为新服务' : '填写服务信息'}>
        <Form
          key={copyFrom ? `copy-${source?.id}` : 'new'}
          form={form}
          layout="vertical"
          initialValues={initialValues}
          onFinish={submit}
          disabled={servers.length === 0}
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
                dependencies={['serverId']}
                rules={[
                  { required: true, message: '请填写服务名称。' },
                  {
                    validator: async (_, value) => {
                      const error = conflictMessage(
                        listNginxServiceConflicts(services, {
                          serverId: form.getFieldValue('serverId'),
                          name: value,
                          port: form.getFieldValue('port'),
                          configPath: form.getFieldValue('configPath'),
                        }),
                        'name',
                      );
                      if (error) throw new Error(error);
                    },
                  },
                ]}
                extra={
                  <FieldHint example="avatar-副本">
                    {isCopy
                      ? '已加上「-副本」后缀，如仍冲突请再修改。同一服务器下名称必须唯一。'
                      : '同一服务器下名称必须唯一，便于在列表中识别。'}
                  </FieldHint>
                }
              >
                <Input placeholder="avatar" maxLength={SERVICE_NAME_MAX_LENGTH} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                label="端口"
                name="port"
                dependencies={['serverId']}
                rules={[
                  { required: true, message: '请填写 1 到 65535 之间的端口。' },
                  {
                    validator: async (_, value) => {
                      const error = conflictMessage(
                        listNginxServiceConflicts(services, {
                          serverId: form.getFieldValue('serverId'),
                          name: form.getFieldValue('name'),
                          port: value,
                          configPath: form.getFieldValue('configPath'),
                        }),
                        'port',
                      );
                      if (error) throw new Error(error);
                    },
                  },
                ]}
                extra={
                  <FieldHint example="8080">
                    {isCopy
                      ? '已带入原服务端口，不会自动更改。同一服务器下端口必须唯一，保存前请改成未被占用的端口。'
                      : '同一服务器下端口必须唯一。'}
                  </FieldHint>
                }
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item
                label="Nginx 配置文件路径"
                name="configPath"
                dependencies={['serverId']}
                rules={[
                  {
                    validator: async (_, value) => {
                      const pathError = validateNginxConfigPath(String(value ?? ''));
                      if (pathError) throw new Error(pathError);
                      const error = conflictMessage(
                        listNginxServiceConflicts(services, {
                          serverId: form.getFieldValue('serverId'),
                          name: form.getFieldValue('name'),
                          port: form.getFieldValue('port'),
                          configPath: value,
                        }),
                        'configPath',
                      );
                      if (error) throw new Error(error);
                    },
                  },
                ]}
                extra={
                  <FieldHint example="/data/smartsecurity/nginx/vhost/avatar.conf">
                    {isCopy
                      ? '已带入原服务路径。必须是绝对路径，以 .conf 结尾，且不能包含「..」。同一服务器下路径必须唯一，请改成另一条路径后再保存。'
                      : '必须是服务器上的绝对路径，并以 .conf 结尾。同一服务器下路径必须唯一。平台不会自动创建目录。'}
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
            <Button type="primary" htmlType="submit" loading={createMutation.isPending} disabled={servers.length === 0}>
              {isCopy ? '保存为新服务' : '创建服务'}
            </Button>
            <Button onClick={confirmLeave}>取消</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
