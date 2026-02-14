import React, { useState, useEffect, useRef, ReactNode } from 'react';

interface CollapsibleHeaderProps {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode; // Toolbar buttons
  search?: ReactNode; // Integrated search bar
  isCollapsed?: boolean; // Allow external control
  style?: React.CSSProperties;
  expandedTitleSize?: string;
  collapsedTitleSize?: string;
}

/**
 * A header component that can collapse to a compact form.
 * Use with useCollapsibleHeader hook to detect scroll position.
 */
export const CollapsibleHeader: React.FC<CollapsibleHeaderProps> = ({
  title,
  subtitle,
  children,
  search,
  isCollapsed = false,
  style,
  expandedTitleSize = 'clamp(26px, 5vw, 40px)',
  collapsedTitleSize = 'clamp(20px, 4vw, 32px)',
}) => {
  return (
    <div
      className={`collapsible-header ${isCollapsed ? 'collapsible-header--collapsed' : 'collapsible-header--expanded'}`}
      style={style}
    >
      <div className="collapsible-header-left">
        <h1
          className="collapsible-header-title"
          style={{ fontSize: isCollapsed ? collapsedTitleSize : expandedTitleSize }}
        >
          {title}
        </h1>
        <div
          className={`collapsible-header-subtitle ${isCollapsed ? 'collapsible-header-subtitle--collapsed' : 'collapsible-header-subtitle--expanded'}`}
        >
          {subtitle}
        </div>
      </div>

      {(search || children) && (
        <div
          className={`collapsible-header-right ${isCollapsed ? 'collapsible-header-right--collapsed' : 'collapsible-header-right--expanded'}`}
        >
          {search && <div className="collapsible-header-search">{search}</div>}
          {children && (
            <div
              className={`collapsible-header-actions ${isCollapsed ? 'collapsible-header-actions--collapsed' : 'collapsible-header-actions--expanded'}`}
            >
              {children}
            </div>
          )}
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
