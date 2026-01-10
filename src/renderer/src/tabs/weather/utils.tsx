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

export const RADAR_INJECT_CSS = `
  .map-buttons-play { background: rgba(0, 0, 0, 0.6) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; padding: 6px 16px !important; border-radius: 30px !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; top: 12px !important; left: 12px !important; display: flex !important; align-items: center !important; gap: 12px !important; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3) !important; width: max-content !important; max-width: 90% !important; }
  .forecast-period { color: #ffffff !important; font-weight: 600 !important; font-size: 14px !important; margin-right: 4px !important; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5) !important; }
  .map-buttons-play svg { fill: #ffffff !important; width: 20px !important; height: 20px !important; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5)) !important; }
  .map-buttons-zoom-in-out { background: rgba(0, 0, 0, 0.6) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; padding: 4px !important; border-radius: 30px !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; right: 8px !important; bottom: 40px !important; display: flex !important; flex-direction: column !important; gap: 4px !important; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3) !important; }
  .map-button-zoom-in, .map-button-zoom-out { background: transparent !important; width: 32px !important; height: 32px !important; display: flex !important; align-items: center !important; justify-content: center !important; border: none !important; padding: 0 !important; }
  .map-button-zoom-in svg, .map-button-zoom-out svg { fill: #ffffff !important; width: 18px !important; height: 18px !important; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5)) !important; }
  #menu-bar { top: auto !important; bottom: 8px !important; left: 8px !important; right: auto !important; width: auto !important; background: transparent !important; border: none !important; box-shadow: none !important; }
  #app-icon, .get-the-app { display: none !important; }
  #app-icon .small-hide { display: none !important; }
  .map-link, .map-link.small-hide, #search-icon, .search-box, .maplibregl-ctrl-logo { display: none !important; }
`;

export const RADAR_INJECT_JS = `
  const menu = document.getElementById('menu-bar'); if (menu) { menu.style.top = 'auto'; menu.style.bottom = '8px'; menu.style.left = '8px'; menu.style.right = 'auto'; menu.style.width = 'auto'; }
  const play = document.querySelector('.map-buttons-play'); if (play) play.style.top = '8px';
  const zoom = document.querySelector('.map-buttons-zoom-in-out'); if (zoom) { zoom.style.right = '8px'; zoom.style.bottom = '40px'; }
  const iconWrap = document.querySelector('#app-icon .small-hide'); if (iconWrap) iconWrap.style.display = 'none';
`;

export const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  Extreme: { bg: "rgba(220, 38, 38, 0.15)", border: "rgba(220, 38, 38, 0.5)", text: "#FCA5A5", icon: "#EF4444" },
  Severe: { bg: "rgba(234, 88, 12, 0.15)", border: "rgba(234, 88, 12, 0.5)", text: "#FDBA74", icon: "#F97316" },
  Moderate: { bg: "rgba(234, 179, 8, 0.15)", border: "rgba(234, 179, 8, 0.5)", text: "#FDE047", icon: "#EAB308" },
  Minor: { bg: "rgba(59, 130, 246, 0.15)", border: "rgba(59, 130, 246, 0.5)", text: "#93C5FD", icon: "#3B82F6" },
  Unknown: { bg: "rgba(107, 114, 128, 0.15)", border: "rgba(107, 114, 128, 0.5)", text: "#9CA3AF", icon: "#6B7280" },
};
