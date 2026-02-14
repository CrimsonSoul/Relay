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
      <div className="composition-list-empty">
        <div className="composition-list-empty-icon">∅</div>
        <div>No recipients selected</div>
      </div>
    );
  }

  return (
    <div className="composition-list-container">
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
