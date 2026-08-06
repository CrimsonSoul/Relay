import type { ReactNode } from 'react';

type TabPageHeaderProps = Readonly<{
  context: string;
  title: string;
  metadata?: ReactNode;
  headingId?: string;
  headingLevel?: 1 | 2;
  className?: string;
}>;

type TabCommandBarProps = Readonly<{
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}>;

type TabCommandGroupProps = Readonly<{
  kind: 'utility' | 'workflow';
  children: ReactNode;
  className?: string;
}>;

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function TabPageHeader({
  context,
  title,
  metadata,
  headingId,
  headingLevel = 2,
  className,
}: TabPageHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <header className={classes('tab-page-header', className)}>
      <div className="tab-page-header__identity">
        <div className="tab-page-header__context">{context}</div>
        <Heading id={headingId} className="tab-page-header__title">
          {title}
        </Heading>
      </div>
      {metadata ? <div className="tab-page-header__meta">{metadata}</div> : null}
    </header>
  );
}

export function TabCommandBar({ ariaLabel, children, className }: TabCommandBarProps) {
  return (
    <div className={classes('tab-command-bar', className)} role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function TabCommandGroup({ kind, children, className }: TabCommandGroupProps) {
  return (
    <div className={classes('tab-command-group', `tab-command-group--${kind}`, className)}>
      {children}
    </div>
  );
}
