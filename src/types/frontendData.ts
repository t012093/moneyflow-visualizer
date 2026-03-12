import type { Edge, Node } from '../data/mockGenerator';

export interface BudgetHighlight {
  entity_id: string;
  fiscal_year: number;
  section_key: string;
  title: string;
  amount_text?: string | null;
  amount_oku_yen?: number | null;
  summary?: string | null;
  source_title?: string | null;
  source_url?: string | null;
  page_number?: number | null;
  display_order: number;
}

export interface AppMetadata {
  source: string;
  total_nodes: number;
  total_edges: number;
  fiscal_years: number[];
  latestFiscalYear?: number | null;
  featuredEntityId?: string | null;
  budgetHighlights?: BudgetHighlight[];
}

export interface UnifiedData {
  nodes: Node[];
  edges: Edge[];
  metadata: AppMetadata;
}
