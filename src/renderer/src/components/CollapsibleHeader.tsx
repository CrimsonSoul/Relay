import React, { useState, useEffect, useRef, ReactNode } from 'react';

interface CollapsibleHeaderProps {
  title?: string;
  subtitle?: ReactNode;
  children?: ReactNode; // Toolbar buttons
  isCollapsed?: boolean; // Allow external control
  style?: React.CSSProperties;
}

/**
 * A header component that can collapse to a compact form.
 * Use with useCollapsibleHeader hook to detect scroll position.
 */
export const CollapsibleHeader: React.FC<CollapsibleHeaderProps> = ({
  title,
  subtitle,
  children,
  isCollapsed = false,
  style,
}) => {
  return (
    <div
      className={`collapsible-header ${isCollapsed ? 'collapsible-header--collapsed' : 'collapsible-header--expanded'}`}
      style={style}
    >
      {(title || subtitle) && (
        <div className="collapsible-header-left">
          {title && <h1 className="collapsible-header-title">{title}</h1>}
          {subtitle && (
            <div
              className={`collapsible-header-subtitle ${isCollapsed ? 'collapsible-header-subtitle--collapsed' : 'collapsible-header-subtitle--expanded'}`}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}

      {children && (
        <div
          className={`collapsible-header-right ${isCollapsed ? 'collapsible-header-right--collapsed' : 'collapsible-header-right--expanded'}`}
        >
          <div
            className={`collapsible-header-actions ${isCollapsed ? 'collapsible-header-actions--collapsed' : 'collapsible-header-actions--expanded'}`}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Hook to detect scroll and control header collapse state.
 * @param scrollThreshold - Amount of scroll (px) before collapsing. Default 50.
 */
export function useCollapsibleHeader(scrollThreshold = 50) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      setIsCollapsed(scrollTop > scrollThreshold);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollThreshold]);

  return { isCollapsed, scrollContainerRef };
}
