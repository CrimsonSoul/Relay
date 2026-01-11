import React, { useState, useRef, useEffect } from 'react';

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
};

export const ResizableHeader = ({
    children,
    width,
    minWidth = 50,
    sortDirection,
    onResize,
    onSort
}: {
    children: React.ReactNode,
    width: number,
    minWidth?: number,
    sortDirection?: 'asc' | 'desc',
    onResize: (w: number) => void,
    onSort: () => void
}) => {
    const [isResizing, setIsResizing] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const startX = useRef(0);
    const startWidth = useRef(0);

    useEffect(() => {
        if (!isResizing) return;

        const onMouseMove = (e: MouseEvent) => {
            const diff = e.clientX - startX.current;
            const newWidth = Math.max(minWidth, startWidth.current + diff);
            onResize(newWidth);
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.body.style.cursor = 'default';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, [isResizing, minWidth, onResize]);

    const isSorted = !!sortDirection;

    // Create accessible label
    const columnName = typeof children === 'string' ? children : 'column';
    let sortLabel = `Sort by ${columnName}`;
    if (sortDirection) {
        const direction = sortDirection === 'asc' ? 'ascending' : 'descending';
        sortLabel += `, currently sorted ${direction}`;
    }

    return (
        <button
            type="button"
            aria-label={sortLabel}
            style={{
                width: width,
                flex: 'none',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                paddingRight: '16px', // Reserve space for resize handle
                background: 'transparent',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'inherit',
                textAlign: 'left'
            }}
            onClick={onSort}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <span className="text-truncate" style={{ flex: 1 }}>
                {children}
            </span>

            {isSorted && (
                <span style={{
                    fontSize: '10px',
                    color: 'var(--color-text-primary)',
                    flexShrink: 0,
                    marginRight: '2px'
                }}>
                    {sortDirection === 'asc' ? '▲' : '▼'}
                </span>
            )}

            {/* Resize Handle Area - Mouse-only interaction (standard for column resizing) */}
            <div
                data-resize-handle="true"
                style={{
                    position: 'absolute',
                    right: '-6px', // Center on the edge
                    top: 0,
                    bottom: 0,
                    width: '12px',
                    cursor: 'col-resize',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background var(--transition-fast)',
                    pointerEvents: 'auto'
                }}
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsResizing(true);
                    startX.current = e.clientX;
                    startWidth.current = width;
                    document.body.style.cursor = 'col-resize';
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                }}
                onMouseLeave={(e) => {
                    if (!isResizing) {
                        e.currentTarget.style.background = 'transparent';
                    }
                }}
            >
                {/* Visual Grabber - Refined Style */}
                <div style={{
                    width: '3px',
                    height: '16px',
                    background: (isHovered || isResizing)
                        ? 'linear-gradient(180deg, var(--color-accent-blue) 0%, var(--color-text-tertiary) 100%)'
                        : 'transparent',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all var(--transition-base)',
                    boxShadow: (isHovered || isResizing) ? '0 0 8px rgba(59, 130, 246, 0.3)' : 'none'
                }} />
            </div>
        </button>
    );
};
