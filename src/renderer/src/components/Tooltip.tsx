import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  width?: string;
  block?: boolean;
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  width = 'max-content',
  block = false,
  delay = 0,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const target = triggerRef.current.firstElementChild || triggerRef.current;
      const rect = target.getBoundingClientRect();
      const scrollY = globalThis.scrollY;
      const scrollX = globalThis.scrollX;

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
      case 'bottom':
        return 'translate(-50%, 0)';
      case 'left':
        return 'translate(-100%, -50%)';
      case 'right':
        return 'translate(0, -50%)';
      case 'top':
      default:
        return 'translate(-50%, -100%)';
    }
  };

  const handleMouseEnter = () => {
    if (delay > 0) {
      timerRef.current = setTimeout(() => setIsVisible(true), delay);
    } else {
      setIsVisible(true);
    }
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsVisible(false);
  };

  const trigger = React.cloneElement(children, {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onFocus: handleMouseEnter,
    onBlur: handleMouseLeave,
  });

  return (
    <>
      <span ref={triggerRef} className={`tooltip-trigger${block ? ' tooltip-trigger--block' : ''}`}>
        {trigger}
      </span>
      {isVisible &&
        content &&
        createPortal(
          <div
            className="tooltip-popup"
            style={{
              top: coords.top,
              left: coords.left,
              transform: getTransform(),
              width,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
};
