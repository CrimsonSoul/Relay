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

    // If data changed externally (not during a local drag), sync the grid visual order
    if (isInitialized.current && gridInstanceRef.current && !isDraggingRef.current) {
      // Always refresh layout to catch height changes (content updates) or order changes
      gridInstanceRef.current.removeAll(false);

      // GridStack will re-pickup the elements from the DOM if we don't destroy them
      // In this React setup, we wait for the next tick to let React render the new order
      setTimeout(() => {
        if (gridInstanceRef.current && gridRef.current) {
          gridInstanceRef.current.makeWidgets('.grid-stack-item');
          gridInstanceRef.current.compact();

          // Enforce column count again to prevent reset to default/1-column during refresh
          const w = gridRef.current.offsetWidth || window.innerWidth;
          const count = w < 900 ? 1 : 2;
          gridInstanceRef.current.column(count);
        }
      }, 50);
    }
  }, [localOnCall]);

  useEffect(() => {
    if (!gridRef.current || isInitialized.current) return;
    const getColumnCount = () => (gridRef.current?.offsetWidth || window.innerWidth) < 900 ? 1 : 2;

    gridInstanceRef.current = GridStack.init({ column: getColumnCount(), cellHeight: 70, margin: 8, float: false, animate: true, draggable: { handle: '.grid-stack-item-content' }, resizable: { handles: '' } }, gridRef.current);
    isInitialized.current = true;

    const handleResize = (width?: number) => {
      if (gridInstanceRef.current && gridRef.current) {
        const w = width || gridRef.current.offsetWidth || window.innerWidth;
        const count = w < 900 ? 1 : 2;
        gridInstanceRef.current.column(count, 'moveScale');
      }
    };

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
      if (gridInstanceRef.current) { gridInstanceRef.current.destroy(false); gridInstanceRef.current = null; isInitialized.current = false; }
    };
  }, [setLocalOnCall]);

  useEffect(() => { if (gridInstanceRef.current) { const timeout = setTimeout(() => gridInstanceRef.current?.compact(), 100); return () => clearTimeout(timeout); } }, []);

  return { gridRef };
}
