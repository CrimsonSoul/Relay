import { useEffect, useRef } from 'react';
import { GridStack } from 'gridstack';
import { OnCallRow } from '@shared/ipc';

export function useGridStack(localOnCall: OnCallRow[], setLocalOnCall: (rows: OnCallRow[]) => void) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gridInstanceRef = useRef<GridStack | null>(null);
  const isInitialized = useRef(false);

  const localOnCallRef = useRef(localOnCall);
  const isDraggingRef = useRef(false);
  
  useEffect(() => {
    localOnCallRef.current = localOnCall;

    // If data changed externally (not during a local drag), sync the grid visual state
    if (isInitialized.current && gridInstanceRef.current && !isDraggingRef.current) {
      const items = gridInstanceRef.current.getGridItems();
      
      const currentOrder = items
        .map(item => item.getAttribute('gs-id'))
        .filter(Boolean) as string[];
      
      const newOrder = Array.from(new Set(localOnCall.map(r => r.team)));
      
      // Check if order OR heights changed
      let needsRefresh = JSON.stringify(currentOrder) !== JSON.stringify(newOrder);
      
      if (!needsRefresh) {
        // Order same, check if any heights need updating in GridStack
        for (const item of items) {
          const team = item.getAttribute('gs-id');
          if (!team) continue;
          
          const node = item.gridstackNode;
          // Read the attribute that React potentially updated
          const attrH = parseInt(item.getAttribute('gs-h') || '0');
          
          if (node && attrH !== node.h) {
            needsRefresh = true;
            break;
          }
        }
      }
      
      if (needsRefresh) {
        gridInstanceRef.current.batchUpdate();
        gridInstanceRef.current.removeAll(false);
        
        // Wait for React to update DOM attributes
        const timeout = setTimeout(() => {
          if (gridInstanceRef.current) {
            gridInstanceRef.current.makeWidgets('.grid-stack-item');
            gridInstanceRef.current.compact();
            gridInstanceRef.current.batchUpdate(false);
          }
        }, 50);
        return () => clearTimeout(timeout);
      }
    }
    return undefined;
  }, [localOnCall]);


  useEffect(() => {
    if (!gridRef.current || isInitialized.current) return;
    const getColumnCount = () => (gridRef.current?.offsetWidth || window.innerWidth) < 900 ? 1 : 2;

    gridInstanceRef.current = GridStack.init({ column: getColumnCount(), cellHeight: 75, margin: 12, float: false, animate: true, staticGrid: false, draggable: { handle: '.grid-stack-item-content' }, resizable: { handles: '' } }, gridRef.current);
    isInitialized.current = true;

    const handleResize = (width?: number) => {
      if (gridInstanceRef.current && gridRef.current) {
        const w = width || gridRef.current.offsetWidth || window.innerWidth;
        const count = w < 900 ? 1 : 2;
        
        if (gridInstanceRef.current.getColumn() !== count) {
          if (count === 2) {
            // Switching to 2 columns: Manual reflow to grid
            gridInstanceRef.current.column(2, 'none'); // Don't scale widths automatically
            
            gridInstanceRef.current.batchUpdate();
            const items = gridInstanceRef.current.getGridItems().sort((a, b) => {
              const aY = parseInt(a.getAttribute('gs-y') || '0');
              const bY = parseInt(b.getAttribute('gs-y') || '0');
              return aY - bY;
            });
            
            items.forEach((item, i) => {
              gridInstanceRef.current?.update(item, {
                x: i % 2,
                w: 1 // Force half width (1 unit in 2-col grid)
                // Do not manually set y, let compact() handle vertical flow
              });
            });
            gridInstanceRef.current.compact();
            gridInstanceRef.current.batchUpdate(false);
          } else {
            // Switching to 1 column: Let GridStack handle it (scales to full width)
            gridInstanceRef.current.column(1, 'moveScale');
          }
        }
      }
    };

    // Reliability: Re-check size immediately after init in case offsetWidth was 0
    const checkSize = () => {
      if (gridRef.current && gridInstanceRef.current) {
        const width = gridRef.current.offsetWidth;
        if (width > 0) {
          handleResize(width);
        }
      }
    };
    const checkSizeTimeout = setTimeout(checkSize, 100);

    // Use ResizeObserver to detect size changes and visibility (width > 0)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          handleResize(entry.contentRect.width);
        }
      }
    });

    if (gridRef.current) observer.observe(gridRef.current);

    gridInstanceRef.current.on('dragstart', () => {
      isDraggingRef.current = true;
    });

    gridInstanceRef.current.on('dragstop', () => {
      isDraggingRef.current = false;
      if (!gridInstanceRef.current) return;
      const newOrder = gridInstanceRef.current.getGridItems().sort((a, b) => {
        const aY = parseInt(a.getAttribute('gs-y') || '0'), bY = parseInt(b.getAttribute('gs-y') || '0');
        if (aY !== bY) return aY - bY;
        return parseInt(a.getAttribute('gs-x') || '0') - parseInt(b.getAttribute('gs-x') || '0');
      }).map(item => item.getAttribute('gs-id')).filter(Boolean) as string[];

      const newFlatList: OnCallRow[] = [];
      newOrder.forEach(teamName => newFlatList.push(...localOnCallRef.current.filter(r => r.team === teamName)));
      setLocalOnCall(newFlatList);

      // Use reorder API to avoid overwriting concurrent content edits
      void window.api?.reorderOnCallTeams(newOrder);
    });

    return () => {
      observer.disconnect();
      clearTimeout(checkSizeTimeout);
      if (gridInstanceRef.current) { gridInstanceRef.current.destroy(false); gridInstanceRef.current = null; isInitialized.current = false; }
    };

  }, [setLocalOnCall]);

  useEffect(() => { if (gridInstanceRef.current) { const timeout = setTimeout(() => gridInstanceRef.current?.compact(), 100); return () => clearTimeout(timeout); } }, []);

  return { gridRef };
}
