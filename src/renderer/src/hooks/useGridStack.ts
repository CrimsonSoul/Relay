import { useEffect, useRef, useCallback } from 'react';
import { GridStack } from 'gridstack';
import { OnCallRow, TeamLayout } from '@shared/ipc';
import { logger } from '../utils/logger';

export function useGridStack(
  localOnCall: OnCallRow[],
  setLocalOnCall: (rows: OnCallRow[]) => void,
  getItemHeight: (team: string) => number,
  teamLayout?: TeamLayout,
  onLayoutChange?: (layout: TeamLayout) => void
) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gridInstanceRef = useRef<GridStack | null>(null);

  // Update ref immediately on each render to ensure latest data in handlers
  const localOnCallRef = useRef(localOnCall);
  localOnCallRef.current = localOnCall;

  // Track dragging state to prevent updates during drag
  const isDraggingRef = useRef(false);
  const wasDraggedRef = useRef(false);
  
  // Track previous order to detect changes
  const prevOrderRef = useRef<string[]>(Array.from(new Set(localOnCall.map(r => r.team))));

  const initGrid = useCallback(() => {
    if (!gridRef.current) return;

    const getColumnCount = () => (gridRef.current?.offsetWidth || window.innerWidth) < 900 ? 1 : 2;

    const grid = GridStack.init({
      column: getColumnCount(),
      cellHeight: 75,
      margin: 12,
      float: false, // Critical: Gravity enabled
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
      wasDraggedRef.current = true;
    });

    // Capture layout helper
    const captureLayout = () => {
      const grid = gridInstanceRef.current;
      if (!grid || !onLayoutChange) return;

      const items = grid.getGridItems();
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
      onLayoutChange(layout);
    };

    grid.on('change', () => {
      if (!gridInstanceRef.current) return;
      
      // Only process reorder if it was caused by an actual user drag
      // or if we explicitly want to capture auto-layout changes (which we do now)
      // But mainly we care about drag/drop for persisting ORDER
      
      if (wasDraggedRef.current) {
         wasDraggedRef.current = false;
         captureLayout();

         const grid = gridInstanceRef.current;
         const items = [...grid.getGridItems()];
         
         const newOrder = items.sort((a, b) => {
           const aY = parseInt(a.getAttribute('gs-y') || '0'), bY = parseInt(b.getAttribute('gs-y') || '0');
           if (aY !== bY) return aY - bY;
           return parseInt(a.getAttribute('gs-x') || '0') - parseInt(b.getAttribute('gs-x') || '0');
         }).map(item => item.getAttribute('gs-id')).filter(Boolean) as string[];

         const orderChanged = JSON.stringify(prevOrderRef.current) !== JSON.stringify(newOrder);
         
         const newFlatList: OnCallRow[] = [];
         newOrder.forEach(teamName => newFlatList.push(...localOnCallRef.current.filter(r => r.team === teamName)));
         
         prevOrderRef.current = newOrder;
         
         if (orderChanged) {
           setLocalOnCall(newFlatList);
         }
         
         // Persist order and layout
         const currentLayout = {}; // We captured it above via captureLayout(), but we need to pass it here too if we want to save.
         // Actually, captureLayout updates the parent state. 
         // But we also need to send to backend.
         const layoutToSave: TeamLayout = {};
         items.forEach(el => {
            const id = el.getAttribute('gs-id');
            if (id) layoutToSave[id] = { x: parseInt(el.getAttribute('gs-x') || '0'), y: parseInt(el.getAttribute('gs-y') || '0') };
         });

         void window.api?.reorderOnCallTeams(newOrder, layoutToSave);
      } else {
         // Non-drag change (auto-positioning etc) - just capture layout
         captureLayout();
      }
    });

    // Cleanup for resize observer logic
    const handleResize = (width?: number) => {
      if (gridInstanceRef.current && gridRef.current) {
        const w = width || gridRef.current.offsetWidth || window.innerWidth;
        const count = w < 900 ? 1 : 2;

        if (gridInstanceRef.current.getColumn() !== count) {
          if (count === 2) {
            gridInstanceRef.current.column(2, 'none');
            // ... (rest of resize logic)
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
  }, [setLocalOnCall]); // Removed onLayoutChange from dep array to avoid re-init loop

  // --- NEW LOGIC: Widget Lifecycle Management via makeWidget ---
  
  useEffect(() => {
    const grid = gridInstanceRef.current;
    if (!grid || !gridRef.current) return;

    // 1. Identify new elements in the DOM that are not widgets yet
    const domChildren = Array.from(gridRef.current.children) as HTMLElement[];
    const widgetElements = grid.getGridItems();
    
    // GridStack adds 'grid-stack-item' class.
    // If we render with React, we add 'grid-stack-item'.
    // We need to check if GridStack *knows* about it.
    // GridStack attaches `gridstackNode` property to the element.
    
    domChildren.forEach(el => {
      if (el.classList.contains('grid-stack-item') && !(el as any).gridstackNode) {
        // This is a new element from React!
        // GridStack doesn't know it yet.
        // The element ALREADY has attributes gs-x, gs-y, gs-h from GridStackItem.
        // So we just tell GridStack to make it a widget.
        
        // IMPORTANT: If we set gs-y=10000 in React, makeWidget reads it.
        grid.makeWidget(el);
      }
    });

    // 2. Sync Heights (if data changed, height might change)
    // GridStack doesn't automatically update height if content grows.
    // We must manually update it.
    // But we avoid doing this if dragging.
    if (!isDraggingRef.current) {
        const items = grid.getGridItems();
        items.forEach(el => {
            const id = el.getAttribute('gs-id');
            if (id) {
                const targetH = getItemHeight(id);
                const currentH = parseInt(el.getAttribute('gs-h') || '0');
                if (targetH !== currentH) {
                    grid.update(el, { h: targetH });
                }
            }
        });
        
        // 3. Compact if necessary (gravity)
        grid.compact();
    }
              }
          });
          
          // 3. Compact if necessary (gravity)
          grid.compact();
      }

    // Update prevOrderRef to match current data
    const currentTeams = Array.from(new Set(localOnCall.map(r => r.team)));
    prevOrderRef.current = currentTeams;

  }, [localOnCall, getItemHeight]); // Run whenever data changes (and thus DOM changes)

  return { gridRef };
}

      });
      onLayoutChange(layout);
    };

    grid.on('change', () => {
      if (!gridInstanceRef.current) return;
      if (isExternalUpdateRef.current) return;
      
      // Only process reorder if it was caused by an actual user drag
      if (!wasDraggedRef.current) return;
      wasDraggedRef.current = false;

      const grid = gridInstanceRef.current;
      
      // Capture layout immediately on user interaction
      captureLayout();

      // IMPORTANT: Spread to avoid mutating GridStack's internal array
      const items = [...grid.getGridItems()];
      
      // DIAGNOSTIC: Log raw positions before sorting
      logger.debug('[GridStack] change event fired. Raw items:', items.map(el => ({
        id: el.getAttribute('gs-id'),
        x: el.getAttribute('gs-x'),
        y: el.getAttribute('gs-y')
      })));
      
      // Update local layout state immediately
      // (Handled by captureLayout now)
      
      const newOrder = items.sort((a, b) => {
        const aY = parseInt(a.getAttribute('gs-y') || '0'), bY = parseInt(b.getAttribute('gs-y') || '0');
        if (aY !== bY) return aY - bY;
        return parseInt(a.getAttribute('gs-x') || '0') - parseInt(b.getAttribute('gs-x') || '0');
      }).map(item => item.getAttribute('gs-id')).filter(Boolean) as string[];

      // Only act if the canonical order has changed OR if layout positions changed
      const orderChanged = JSON.stringify(prevOrderRef.current) !== JSON.stringify(newOrder);
      
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
        
        const newLayout = newOrder.map((team, i) => {
          const storedPos = teamLayout?.[team];
          // If we have a stored position, use it.
          // If NOT, use autoPosition to let GridStack find the best slot (avoids overlaps).
          // Fallback to simple stacking only if columnCount is 1 (mobile/narrow).
          if (columnCount === 1) {
            return {
              id: team,
              x: 0,
              y: i,
              w: 1,
              h: getItemHeight(team)
            };
          }
          
          if (storedPos) {
            return {
              id: team,
              x: storedPos.x,
              y: storedPos.y,
              w: 1,
              h: getItemHeight(team)
            };
          }

          return {
            id: team,
            // Use gravity strategy for unknown items instead of autoPosition.
            // autoPosition can sometimes be flaky during full grid reloads or race conditions,
            // potentially placing items at (0,0) and overlapping.
            // Placing at y=10000 guarantees it starts at the bottom, and float:true will
            // naturally bubble it up to the correct spot.
            x: 0,
            y: 10000,
            w: 1,
            h: getItemHeight(team)
          };
        });
        
        // Guard: prevent change handler from firing during our load()
        isExternalUpdateRef.current = true;
        grid.load(newLayout);
        
        // After load, if we have auto-positioned items, we should capture the resulting layout
        // so that our local state reflects reality.
        requestAnimationFrame(() => {
           captureLayout();
        });
        
        // Use double-requestAnimationFrame to ensure the guard persists
        // until after the browser has processed the GridStack DOM updates
        // and any potentially deferred 'change' events.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            isExternalUpdateRef.current = false;
          });
        });
      }, 50);
      
      prevOrderRef.current = newOrder;
      return () => clearTimeout(timeoutId);
    }
    
    prevOrderRef.current = newOrder;
    return undefined;
  }, [localOnCall, getItemHeight, teamLayout]);

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
