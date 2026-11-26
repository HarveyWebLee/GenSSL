import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Typography } from 'antd';
import {
  SafetyCertificateOutlined,
  AppstoreOutlined,
  FileAddOutlined,
  ClusterOutlined,
  CloudServerOutlined,
  QuestionCircleOutlined,
  UploadOutlined,
  HddOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';

const { Sider, Header, Content } = Layout;

const menuItems: MenuProps['items'] = [
  {
    type: 'group',
    label: '配置流程',
    children: [
      { key: '/', icon: <AppstoreOutlined />, label: '概览' },
      { key: '/ca', icon: <SafetyCertificateOutlined />, label: '根 CA' },
      { key: '/issue', icon: <FileAddOutlined />, label: '签发证书' },
      { key: '/servers', icon: <HddOutlined />, label: '服务器与路径' },
      { key: '/deploy', icon: <UploadOutlined />, label: '上传部署' },
    ],
  },
  {
    type: 'group',
    label: '证书与指引',
    children: [
      { key: '/certs', icon: <ClusterOutlined />, label: '证书列表' },
      { key: '/archive', icon: <DatabaseOutlined />, label: '证书库' },
      { key: '/nginx', icon: <CloudServerOutlined />, label: 'Nginx 配置' },
      { key: '/guide', icon: <QuestionCircleOutlined />, label: '客户端信任' },
    ],
  },
];

const allKeys = ['/', '/ca', '/issue', '/servers', '/deploy', '/certs', '/archive', '/nginx', '/guide'];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey =
    allKeys.find((key) => (key === '/' ? location.pathname === '/' : location.pathname.startsWith(key))) ??
    '/';

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth={64} theme="light" width={232} className="app-sider">
        <div className="app-brand">
          <div className="app-brand-mark">
            <SafetyCertificateOutlined />
          </div>
          <div className="app-brand-text">
            <Typography.Title level={5} className="app-brand-name">
              GenSSL
            </Typography.Title>
            <span className="app-brand-sub">局域网证书管理</span>
          </div>
        </div>
        <Menu
          className="app-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <span className="app-header-caption">按步骤管理多棵根证书，签发服务器证书，并区分证书库与服务器部署目录</span>
        </Header>
        <Content className="app-content">
          <div className="app-content-inner">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
