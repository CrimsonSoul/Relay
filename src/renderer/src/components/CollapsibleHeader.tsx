import React, { useState, useEffect, useRef, ReactNode, RefObject } from 'react';

interface CollapsibleHeaderProps {
    title: string;
    subtitle?: ReactNode;
    children?: ReactNode; // Toolbar buttons
    search?: ReactNode; // Integrated search bar
    isCollapsed?: boolean; // Allow external control
    onCollapsedChange?: (collapsed: boolean) => void;
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
}) => {
    return (
        <div
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: isCollapsed ? 'center' : 'flex-end',
                marginBottom: isCollapsed ? '8px' : '16px',
                gap: '12px',
                flexWrap: 'wrap',
                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                flexShrink: 0,
            }}
        >
            <div style={{ minWidth: '200px', flex: 1 }}>
                <h1
                    style={{
                        fontSize: isCollapsed ? '32px' : '40px',
                        fontWeight: 800,
                        margin: 0,
                        color: 'var(--color-text-primary)',
                        transition: 'font-size 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        willChange: 'font-size',
                    }}
                >
                    {title}
                </h1>
                <div
                    style={{
                        fontSize: '18px',
                        color: 'var(--color-text-tertiary)',
                        margin: isCollapsed ? '0' : '10px 0 0 0',
                        fontWeight: 500,
                        maxHeight: isCollapsed ? '0px' : '50px',
                        opacity: isCollapsed ? 0 : 1,
                        overflow: 'hidden',
                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        display: 'flex',
                        alignItems: 'center',
                        willChange: 'opacity, max-height',
                    }}
                >
                    {subtitle}
                </div>
            </div>

            {(search || children) && (
                <div
                    style={{
                        display: 'flex',
                        gap: isCollapsed ? '12px' : '16px', // Reduced from 24px for tighter cohesion
                        alignItems: 'center',
                        flex: '0 1 auto',
                        justifyContent: 'flex-end',
                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                >
                    {search && (
                        <div style={{ 
                            flex: '0 1 420px',
                            minWidth: '180px',
                            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}>
                            {search}
                        </div>
                    )}
                    {children && (
                        <div style={{
                            display: 'flex',
                            gap: isCollapsed ? '8px' : '12px', // Increased from 8px for better touch targets
                            alignItems: 'center',
                        }}>
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

/**
 * Hook for react-window lists that don't use a native scroll container.
 * Pass the outerRef from react-window's List component.
 */
export function useCollapsibleHeaderForList(scrollThreshold = 50) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const listOuterRef = useRef<HTMLDivElement>(null);

    const handleScroll = ({ scrollOffset }: { scrollOffset: number }) => {
        setIsCollapsed(scrollOffset > scrollThreshold);
    };

    return { isCollapsed, listOuterRef, onScroll: handleScroll };
}
