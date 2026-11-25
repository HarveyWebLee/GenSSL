import { Alert, Card, Typography } from 'antd';

interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        message="当前为项目骨架"
        description="页面布局与路由已就绪，业务功能将在后续迭代中实现。"
      />
    </Card>
  );
}
