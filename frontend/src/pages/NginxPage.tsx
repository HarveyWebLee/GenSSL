import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getApiErrorMessage } from '../api/http';
import { deleteNginxService, listNginxServices, listServers } from '../api/ssl';
import type { NginxServiceSummary, ServerRecord } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';

function serverLabel(server: ServerRecord): string {
  return server.host ? `${server.name}（${server.host}:${server.sshPort}）` : server.name;
}

export function NginxPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [serverFilter, setServerFilter] = useState<string>();

  const serversQuery = useQuery({ queryKey: ['servers'], queryFn: listServers });
  const servicesQuery = useQuery({
    queryKey: ['nginx-services', serverFilter],
    queryFn: () => listNginxServices(serverFilter),
  });
  const servers = serversQuery.data?.items ?? [];
  const items = servicesQuery.data?.items ?? [];

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

  return (
    <div className="page-stack">
      <PageHeader
        title="Nginx 配置"
        description="针对已登记的服务器管理各端口服务的 Nginx 配置：在线编辑或上传 .conf，保存后写入文件服务器管理副本，发布时再覆盖到服务器上的真实路径并执行该服务配置的重启命令。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} disabled={servers.length === 0} onClick={() => navigate('/nginx/new')}>
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
                width: 268,
                render: (_, row) => (
                  <Space wrap>
                    <Button type="link" size="small" onClick={() => navigate(`/nginx/${row.id}`)}>
                      详情
                    </Button>
                    <Button type="link" size="small" onClick={() => navigate(`/nginx/${row.id}?publish=1`)}>
                      发布
                    </Button>
                    <Button type="link" size="small" onClick={() => navigate(`/nginx/new?copyFrom=${encodeURIComponent(row.id)}`)}>
                      复制新建
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
    </div>
  );
}
