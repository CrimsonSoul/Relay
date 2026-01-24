import React from "react";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { VirtualRow } from "./VirtualRow";
import { Contact } from "@shared/ipc";

type VirtualRowData = {
  log: { email: string; source: string }[];
  contactMap: Map<string, Contact>;
  groupMap: Map<string, string[]>;
  onRemoveManual: (email: string) => void;
  onAddToContacts: (email: string) => void;
  onContextMenu: (e: React.MouseEvent, email: string, isUnknown: boolean) => void;
};

type CompositionListProps = {
  log: { email: string; source: string }[];
  itemData: VirtualRowData;
  onScroll: (scrollOffset: number) => void;
};

export const CompositionList: React.FC<CompositionListProps> = ({
  log,
  itemData,
  onScroll,
}) => {
  if (log.length === 0) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "16px",
        color: "var(--color-text-tertiary)"
      }}>
        <div style={{ fontSize: "48px", opacity: 0.1 }}>∅</div>
        <div>No recipients selected</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
      <AutoSizer>
        {({ height, width }) => (
          <List
            height={height}
            itemCount={log.length}
            itemSize={104}
            width={width}
            itemData={itemData}
            onScroll={({ scrollOffset }) => onScroll(scrollOffset)}
          >
            {VirtualRow}
          </List>
        )}
      </AutoSizer>
    </div>
  );
};
