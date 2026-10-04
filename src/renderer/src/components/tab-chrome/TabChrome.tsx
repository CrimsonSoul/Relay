import type { ReactNode } from 'react';
import { TactileButtonSizeContext } from '../TactileButton';

type TabPageHeaderProps = Readonly<{
  /** The destination's one name: the nav label (or Knowledge sub-destination) in Title Case. */
  title: string;
  /** Quiet qualifier beside the title (source or scope), never a second name for the page. */
  subtitle?: string;
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
  title,
  subtitle,
  metadata,
  headingId,
  headingLevel = 2,
  className,
}: TabPageHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <header className={classes('tab-page-header', className)}>
      <div className="tab-page-header__identity">
        <Heading id={headingId} className="tab-page-header__title">
          {title}
        </Heading>
        {subtitle ? <p className="tab-page-header__subtitle">{subtitle}</p> : null}
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

/** Utility commands use the 36 px `sm` button; workflow commands use the 40 px `md` button. */
export function TabCommandGroup({ kind, children, className }: TabCommandGroupProps) {
  return (
    <div className={classes('tab-command-group', `tab-command-group--${kind}`, className)}>
      <TactileButtonSizeContext.Provider value={kind === 'utility' ? 'sm' : 'md'}>
        {children}
      </TactileButtonSizeContext.Provider>
    </div>
  );
}
