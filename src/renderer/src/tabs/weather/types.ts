export type { WeatherAlert, WeatherData } from '@shared/ipc';
import type { WeatherAlert, WeatherData } from '@shared/ipc';

export interface Location {
  latitude: number;
  longitude: number;
  name?: string;
}

export interface WeatherTabProps {
  weather: WeatherData | null;
  alerts: WeatherAlert[];
  location: Location | null;
  loading: boolean;
  onLocationChange: (loc: Location) => void;
  onManualRefresh: (lat: number, lon: number) => void;
}
