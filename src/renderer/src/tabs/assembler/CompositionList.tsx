import React from 'react';
import { List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { VirtualRow } from './VirtualRow';
import { VirtualRowData } from './types';

type CompositionListProps = {
  log: { email: string; source: string }[];
  itemData: VirtualRowData;
  onScroll: (scrollOffset: number) => void;
  onOpenHistory?: () => void;
};

export const CompositionList: React.FC<CompositionListProps> = ({
  log,
  itemData,
  onScroll,
  onOpenHistory,
}) => {
  if (log.length === 0) {
    return (
      <div className="composition-list-empty">
        <div className="composition-list-empty-icon">∅</div>
        <div className="composition-list-empty-copy">
          <div className="composition-list-empty-title">No recipients selected</div>
          <p>
            Use global search to add a contact or group, select a group from the left, or open
            History to reload a recent bridge.
          </p>
          {onOpenHistory && (
            <button type="button" className="composition-list-empty-action" onClick={onOpenHistory}>
              Open History
            </button>
          )}
        </div>
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
            rowHeight={72}
            rowComponent={VirtualRow}
            rowProps={itemData}
            onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
          />
        )}
      />
    </div>
  );
};
