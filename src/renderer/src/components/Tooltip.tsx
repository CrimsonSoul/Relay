import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactNode;
    position?: 'top' | 'bottom' | 'right' | 'left';
    width?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
    content,
    children,
    position = 'top',
    width = 'max-content'
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLDivElement>(null);

    const updateCoords = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            let top = 0;
            let left = 0;

            switch (position) {
                case 'bottom':
                    top = rect.bottom + window.scrollY;
                    left = rect.left + rect.width / 2 + window.scrollX;
                    break;
                case 'left':
                    top = rect.top + rect.height / 2 + window.scrollY;
                    left = rect.left + window.scrollX - 8;
                    break;
                case 'right':
                    top = rect.top + rect.height / 2 + window.scrollY;
                    left = rect.right + window.scrollX + 8;
                    break;
                case 'top':
                default:
                    top = rect.top + window.scrollY - 8;
                    left = rect.left + rect.width / 2 + window.scrollX;
                    break;
            }

            setCoords({ top, left });
        }
    };

    useEffect(() => {
        if (isVisible) {
            updateCoords();
            // Use ResizeObserver for more robust tracking if necessary, 
            // but for now scroll/resize icons should be enough
            window.addEventListener('scroll', updateCoords, true);
            window.addEventListener('resize', updateCoords);
        }
        return () => {
            window.removeEventListener('scroll', updateCoords, true);
            window.removeEventListener('resize', updateCoords);
        };
    }, [isVisible]);

    const getTransform = () => {
        switch (position) {
            case 'bottom': return 'translate(-50%, 0)';
            case 'left': return 'translate(-100%, -50%)';
            case 'right': return 'translate(0, -50%)';
            case 'top': default: return 'translate(-50%, -100%)';
        }
    };

    return (
        <>
            <div
                ref={triggerRef}
                style={{ display: 'inline-block' }}
                onMouseEnter={() => setIsVisible(true)}
                onMouseLeave={() => setIsVisible(false)}
            >
                {children}
            </div>
            {isVisible && content && createPortal(
                <div style={{
                    position: 'absolute', // absolute relative to document.body
                    top: coords.top,
                    left: coords.left,
                    transform: getTransform(),
                    background: 'rgba(15, 15, 15, 0.98)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: 'var(--color-text-primary)',
                    fontSize: '11px',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
                    zIndex: 100000,
                    pointerEvents: 'none',
                    width,
                    whiteSpace: 'nowrap',
                    animation: 'tooltipFadeIn 0.15s ease-out'
                }}>
                    <style>
                        {`
              @keyframes tooltipFadeIn {
                from { opacity: 0; transform: ${getTransform()} translateY(4px); }
                to { opacity: 1; transform: ${getTransform()} translateY(0); }
              }
            `}
                    </style>
                    {content}
                </div>,
                document.body
            )}
        </>
    );
};
