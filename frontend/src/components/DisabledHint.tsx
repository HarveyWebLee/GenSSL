import type { ReactElement } from 'react';
import { Tooltip } from 'antd';

export function DisabledHint({ title, children }: { title?: string; children: ReactElement }) {
  if (!title) {
    return children;
  }
  return (
    <Tooltip title={title}>
      <span>{children}</span>
    </Tooltip>
  );
}
