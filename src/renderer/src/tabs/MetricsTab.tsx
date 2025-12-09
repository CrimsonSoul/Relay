import React, { useEffect, useState } from 'react';
import { MetricsData } from '@shared/ipc';
import { getColorForString } from '../utils/colors';

export const MetricsTab: React.FC = () => {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      const data = await window.api?.getMetrics();
      if (data) setMetrics(data);
    };
    fetchMetrics();
    // Refresh periodically if needed, or just on mount
  }, []);

  const StatCard = ({ label, value }: { label: string; value: number }) => (
    <div style={{
      padding: '24px',
      borderRadius: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      background: 'rgba(255, 255, 255, 0.03)',
      border: 'var(--border-subtle)'
    }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: '32px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="glass-panel" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      borderRadius: '12px',
      overflow: 'hidden',
      background: 'var(--color-bg-card)',
      border: 'var(--border-subtle)'
    }}>
        {/* Header */}
        <div style={{
            padding: '16px 24px',
            borderBottom: 'var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
        }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Reports</h2>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                {metrics ? 'Data Loaded' : 'Loading...'}
            </div>
        </div>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
            {!metrics ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)' }}>
                    Loading metrics...
                </div>
            ) : (
                <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

                    {/* Stat Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
                        <StatCard label="Last 7 Days" value={metrics.bridgesLast7d} />
                        <StatCard label="Last 30 Days" value={metrics.bridgesLast30d} />
                        <StatCard label="Last 6 Months" value={metrics.bridgesLast6m} />
                        <StatCard label="Last Year" value={metrics.bridgesLast1y} />
                    </div>

                    {/* Top Groups */}
                    <div style={{
                        borderRadius: '12px',
                        overflow: 'hidden',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: 'var(--border-subtle)'
                    }}>
                        <div style={{ padding: '24px', borderBottom: 'var(--border-subtle)' }}>
                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Top Groups (Bridge Volume)</h3>
                        </div>
                        <div>
                            {metrics.topGroups.length === 0 ? (
                                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                    No data available yet.
                                </div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <tbody>
                                        {metrics.topGroups.map((g, i) => {
                                            const color = getColorForString(g.name);
                                            return (
                                                <tr key={g.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <td style={{ padding: '16px 24px', width: '40px', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                                                        #{i + 1}
                                                    </td>
                                                    <td style={{ padding: '16px 24px', fontWeight: 500 }}>
                                                        <span style={{
                                                            padding: '6px 12px',
                                                            borderRadius: '20px',
                                                            fontSize: '12px',
                                                            fontWeight: 500,
                                                            background: color.bg,
                                                            border: `1px solid ${color.border}`,
                                                            color: color.text,
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            lineHeight: 1
                                                        }}>
                                                            {g.name}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '16px 24px', textAlign: 'right', fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-secondary)' }}>
                                                        {g.count}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};
