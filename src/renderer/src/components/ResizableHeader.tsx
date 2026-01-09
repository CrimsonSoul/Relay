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

    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={`Sort by ${children}${sortDirection ? `, currently sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
            style={{
                width: width,
                flex: 'none',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                paddingRight: '16px' // Reserve space for resize handle
            }}
            onClick={onSort}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSort();
                }
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1
            }}>
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

            {/* Resize Handle Area - Enhanced */}
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize column"
                tabIndex={0}
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
                    transition: 'background var(--transition-fast)'
                }}
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsResizing(true);
                    startX.current = e.clientX;
                    startWidth.current = width;
                    document.body.style.cursor = 'col-resize';
                }}
                onKeyDown={(e) => {
                    // Allow keyboard-based resizing with arrow keys
                    if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        e.stopPropagation();
                        const newWidth = Math.max(minWidth, width - 10);
                        onResize(newWidth);
                    } else if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        e.stopPropagation();
                        onResize(width + 10);
                    }
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
        </div>
    );
};
