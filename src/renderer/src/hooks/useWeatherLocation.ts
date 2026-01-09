import { useState, useEffect, useCallback, useRef } from 'react';
import type { Location } from '../tabs/weather/types';

export function useWeatherLocation(location: Location | null, loading: boolean, onLocationChange: (loc: Location) => void, onManualRefresh: (lat: number, lon: number) => void) {
  const [manualInput, setManualInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const autoLocateAttemptedRef = useRef(false);

  const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    try { const data = await window.api.searchLocation(`${lat},${lon}`); if (data.results?.[0]) { const { name, admin1, country_code } = data.results[0]; return `${name}, ${admin1 || ''} ${country_code}`.trim(); } } catch {}
    return 'Current Location';
  };

  const handleAutoLocate = useCallback(async () => {
    setError(null); setPermissionDenied(false);
    if (!('geolocation' in navigator)) { setError('Auto-location not supported by this browser.'); return; }
    navigator.geolocation.getCurrentPosition(
      async (position) => { 
        const { latitude, longitude } = position.coords; 
        const lat = Number(latitude.toFixed(4));
        const lon = Number(longitude.toFixed(4));
        const name = await reverseGeocode(lat, lon);
        const newLoc: Location = { latitude: lat, longitude: lon, name }; 
        onLocationChange(newLoc); 
        onManualRefresh(lat, lon); 
      },
      async (err) => { 
        console.error('[Weather] Geolocation failed:', err.message); 
        if (err.code === 1) { setPermissionDenied(true); setError('Location access was denied. Please search for your city manually.'); } 
        else { setError('Could not detect location automatically. Please search for your city manually.'); } 
      },
      { timeout: 5000, maximumAge: 300000, enableHighAccuracy: false }
    );
  }, [onLocationChange, onManualRefresh]);

  useEffect(() => { if (!location && !loading && !autoLocateAttemptedRef.current) { autoLocateAttemptedRef.current = true; handleAutoLocate(); } }, [location, loading, handleAutoLocate]);

  const handleManualSearch = async () => {
    if (!manualInput.trim()) return; setError(null);
    try { const data = await window.api.searchLocation(manualInput);
      if (data.results?.[0]) { const { latitude, longitude, name, admin1, country_code } = data.results[0]; const label = `${name}, ${admin1 || ''} ${country_code}`.trim();
        const newLoc: Location = { latitude: Number(latitude.toFixed(4)), longitude: Number(longitude.toFixed(4)), name: label }; onLocationChange(newLoc); onManualRefresh(newLoc.latitude, newLoc.longitude); setManualInput('');
      } else { setError('Location not found. Try a different search term.'); }
    } catch (err: any) { setError(err.message || 'Search failed'); }
  };

  return { manualInput, setManualInput, error, permissionDenied, handleAutoLocate, handleManualSearch };
}
