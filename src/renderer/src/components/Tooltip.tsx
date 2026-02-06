import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    content: string;
    children: React.ReactElement;
    position?: 'top' | 'bottom' | 'left' | 'right';
    width?: string;
    block?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
    content,
    children,
    position = 'top',
    width = 'max-content',
    block = false
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isVisible && triggerRef.current) {
            const target = triggerRef.current.firstElementChild || triggerRef.current;
            const rect = target.getBoundingClientRect();
            const scrollY = window.scrollY;
            const scrollX = window.scrollX;

            let t = 0;
            let l = 0;

            switch (position) {
                case 'bottom':
                    t = rect.bottom + scrollY + 8;
                    l = rect.left + scrollX + rect.width / 2;
                    break;
                case 'left':
                    t = rect.top + scrollY + rect.height / 2;
                    l = rect.left + scrollX - 8;
                    break;
                case 'right':
                    t = rect.top + scrollY + rect.height / 2;
                    l = rect.right + scrollX + 8;
                    break;
                case 'top':
                default:
                    t = rect.top + scrollY - 8;
                    l = rect.left + scrollX + rect.width / 2;
                    break;
            }

            setCoords({ top: t, left: l });
        }
    }, [isVisible, position]);

    const getTransform = () => {
        switch (position) {
            case 'bottom': return 'translate(-50%, 0)';
            case 'left': return 'translate(-100%, -50%)';
            case 'right': return 'translate(0, -50%)';
            case 'top':
            default: return 'translate(-50%, -100%)';
        }
    };

    return (
        <>
            <div
                ref={triggerRef}
                onMouseEnter={() => setIsVisible(true)}
                onMouseLeave={() => setIsVisible(false)}
                style={{ display: block ? 'block' : 'inline-flex', minWidth: 0, width: block ? '100%' : 'auto' }}
            >
                {children}
            </div>
            {isVisible && content && createPortal(
                <div style={{
                    position: 'absolute',
                    top: coords.top,
                    left: coords.left,
                    transform: getTransform(),
                    background: 'var(--color-bg-chrome)',
                    backdropFilter: 'blur(12px)',
                    border: 'var(--border-medium)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: 'var(--color-text-primary)',
                    fontSize: '11px',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 10000,
                    pointerEvents: 'none',
                    width,
                    maxWidth: '320px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                }}>
                    {content}
                </div>,
                document.body
            )}
        </>
    );
};
