import type { ReactNode } from 'react';
import { Typography } from 'antd';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
}

export function PageHeader({ title, description, extra }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <Typography.Title level={3} className="page-title">
          {title}
        </Typography.Title>
        {description ? (
          <Typography.Paragraph type="secondary" className="page-desc">
            {description}
          </Typography.Paragraph>
        ) : null}
      </div>
      {extra ? <div className="page-header-extra">{extra}</div> : null}
    </div>
  );
}
