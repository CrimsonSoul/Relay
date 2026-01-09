import React, { useState } from "react";
import { TabFallback } from "../components/TabFallback";
import { CollapsibleHeader } from "../components/CollapsibleHeader";
import { TactileButton } from "../components/TactileButton";
import { SearchInput } from "../components/SearchInput";
import { WeatherAlertCard, HourlyForecast, DailyForecast, RadarPanel, getWeatherDescription, type WeatherTabProps } from "./weather";
import { useWeatherLocation } from "../hooks/useWeatherLocation";

export const WeatherTab: React.FC<WeatherTabProps> = ({ weather, alerts, location, loading, onLocationChange, onManualRefresh }) => {
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const loc = useWeatherLocation(location, loading, onLocationChange, onManualRefresh);

  if (!location && loading) return <TabFallback />;

  return (
    <div className="weather-scroll-container" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "var(--color-bg-app)", padding: "20px 24px", gap: "12px", overflow: "hidden" }}>
      <CollapsibleHeader title={location?.name || "Weather"} subtitle={weather ? `${Math.round(weather.current_weather.temperature)}°F • ${getWeatherDescription(weather.current_weather.weathercode)}` : "Local weather conditions and alerts"} isCollapsed={false}
        search={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loc.error && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 16px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#ff8a8a", borderRadius: "16px", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", height: "44px", animation: "fadeIn 0.2s ease-out", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <span>Location not found</span>
              </div>
            )}
            <SearchInput style={{ height: "44px" }} placeholder="Search city..." value={loc.manualInput} onChange={(e) => loc.setManualInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loc.handleManualSearch()} />
          </div>
        }
      >
        <TactileButton onClick={loc.handleManualSearch} variant="primary" title="Search" style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>} />
        <TactileButton onClick={() => onManualRefresh(location?.latitude || 0, location?.longitude || 0)} title="Refresh" style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>} />
      </CollapsibleHeader>

      <div className="weather-tab-root weather-scroll-container" style={{ display: "flex", gap: "16px", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div className="weather-forecast-column weather-scroll-container" style={{ display: "flex", flexDirection: "column", gap: "16px", flex: "0 0 35%", minWidth: "300px", overflowY: "auto" }}>
          {alerts.length > 0 && alerts.map((alert) => <WeatherAlertCard key={alert.id} alert={alert} isExpanded={expandedAlert === alert.id} onToggle={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)} />)}
          <HourlyForecast weather={weather} />
          <DailyForecast weather={weather} />
        </div>
        <RadarPanel location={location} />
      </div>
    </div>
  );
};
