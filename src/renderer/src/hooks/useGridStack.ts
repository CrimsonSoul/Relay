import { useEffect, useRef } from 'react';
import { GridStack } from 'gridstack';
import { OnCallRow } from '@shared/ipc';

export function useGridStack(localOnCall: OnCallRow[], setLocalOnCall: (rows: OnCallRow[]) => void) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gridInstanceRef = useRef<GridStack | null>(null);
  const isInitialized = useRef(false);

  const localOnCallRef = useRef(localOnCall);
  
  useEffect(() => {
    localOnCallRef.current = localOnCall;
  }, [localOnCall]);

  useEffect(() => {
    if (!gridRef.current || isInitialized.current) return;
    const getColumnCount = () => (gridRef.current?.offsetWidth || window.innerWidth) < 900 ? 1 : 2;

    gridInstanceRef.current = GridStack.init({ column: getColumnCount(), cellHeight: 70, margin: 8, float: false, animate: true, draggable: { handle: '.grid-stack-item-content' }, resizable: { handles: '' } }, gridRef.current);
    isInitialized.current = true;

    const handleResize = () => { if (gridInstanceRef.current && gridRef.current) gridInstanceRef.current.column(getColumnCount(), 'moveScale'); };
    window.addEventListener('resize', handleResize);

    gridInstanceRef.current.on('dragstop', () => {
      if (!gridInstanceRef.current) return;
      const newOrder = gridInstanceRef.current.getGridItems().sort((a, b) => {
        const aY = parseInt(a.getAttribute('gs-y') || '0'), bY = parseInt(b.getAttribute('gs-y') || '0');
        if (aY !== bY) return aY - bY;
        return parseInt(a.getAttribute('gs-x') || '0') - parseInt(b.getAttribute('gs-x') || '0');
      }).map(item => item.getAttribute('gs-id')).filter(Boolean) as string[];

      const newFlatList: OnCallRow[] = [];
      newOrder.forEach(teamName => newFlatList.push(...localOnCallRef.current.filter(r => r.team === teamName)));
      setLocalOnCall(newFlatList);
      window.api?.saveAllOnCall(newFlatList);
    });

    return () => { window.removeEventListener('resize', handleResize); if (gridInstanceRef.current) { gridInstanceRef.current.destroy(false); gridInstanceRef.current = null; isInitialized.current = false; } };
  }, [setLocalOnCall]);

  useEffect(() => { if (gridInstanceRef.current) { const timeout = setTimeout(() => gridInstanceRef.current?.compact(), 100); return () => clearTimeout(timeout); } }, []);

  return { gridRef };
}
