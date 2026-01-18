import { useEffect, useRef, useCallback } from 'react';
import { GridStack } from 'gridstack';
import { OnCallRow, TeamLayout } from '@shared/ipc';

export function useGridStack(
  localOnCall: OnCallRow[], 
  setLocalOnCall: (rows: OnCallRow[]) => void,
  getItemHeight: (team: string) => number
) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gridInstanceRef = useRef<GridStack | null>(null);
  
  const localOnCallRef = useRef(localOnCall);
  const isDraggingRef = useRef(false);
  const isExternalUpdateRef = useRef(false); // Guard against feedback loop from grid.load()
  const prevOrderRef = useRef<string[]>(Array.from(new Set(localOnCall.map(r => r.team))));

  const initGrid = useCallback(() => {
    if (!gridRef.current) return;
    
    const getColumnCount = () => (gridRef.current?.offsetWidth || window.innerWidth) < 900 ? 1 : 2;

    const grid = GridStack.init({ 
      column: getColumnCount(), 
      cellHeight: 75, 
      margin: 12, 
      float: false, 
      animate: true, 
      staticGrid: false, 
      draggable: { handle: '.grid-stack-item-content' }, 
      resizable: { handles: '' } 
    }, gridRef.current);
    
    gridInstanceRef.current = grid;

    grid.on('dragstart', () => {
      isDraggingRef.current = true;
    });

    grid.on('dragstop', () => {
      isDraggingRef.current = false;
    });

    grid.on('change', () => {
      if (!gridInstanceRef.current) return;
      if (isExternalUpdateRef.current) return; // Ignore changes triggered by our own grid.load()
      
      const grid = gridInstanceRef.current;
      
      // IMPORTANT: Spread to avoid mutating GridStack's internal array
      const items = [...grid.getGridItems()];
      
      // DIAGNOSTIC: Log raw positions before sorting
      console.log('[GridStack] change event fired. Raw items:', items.map(el => ({
        id: el.getAttribute('gs-id'),
        x: el.getAttribute('gs-x'),
        y: el.getAttribute('gs-y')
      })));
      
      // Capture actual layout positions
      const layout: TeamLayout = {};
      items.forEach(el => {
        const id = el.getAttribute('gs-id');
        if (id) {
          layout[id] = {
            x: parseInt(el.getAttribute('gs-x') || '0'),
            y: parseInt(el.getAttribute('gs-y') || '0')
          };
        }
      });
      
      const newOrder = items.sort((a, b) => {
        const aY = parseInt(a.getAttribute('gs-y') || '0'), bY = parseInt(b.getAttribute('gs-y') || '0');
        if (aY !== bY) return aY - bY;
        return parseInt(a.getAttribute('gs-x') || '0') - parseInt(b.getAttribute('gs-x') || '0');
      }).map(item => item.getAttribute('gs-id')).filter(Boolean) as string[];

      // Only act if the canonical order has changed OR if layout positions changed
      // (For simplicity, we persist on every change event to capture position tweaks)
      // Actually, let's keep the order change check but also check layout changes?
      // Since 'change' fires on any move, we can just persist.
      // But let's check order to decide if we update local list order.
      
      const orderChanged = JSON.stringify(prevOrderRef.current) !== JSON.stringify(newOrder);
      
      console.log('[GridStack] prevOrder:', prevOrderRef.current, 'newOrder:', newOrder, 'changed:', orderChanged);
      
      // Always persist layout changes, even if order is same (e.g. asymmetric move)
      console.log('[GridStack] Layout changed. New Order:', newOrder, 'Layout:', layout);

      const newFlatList: OnCallRow[] = [];
      newOrder.forEach(teamName => newFlatList.push(...localOnCallRef.current.filter(r => r.team === teamName)));
      
      // Update refs first to prevent sync effect from firing
      prevOrderRef.current = newOrder;
      
      // Update local state immediately if order changed
      if (orderChanged) {
        setLocalOnCall(newFlatList);
      }
      
      // Persist to main process (both order and layout)
      void window.api?.reorderOnCallTeams(newOrder, layout).then(success => {
        if (!success) console.error('[GridStack] Failed to persist new order');
      });
    });

    // Cleanup for resize observer logic
    const handleResize = (width?: number) => {
      if (gridInstanceRef.current && gridRef.current) {
        const w = width || gridRef.current.offsetWidth || window.innerWidth;
        const count = w < 900 ? 1 : 2;
        
        if (gridInstanceRef.current.getColumn() !== count) {
          if (count === 2) {
            gridInstanceRef.current.column(2, 'none');
            gridInstanceRef.current.batchUpdate();
            // IMPORTANT: Spread to avoid mutating GridStack's internal array
            const items = [...gridInstanceRef.current.getGridItems()].sort((a, b) => {
              const aY = parseInt(a.getAttribute('gs-y') || '0');
              const bY = parseInt(b.getAttribute('gs-y') || '0');
              return aY - bY;
            });
            items.forEach((item, i) => {
              gridInstanceRef.current?.update(item, { x: i % 2, w: 1 });
            });
            gridInstanceRef.current.compact();
            gridInstanceRef.current.batchUpdate(false);
          } else {
            gridInstanceRef.current.column(1, 'moveScale');
          }
        }
      }
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          handleResize(entry.contentRect.width);
        }
      }
    });

    observer.observe(gridRef.current);
    
    return () => {
        observer.disconnect();
    };
  }, [setLocalOnCall]);

  // Handle data updates from props/state (e.g. from other window)
  useEffect(() => {
    localOnCallRef.current = localOnCall;
    const newOrder = Array.from(new Set(localOnCall.map(r => r.team)));
    
    // Guard: empty grid has nothing to sync
    if (newOrder.length === 0) {
      prevOrderRef.current = newOrder;
      return undefined;
    }
    
    const orderChanged = JSON.stringify(prevOrderRef.current) !== JSON.stringify(newOrder);
    
    const currentItemCount = gridInstanceRef.current?.getGridItems().length || 0;
    const countChanged = currentItemCount !== newOrder.length;

    if ((orderChanged || countChanged) && !isDraggingRef.current && gridInstanceRef.current) {
      // Debounce: wait for rapid state updates to settle (optimistic + broadcast)
      const timeoutId = setTimeout(() => {
        const grid = gridInstanceRef.current;
        if (!grid) return;
        
        // Use receiver's column count for responsive layout
        const columnCount = grid.getColumn();
        
        console.log('[GridStack] Syncing layout:', newOrder, 'columns:', columnCount);
        
        const newLayout = newOrder.map((team, i) => ({
          id: team,
          x: columnCount === 1 ? 0 : i % columnCount,
          y: columnCount === 1 ? i : Math.floor(i / columnCount),
          w: 1,
          h: getItemHeight(team)
        }));
        
        // Guard: prevent change handler from firing during our load()
        isExternalUpdateRef.current = true;
        grid.load(newLayout);
        isExternalUpdateRef.current = false;
      }, 50);
      
      prevOrderRef.current = newOrder;
      return () => clearTimeout(timeoutId);
    }
    
    prevOrderRef.current = newOrder;
    return undefined;
  }, [localOnCall, getItemHeight]);

  // Initial initialization
  useEffect(() => {
    const cleanup = initGrid();
    return () => {
      cleanup?.();
      gridInstanceRef.current?.destroy(false);
      gridInstanceRef.current = null;
    };
  }, [initGrid]);

  return { gridRef };
}
