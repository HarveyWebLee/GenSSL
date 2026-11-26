import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Space } from 'antd';
import { generateNginxConfig } from '../api/ssl';
import type { GenerateNginxPayload } from '../api/types';
import { FieldHint } from './FieldHint';

interface ExampleFormValues {
  listenPort?: number | null;
  serverName?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
  rootPath?: string;
  proxyPass?: string;
}

const DEFAULT_EXAMPLE = {
  listenPort: 443,
  serverName: '192.168.99.242',
  sslCertificate: '/etc/nginx/ssl/192.168.99.242.crt',
  sslCertificateKey: '/etc/nginx/ssl/192.168.99.242.key',
  rootPath: 'html',
};

function toPayload(values: ExampleFormValues): GenerateNginxPayload {
  return {
    listenPort: values.listenPort || DEFAULT_EXAMPLE.listenPort,
    serverName: values.serverName?.trim() || DEFAULT_EXAMPLE.serverName,
    sslCertificate: values.sslCertificate?.trim() || DEFAULT_EXAMPLE.sslCertificate,
    sslCertificateKey: values.sslCertificateKey?.trim() || DEFAULT_EXAMPLE.sslCertificateKey,
    rootPath: values.rootPath?.trim() || DEFAULT_EXAMPLE.rootPath,
    proxyPass: values.proxyPass?.trim() || undefined,
  };
}

interface NginxExampleCardProps {
  defaultPort?: number;
  defaultServerName?: string;
  onInsert?: (config: string) => void;
  compact?: boolean;
}

export function NginxExampleCard({ defaultPort, defaultServerName, onInsert, compact }: NginxExampleCardProps) {
  const [form] = Form.useForm<ExampleFormValues>();
  const listenPort = Form.useWatch('listenPort', form);
  const serverName = Form.useWatch('serverName', form);
  const sslCertificate = Form.useWatch('sslCertificate', form);
  const sslCertificateKey = Form.useWatch('sslCertificateKey', form);
  const rootPath = Form.useWatch('rootPath', form);
  const proxyPass = Form.useWatch('proxyPass', form);
  const payload = useMemo(
    () =>
      toPayload({
        listenPort,
        serverName,
        sslCertificate,
        sslCertificateKey,
        rootPath,
        proxyPass,
      }),
    [listenPort, serverName, sslCertificate, sslCertificateKey, rootPath, proxyPass],
  );
  const configQuery = useQuery({
    queryKey: ['nginx-config', payload],
    queryFn: () => generateNginxConfig(payload),
  });

  return (
    <Card className="surface-card" size={compact ? 'small' : 'default'} title="生成配置示例">
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            ...DEFAULT_EXAMPLE,
            listenPort: defaultPort ?? DEFAULT_EXAMPLE.listenPort,
            serverName: defaultServerName ?? DEFAULT_EXAMPLE.serverName,
          }}
        >
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                label="监听端口"
                name="listenPort"
                extra={<FieldHint example="443 或 8080">填写该服务将监听的端口，可与服务配置中的端口保持一致。</FieldHint>}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item
                label="server_name"
                name="serverName"
                extra={<FieldHint example="192.168.99.242">可直接写 IP，须与证书 SAN 一致，不要带端口。</FieldHint>}
              >
                <Input placeholder="192.168.99.242" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="证书路径"
                name="sslCertificate"
                extra={<FieldHint example="/etc/nginx/ssl/192.168.99.242.crt">指向上传部署后的实际证书文件，不要写成 RustFS 管理副本路径。</FieldHint>}
              >
                <Input placeholder="/etc/nginx/ssl/192.168.99.242.crt" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="私钥路径"
                name="sslCertificateKey"
                extra={<FieldHint example="/etc/nginx/ssl/192.168.99.242.key">指向实际上传的服务器私钥。</FieldHint>}
              >
                <Input placeholder="/etc/nginx/ssl/192.168.99.242.key" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="网站根目录（可选）"
                name="rootPath"
                extra={<FieldHint example="html 或 /var/www/html">用于静态站点。相对路径相对于 Nginx 安装目录。</FieldHint>}
              >
                <Input placeholder="html" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="反向代理（可选）"
                name="proxyPass"
                extra={<FieldHint example="http://127.0.0.1:8080">填写后示例将改用 proxy_pass，不再写出 root。</FieldHint>}
              >
                <Input placeholder="http://127.0.0.1:8080" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        {configQuery.isError ? <Alert type="error" showIcon title="生成配置示例失败，请稍后重试。" /> : null}
        {configQuery.data?.config ? <pre className="san-preview nginx-example-preview">{configQuery.data.config}</pre> : null}
        {configQuery.data?.note ? <Alert type="info" showIcon title={configQuery.data.note} /> : null}
        {onInsert && configQuery.data?.config ? (
          <Button type="primary" onClick={() => onInsert(configQuery.data!.config)}>
            插入到编辑器
          </Button>
        ) : null}
      </Space>
    </Card>
  );
}
