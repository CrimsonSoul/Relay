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

  const tryIPLocation = async () => {
    try { const response = await fetch('https://ipapi.co/json/'); const data = await response.json();
      if (data.latitude && data.longitude) { const newLoc: Location = { latitude: data.latitude, longitude: data.longitude, name: `${data.city}, ${data.region_code} ${data.country_code}` };
        onLocationChange(newLoc); localStorage.setItem('weather_location', JSON.stringify(newLoc)); onManualRefresh(data.latitude, data.longitude); return true; }
    } catch (e) { console.error('[Weather] IP Location fallback failed:', e); }
    return false;
  };

  const handleAutoLocate = useCallback(async () => {
    setError(null); setPermissionDenied(false);
    if (!('geolocation' in navigator)) { await tryIPLocation(); return; }
    navigator.geolocation.getCurrentPosition(
      async (position) => { const { latitude, longitude } = position.coords; const name = await reverseGeocode(latitude, longitude);
        const newLoc: Location = { latitude, longitude, name }; onLocationChange(newLoc); localStorage.setItem('weather_location', JSON.stringify(newLoc)); onManualRefresh(latitude, longitude); },
      async (err) => { console.error('[Weather] Geolocation failed:', err.message); const ipSuccess = await tryIPLocation();
        if (!ipSuccess) { if (err.code === 1) { setPermissionDenied(true); setError('Location access was denied and fallback failed. Please search for your city manually.'); } else { setError('Could not detect location automatically. Please search for your city manually.'); } } },
      { timeout: 5000, maximumAge: 300000, enableHighAccuracy: false }
    );
  }, [onLocationChange, onManualRefresh]);

  useEffect(() => { if (!location && !loading && !autoLocateAttemptedRef.current) { autoLocateAttemptedRef.current = true; handleAutoLocate(); } }, [location, loading, handleAutoLocate]);

  const handleManualSearch = async () => {
    if (!manualInput.trim()) return; setError(null);
    try { const data = await window.api.searchLocation(manualInput);
      if (data.results?.[0]) { const { latitude, longitude, name, admin1, country_code } = data.results[0]; const label = `${name}, ${admin1 || ''} ${country_code}`.trim();
        const newLoc: Location = { latitude, longitude, name: label }; onLocationChange(newLoc); localStorage.setItem('weather_location', JSON.stringify(newLoc)); onManualRefresh(latitude, longitude); setManualInput('');
      } else { setError('Location not found. Try a different search term.'); }
    } catch (err: any) { setError(err.message || 'Search failed'); }
  };

  return { manualInput, setManualInput, error, permissionDenied, handleAutoLocate, handleManualSearch };
}
