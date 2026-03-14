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

export interface KnowledgeNoteSource {
  source_title: string;
  source_url: string;
  source_kind?: string | null;
  authority_level?: string | null;
  display_order: number;
}

export interface KnowledgeNote {
  entity_id: string;
  fiscal_year: number;
  note_key: string;
  title: string;
  summary?: string | null;
  key_points?: string[];
  body_markdown?: string | null;
  doc_path?: string | null;
  flow_focus_target_id?: string | null;
  display_order: number;
  sources: KnowledgeNoteSource[];
}

export interface StructuredFactSource {
  source_title: string;
  source_url: string;
  source_kind?: string | null;
  authority_level?: string | null;
  display_order: number;
}

export interface ImplementationSiteSource {
  source_title: string;
  source_url: string;
  source_kind?: string | null;
  authority_level?: string | null;
  display_order: number;
}

export interface StructuredFact {
  entity_id: string;
  fiscal_year: number;
  fact_key: string;
  fact_group?: string | null;
  title: string;
  value_text: string;
  numeric_value?: number | null;
  unit?: string | null;
  summary?: string | null;
  note_key?: string | null;
  source_excerpt?: string | null;
  display_order: number;
  sources: StructuredFactSource[];
}

export interface ImplementationSite {
  entity_id: string;
  fiscal_year: number;
  site_key: string;
  program_key?: string | null;
  note_key?: string | null;
  site_name: string;
  ward?: string | null;
  site_category?: string | null;
  operator_name?: string | null;
  started_on?: string | null;
  status_note?: string | null;
  display_order: number;
  sources: ImplementationSiteSource[];
}

export interface AppMetadata {
  source: string;
  total_nodes: number;
  total_edges: number;
  fiscal_years: number[];
  latestFiscalYear?: number | null;
  featuredEntityId?: string | null;
  budgetHighlights?: BudgetHighlight[];
  knowledgeNotes?: KnowledgeNote[];
  structuredFacts?: StructuredFact[];
  implementationSites?: ImplementationSite[];
}

export interface UnifiedData {
  nodes: Node[];
  edges: Edge[];
  metadata: AppMetadata;
}
