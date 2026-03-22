import { getPb, handleApiError, escapeFilter, requireOnline } from './pocketbase';

export interface OncallLayoutRecord {
  id: string;
  team: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isStatic: boolean;
  created: string;
  updated: string;
}

export type OncallLayoutInput = Omit<OncallLayoutRecord, 'id' | 'created' | 'updated'>;

export type TeamLayoutMap = Record<
  string,
  { x: number; y: number; w?: number; h?: number; isStatic?: boolean }
>;

export async function getLayout(): Promise<TeamLayoutMap> {
  try {
    const records = await getPb().collection('oncall_layout').getFullList<OncallLayoutRecord>();
    const layout: TeamLayoutMap = {};
    for (const record of records) {
      layout[record.team] = {
        x: record.x,
        y: record.y,
        w: record.w,
        h: record.h,
        isStatic: record.isStatic,
      };
    }
    return layout;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function saveLayout(
  team: string,
  position: { x: number; y: number; w?: number; h?: number; isStatic?: boolean },
): Promise<OncallLayoutRecord> {
  requireOnline();
  try {
    // Find existing record for this team (upsert)
    let existing: OncallLayoutRecord | null = null;
    try {
      existing = await getPb()
        .collection('oncall_layout')
        .getFirstListItem<OncallLayoutRecord>(`team="${escapeFilter(team)}"`);
    } catch (err: unknown) {
      if (
        !(err instanceof Error && 'status' in err && (err as { status: number }).status === 404)
      ) {
        handleApiError(err);
        throw err;
      }
    }

    const data: Partial<OncallLayoutInput> = {
      team,
      x: position.x,
      y: position.y,
      ...(position.w !== undefined ? { w: position.w } : {}),
      ...(position.h !== undefined ? { h: position.h } : {}),
      ...(position.isStatic !== undefined ? { isStatic: position.isStatic } : {}),
    };

    if (existing) {
      return await getPb()
        .collection('oncall_layout')
        .update<OncallLayoutRecord>(existing.id, data);
    }
    return await getPb().collection('oncall_layout').create<OncallLayoutRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
