import React, { useState, ReactNode } from 'react';
import { TactileButton } from './TactileButton';

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
};

export const ToolbarButton = ({ onClick, label, icon, primary = false, active = false, successLabel, children, style, disabled }: Props) => {
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

    return (
        <TactileButton
            onClick={handleClick}
            variant={primary ? 'primary' : 'secondary'}
            active={active}
            disabled={disabled}
            style={style}
            // If showing success state, we might want to force a green style
            // But TactileButton doesn't support "success" variant yet.
            // For now, let's stick to standard variants, or perform a small override if needed.
            // Actually, the original design had a green gradient for success.
            // Let's implement a 'success' style override via style prop for now to match exactly what it was,
            // or better yet, verify if we can add a 'success' variant to TactileButton later?
            // For standardization, let's use 'primary' (blue) or 'danger' (red). 
            // If the user *really* wants green checks, we can assume 'primary' is clear enough or add a class.
            // However, to keep it "buttery", let's use the style override for the green success state if active.
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
    )
}
