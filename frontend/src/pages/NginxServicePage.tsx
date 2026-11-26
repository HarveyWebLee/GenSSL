import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
  Upload,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import {
  deleteNginxRelease,
  deleteNginxService,
  downloadNginxRelease,
  getNginxService,
  listNginxReleases,
  listServers,
  publishNginxService,
  republishNginxRelease,
  restartNginxService,
  updateNginxRelease,
  updateNginxService,
} from '../api/ssl';
import type { NginxReleaseDetail, NginxReleaseStatus, NginxServiceDetail, ServerRecord } from '../api/types';
import { FieldHint } from '../components/FieldHint';
import { NginxExampleCard } from '../components/NginxExampleCard';
import { PageHeader } from '../components/PageHeader';
import { readConfFile, validateNginxConfigPath, validateRestartCommand, validateVersion } from '../utils/nginx-path';

interface MetaFormValues {
  serverId: string;
  name: string;
  port: number;
  configPath: string;
  restartCommand: string;
}

interface PublishFormValues {
  version: string;
  remark: string;
}

function releaseColor(status: NginxReleaseStatus): string {
  if (status === 'success') return 'var(--ok)';
  if (status === 'partial') return 'var(--warn)';
  return 'var(--danger)';
}

function releaseTagColor(status: NginxReleaseStatus): 'success' | 'warning' | 'error' {
  if (status === 'success') return 'success';
  if (status === 'partial') return 'warning';
  return 'error';
}

function serverLabel(server: Pick<ServerRecord, 'name' | 'host' | 'sshPort'>): string {
  return server.host ? `${server.name}（${server.host}:${server.sshPort}）` : server.name;
}

function remoteSummary(service: NginxServiceDetail): string {
  const host = service.server.host ? `${service.server.host}:${service.server.sshPort}` : '未填写主机';
  const user = service.server.sshUsername ? `${service.server.sshUsername}@` : '';
  return `${user}${host}:${service.configPath}`;
}

export function NginxServicePage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const [configText, setConfigText] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [remarkTarget, setRemarkTarget] = useState<NginxReleaseDetail | null>(null);
  const [metaForm] = Form.useForm<MetaFormValues>();
  const [publishForm] = Form.useForm<PublishFormValues>();
  const [remarkForm] = Form.useForm<{ remark: string }>();

  const serviceQuery = useQuery({
    queryKey: ['nginx-service', id],
    queryFn: () => getNginxService(id as string),
    enabled: Boolean(id),
  });
  const releasesQuery = useQuery({
    queryKey: ['nginx-releases', id],
    queryFn: () => listNginxReleases(id as string),
    enabled: Boolean(id),
  });
  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const service = serviceQuery.data;
  const releases = releasesQuery.data?.items ?? [];
  const servers = serversQuery.data?.items ?? [];
  const dirty = Boolean(service && configText !== service.configText);

  useEffect(() => {
    if (service) {
      setConfigText(service.configText);
    }
  }, [service?.id, service?.updatedAt, service?.configText]);

  useEffect(() => {
    if (params.get('publish') === '1' && service) {
      setPublishOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, service, setParams]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['nginx-service', id] });
    await queryClient.invalidateQueries({ queryKey: ['nginx-releases', id] });
    await queryClient.invalidateQueries({ queryKey: ['nginx-services'] });
  };

  const saveMutation = useMutation({
    mutationFn: (text: string) => updateNginxService(id as string, { configText: text }),
    onSuccess: async (updated) => {
      await invalidate();
      setConfigText(updated.configText);
      if (updated.warning) {
        message.warning(updated.warning);
      } else {
        message.success('配置已保存，并已更新文件服务器中的管理副本。尚未覆盖到服务器，需发布后才会生效。');
      }
    },
    onError: (error) => message.error(getApiErrorMessage(error, '保存配置失败')),
  });

  const metaMutation = useMutation({
    mutationFn: (values: MetaFormValues) =>
      updateNginxService(id as string, {
        serverId: values.serverId,
        name: values.name.trim(),
        port: values.port,
        configPath: values.configPath.trim(),
        restartCommand: values.restartCommand.trim(),
      }),
    onSuccess: async (updated) => {
      await invalidate();
      setEditingMeta(false);
      message.success(updated.warning || '服务信息已更新。重启命令将用于之后的发布、重新发布和手动重启。');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '保存服务信息失败')),
  });

  const publishMutation = useMutation({
    mutationFn: ({ id: serviceId, version, remark }: { id: string; version: string; remark: string }) =>
      publishNginxService(serviceId, { version, remark }),
    onSuccess: async (released) => {
      await invalidate();
      setPublishOpen(false);
      publishForm.resetFields();
      if (released.status === 'partial') {
        modal.warning({
          title: '配置文件已覆盖，但服务可能未重启',
          content: released.warning || released.errorMessage || '远程写入已成功，重启命令执行失败。',
        });
      } else if (released.status === 'success') {
        message.success(`版本 ${released.version} 已发布到 ${released.remote?.destination ?? service?.configPath}，并已执行重启命令。`);
      }
    },
    onError: (error) => message.error(getApiErrorMessage(error, '发布失败')),
  });

  const restartMutation = useMutation({
    mutationFn: () => restartNginxService(id as string),
    onSuccess: (result) => {
      if (result.ok) {
        message.success(result.message);
      } else {
        modal.error({ title: '重启命令执行失败', content: result.message });
      }
    },
    onError: (error) => message.error(getApiErrorMessage(error, '重启失败')),
  });

  const republishMutation = useMutation({
    mutationFn: (releaseId: string) => republishNginxRelease(id as string, releaseId),
    onSuccess: async (released) => {
      await invalidate();
      if (released.status === 'partial') {
        modal.warning({
          title: '历史版本已覆盖到服务器，但服务可能未重启',
          content: released.warning || released.errorMessage || '远程写入已成功，重启命令执行失败。',
        });
      } else {
        message.success(`已重新发布版本 ${released.version}，并使用当前服务配置中的重启命令。`);
      }
    },
    onError: (error) => message.error(getApiErrorMessage(error, '重新发布失败')),
  });

  const deleteServiceMutation = useMutation({
    mutationFn: () => deleteNginxService(id as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nginx-services'] });
      message.success('服务已从列表中移除。这是假删除，服务器上的配置文件不会被删除。');
      navigate('/nginx');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除服务失败')),
  });

  const deleteReleaseMutation = useMutation({
    mutationFn: (releaseId: string) => deleteNginxRelease(id as string, releaseId),
    onSuccess: async () => {
      await invalidate();
      message.success('该版本已从时间线中移除。这是假删除，不会改动服务器上的当前文件。');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '删除版本失败')),
  });

  const remarkMutation = useMutation({
    mutationFn: ({ releaseId, remark }: { releaseId: string; remark: string }) =>
      updateNginxRelease(id as string, releaseId, remark),
    onSuccess: async () => {
      await invalidate();
      setRemarkTarget(null);
      message.success('备注已更新。配置快照不会因修改备注而改变，也不会自动同步到服务器。');
    },
    onError: (error) => message.error(getApiErrorMessage(error, '更新备注失败')),
  });

  const ensureSaved = async (): Promise<boolean> => {
    if (!service) return false;
    if (!dirty) return true;
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: '先保存当前配置？',
        content: '编辑器中有尚未保存的修改。发布将使用已保存的配置。是否先保存再继续发布？',
        okText: '保存并继续',
        cancelText: '取消',
        onOk: async () => {
          await saveMutation.mutateAsync(configText);
          resolve(true);
        },
        onCancel: () => resolve(false),
      });
    });
    return confirmed;
  };

  const openPublish = async () => {
    if (!service) return;
    if (!service.server.sshReady) {
      message.error(service.server.sshReadyReason ?? '尚未配置远程登录，无法发布。');
      return;
    }
    const ready = await ensureSaved();
    if (!ready) return;
    setPublishOpen(true);
  };

  const confirmPublish = (values: PublishFormValues) => {
    if (!service) return;
    modal.confirm({
      title: `确认发布版本 ${values.version.trim()}？`,
      width: 560,
      content: (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <div>即将把当前已保存的配置覆盖写入目标服务器，成功后再执行该服务上的重启命令。请再次确认，以防误触。</div>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="服务器">{serverLabel(service.server)}</Descriptions.Item>
            <Descriptions.Item label="远程路径">{service.configPath}</Descriptions.Item>
            <Descriptions.Item label="目标">{remoteSummary(service)}</Descriptions.Item>
            <Descriptions.Item label="版本号">{values.version.trim()}</Descriptions.Item>
            <Descriptions.Item label="备注">{values.remark.trim()}</Descriptions.Item>
            <Descriptions.Item label="重启命令">{service.restartCommand}</Descriptions.Item>
          </Descriptions>
          <Alert type="warning" showIcon title="重启命令将在目标服务器上通过 SSH 执行，不会在本平台本机执行。目录不存在时不会自动创建。" />
        </Space>
      ),
      okText: '确认发布',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => publishMutation.mutateAsync({ id: service.id, ...values, version: values.version.trim(), remark: values.remark.trim() }),
    });
  };

  const confirmRestart = () => {
    if (!service) return;
    if (!service.server.sshReady) {
      message.error(service.server.sshReadyReason ?? '尚未配置远程登录，无法重启。');
      return;
    }
    modal.confirm({
      title: '确认在目标服务器上执行重启命令？',
      width: 520,
      content: (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <div>不会再次上传配置文件，只会在目标服务器执行该服务当前配置的重启命令。</div>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="服务器">{serverLabel(service.server)}</Descriptions.Item>
            <Descriptions.Item label="目标">{remoteSummary(service)}</Descriptions.Item>
            <Descriptions.Item label="重启命令">{service.restartCommand}</Descriptions.Item>
          </Descriptions>
        </Space>
      ),
      okText: '确认重启',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => restartMutation.mutateAsync(),
    });
  };

  const confirmRepublish = (row: NginxReleaseDetail) => {
    if (!service) return;
    modal.confirm({
      title: `重新发布版本 ${row.version}？`,
      width: 560,
      content: (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <div>
            将把该历史版本的配置快照覆盖到服务器当前路径，然后执行<strong>服务当前配置</strong>中的重启命令，并在时间线中新增一条记录。
          </div>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="服务器">{serverLabel(service.server)}</Descriptions.Item>
            <Descriptions.Item label="远程路径">{service.configPath}</Descriptions.Item>
            <Descriptions.Item label="历史版本">{row.version}</Descriptions.Item>
            <Descriptions.Item label="当时路径">{row.configPath}</Descriptions.Item>
            <Descriptions.Item label="将执行的重启命令">{service.restartCommand}</Descriptions.Item>
          </Descriptions>
        </Space>
      ),
      okText: '确认重新发布',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => republishMutation.mutateAsync(row.id),
    });
  };

  const confirmDeleteService = () => {
    if (!service) return;
    modal.confirm({
      title: `删除服务「${service.name}」？`,
      content: `页面上将不再显示该服务及其版本时间线。这是假删除，不会删除服务器上的 ${service.configPath}，也不会销毁文件服务器中的管理副本。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteServiceMutation.mutateAsync(),
    });
  };

  const confirmDeleteRelease = (row: NginxReleaseDetail) => {
    modal.confirm({
      title: `删除版本 ${row.version}？`,
      content: '该版本将从发布时间线中消失。这是假删除，不会改动服务器上已经写入的文件。若该版本号被移除，之后可以再次使用相同版本号发布。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteReleaseMutation.mutateAsync(row.id),
    });
  };

  const uploadProps = useMemo(
    () => ({
      accept: '.conf',
      showUploadList: false,
      beforeUpload: async (file: File) => {
        try {
          setConfigText(await readConfFile(file));
          message.success(`已载入 ${file.name}，请检查后保存。尚未覆盖到服务器。`);
        } catch (error) {
          message.error(error instanceof Error ? error.message : '读取配置文件失败');
        }
        return false;
      },
    }),
    [message],
  );

  if (serviceQuery.isLoading) {
    return (
      <div className="page-stack">
        <Card>
          <Spin description="正在读取服务详情…">
            <div style={{ minHeight: 160 }} />
          </Spin>
        </Card>
      </div>
    );
  }

  if (serviceQuery.isError || !service) {
    return (
      <div className="page-stack">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/nginx')}>
          返回服务列表
        </Button>
        <Alert
          type="error"
          showIcon
          title="无法读取该 Nginx 服务"
          description={getApiErrorMessage(serviceQuery.error, '该服务可能已被删除，或暂时无法访问。')}
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={
          <Space size={12} align="center">
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/nginx')}>
              返回
            </Button>
            <span>{service.name}</span>
          </Space>
        }
        description={`所属服务器 ${serverLabel(service.server)}，配置将发布到 ${service.configPath}。重启命令保存在服务配置中，不会在发布时另行填写。`}
        extra={
          <Space wrap>
            <Button icon={<CloudUploadOutlined />} type="primary" onClick={() => void openPublish()} loading={publishMutation.isPending}>
              发布新版本
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => navigate(`/nginx/new?copyFrom=${encodeURIComponent(service.id)}`)}>
              复制新建
            </Button>
            <Button icon={<ReloadOutlined />} onClick={confirmRestart} loading={restartMutation.isPending}>
              手动重启
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={confirmDeleteService} loading={deleteServiceMutation.isPending}>
              删除服务
            </Button>
          </Space>
        }
      />

      {!service.server.sshReady ? (
        <Alert
          type="warning"
          showIcon
          title="尚未配置远程登录，无法发布或重启"
          description={service.server.sshReadyReason ?? '请先在「服务器与路径」中补全该服务器的 SSH 信息。'}
          action={
            <Button onClick={() => navigate('/servers')}>
              去配置服务器
            </Button>
          }
        />
      ) : null}

      <Card
        className="surface-card"
        title="服务信息"
        extra={
          <Button type="link" icon={<EditOutlined />} onClick={() => {
            setEditingMeta(true);
            metaForm.setFieldsValue({
              serverId: service.server.id,
              name: service.name,
              port: service.port,
              configPath: service.configPath,
              restartCommand: service.restartCommand,
            });
          }}
          >
            编辑
          </Button>
        }
      >
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="服务器">{serverLabel(service.server)}</Descriptions.Item>
          <Descriptions.Item label="端口">{service.port}</Descriptions.Item>
          <Descriptions.Item label="配置路径" span={2}>
            <Typography.Text code>{service.configPath}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="重启命令" span={2}>
            <Typography.Text code>{service.restartCommand}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="当前版本">
            {service.currentRelease ? (
              <Space size={8}>
                <Tag color={releaseTagColor(service.currentRelease.status)}>{service.currentRelease.version}</Tag>
                <span>{service.currentRelease.statusLabel}</span>
              </Space>
            ) : (
              '尚未发布'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="最近发布">
            {service.currentRelease ? dayjs(service.currentRelease.publishedAt).format('YYYY-MM-DD HH:mm') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="管理副本" span={2}>
            {service.archive.uploaded ? (
              <Typography.Text type="secondary">
                已保存到文件服务器：<code>{service.archive.objectKey}</code>。这不是服务器上的真实文件。
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">尚未写入文件服务器管理副本。保存配置时会尝试上传。</Typography.Text>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <div className="nginx-detail-grid">
        <Card
          className="surface-card"
          title="配置文件"
          extra={
            <Space wrap>
              {dirty ? <Tag color="warning">未保存</Tag> : <Tag>已与保存内容一致</Tag>}
              <Upload {...uploadProps}>
                <Button icon={<UploadOutlined />}>上传 .conf</Button>
              </Upload>
              <Button icon={<SaveOutlined />} type="primary" disabled={!dirty} loading={saveMutation.isPending} onClick={() => saveMutation.mutate(configText)}>
                保存配置
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title="这里编辑的是管理副本。保存后会写入文件服务器，但只有发布成功后才会覆盖服务器上的真实文件。"
          />
          <Input.TextArea
            className="nginx-editor"
            value={configText}
            onChange={(event) => setConfigText(event.target.value)}
            autoSize={{ minRows: 18, maxRows: 36 }}
            spellCheck={false}
          />
        </Card>

        <Card className="surface-card" title="版本时间线">
          {releasesQuery.isLoading ? (
            <Spin description="正在读取发布记录…" />
          ) : releases.length === 0 ? (
            <div className="empty-panel" style={{ padding: '28px 8px' }}>
              <h4>还没有发布记录</h4>
              <p>保存配置后，点击「发布新版本」。发布时需填写版本号和备注，覆盖远程文件成功后会自动执行服务上的重启命令。</p>
              <Button type="primary" onClick={() => void openPublish()}>
                发布第一个版本
              </Button>
            </div>
          ) : (
            <Timeline
              className="nginx-timeline"
              items={releases.map((item) => ({
                color: releaseColor(item.status),
                children: (
                  <div className="nginx-release">
                    <div className="nginx-release-head">
                      <Space wrap size={8}>
                        <Typography.Text strong>版本 {item.version}</Typography.Text>
                        <Tag color={releaseTagColor(item.status)}>{item.statusLabel}</Tag>
                        {item.sourceReleaseId ? <Tag>重新发布</Tag> : null}
                      </Space>
                      <Typography.Text type="secondary">{dayjs(item.publishedAt).format('YYYY-MM-DD HH:mm:ss')}</Typography.Text>
                    </div>
                    <div className="nginx-release-remark">{item.remark}</div>
                    <Typography.Text type="secondary">
                      写入路径 <code>{item.configPath}</code>
                      {item.restartCommandUsed ? `，当时执行：${item.restartCommandUsed}` : ''}
                    </Typography.Text>
                    {item.errorMessage && item.status !== 'success' ? (
                      <Alert
                        type={item.status === 'partial' ? 'warning' : 'error'}
                        showIcon
                        style={{ marginTop: 8 }}
                        title={item.errorMessage}
                      />
                    ) : null}
                    <Space wrap size={4} style={{ marginTop: 8 }}>
                      <Button
                        type="link"
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() =>
                          downloadNginxRelease(service.id, item.id, `${service.name}-${item.version}.conf`).catch((error) =>
                            message.error(getApiErrorMessage(error, '下载失败')),
                          )
                        }
                      >
                        下载 conf
                      </Button>
                      <Button type="link" size="small" onClick={() => confirmRepublish(item)} loading={republishMutation.isPending}>
                        重新发布
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setRemarkTarget(item);
                          remarkForm.setFieldsValue({ remark: item.remark });
                        }}
                      >
                        改备注
                      </Button>
                      <Button type="link" size="small" danger onClick={() => confirmDeleteRelease(item)}>
                        删除
                      </Button>
                    </Space>
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      </div>

      <Collapse
        items={[
          {
            key: 'example',
            label: '生成配置示例（可作为草稿插入编辑器）',
            children: (
              <NginxExampleCard
                defaultPort={service.port}
                defaultServerName={service.server.host || service.name}
                onInsert={(config) => {
                  setConfigText(config);
                  message.success('已将示例插入编辑器，请检查路径后保存，再发布到服务器。');
                }}
              />
            ),
          },
        ]}
      />

      <Modal
        title="编辑服务信息"
        open={editingMeta}
        onCancel={() => setEditingMeta(false)}
        onOk={() => metaForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={metaMutation.isPending}
        destroyOnHidden
        width={640}
      >
        <Form form={metaForm} layout="vertical" onFinish={(values) => metaMutation.mutate(values)}>
          <Form.Item label="所属服务器" name="serverId" rules={[{ required: true, message: '请选择已登记的服务器。' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={servers.map((item) => ({
                value: item.id,
                label: item.sshReady ? serverLabel(item) : `${serverLabel(item)}（未配置远程登录）`,
              }))}
            />
          </Form.Item>
          <Form.Item label="服务名称" name="name" rules={[{ required: true, message: '请填写服务名称。' }]}>
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item label="端口" name="port" rules={[{ required: true, message: '请填写 1 到 65535 之间的端口。' }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
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
            extra={<FieldHint>必须是绝对路径并以 .conf 结尾。发布时覆盖这个文件，平台不会自动创建目录。</FieldHint>}
          >
            <Input />
          </Form.Item>
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
            extra={<FieldHint>发布、重新发布和手动重启都会使用这条命令。命令在目标服务器上通过 SSH 执行。</FieldHint>}
          >
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="发布新版本"
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onOk={() => publishForm.submit()}
        okText="下一步：确认发布"
        cancelText="取消"
        confirmLoading={publishMutation.isPending}
        destroyOnHidden
        width={560}
      >
        {service ? (
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              title="发布不会在表单中填写重启命令"
              description={`覆盖 ${service.configPath} 成功后，将自动执行「${service.restartCommand}」。`}
            />
            <Form form={publishForm} layout="vertical" onFinish={confirmPublish}>
              <Form.Item
                label="版本号"
                name="version"
                rules={[
                  {
                    validator: async (_, value) => {
                      const error = validateVersion(String(value ?? ''));
                      if (error) throw new Error(error);
                    },
                  },
                ]}
                extra={<FieldHint example="1.0.0">同一服务下未删除的版本号不能重复。重新发布请使用时间线中的「重新发布」。</FieldHint>}
              >
                <Input placeholder="1.0.0" maxLength={64} />
              </Form.Item>
              <Form.Item
                label="备注"
                name="remark"
                rules={[{ required: true, message: '请填写发布备注。' }]}
              >
                <Input.TextArea rows={3} maxLength={500} placeholder="例如：开放头像服务 8080 端口并启用 HTTPS" />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={remarkTarget ? `修改版本 ${remarkTarget.version} 的备注` : '修改备注'}
        open={Boolean(remarkTarget)}
        onCancel={() => setRemarkTarget(null)}
        onOk={() => remarkForm.submit()}
        okText="保存备注"
        cancelText="取消"
        confirmLoading={remarkMutation.isPending}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="只能修改备注。配置快照保持不变，也不会自动同步到服务器；如需让服务器使用该版本，请重新发布。"
        />
        <Form
          form={remarkForm}
          layout="vertical"
          onFinish={(values) => {
            if (!remarkTarget) return;
            remarkMutation.mutate({ releaseId: remarkTarget.id, remark: values.remark.trim() });
          }}
        >
          <Form.Item label="备注" name="remark" rules={[{ required: true, message: '请填写备注。' }]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
