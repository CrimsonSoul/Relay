import React, { createContext, ReactNode, useContext } from 'react';
import { Tooltip } from './Tooltip';

/** The three button heights Relay allows: 28 px inline/in-row, 36 px compact, 40 px default. */
export type TactileButtonSize = 'xs' | 'sm' | 'md';

/**
 * Lets a container (for example a tab command group) choose the size of the buttons inside it.
 * An explicit `size` prop always wins.
 */
export const TactileButtonSizeContext = createContext<TactileButtonSize>('md');

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: TactileButtonSize;
  active?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
  tooltip?: ReactNode;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
};

export const TactileButton = React.forwardRef<HTMLButtonElement, Props>(function TactileButton(
  {
    children,
    variant = 'secondary',
    size,
    active = false,
    icon,
    loading = false,
    block = false,
    tooltip,
    tooltipPosition = 'top',
    className = '',
    style,
    disabled,
    title,
    ...props
  },
  ref,
) {
  const contextSize = useContext(TactileButtonSizeContext);
  const classes = [
    'tactile-button',
    `tactile-button--${variant}`,
    `tactile-button--${size ?? contextSize}`,
    active ? 'is-active' : '',
    loading ? 'is-loading' : '',
    block ? 'is-block' : '',
    !children && icon ? 'tactile-button--icon-only' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const isDisabled = disabled || loading;
  const ariaLabel = props['aria-label'];
  const isIconOnly = !children && icon;
  let inferredTooltip: string | undefined;
  if (isIconOnly && typeof ariaLabel === 'string') {
    inferredTooltip = ariaLabel;
  } else if (isIconOnly && typeof title === 'string') {
    inferredTooltip = title;
  }
  const tooltipContent = tooltip ?? inferredTooltip;
  // An icon-only button named only by `title` keeps that name once the Tooltip replaces it.
  const fallbackName = isIconOnly && typeof title === 'string' ? title : undefined;

  const button = (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      style={style}
      className={classes}
      disabled={isDisabled}
      // The Tooltip is the single hover label; a native title would stack a second one.
      title={tooltipContent ? undefined : title}
      aria-label={ariaLabel ?? fallbackName}
      {...props}
      aria-busy={loading || undefined}
    >
      {loading && (
        <span className="animate-spin tactile-button-spinner" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path
              d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"
              strokeOpacity={0.3}
            />
            <path d="M12 2v4" />
          </svg>
        </span>
      )}
      {!loading && icon && (
        <span className="tactile-button-icon" aria-hidden="true">
          {icon}
        </span>
      )}

      {children && <span className="tactile-button-label">{children}</span>}
    </button>
  );

  if (!tooltipContent) return button;

  return (
    <Tooltip content={tooltipContent} position={tooltipPosition}>
      {button}
    </Tooltip>
  );
});
