import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** Small right-aligned text or controls in the panel header. */
  aside?: ReactNode;
  /** Extra class, typically the grid-area modifier of the layout. */
  className?: string;
  children: ReactNode;
}

/** The standard terminal box: title bar + body. Every feature panel uses it. */
export function Panel({ title, aside, className, children }: PanelProps) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {aside !== undefined && <div className="panel__aside">{aside}</div>}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/** Body of a panel whose feature is not built yet. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <div className="placeholder">{children}</div>;
}
