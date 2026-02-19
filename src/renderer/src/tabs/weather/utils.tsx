export const getRadarUrl = (lat: number, lon: number): string => {
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (Number.isNaN(nLat) || Number.isNaN(nLon)) return '';
  return `https://www.rainviewer.com/map.html?loc=${nLat.toFixed(4)},${nLon.toFixed(4)},6&theme=dark&color=1&opacity=0.7`;
};

export { getWeatherIcon } from './WeatherIcons';

const WMO_CODES: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Foggy',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Rainy',
  63: 'Rainy',
  65: 'Rainy',
  66: 'Freezing Rain',
  67: 'Freezing Rain',
  71: 'Snowy',
  73: 'Snowy',
  75: 'Snowy',
  77: 'Snow Grains',
  80: 'Rain Showers',
  81: 'Rain Showers',
  82: 'Rain Showers',
  85: 'Snow Showers',
  86: 'Snow Showers',
  95: 'Thunderstorm',
};

export const getWeatherDescription = (code: number): string => {
  return WMO_CODES[code] || 'Cloudy';
};

export const getWeatherOffsetMs = (weather?: {
  utc_offset_seconds?: number;
  timezone?: string;
}): number => {
  if (!weather) return 0;
  if (typeof weather.utc_offset_seconds === 'number') {
    return weather.utc_offset_seconds * 1000;
  }
  if (weather.timezone) {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: weather.timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(now);
      const lookup = Object.fromEntries(
        parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
      );
      const tzMs = Date.UTC(
        Number(lookup.year),
        Number(lookup.month) - 1,
        Number(lookup.day),
        Number(lookup.hour),
        Number(lookup.minute),
        Number(lookup.second),
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
  body { position: relative !important; font-family: 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif !important; }

  /* Map fills entire frame */
  #map, #map-container, .map-container, .maplibregl-map, .maplibregl-canvas-container, .maplibregl-canvas {
    left: 0 !important; top: 0 !important; right: 0 !important; bottom: 0 !important;
    width: 100% !important; height: 100% !important; position: absolute !important;
  }

  /* Control container reset */
  .map-controls-left, .map-panel-left, #map-controls, .map-controls {
    position: absolute !important; left: 12px !important; top: 12px !important;
    background: transparent !important; box-shadow: none !important; border: none !important;
    padding: 0 !important; margin: 0 !important; z-index: 70 !important;
    display: flex !important; flex-direction: column !important; gap: 8px !important;
  }
  .left-panel, .side-panel, .sidebar {
    background: transparent !important; box-shadow: none !important;
    border: none !important; padding: 0 !important; margin: 0 !important;
  }

  /* Play/timeline bar — solid dark surface, matching app overlay controls */
  .map-buttons-play {
    background: #0c0e12 !important;
    backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
    padding: 6px 10px !important; border-radius: 10px !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    display: inline-flex !important; align-items: center !important; gap: 8px !important;
    box-shadow: none !important; width: max-content !important; max-width: 90% !important;
    transition: border-color 0.2s ease !important;
  }
  .map-buttons-play:hover { border-color: rgba(255, 255, 255, 0.12) !important; }
  .map-buttons-play .live, .map-buttons-play [class*="live"], .map-buttons-play [id*="live"] { display: none !important; }
  .forecast-period {
    color: rgba(255, 255, 255, 0.7) !important; font-weight: 500 !important;
    font-size: 12px !important; margin-right: 2px !important;
    text-shadow: none !important; font-family: inherit !important;
  }
  .map-buttons-play svg {
    fill: rgba(255, 255, 255, 0.7) !important; width: 16px !important; height: 16px !important;
    filter: none !important; transition: fill 0.15s ease !important;
  }
  .map-buttons-play svg:hover { fill: #ffffff !important; }
  .map-buttons-play button, .map-buttons-play a {
    background: transparent !important; border: none !important; cursor: pointer !important;
    padding: 4px !important; border-radius: 6px !important; transition: background 0.15s ease !important;
  }
  .map-buttons-play button:hover, .map-buttons-play a:hover { background: rgba(255, 255, 255, 0.06) !important; }

  /* Hide zoom buttons */
  .map-buttons-zoom-in-out, .map-button-zoom-in, .map-button-zoom-out { display: none !important; }

  /* Bottom menu bar — same solid dark surface */
  #menu-bar {
    top: auto !important; bottom: 12px !important; left: 12px !important;
    right: auto !important; width: auto !important;
    background: #0c0e12 !important; border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 10px !important; box-shadow: none !important;
    padding: 4px !important; display: flex !important; gap: 2px !important;
  }
  #menu-bar button, #menu-bar a, #menu-bar .menu-item {
    background: transparent !important; border: none !important; border-radius: 6px !important;
    padding: 6px 8px !important; color: rgba(255, 255, 255, 0.7) !important;
    font-size: 12px !important; font-family: inherit !important; cursor: pointer !important;
    transition: background 0.15s ease, color 0.15s ease !important;
  }
  #menu-bar button:hover, #menu-bar a:hover, #menu-bar .menu-item:hover {
    background: rgba(255, 255, 255, 0.06) !important; color: #ffffff !important;
  }
  #menu-bar svg { fill: rgba(255, 255, 255, 0.7) !important; width: 14px !important; height: 14px !important; }

  /* Hide branding/search elements */
  #app-icon, .get-the-app, #app-icon .small-hide { display: none !important; }
  .map-link, .map-link.small-hide, #search-icon, .search-box, .maplibregl-ctrl-logo { display: none !important; }

  /* MapLibre attribution — match overlay style */
  .maplibregl-ctrl-attrib {
    background: #0c0e12 !important; border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 8px !important; padding: 4px 8px !important;
    font-size: 10px !important; color: rgba(255, 255, 255, 0.4) !important;
  }
  .maplibregl-ctrl-attrib a { color: rgba(255, 255, 255, 0.5) !important; }
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
  const menu = document.getElementById('menu-bar');
  if (menu) { menu.style.top = 'auto'; menu.style.bottom = '12px'; menu.style.left = '12px'; menu.style.right = 'auto'; menu.style.width = 'auto'; }
  const play = document.querySelector('.map-buttons-play');
  if (play) {
    play.querySelectorAll('*').forEach((el) => {
      if (el.textContent && el.textContent.trim().toUpperCase() === 'LIVE') {
        (el as HTMLElement).style.display = 'none';
      }
    });
  }
`;

export const SEVERITY_COLORS: Record<
  string,
  { bg: string; border: string; text: string; icon: string }
> = {
  Extreme: {
    bg: 'rgba(220, 38, 38, 0.15)',
    border: 'rgba(220, 38, 38, 0.5)',
    text: '#FCA5A5',
    icon: '#EF4444',
  },
  Severe: {
    bg: 'rgba(234, 88, 12, 0.15)',
    border: 'rgba(234, 88, 12, 0.5)',
    text: '#FDBA74',
    icon: '#F97316',
  },
  Moderate: {
    bg: 'rgba(234, 179, 8, 0.15)',
    border: 'rgba(234, 179, 8, 0.5)',
    text: '#FDE047',
    icon: '#EAB308',
  },
  Minor: {
    bg: 'rgba(6, 182, 212, 0.15)',
    border: 'rgba(6, 182, 212, 0.5)',
    text: '#67E8F9',
    icon: '#06B6D4',
  },
  Unknown: {
    bg: 'rgba(107, 114, 128, 0.15)',
    border: 'rgba(107, 114, 128, 0.5)',
    text: '#9CA3AF',
    icon: '#6B7280',
  },
};
