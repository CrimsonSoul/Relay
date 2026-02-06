export const getRadarUrl = (lat: number, lon: number): string => {
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (Number.isNaN(nLat) || Number.isNaN(nLon)) return "";
  return `https://www.rainviewer.com/map.html?loc=${nLat.toFixed(4)},${nLon.toFixed(4)},6&theme=dark&color=1&opacity=0.7`;
};

export { getWeatherIcon } from "./WeatherIcons";

const WMO_CODES: Record<number, string> = {
  0: "Clear Sky",
  1: "Mainly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy",
  51: "Drizzle",
  53: "Drizzle",
  55: "Drizzle",
  61: "Rainy",
  63: "Rainy",
  65: "Rainy",
  66: "Freezing Rain",
  67: "Freezing Rain",
  71: "Snowy",
  73: "Snowy",
  75: "Snowy",
  77: "Snow Grains",
  80: "Rain Showers",
  81: "Rain Showers",
  82: "Rain Showers",
  85: "Snow Showers",
  86: "Snow Showers",
  95: "Thunderstorm"
};

export const getWeatherDescription = (code: number): string => {
  return WMO_CODES[code] || "Cloudy";
};

export const getWeatherOffsetMs = (weather?: { utc_offset_seconds?: number; timezone?: string }): number => {
  if (!weather) return 0;
  if (typeof weather.utc_offset_seconds === "number") {
    return weather.utc_offset_seconds * 1000;
  }
  if (weather.timezone) {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: weather.timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).formatToParts(now);
      const lookup = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
      const tzMs = Date.UTC(
        Number(lookup.year),
        Number(lookup.month) - 1,
        Number(lookup.day),
        Number(lookup.hour),
        Number(lookup.minute),
        Number(lookup.second)
      );
      return tzMs - now.getTime();
    } catch {
      return 0;
    }
  }
  return 0;
};

export const RADAR_INJECT_CSS = `
  html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; height: 100% !important; }
  body { position: relative !important; }
  #map, #map-container, .map-container, .maplibregl-map, .maplibregl-canvas-container, .maplibregl-canvas {
    left: 0 !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: 100% !important;
    position: absolute !important;
  }
  .map-controls-left, .map-panel-left, #map-controls, .map-controls { position: absolute !important; left: 12px !important; top: 12px !important; background: transparent !important; box-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important; z-index: 70 !important; display: flex !important; flex-direction: column !important; gap: 8px !important; }
  .left-panel, .side-panel, .sidebar { background: transparent !important; box-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important; }
  .map-buttons-play { background: rgba(0, 0, 0, 0.65) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; padding: 6px 14px !important; border-radius: 12px !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; display: inline-flex !important; align-items: center !important; gap: 10px !important; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35) !important; width: max-content !important; max-width: 90% !important; }
  .map-buttons-play .live, .map-buttons-play [class*="live"], .map-buttons-play [id*="live"] { display: none !important; }
  .forecast-period { color: #ffffff !important; font-weight: 600 !important; font-size: 13px !important; margin-right: 4px !important; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5) !important; }
  .map-buttons-play svg { fill: #ffffff !important; width: 18px !important; height: 18px !important; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5)) !important; }
  .map-buttons-zoom-in-out, .map-button-zoom-in, .map-button-zoom-out { display: none !important; }
  #menu-bar { top: auto !important; bottom: 8px !important; left: 8px !important; right: auto !important; width: auto !important; background: transparent !important; border: none !important; box-shadow: none !important; }
  #app-icon, .get-the-app { display: none !important; }
  #app-icon .small-hide { display: none !important; }
  .map-link, .map-link.small-hide, #search-icon, .search-box, .maplibregl-ctrl-logo { display: none !important; }
`;

export const RADAR_INJECT_JS = `
  const selectorsToRemove = [
    '#app-icon',
    '.get-the-app',
    '.map-link',
    '.map-link.small-hide',
    '#search-icon',
    '.search-box',
    '.maplibregl-ctrl-logo'
  ];
  selectorsToRemove.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.parentElement?.removeChild(el);
    });
  });
  const menu = document.getElementById('menu-bar'); if (menu) { menu.style.top = 'auto'; menu.style.bottom = '8px'; menu.style.left = '8px'; menu.style.right = 'auto'; menu.style.width = 'auto'; }
  const play = document.querySelector('.map-buttons-play');
  if (play) {
    play.querySelectorAll('*').forEach((el) => {
      if (el.textContent && el.textContent.trim().toUpperCase() === 'LIVE') {
        (el as HTMLElement).style.display = 'none';
      }
    });
  }
`;

export const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  Extreme: { bg: "rgba(220, 38, 38, 0.15)", border: "rgba(220, 38, 38, 0.5)", text: "#FCA5A5", icon: "#EF4444" },
  Severe: { bg: "rgba(234, 88, 12, 0.15)", border: "rgba(234, 88, 12, 0.5)", text: "#FDBA74", icon: "#F97316" },
  Moderate: { bg: "rgba(234, 179, 8, 0.15)", border: "rgba(234, 179, 8, 0.5)", text: "#FDE047", icon: "#EAB308" },
  Minor: { bg: "rgba(59, 130, 246, 0.15)", border: "rgba(59, 130, 246, 0.5)", text: "#93C5FD", icon: "#3B82F6" },
  Unknown: { bg: "rgba(107, 114, 128, 0.15)", border: "rgba(107, 114, 128, 0.5)", text: "#9CA3AF", icon: "#6B7280" },
};
