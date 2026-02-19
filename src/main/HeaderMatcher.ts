/**
 * Utility class for flexible CSV header matching and column management
 */

export class HeaderMatcher {
  private headers: string[];
  private lowerHeaders: string[];

  constructor(headers: string[]) {
    this.headers = headers;
    this.lowerHeaders = headers.map((h) => String(h).toLowerCase().trim());
  }

  /**
   * Find column index by checking multiple possible aliases (case-insensitive)
   * Checks aliases in priority order - returns first match
   */
  findColumn(aliases: readonly string[]): number {
    for (const alias of aliases) {
      const idx = this.lowerHeaders.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  }
}
