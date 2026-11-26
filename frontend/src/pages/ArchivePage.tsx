import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '../api/http';
import { downloadStoredObject, getArchiveLibrary } from '../api/ssl';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';
import { certStatusColor } from '../utils/cert-status';

export function ArchivePage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['archive'], queryFn: getArchiveLibrary });

  return (
    <div className="page-stack">
      <PageHeader
        title="证书库"
        description="证书库是平台管理档案，对象前缀为 archive/：按根证书和服务器证书组织根公钥、服务器证书和服务器私钥。它与「部署到服务器 cert 目录」（deploy/）不是同一处。rootCA.key 不会出现在证书库中。"
      />
      <WorkflowBar current="install" />

      {query.isError ? (
        <Alert type="error" showIcon title="无法读取证书库" description={getApiErrorMessage(query.error, '请稍后重试。')} />
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            title="这是证书库，不是服务器部署目录"
            description={query.data?.note}
          />
          {!query.data?.storage.ready ? (
            <Alert
              type="warning"
              showIcon
              title="RustFS 暂不可用"
              description="签发服务器证书和上传档案都需要文件服务器。请先在项目根目录执行 docker compose up -d。"
            />
          ) : null}

          <Card className="surface-card" title="根证书公钥（archive/cas/）">
            <Table
              rowKey="id"
              loading={query.isLoading}
              pagination={false}
              dataSource={query.data?.cas ?? []}
              columns={[
                { title: '根证书', dataIndex: 'name' },
                {
                  title: '状态',
                  dataIndex: 'status',
                  render: (status: string, row) => (
                    <Space size={4} wrap>
                      {status === 'active' ? <Tag color="success">启用中</Tag> : <Tag>已停用</Tag>}
                      {status === 'active' && (row.generation ?? 1) > 1 ? (
                        <Tag color="warning">已覆盖，需改装公钥</Tag>
                      ) : null}
                    </Space>
                  ),
                },
                { title: '文件名', dataIndex: 'publicFileName' },
                {
                  title: '入库',
                  render: (_, row) =>
                    row.archive.uploaded ? (
                      <Space>
                        <Tag color="blue">已入库</Tag>
                        <Typography.Text code>{row.archive.objectKey}</Typography.Text>
                      </Space>
                    ) : (
                      <Tag>未入库</Tag>
                    ),
                },
                {
                  title: '操作',
                  render: (_, row) => (
                    <Space>
                      <Button size="small" onClick={() => navigate(`/ca?id=${row.id}`)}>
                        管理
                      </Button>
                      {row.archive.objectKey ? (
                        <Button
                          size="small"
                          onClick={() => void downloadStoredObject(row.archive.objectKey as string)}
                        >
                          从证书库下载
                        </Button>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>

          <Card className="surface-card" title="服务器证书档案（archive/certs/）">
            <Table
              rowKey="id"
              loading={query.isLoading}
              pagination={false}
              dataSource={query.data?.certificates ?? []}
              columns={[
                { title: '证书', dataIndex: 'name' },
                { title: '所属根', dataIndex: ['ca', 'name'] },
                {
                  title: '状态',
                  dataIndex: 'statusLabel',
                  render: (label: string, row) => <Tag color={certStatusColor(row.status)}>{label}</Tag>,
                },
                {
                  title: '档案文件',
                  render: (_, row) => (
                    <div>
                      <div>{row.publicFileName}</div>
                      <Typography.Text type="secondary">{row.keyFileName}</Typography.Text>
                    </div>
                  ),
                },
                {
                  title: '对象前缀',
                  render: (_, row) =>
                    row.archive.objectPrefix ? <Typography.Text code>{row.archive.objectPrefix}</Typography.Text> : '—',
                },
                {
                  title: '操作',
                  render: (_, row) => (
                    <Space>
                      <Button size="small" onClick={() => navigate(`/certs?id=${row.id}`)}>
                        查看
                      </Button>
                      {row.status === 'needs_regenerate' ? (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => navigate(`/certs?id=${row.id}&status=needs_regenerate`)}
                        >
                          去重新生成并覆盖
                        </Button>
                      ) : null}
                      {row.status === 'needs_reissue' ? (
                        <Button size="small" onClick={() => navigate('/issue')}>
                          去重新签发
                        </Button>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
