import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Typography } from 'antd';
import {
  SafetyCertificateOutlined,
  AppstoreOutlined,
  FileAddOutlined,
  ClusterOutlined,
  CloudServerOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';

const { Sider, Header, Content } = Layout;

const menuItems = [
  { key: '/', icon: <AppstoreOutlined />, label: '概览' },
  { key: '/ca', icon: <SafetyCertificateOutlined />, label: '根 CA' },
  { key: '/issue', icon: <FileAddOutlined />, label: '签发证书' },
  { key: '/certs', icon: <ClusterOutlined />, label: '证书管理' },
  { key: '/nginx', icon: <CloudServerOutlined />, label: 'Nginx 配置' },
  { key: '/guide', icon: <QuestionCircleOutlined />, label: '客户端信任' },
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey =
    menuItems.find((item) =>
      item.key === '/' ? location.pathname === '/' : location.pathname.startsWith(item.key),
    )?.key ?? '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={64}
        theme="light"
        style={{ borderRight: '1px solid #f0f0f0' }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '0 16px',
          }}
        >
          <SafetyCertificateOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <Typography.Title level={5} style={{ margin: 0, whiteSpace: 'nowrap' }}>
            GenSSL
          </Typography.Title>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Typography.Text type="secondary">局域网 HTTPS 自建 SSL 证书管理</Typography.Text>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
