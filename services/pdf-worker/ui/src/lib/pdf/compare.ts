export interface ChangeRegion { page: number; box: [number, number, number, number] }
export interface PdfDifference {
  id: number;
  type: 'added' | 'removed' | 'modified' | 'visual' | 'page_added' | 'page_removed' | 'page_moved';
  originalPage: number | null;
  modifiedPage: number | null;
  before: string | null;
  after: string | null;
  originalRegions: ChangeRegion[];
  modifiedRegions: ChangeRegion[];
  description?: string;
}
export interface ComparisonSummary {
  version: 1;
  originalName: string;
  modifiedName: string;
  originalPages: number;
  modifiedPages: number;
  totalDifferences: number;
  pagesChanged: number;
  pagesAdded: number;
  pagesRemoved: number;
  pagesMoved: number;
  textChanges: number;
  visualChanges: number;
  pageMap: { originalPage: number | null; modifiedPage: number | null; changed: boolean }[];
  differences: PdfDifference[];
  warnings: string[];
  detailsTruncated?: boolean;
}

export function filterDifferences(changes: PdfDifference[], filter: 'all' | 'text' | 'visual'): PdfDifference[] {
  return changes.filter(d => filter === 'all' || (filter === 'visual' ? d.type === 'visual' : ['added', 'removed', 'modified'].includes(d.type)));
}

export function changeLabel(type: PdfDifference['type']): string {
  return ({ added: 'Added text', removed: 'Removed text', modified: 'Modified text', visual: 'Visual change',
    page_added: 'Page added', page_removed: 'Page removed', page_moved: 'Page moved' })[type];
}

export const changeColors: Record<PdfDifference['type'], string> = {
  added: '#16803c', removed: '#dc2638', modified: '#b97503', visual: '#b97503',
  page_added: '#16803c', page_removed: '#dc2638', page_moved: '#405bcc',
};
