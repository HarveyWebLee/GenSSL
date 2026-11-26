import type { ReactNode } from 'react';

interface NamePreviewItem {
  label: string;
  value: string;
}

interface NamePreviewProps {
  title?: ReactNode;
  items: NamePreviewItem[];
  footnote?: ReactNode;
}

export function NamePreview({ title, items, footnote }: NamePreviewProps) {
  return (
    <div className="name-preview">
      {title ? <div className="name-preview-title">{title}</div> : null}
      <dl className="name-preview-list">
        {items.map((item) => (
          <div key={item.label} className="name-preview-row">
            <dt>{item.label}</dt>
            <dd>
              <code>{item.value}</code>
            </dd>
          </div>
        ))}
      </dl>
      {footnote ? <div className="name-preview-note">{footnote}</div> : null}
    </div>
  );
}
