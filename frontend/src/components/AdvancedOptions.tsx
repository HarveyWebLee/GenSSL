import type { ReactNode } from 'react';
import { Collapse } from 'antd';

interface AdvancedOptionsProps {
  children: ReactNode;
  defaultOpen?: boolean;
  title?: string;
}

export function AdvancedOptions({
  children,
  defaultOpen = false,
  title = '高级选项',
}: AdvancedOptionsProps) {
  return (
    <Collapse
      className="advanced-options"
      bordered={false}
      defaultActiveKey={defaultOpen ? ['advanced'] : []}
      items={[
        {
          key: 'advanced',
          label: title,
          children,
        },
      ]}
    />
  );
}
