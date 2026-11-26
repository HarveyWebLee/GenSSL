import type { ReactNode } from 'react';

interface FieldHintProps {
  children: ReactNode;
  example?: string;
}

export function FieldHint({ children, example }: FieldHintProps) {
  return (
    <div className="field-hint">
      <div>{children}</div>
      {example ? <div className="field-example">例：{example}</div> : null}
    </div>
  );
}
