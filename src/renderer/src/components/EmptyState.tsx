import { type ReactNode } from 'react';

type EmptyStateProps = Readonly<{
  title: string;
  /** A heading when the empty state stands in for a page section; plain text inside a list pane. */
  titleAs?: 'h2' | 'h3' | 'p';
  /** Optional neutral line glyph shown beside the copy; decorative, so hidden from AT. */
  glyph?: ReactNode;
  description?: ReactNode;
  /** Status or error lines that explain why the surface is empty. */
  notices?: ReactNode;
  /** One primary action (the real first step), then equal-weight secondaries. */
  actions?: ReactNode;
  /** Content after the actions, such as quick adds or other places to look. */
  children?: ReactNode;
  as?: 'div' | 'li' | 'section';
  className?: string;
}>;

/**
 * Relay's one empty-state composition: inline and left-aligned in the space the content would
 * fill, a neutral glyph beside the copy, then the next step. Never a centred card or icon tile.
 */
export function EmptyState({
  title,
  titleAs: Title = 'p',
  glyph,
  description,
  notices,
  actions,
  children,
  as: Root = 'div',
  className,
}: EmptyStateProps) {
  return (
    <Root className={className ? `empty-state ${className}` : 'empty-state'}>
      {glyph && (
        <span className="empty-state__glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      <div className="empty-state__body">
        <Title className="empty-state__title">{title}</Title>
        {description && <p className="empty-state__description">{description}</p>}
        {notices}
        {actions && <div className="empty-state__actions">{actions}</div>}
        {children}
      </div>
    </Root>
  );
}
