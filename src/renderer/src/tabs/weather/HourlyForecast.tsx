import React, { useMemo } from 'react';
import type { WeatherData } from './types';
import { Tooltip } from '../../components/Tooltip';
import { getWeatherIcon, getWeatherDescription, getWeatherOffsetMs } from './utils';

interface HourlyForecastProps {
  weather: WeatherData | null;
}

export const HourlyForecast: React.FC<HourlyForecastProps> = ({ weather }) => {
  // Filter hourly forecast to only show future hours
  const hourlyState = useMemo(() => {
    if (!weather) {
      return { items: [], startIndex: 0 };
    }

    const times = weather.hourly.time || [];
    if (times.length === 0) {
      return { items: [], startIndex: 0 };
    }

    const offsetMs = getWeatherOffsetMs(weather);
    const locationNow = new Date(Date.now() + offsetMs);
    const locationKey = `${locationNow.getUTCFullYear()}-${String(locationNow.getUTCMonth() + 1).padStart(2, '0')}-${String(locationNow.getUTCDate()).padStart(2, '0')}T${String(locationNow.getUTCHours()).padStart(2, '0')}:00`;
    const utcNow = new Date();
    const utcKey = `${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}-${String(utcNow.getUTCDate()).padStart(2, '0')}T${String(utcNow.getUTCHours()).padStart(2, '0')}:00`;

    let startIndex = times.indexOf(locationKey);
    if (startIndex === -1) {
      startIndex = times.indexOf(utcKey);
    }
    if (startIndex === -1) {
      startIndex = times.findIndex((t) => t > locationKey);
    }
    if (startIndex === -1) {
      startIndex = 0;
    }

    const items = times.slice(startIndex, startIndex + 12).map((t, offset) => {
      const index = startIndex + offset;
      return {
        time: t,
        temp: weather.hourly.temperature_2m[index] ?? 0,
        code: weather.hourly.weathercode[index] ?? 0,
        precip: weather.hourly.precipitation_probability[index] ?? 0,
        index,
        isNow: index === startIndex,
      };
    });

    return { items, startIndex };
  }, [weather]);

  if (!weather) return null;

  return (
    <div className="hourly-forecast">
      <h3 className="hourly-forecast-title">Hourly Forecast</h3>
      <ul
        className="hourly-forecast-list weather-scroll-container"
        onWheel={(e) => {
          const container = e.currentTarget;
          const hasHorizontalScroll = container.scrollWidth > container.clientWidth;

          if (hasHorizontalScroll) {
            const scrollAmount = e.deltaX === 0 ? e.deltaY : e.deltaX;

            if (scrollAmount !== 0) {
              e.preventDefault();
              container.scrollLeft += scrollAmount;
            }
          }
        }}
      >
        {hourlyState.items.map((item) => {
          const timePart = item.time.split('T')[1] || '00:00';
          const hourStr = timePart.split(':')[0] || '0';
          const hours = Number(hourStr);
          const displayHour = hours % 12 || 12;
          const suffix = hours >= 12 ? 'PM' : 'AM';
          const hourLabel = `${displayHour} ${suffix}`;
          const isNow = item.isNow;
          const timeLabel = isNow ? 'Current hour' : hourLabel;
          const precipLabel =
            item.precip > 0
              ? `${item.precip}% chance of precipitation`
              : 'no precipitation expected';
          const ariaLabel = `${timeLabel}, ${Math.round(item.temp)} degrees, ${precipLabel}`;
          return (
            <li
              key={item.time}
              aria-label={ariaLabel}
              className={`hourly-forecast-item${isNow ? ' hourly-forecast-item--now' : ''}`}
            >
              <span className="hourly-forecast-time">{isNow ? 'Now' : hourLabel}</span>
              <Tooltip content={getWeatherDescription(item.code)} position="top">
                <div className="hourly-forecast-icon">{getWeatherIcon(item.code, 18)}</div>
              </Tooltip>
              {item.precip > 0 ? (
                <div className="hourly-forecast-precip">{item.precip}%</div>
              ) : (
                <div className="hourly-forecast-precip-spacer" />
              )}
              <span className="hourly-forecast-temp">{Math.round(item.temp)}°</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
