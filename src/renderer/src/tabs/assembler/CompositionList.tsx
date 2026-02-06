import React from 'react';
import { List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { VirtualRow } from './VirtualRow';
import { VirtualRowData } from './types';

type CompositionListProps = {
  log: { email: string; source: string }[];
  itemData: VirtualRowData;
  onScroll: (scrollOffset: number) => void;
};

export const CompositionList: React.FC<CompositionListProps> = ({ log, itemData, onScroll }) => {
  if (log.length === 0) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '16px',
          color: 'var(--color-text-tertiary)',
        }}
      >
        <div style={{ fontSize: '48px', opacity: 0.1 }}>∅</div>
        <div>No recipients selected</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
      <AutoSizer
        renderProp={({ height, width }) => (
          <List
            style={{ height: height ?? 0, width: width ?? 0 }}
            rowCount={log.length}
            rowHeight={104}
            rowComponent={VirtualRow}
            rowProps={itemData}
            onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
          />
        )}
      />
    </div>
  );
};
