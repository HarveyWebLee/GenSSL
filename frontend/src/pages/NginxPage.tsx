import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { generateNginxConfig, listCas } from '../api/ssl';
import type { GenerateNginxPayload } from '../api/types';
import { FieldHint } from '../components/FieldHint';
import { PageHeader } from '../components/PageHeader';
import { WorkflowBar } from '../components/WorkflowBar';

interface ExampleFormValues {
  listenPort?: number | null;
  serverName?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
  rootPath?: string;
}

const DEFAULT_EXAMPLE = {
  listenPort: 443,
  serverName: '192.168.99.242',
  sslCertificate: '/etc/nginx/ssl/192.168.99.242.crt',
  sslCertificateKey: '/etc/nginx/ssl/192.168.99.242.key',
  rootPath: 'html',
};

function toPayload(values: ExampleFormValues): GenerateNginxPayload {
  const listenPort = values.listenPort ?? DEFAULT_EXAMPLE.listenPort;
  const serverName = values.serverName?.trim();
  const sslCertificate = values.sslCertificate?.trim();
  const sslCertificateKey = values.sslCertificateKey?.trim();
  const rootPath = values.rootPath?.trim();
  return {
    listenPort: listenPort || DEFAULT_EXAMPLE.listenPort,
    serverName: serverName || DEFAULT_EXAMPLE.serverName,
    sslCertificate: sslCertificate || DEFAULT_EXAMPLE.sslCertificate,
    sslCertificateKey: sslCertificateKey || DEFAULT_EXAMPLE.sslCertificateKey,
    rootPath: rootPath || DEFAULT_EXAMPLE.rootPath,
  };
}

export function NginxPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<ExampleFormValues>();
  const listenPort = Form.useWatch('listenPort', form);
  const serverName = Form.useWatch('serverName', form);
  const sslCertificate = Form.useWatch('sslCertificate', form);
  const sslCertificateKey = Form.useWatch('sslCertificateKey', form);
  const rootPath = Form.useWatch('rootPath', form);
  const payload = useMemo(
    () =>
      toPayload({
        listenPort,
        serverName,
        sslCertificate,
        sslCertificateKey,
        rootPath,
      }),
    [listenPort, serverName, sslCertificate, sslCertificateKey, rootPath],
  );

  const casQuery = useQuery({ queryKey: ['cas'], queryFn: listCas });
  const configQuery = useQuery({
    queryKey: ['nginx-config', payload],
    queryFn: () => generateNginxConfig(payload),
  });
  const cas = casQuery.data?.items ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        title="Nginx 配置"
        description="上传部署会通过 SFTP 把证书和私钥写到服务器上登记的绝对目录。用下面的示例指向这些实际文件，不要指向 RustFS 管理副本。客户端必须安装签发该服务器证书的那棵根的公钥。"
      />
      <WorkflowBar current="install" />

      <Card className="surface-card" title="需要信任的根证书">
        {cas.length === 0 ? (
          <Typography.Text type="secondary">尚未创建根证书。</Typography.Text>
        ) : (
          <ul className="guide-steps">
            {cas.map((item) => (
              <li key={item.id}>
                {item.name}（{item.publicFileName}，{item.status === 'active' ? '启用中' : '已停用'}
                {(item.generation ?? 1) > 1 ? '，已重新生成并覆盖，客户端须改装新公钥' : ''}）
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="surface-card" title="配置示例">
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <ol className="guide-steps">
            <li>
              「上传部署」已通过 SFTP 把证书和私钥写到服务器上登记的绝对目录。从该页下载的是文件服务器中的管理副本，从「证书库」下载的是管理档案，请不要把 Nginx 路径写成这些副本路径。
            </li>
            <li>
              把下面的证书和私钥路径改成远程目录中的实际文件名，例如 /etc/nginx/ssl/192.168.99.242.crt。若写成相对路径，则相对于 Nginx 安装目录（prefix）。
            </li>
            <li>
              server_name 可直接写 IP，须与证书 SAN 中的 IP 一致，不要带端口。监听可以是 443，也可以是 3084 这类端口；非 443 时请用 https://IP:端口 访问。
            </li>
          </ol>
          <Form
            form={form}
            layout="vertical"
            initialValues={DEFAULT_EXAMPLE}
          >
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item
                  label="监听端口"
                  name="listenPort"
                  rules={[
                    { type: 'number', min: 1, max: 65535, message: '请填写 1 到 65535 之间的端口' },
                  ]}
                  extra={<FieldHint example="443 或 3084">默认为 443，也可以是 3084 这类端口。非 443 时请用 https://IP:端口 访问。</FieldHint>}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item
                  label="server_name"
                  name="serverName"
                  extra={
                    <FieldHint example="192.168.99.242">
                      可直接写 IP，须与证书 SAN 中的 IP 一致，不要带端口。
                    </FieldHint>
                  }
                >
                  <Input placeholder="192.168.99.242" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="证书路径"
                  name="sslCertificate"
                  extra={
                    <FieldHint example="/etc/nginx/ssl/192.168.99.242.crt">
                      登记的绝对目录 + 实际上传后的文件名。不必叫 server.crt。
                    </FieldHint>
                  }
                >
                  <Input placeholder="/etc/nginx/ssl/192.168.99.242.crt" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="私钥路径"
                  name="sslCertificateKey"
                  extra={
                    <FieldHint example="/etc/nginx/ssl/192.168.99.242.key">
                      与证书同一目录下的私钥文件，文件名沿用证书自己的名称。
                    </FieldHint>
                  }
                >
                  <Input placeholder="/etc/nginx/ssl/192.168.99.242.key" />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item
                  label="网站根目录（可选）"
                  name="rootPath"
                  extra={
                    <FieldHint example="html 或 /var/www/html">
                      用于静态站点的 root。相对路径相对于 Nginx 安装目录（prefix）。不填则示例使用 html。
                    </FieldHint>
                  }
                >
                  <Input placeholder="html" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
          {configQuery.isError ? (
            <Alert type="error" showIcon title="生成配置示例失败，请稍后重试。" />
          ) : null}
          {configQuery.data?.config ? <pre className="san-preview">{configQuery.data.config}</pre> : null}
          {configQuery.data?.note ? <Alert type="info" showIcon title={configQuery.data.note} /> : null}
          <Button type="primary" onClick={() => navigate('/guide')}>
            查看客户端安装指引
          </Button>
        </Space>
      </Card>
    </div>
  );
}
