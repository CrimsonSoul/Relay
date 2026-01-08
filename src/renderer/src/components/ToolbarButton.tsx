import React, { useState, ReactNode } from 'react';
import { TactileButton } from './TactileButton';
import { Tooltip } from './Tooltip';

type Props = {
    label?: string;
    icon?: ReactNode;
    onClick: () => void;
    primary?: boolean;
    active?: boolean;
    successLabel?: string;
    children?: ReactNode;
    style?: React.CSSProperties;
    disabled?: boolean;
    tooltip?: string;
};

export const ToolbarButton = ({ onClick, label, icon, primary = false, active = false, successLabel, children, style, disabled, tooltip }: Props) => {
    const [isSuccess, setIsSuccess] = useState(false);

    const handleClick = () => {
        if (disabled) return;
        onClick();
        if (successLabel) {
            setIsSuccess(true);
            setTimeout(() => setIsSuccess(false), 2000);
        }
    };

    const content = children || label;
    const showSuccess = isSuccess && successLabel;

    const button = (
        <TactileButton
            onClick={handleClick}
            variant={primary ? 'primary' : 'secondary'}
            active={active}
            disabled={disabled}
            style={style}
            className={showSuccess ? 'toolbar-btn-success' : ''}
            icon={!showSuccess ? icon : undefined}
        >
            {showSuccess ? (
                <span className="animate-scale-in" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>✓</span>
                    {successLabel}
                </span>
            ) : content}
            {showSuccess && (
                <style>{`
                    .toolbar-btn-success {
                        background: linear-gradient(135deg, var(--color-accent-green) 0%, #059669 100%) !important;
                        border-color: var(--color-accent-green) !important;
                        color: white !important;
                        box-shadow: 0 0 20px rgba(16, 185, 129, 0.3) !important;
                    }
                `}</style>
            )}
        </TactileButton>
    );

    if (tooltip && !showSuccess) {
        return <Tooltip content={tooltip}>{button}</Tooltip>;
    }

    return button;
}
