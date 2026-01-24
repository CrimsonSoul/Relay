import React, { useState } from "react";
import { SidebarButton } from "./sidebar/SidebarButton";
import {
  ComposeIcon,
  PersonnelIcon,
  AIIcon,
  PeopleIcon,
  ServersIcon,
  RadarIcon,
  WeatherIcon,
  SettingsIcon,
  AppIcon
} from "./sidebar/SidebarIcons";

type Tab = "Compose" | "Personnel" | "People" | "Reports" | "Radar" | "Servers" | "Weather" | "AI";

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onOpenSettings }) => {
  const isDarwin = window.api?.platform === "darwin";
  const [isIconHovered, setIsIconHovered] = useState(false);

  const navItems: { label: string; tab: Tab; icon: React.ReactNode }[] = [
    { label: "Compose", tab: "Compose", icon: <ComposeIcon /> },
    { label: "On-Call Board", tab: "Personnel", icon: <PersonnelIcon /> },
    { label: "AI Chat", tab: "AI", icon: <AIIcon /> },
    { label: "People", tab: "People", icon: <PeopleIcon /> },
    { label: "Servers", tab: "Servers", icon: <ServersIcon /> },
    { label: "Radar", tab: "Radar", icon: <RadarIcon /> },
    { label: "Weather", tab: "Weather", icon: <WeatherIcon /> },
  ];

  return (
    <div
      style={{
        width: isDarwin ? "72px" : "var(--sidebar-width-collapsed)",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: isDarwin ? "38px" : "15px",
        paddingBottom: "16px",
        gap: "12px",
        zIndex: 9002,
        WebkitAppRegion: "drag",
      }}
    >
      {/* App Icon */}
      <div
        onClick={() => onTabChange("Compose")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTabChange("Compose");
          }
        }}
        onMouseEnter={() => setIsIconHovered(true)}
        onMouseLeave={() => setIsIconHovered(false)}
        id="app-icon-container"
        className="interactive"
        role="button"
        tabIndex={0}
        aria-label="Go to Compose tab"
        style={{
          width: "40px",
          height: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isIconHovered ? "var(--color-accent-blue)" : "rgba(255, 255, 255, 0.03)",
          borderRadius: "20px",
          WebkitAppRegion: "no-drag",
          transition: "all var(--transition-smooth)",
          marginBottom: "4px",
          color: isIconHovered ? "white" : "var(--color-text-tertiary)",
          cursor: "pointer",
          transform: isIconHovered ? "translateY(-1px) scale(1.05)" : "scale(1)",
          boxShadow: isIconHovered ? "0 4px 12px rgba(0, 0, 0, 0.2)" : "none",
        }}
      >
        <div id="app-icon-inner" style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center",
          transition: "all var(--transition-smooth)",
          filter: isIconHovered ? "grayscale(0) opacity(1)" : "grayscale(1) opacity(0.85)",
        }}>
          <AppIcon />
        </div>
      </div>

      <div style={{ width: "32px", height: "2px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "1px", flexShrink: 0 }} />

      <nav style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", WebkitAppRegion: "no-drag" }}>
        {navItems.map((item) => (
          <SidebarButton
            key={item.tab}
            label={item.label}
            isActive={activeTab === item.tab}
            onClick={() => onTabChange(item.tab)}
            icon={item.icon}
          />
        ))}
      </nav>

      <div style={{ WebkitAppRegion: "no-drag", display: "flex", flexDirection: "column", gap: "12px" }}>
        <SidebarButton
          label="Settings"
          isActive={false}
          onClick={onOpenSettings}
          icon={<SettingsIcon />}
        />
      </div>
    </div>
  );
};
