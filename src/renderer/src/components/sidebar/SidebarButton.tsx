import React, { useState } from "react";
import { Tooltip } from "../Tooltip";

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export const SidebarButton: React.FC<SidebarButtonProps> = ({
  icon,
  label,
  isActive,
  onClick,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Tooltip content={label} position="right">
      <button
        aria-label={label}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "40px",
          height: "40px",
          background: isActive
            ? "var(--color-accent-blue)"
            : isHovered
              ? "var(--color-accent-blue)"
              : "rgba(255, 255, 255, 0.03)",
          border: "none",
          cursor: "pointer",
          position: "relative",
          color: isActive || isHovered ? "white" : "var(--color-text-tertiary)",
          transition: "all var(--transition-smooth)",
          borderRadius: "20px",
          outline: "none",
          transform: isHovered
            ? isActive
              ? "scale(1.05)"
              : "translateY(-1px) scale(1.05)"
            : "scale(1)",
          boxShadow: isHovered ? "0 4px 12px rgba(0, 0, 0, 0.2)" : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all var(--transition-smooth)",
            filter: isActive || isHovered ? "grayscale(0) opacity(1)" : "grayscale(1) opacity(0.85)",
          }}
        >
          {icon}
        </div>

        {isActive && (
          <div
            style={{
              position: "absolute",
              left: "-12px",
              top: "50%",
              transform: "translateY(-50%)",
              height: "24px",
              width: "4px",
              background: "white",
              borderRadius: "0 4px 4px 0",
              boxShadow: "0 0 10px rgba(255, 255, 255, 0.5)",
            }}
          />
        )}
      </button>
    </Tooltip>
  );
};
