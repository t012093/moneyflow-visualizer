import React, { useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from '../data/mockGenerator';
import type {
  AppMetadata,
  BudgetHighlight,
  ImplementationSite,
  ImplementationSiteSource,
  KnowledgeNote,
  KnowledgeNoteSource,
  StructuredFact,
  StructuredFactSource,
} from '../types/frontendData';
import { JPY_RATE } from '../utils/currencyFormatter';

type BudgetTab = 'overview' | 'increase_driver' | 'policy_frame' | 'major_program' | 'individual_project' | 'research_note' | 'year_compare';

interface BudgetReportPageProps {
  currentYear: number;
  nodes: Node[];
  edges: Edge[];
  metadata: AppMetadata;
  selectedEntityId: string;
  onSelectedEntityChange: (entityId: string) => void;
}

const TAB_LABELS: Record<BudgetTab, string> = {
  overview: '総額',
  increase_driver: '増要因',
  policy_frame: '政策枠',
  major_program: '主な事業',
  individual_project: '個別施策',
  research_note: '調査ノート',
  year_compare: '年度比較',
};

const TAB_ACCENTS: Record<BudgetTab, string> = {
  overview: '#fde68a',
  increase_driver: '#fbbf24',
  policy_frame: '#34d399',
  major_program: '#60a5fa',
  individual_project: '#c084fc',
  research_note: '#a3e635',
  year_compare: '#fca5a5',
};

type BudgetEvidenceStatus = 'reviewed' | 'model-based' | 'hybrid';
type ReferenceSource = KnowledgeNoteSource | StructuredFactSource | ImplementationSiteSource;
type BudgetEvidenceCountRecord = Record<'reviewed' | 'model-based', number>;
type BudgetHighlightWithEvidence = BudgetHighlight & { evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'> };
type KnowledgeNoteWithEvidence = KnowledgeNote & { evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'> };
type StructuredFactWithEvidence = StructuredFact & { evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'> };
type ImplementationSiteWithEvidence = ImplementationSite & { evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'> };
type MajorProgramWithEvidence = Edge & {
  targetName: string;
  evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'>;
};

const MODEL_BUDGET_DATASET_MARKERS = ['省庁別主要経費推計', '財務省 一般会計（所管別）', '財務省一般会計', 'ministries_data', 'meti_data', '想定', '按分', 'Proxy', 'Approximation', 'Estimated'];

const EVIDENCE_BADGE_STYLE: Record<BudgetEvidenceStatus, { label: string; color: string; background: string; border: string; description: string }> = {
  reviewed: {
    label: 'reviewed',
    color: '#86efac',
    background: 'rgba(34, 197, 94, 0.14)',
    border: 'rgba(74, 222, 128, 0.22)',
    description: 'official PDF から review 済みの予算情報を表示しています。',
  },
  'model-based': {
    label: 'model-based',
    color: '#fbbf24',
    background: 'rgba(251, 191, 36, 0.14)',
    border: 'rgba(251, 191, 36, 0.22)',
    description: '推計配分や大分類モデルの情報を含みます。',
  },
  hybrid: {
    label: 'hybrid',
    color: '#93c5fd',
    background: 'rgba(96, 165, 250, 0.14)',
    border: 'rgba(96, 165, 250, 0.22)',
    description: 'reviewed edge と model-based edge が混在しています。',
  },
};

function inferEvidenceStatus(item: { source_dataset?: string | null; source_url?: string | null }): Exclude<BudgetEvidenceStatus, 'hybrid'> {
  if (item.source_dataset && MODEL_BUDGET_DATASET_MARKERS.some((marker) => item.source_dataset?.includes(marker))) {
    return 'model-based';
  }
  if (item.source_url && isOfficialPublicSourceUrl(item.source_url)) {
    return 'reviewed';
  }
  return 'model-based';
}

function isOfficialPublicSourceUrl(sourceUrl?: string | null): boolean {
  if (!sourceUrl) {
    return false;
  }
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return ['.go.jp', '.lg.jp', '.ac.jp', '.or.jp'].some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function inferEvidenceStatusFromSources(sources: ReferenceSource[] = []): Exclude<BudgetEvidenceStatus, 'hybrid'> {
  if (sources.some((source) => isOfficialPublicSourceUrl(source.source_url))) {
    return 'reviewed';
  }
  return 'model-based';
}

function createBudgetEvidenceCounts(): BudgetEvidenceCountRecord {
  return { reviewed: 0, 'model-based': 0 };
}

function countBudgetEvidence(items: Array<{ evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'> }>): BudgetEvidenceCountRecord {
  return items.reduce<BudgetEvidenceCountRecord>((counts, item) => {
    counts[item.evidenceStatus] += 1;
    return counts;
  }, createBudgetEvidenceCounts());
}

function shouldIncludeBudgetItem(
  item: { evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'> },
  reviewedOnly: boolean
): boolean {
  return !reviewedOnly || item.evidenceStatus === 'reviewed';
}

function aggregateBudgetEvidenceStatus(items: Array<{ evidenceStatus: Exclude<BudgetEvidenceStatus, 'hybrid'> }>): BudgetEvidenceStatus | null {
  const statuses = new Set<BudgetEvidenceStatus>();
  items.forEach((item) => statuses.add(item.evidenceStatus));
  if (statuses.size === 0) {
    return null;
  }
  if (statuses.size > 1) {
    return 'hybrid';
  }
  return Array.from(statuses)[0];
}

function isBudgetSurfaceEligibleEdge(edge: Edge): boolean {
  const dataset = edge.source_dataset || '';
  return !MODEL_BUDGET_DATASET_MARKERS.some((marker) => dataset.includes(marker));
}

function renderEvidenceBadge(status: BudgetEvidenceStatus) {
  const badge = EVIDENCE_BADGE_STYLE[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.22rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: badge.color,
        background: badge.background,
        border: `1px solid ${badge.border}`,
      }}
    >
      {badge.label}
    </span>
  );
}

function formatExactBudgetAmount(valueUsd: number): string {
  const rawValJpy = valueUsd * JPY_RATE;
  if (rawValJpy >= 1e8) {
    return `${Math.round(rawValJpy / 1e8).toLocaleString()}億円`;
  }
  if (rawValJpy >= 1e4) {
    return `${Math.round(rawValJpy / 1e4).toLocaleString()}万円`;
  }
  return `${Math.round(rawValJpy).toLocaleString()}円`;
}

function formatOkuuDelta(valueOku: number | null | undefined): string {
  if (valueOku === null || valueOku === undefined || Number.isNaN(valueOku)) {
    return '差分なし';
  }
  if (valueOku === 0) {
    return '±0億円';
  }
  const sign = valueOku > 0 ? '+' : '-';
  const absValue = Math.abs(valueOku);
  if (absValue >= 10000) {
    const trillions = absValue / 10000;
    const text = Number.isInteger(trillions) ? trillions.toLocaleString() : trillions.toFixed(1);
    return `${sign}${text}兆円`;
  }
  return `${sign}${Math.round(absValue).toLocaleString()}億円`;
}

function amountUsdToOku(valueUsd: number): number {
  return Math.round((valueUsd * JPY_RATE) / 1e8);
}

function parseBudgetPageParams(): { entityId: string | null; tab: BudgetTab | null; focusTargetId: string | null } {
  const params = new URLSearchParams(window.location.search);
  const entityId = params.get('entity');
  const focusTargetId = params.get('focus');
  const requestedTab = params.get('tab');
  const allowedTabs = new Set<BudgetTab>(['overview', 'increase_driver', 'policy_frame', 'major_program', 'individual_project', 'research_note', 'year_compare']);
  const tab = requestedTab && allowedTabs.has(requestedTab as BudgetTab) ? (requestedTab as BudgetTab) : null;
  return {
    entityId: entityId || null,
    tab,
    focusTargetId: focusTargetId || null,
  };
}

function renderSourceLink(item: { source_url?: string | null; source_title?: string | null; page_number?: number | null }, color: string) {
  if (!item.source_url) {
    return null;
  }

  return (
    <a
      href={item.source_url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'inline-block', marginTop: '0.5rem', color, fontSize: '0.8rem', textDecoration: 'none' }}
    >
      {item.source_title || '出典資料'}{item.page_number ? ` p.${item.page_number}` : ''}
    </a>
  );
}

function renderHighlightGrid(items: BudgetHighlightWithEvidence[], accent: string) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem' }}>
      {items.map((item) => (
        <article
          key={`${item.section_key}-${item.title}`}
          style={{
            padding: '1rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${accent}22`,
          }}
        >
          <div style={{ marginBottom: '0.55rem' }}>{renderEvidenceBadge(item.evidenceStatus)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' }}>
            <div style={{ fontWeight: 700, lineHeight: 1.45 }}>{item.title}</div>
            {item.amount_text && <div style={{ color: accent, fontWeight: 700, whiteSpace: 'nowrap' }}>{item.amount_text}</div>}
          </div>
          {item.summary && (
            <div style={{ marginTop: '0.45rem', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              {item.summary}
            </div>
          )}
          {renderSourceLink(item, accent)}
        </article>
      ))}
    </div>
  );
}

function renderReferenceSources(sources: ReferenceSource[], accent: string) {
  if (!sources.length) {
    return null;
  }

  return (
    <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {sources.map((source) => (
        <a
          key={`${source.source_title}-${source.source_url}`}
          href={source.source_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.35rem 0.65rem',
            borderRadius: '999px',
            textDecoration: 'none',
            color: accent,
            background: `${accent}14`,
            border: `1px solid ${accent}22`,
            fontSize: '0.78rem',
          }}
        >
          {source.source_title}
        </a>
      ))}
    </div>
  );
}

function renderStructuredFactGrid(items: StructuredFactWithEvidence[], accent: string) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.9rem' }}>
      {items.map((item) => (
        <article
          key={item.fact_key}
          style={{
            padding: '1rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${accent}22`,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
            {renderEvidenceBadge(item.evidenceStatus)}
            {item.fact_group ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.22rem 0.6rem',
                  borderRadius: '999px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: accent,
                  background: `${accent}14`,
                  border: `1px solid ${accent}22`,
                }}
              >
                {item.fact_group}
              </div>
            ) : null}
          </div>
          <div style={{ marginTop: '0.7rem', color: accent, fontSize: '1.45rem', fontWeight: 700 }}>{item.value_text}</div>
          <div style={{ marginTop: '0.35rem', fontWeight: 700, lineHeight: 1.45 }}>{item.title}</div>
          {item.summary ? (
            <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {item.summary}
            </div>
          ) : null}
          {item.source_excerpt ? (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                borderRadius: '14px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(148, 163, 184, 0.12)',
                color: 'var(--text-muted)',
                fontSize: '0.84rem',
                lineHeight: 1.6,
              }}
            >
              {item.source_excerpt}
            </div>
          ) : null}
          {renderReferenceSources(item.sources || [], accent)}
        </article>
      ))}
    </div>
  );
}

function renderKnowledgeNoteGrid(
  items: KnowledgeNoteWithEvidence[],
  accent: string,
  getFlowFocusHref: (item: KnowledgeNoteWithEvidence) => string | null
) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0.9rem' }}>
      {items.map((item) => (
        <article
          key={item.note_key}
          style={{
            padding: '1rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${accent}22`,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.22rem 0.6rem',
                borderRadius: '999px',
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: accent,
                background: `${accent}14`,
                border: `1px solid ${accent}22`,
              }}
            >
              Research note
            </div>
            {renderEvidenceBadge(item.evidenceStatus)}
          </div>
          <div style={{ marginTop: '0.7rem', fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.5 }}>{item.title}</div>
          {item.summary && (
            <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
              {item.summary}
            </div>
          )}
          {item.key_points?.length ? (
            <ul style={{ margin: '0.85rem 0 0', paddingLeft: '1.1rem', color: 'var(--text-main)', lineHeight: 1.7 }}>
              {item.key_points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : null}
          {renderReferenceSources(item.sources || [], accent)}
          {item.doc_path && (
            <div style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              internal doc: {item.doc_path}
            </div>
          )}
          {getFlowFocusHref(item) ? (
            <div style={{ marginTop: '0.85rem' }}>
              <a
                href={getFlowFocusHref(item) || undefined}
                style={{
                  display: 'inline-block',
                  padding: '0.42rem 0.9rem',
                  borderRadius: '999px',
                  background: 'rgba(96, 165, 250, 0.14)',
                  border: '1px solid rgba(96, 165, 250, 0.28)',
                  color: '#bfdbfe',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  textDecoration: 'none',
                }}
              >
                2Dフローで見る
              </a>
            </div>
          ) : null}
          {item.body_markdown ? (
            <details style={{ marginTop: '0.85rem' }}>
              <summary style={{ cursor: 'pointer', color: accent, fontWeight: 600 }}>ノート全文</summary>
              <div
                style={{
                  marginTop: '0.7rem',
                  padding: '0.9rem',
                  borderRadius: '14px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(148, 163, 184, 0.12)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.65,
                  fontSize: '0.88rem',
                }}
              >
                {item.body_markdown}
              </div>
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function renderImplementationSiteDirectory(items: ImplementationSiteWithEvidence[], accent: string) {
  const sitesByWard = new Map<string, ImplementationSite[]>();
  const categoryCounts = new Map<string, number>();
  const aggregateStatus = aggregateBudgetEvidenceStatus(items) || 'reviewed';

  items.forEach((item) => {
    const ward = item.ward || '区未設定';
    const category = item.site_category || 'その他';
    const wardSites = sitesByWard.get(ward) || [];
    wardSites.push(item);
    sitesByWard.set(ward, wardSites);
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  });

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.9rem' }}>
        <article
          style={{
            padding: '1rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${accent}22`,
          }}
        >
          <div style={{ marginBottom: '0.55rem' }}>{renderEvidenceBadge(aggregateStatus)}</div>
          <div style={{ color: accent, fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>Total Sites</div>
          <div style={{ marginTop: '0.4rem', fontSize: '1.8rem', fontWeight: 700 }}>{items.length}施設</div>
          <div style={{ marginTop: '0.45rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            構造化した実施施設データを ward 単位で一覧表示しています。
          </div>
        </article>
        <article
          style={{
            padding: '1rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${accent}22`,
          }}
        >
          <div style={{ marginBottom: '0.55rem' }}>{renderEvidenceBadge(aggregateStatus)}</div>
          <div style={{ color: accent, fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>Coverage</div>
          <div style={{ marginTop: '0.4rem', fontSize: '1.8rem', fontWeight: 700 }}>{sitesByWard.size}区</div>
          <div style={{ marginTop: '0.45rem', display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
            {Array.from(categoryCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([category, count]) => (
                <span
                  key={category}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.22rem 0.55rem',
                    borderRadius: '999px',
                    fontSize: '0.78rem',
                    color: accent,
                    background: `${accent}14`,
                    border: `1px solid ${accent}22`,
                  }}
                >
                  {category} {count}
                </span>
              ))}
          </div>
        </article>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.9rem' }}>
        {Array.from(sitesByWard.entries()).map(([ward, wardSites]) => (
          <section
            key={ward}
            style={{
              padding: '1rem',
              borderRadius: '18px',
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${accent}22`,
              display: 'grid',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{ward}</div>
              <div style={{ color: accent, fontSize: '0.84rem', fontWeight: 700 }}>{wardSites.length}施設</div>
            </div>
            <div style={{ display: 'grid', gap: '0.65rem' }}>
              {wardSites.map((site) => (
                <article
                  key={site.site_key}
                  style={{
                    padding: '0.85rem',
                    borderRadius: '14px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(148, 163, 184, 0.12)',
                  }}
                >
                  <div style={{ fontWeight: 700, lineHeight: 1.5 }}>{site.site_name}</div>
                  <div style={{ marginTop: '0.45rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {site.site_category ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.18rem 0.5rem',
                          borderRadius: '999px',
                          fontSize: '0.74rem',
                          color: accent,
                          background: `${accent}14`,
                          border: `1px solid ${accent}22`,
                        }}
                      >
                        {site.site_category}
                      </span>
                    ) : null}
                    {site.started_on ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.18rem 0.5rem',
                          borderRadius: '999px',
                          fontSize: '0.74rem',
                          color: '#cbd5e1',
                          background: 'rgba(148, 163, 184, 0.12)',
                          border: '1px solid rgba(148, 163, 184, 0.18)',
                        }}
                      >
                        開始 {site.started_on}
                      </span>
                    ) : null}
                  </div>
                  {site.status_note ? (
                    <div style={{ marginTop: '0.45rem', color: 'var(--text-muted)', lineHeight: 1.6, fontSize: '0.86rem' }}>
                      {site.status_note}
                    </div>
                  ) : null}
                  {renderReferenceSources(site.sources || [], accent)}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export const BudgetReportPage: React.FC<BudgetReportPageProps> = ({
  currentYear,
  nodes,
  edges,
  metadata,
  selectedEntityId,
  onSelectedEntityChange,
}) => {
  const budgetHighlights = useMemo(() => metadata.budgetHighlights || [], [metadata.budgetHighlights]);
  const knowledgeNotes = useMemo(() => metadata.knowledgeNotes || [], [metadata.knowledgeNotes]);
  const structuredFacts = useMemo(() => metadata.structuredFacts || [], [metadata.structuredFacts]);
  const implementationSites = useMemo(() => metadata.implementationSites || [], [metadata.implementationSites]);
  const budgetPageParams = useMemo(() => parseBudgetPageParams(), []);
  const entityOptions = useMemo(() => {
    return [...new Set([
      ...budgetHighlights.map((item) => item.entity_id),
      ...knowledgeNotes.map((item) => item.entity_id),
      ...structuredFacts.map((item) => item.entity_id),
      ...implementationSites.map((item) => item.entity_id),
    ])]
      .map((entityId) => ({
        entityId,
        name: nodes.find((node) => node.id === entityId)?.name || entityId,
      }))
      .sort((a, b) => {
        if (a.entityId === metadata.featuredEntityId) return -1;
        if (b.entityId === metadata.featuredEntityId) return 1;
        return a.name.localeCompare(b.name, 'ja');
      });
  }, [budgetHighlights, implementationSites, knowledgeNotes, structuredFacts, metadata.featuredEntityId, nodes]);
  const fallbackEntityId = budgetPageParams.entityId || metadata.featuredEntityId || entityOptions[0]?.entityId || '';
  const activeEntityId = entityOptions.some((item) => item.entityId === selectedEntityId) ? selectedEntityId : fallbackEntityId;
  const focusTargetId = budgetPageParams.focusTargetId;
  const requestedTab = budgetPageParams.tab || (focusTargetId ? 'major_program' : 'overview');
  const tabScopeKey = `${activeEntityId}:${currentYear}:${requestedTab}:${focusTargetId || ''}`;
  const [manualTabState, setManualTabState] = useState<{ scopeKey: string; tab: BudgetTab }>({
    scopeKey: tabScopeKey,
    tab: requestedTab,
  });
  const activeTab = manualTabState.scopeKey === tabScopeKey ? manualTabState.tab : requestedTab;

  useEffect(() => {
    if (selectedEntityId !== activeEntityId) {
      onSelectedEntityChange(activeEntityId);
    }
  }, [activeEntityId, onSelectedEntityChange, selectedEntityId]);

  const currentHighlights = useMemo(
    () =>
      budgetHighlights
        .filter((item) => item.entity_id === activeEntityId && item.fiscal_year === currentYear)
        .sort((a, b) => a.display_order - b.display_order),
    [activeEntityId, budgetHighlights, currentYear]
  );

  const currentKnowledgeNotes = useMemo(
    () =>
      knowledgeNotes
        .filter((item) => item.entity_id === activeEntityId && item.fiscal_year === currentYear)
        .sort((a, b) => a.display_order - b.display_order),
    [activeEntityId, currentYear, knowledgeNotes]
  );
  const currentStructuredFacts = useMemo(
    () =>
      structuredFacts
        .filter((item) => item.entity_id === activeEntityId && item.fiscal_year === currentYear)
        .sort((a, b) => a.display_order - b.display_order),
    [activeEntityId, currentYear, structuredFacts]
  );
  const currentImplementationSites = useMemo(
    () =>
      implementationSites
        .filter((item) => item.entity_id === activeEntityId && item.fiscal_year === currentYear)
        .sort((a, b) => a.display_order - b.display_order),
    [activeEntityId, currentYear, implementationSites]
  );
  const availableKnowledgeYears = useMemo(
    () => [...new Set(knowledgeNotes.filter((item) => item.entity_id === activeEntityId).map((item) => item.fiscal_year))].sort(),
    [activeEntityId, knowledgeNotes]
  );
  const availableStructuredFactYears = useMemo(
    () => [...new Set(structuredFacts.filter((item) => item.entity_id === activeEntityId).map((item) => item.fiscal_year))].sort(),
    [activeEntityId, structuredFacts]
  );
  const availableImplementationSiteYears = useMemo(
    () => [...new Set(implementationSites.filter((item) => item.entity_id === activeEntityId).map((item) => item.fiscal_year))].sort(),
    [activeEntityId, implementationSites]
  );
  const availableYears = useMemo(
    () => [...new Set(budgetHighlights.filter((item) => item.entity_id === activeEntityId).map((item) => item.fiscal_year))].sort(),
    [activeEntityId, budgetHighlights]
  );
  const previousYear = useMemo(
    () => [...availableYears].filter((year) => year < currentYear).sort((a, b) => b - a)[0] || null,
    [availableYears, currentYear]
  );
  const previousHighlights = useMemo(
    () =>
      previousYear === null
        ? []
        : budgetHighlights
            .filter((item) => item.entity_id === activeEntityId && item.fiscal_year === previousYear)
            .sort((a, b) => a.display_order - b.display_order),
    [activeEntityId, budgetHighlights, previousYear]
  );
  const [reviewedOnly, setReviewedOnly] = useState(false);

  const currentHighlightsWithEvidence = useMemo<BudgetHighlightWithEvidence[]>(
    () =>
      currentHighlights.map((item) => ({
        ...item,
        evidenceStatus: inferEvidenceStatus({ source_url: item.source_url }),
      })),
    [currentHighlights]
  );
  const currentKnowledgeNotesWithEvidence = useMemo<KnowledgeNoteWithEvidence[]>(
    () =>
      currentKnowledgeNotes.map((item) => ({
        ...item,
        evidenceStatus: inferEvidenceStatusFromSources(item.sources),
      })),
    [currentKnowledgeNotes]
  );
  const currentStructuredFactsWithEvidence = useMemo<StructuredFactWithEvidence[]>(
    () =>
      currentStructuredFacts.map((item) => ({
        ...item,
        evidenceStatus: inferEvidenceStatusFromSources(item.sources),
      })),
    [currentStructuredFacts]
  );
  const currentImplementationSitesWithEvidence = useMemo<ImplementationSiteWithEvidence[]>(
    () =>
      currentImplementationSites.map((item) => ({
        ...item,
        evidenceStatus: inferEvidenceStatusFromSources(item.sources),
      })),
    [currentImplementationSites]
  );
  const buildKnowledgeNoteFlowHref = (item: KnowledgeNoteWithEvidence): string | null => {
    if (!item.flow_focus_target_id) {
      return null;
    }
    const params = new URLSearchParams({
      view: '2d',
      year: String(item.fiscal_year),
      entity: item.entity_id,
      focus: item.flow_focus_target_id,
    });
    return `${window.location.pathname}?${params.toString()}`;
  };

  const majorPrograms = useMemo<MajorProgramWithEvidence[]>(() => {
    return edges
      .filter((edge) => edge.source_id === activeEntityId && edge.year === currentYear && isBudgetSurfaceEligibleEdge(edge))
      .sort((a, b) => b.value_usd - a.value_usd)
      .slice(0, 8)
      .map((edge) => ({
        ...edge,
        targetName: nodes.find((node) => node.id === edge.target_id)?.name || edge.target_id,
        evidenceStatus: inferEvidenceStatus(edge) as Exclude<BudgetEvidenceStatus, 'hybrid'>,
      }));
  }, [activeEntityId, currentYear, edges, nodes]);
  const previousMajorPrograms = useMemo<MajorProgramWithEvidence[]>(() => {
    if (previousYear === null) {
      return [];
    }
    return edges
      .filter((edge) => edge.source_id === activeEntityId && edge.year === previousYear && isBudgetSurfaceEligibleEdge(edge))
      .sort((a, b) => b.value_usd - a.value_usd)
      .slice(0, 8)
      .map((edge) => ({
        ...edge,
        targetName: nodes.find((node) => node.id === edge.target_id)?.name || edge.target_id,
        evidenceStatus: inferEvidenceStatus(edge) as Exclude<BudgetEvidenceStatus, 'hybrid'>,
      }));
  }, [activeEntityId, edges, nodes, previousYear]);
  const visibleHighlights = useMemo(
    () => currentHighlightsWithEvidence.filter((item) => shouldIncludeBudgetItem(item, reviewedOnly)),
    [currentHighlightsWithEvidence, reviewedOnly]
  );
  const visibleIncreaseDrivers = useMemo(
    () => visibleHighlights.filter((item) => item.section_key === 'increase_driver'),
    [visibleHighlights]
  );
  const visiblePolicyFrames = useMemo(
    () => visibleHighlights.filter((item) => item.section_key === 'policy_frame'),
    [visibleHighlights]
  );
  const visibleIndividualProjects = useMemo(
    () => visibleHighlights.filter((item) => item.section_key === 'individual_project'),
    [visibleHighlights]
  );
  const visibleOverview = useMemo(
    () => visibleHighlights.find((item) => item.section_key === 'overview'),
    [visibleHighlights]
  );
  const visibleKnowledgeNotes = useMemo(
    () => currentKnowledgeNotesWithEvidence.filter((item) => shouldIncludeBudgetItem(item, reviewedOnly)),
    [currentKnowledgeNotesWithEvidence, reviewedOnly]
  );
  const visibleStructuredFacts = useMemo(
    () => currentStructuredFactsWithEvidence.filter((item) => shouldIncludeBudgetItem(item, reviewedOnly)),
    [currentStructuredFactsWithEvidence, reviewedOnly]
  );
  const visibleImplementationSites = useMemo(
    () => currentImplementationSitesWithEvidence.filter((item) => shouldIncludeBudgetItem(item, reviewedOnly)),
    [currentImplementationSitesWithEvidence, reviewedOnly]
  );
  const visibleMajorPrograms = useMemo(
    () => majorPrograms.filter((item) => shouldIncludeBudgetItem(item, reviewedOnly)),
    [majorPrograms, reviewedOnly]
  );
  const yearComparisonRows = useMemo(() => {
    if (previousYear === null) {
      return [];
    }
    const currentMap = new Map(visibleMajorPrograms.map((program) => [program.target_id, program]));
    const previousMap = new Map(
      previousMajorPrograms
        .filter((program) => shouldIncludeBudgetItem(program, reviewedOnly))
        .map((program) => [program.target_id, program])
    );
    const targetIds = [...new Set([...currentMap.keys(), ...previousMap.keys()])];
    return targetIds
      .map((targetId) => {
        const current = currentMap.get(targetId);
        const previous = previousMap.get(targetId);
        const currentOku = current ? amountUsdToOku(current.value_usd) : 0;
        const previousOku = previous ? amountUsdToOku(previous.value_usd) : 0;
        return {
          targetId,
          title: current?.sub_category || previous?.sub_category || current?.targetName || previous?.targetName || targetId,
          current,
          previous,
          currentOku,
          previousOku,
          deltaOku: currentOku - previousOku,
        };
      })
      .sort((a, b) => Math.abs(b.deltaOku) - Math.abs(a.deltaOku));
  }, [previousMajorPrograms, previousYear, reviewedOnly, visibleMajorPrograms]);

  const evidenceSummary = useMemo(() => {
    const allItems = [
      ...currentHighlightsWithEvidence,
      ...majorPrograms,
      ...currentKnowledgeNotesWithEvidence,
      ...currentStructuredFactsWithEvidence,
      ...currentImplementationSitesWithEvidence,
    ];
    const visibleItems = [
      ...visibleHighlights,
      ...visibleMajorPrograms,
      ...visibleKnowledgeNotes,
      ...visibleStructuredFacts,
      ...visibleImplementationSites,
    ];
    const allCounts = countBudgetEvidence(allItems);
    const visibleCounts = countBudgetEvidence(visibleItems);
    return {
      allCounts,
      visibleCounts,
      hiddenModelBasedCount: Math.max(0, allCounts['model-based'] - visibleCounts['model-based']),
    };
  }, [
    currentHighlightsWithEvidence,
    currentImplementationSitesWithEvidence,
    currentKnowledgeNotesWithEvidence,
    currentStructuredFactsWithEvidence,
    majorPrograms,
    visibleHighlights,
    visibleImplementationSites,
    visibleKnowledgeNotes,
    visibleMajorPrograms,
    visibleStructuredFacts,
  ]);

  const selectedEntityName = entityOptions.find((item) => item.entityId === activeEntityId)?.name || activeEntityId;
  const coverageStatus = useMemo<BudgetEvidenceStatus | null>(
    () =>
      aggregateBudgetEvidenceStatus([
        ...visibleHighlights,
        ...visibleMajorPrograms,
        ...visibleKnowledgeNotes,
        ...visibleStructuredFacts,
        ...visibleImplementationSites,
      ]),
    [visibleHighlights, visibleImplementationSites, visibleKnowledgeNotes, visibleMajorPrograms, visibleStructuredFacts]
  );
  const visibleResearchItemCount = visibleStructuredFacts.length + visibleKnowledgeNotes.length + visibleImplementationSites.length;
  const hasAnyBudgetHighlights = currentHighlights.length > 0;
  const hasVisibleBudgetHighlights = visibleHighlights.length > 0;
  const hasHiddenBudgetHighlights = reviewedOnly && hasAnyBudgetHighlights && !hasVisibleBudgetHighlights;
  const hasAnyResearchItems = currentStructuredFacts.length + currentKnowledgeNotes.length + currentImplementationSites.length > 0;
  const hasHiddenResearchItems = reviewedOnly && hasAnyResearchItems && visibleResearchItemCount === 0;
  const previousOverviewWithEvidence = useMemo<BudgetHighlightWithEvidence | null>(() => {
    const previousOverview = previousHighlights.find((item) => item.section_key === 'overview');
    if (!previousOverview) {
      return null;
    }
    const evidenceStatus = inferEvidenceStatus({ source_url: previousOverview.source_url });
    if (reviewedOnly && evidenceStatus !== 'reviewed') {
      return null;
    }
    return {
      ...previousOverview,
      evidenceStatus,
    };
  }, [previousHighlights, reviewedOnly]);

  const tabContent = useMemo(() => {
    const renderEmptyTabState = (message: string) => (
      <div
        style={{
          padding: '1.2rem',
          borderRadius: '18px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(148, 163, 184, 0.16)',
          color: 'var(--text-muted)',
          lineHeight: 1.7,
        }}
      >
        {message}
      </div>
    );

    if (!activeEntityId) {
      return renderEmptyTabState('表示対象の主体が見つかりません。');
    }

    if (activeTab === 'research_note') {
      if (visibleResearchItemCount) {
        return (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {visibleStructuredFacts.length ? (
              <section style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.9rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: TAB_ACCENTS.research_note }}>
                  Structured Facts
                </div>
                {renderStructuredFactGrid(visibleStructuredFacts, TAB_ACCENTS.research_note)}
              </section>
            ) : null}
            {visibleKnowledgeNotes.length ? (
              <section style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.9rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: TAB_ACCENTS.research_note }}>
                  Research Notes
                </div>
                {renderKnowledgeNoteGrid(visibleKnowledgeNotes, TAB_ACCENTS.research_note, buildKnowledgeNoteFlowHref)}
              </section>
            ) : null}
            {visibleImplementationSites.length ? (
              <section style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.9rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: TAB_ACCENTS.research_note }}>
                  Implementation Sites
                </div>
                {renderImplementationSiteDirectory(visibleImplementationSites, TAB_ACCENTS.research_note)}
              </section>
            ) : null}
          </div>
        );
      }

      return renderEmptyTabState(
        `${
          hasHiddenResearchItems
            ? `${selectedEntityName} の ${currentYear} 年度調査ノートは model-based 項目のみです。実データのみ表示をオフにすると確認できます。`
            : `${selectedEntityName} の ${currentYear} 年度調査ノートは未登録です。`
        }${
          [...new Set([...availableKnowledgeYears, ...availableStructuredFactYears, ...availableImplementationSiteYears])].length > 0
            ? ` 登録済み年度: ${[...new Set([...availableKnowledgeYears, ...availableStructuredFactYears, ...availableImplementationSiteYears])].join(', ')}`
            : ' 登録済みの調査ノート / structured facts / 実施施設データがありません。'
        }`
      );
    }

    if (!hasVisibleBudgetHighlights) {
      return renderEmptyTabState(
        `${
          hasHiddenBudgetHighlights
            ? `${selectedEntityName} の ${currentYear} 年度ハイライトは model-based 項目のみです。実データのみ表示をオフにすると確認できます。`
            : `${selectedEntityName} の ${currentYear} 年度ハイライトは未登録です。`
        }${availableYears.length > 0 ? ` 登録済み年度: ${availableYears.join(', ')}` : ' 登録済みの予算ハイライトがありません。'}`
      );
    }

    if (activeTab === 'overview' && visibleOverview) {
      return (
        <section
          style={{
            padding: '1.4rem',
            borderRadius: '22px',
            background:
              'radial-gradient(circle at top left, rgba(251, 191, 36, 0.18) 0%, rgba(20, 28, 44, 0.95) 48%, rgba(8, 12, 20, 0.96) 100%)',
            border: '1px solid rgba(251, 191, 36, 0.22)',
          }}
        >
          <div style={{ color: TAB_ACCENTS.overview, fontSize: '0.8rem', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Overview
          </div>
          <div style={{ marginTop: '0.7rem' }}>{renderEvidenceBadge(visibleOverview.evidenceStatus)}</div>
          <div style={{ marginTop: '0.6rem', fontSize: '2.4rem', fontWeight: 700, letterSpacing: '-0.04em' }}>
            {visibleOverview.amount_text}
          </div>
          {visibleOverview.summary && (
            <div
              style={{
                marginTop: '0.9rem',
                padding: '1rem 1.05rem',
                borderRadius: '16px',
                background: 'rgba(255,255,255,0.04)',
                lineHeight: 1.7,
                fontSize: '1rem',
              }}
            >
              {visibleOverview.summary}
            </div>
          )}
          {renderSourceLink(visibleOverview, TAB_ACCENTS.overview)}
        </section>
      );
    }

    if (activeTab === 'increase_driver') {
      if (!visibleIncreaseDrivers.length) {
        return renderEmptyTabState('この年度の増要因は、現在の evidence フィルタ条件では表示できません。');
      }
      return renderHighlightGrid(visibleIncreaseDrivers, TAB_ACCENTS.increase_driver);
    }

    if (activeTab === 'policy_frame') {
      if (!visiblePolicyFrames.length) {
        return renderEmptyTabState('この年度の政策枠は、現在の evidence フィルタ条件では表示できません。');
      }
      return renderHighlightGrid(visiblePolicyFrames, TAB_ACCENTS.policy_frame);
    }

    if (activeTab === 'individual_project') {
      if (!visibleIndividualProjects.length) {
        return renderEmptyTabState('この年度の個別施策は、現在の evidence フィルタ条件では表示できません。');
      }
      return renderHighlightGrid(visibleIndividualProjects, TAB_ACCENTS.individual_project);
    }

    if (activeTab === 'year_compare') {
      const currentOverview = visibleOverview;
      const previousOverview = previousOverviewWithEvidence;
      const totalDelta =
        currentOverview?.amount_oku_yen !== null &&
        currentOverview?.amount_oku_yen !== undefined &&
        previousOverview?.amount_oku_yen !== null &&
        previousOverview?.amount_oku_yen !== undefined
          ? Number(currentOverview.amount_oku_yen) - Number(previousOverview.amount_oku_yen)
          : null;

      return (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem' }}>
            <article
              style={{
                padding: '1rem',
                borderRadius: '18px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(252, 165, 165, 0.18)',
              }}
            >
              <div style={{ color: TAB_ACCENTS.year_compare, fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                Current
              </div>
              <div style={{ marginTop: '0.45rem', fontSize: '1.35rem', fontWeight: 700 }}>{currentYear}年度</div>
              <div style={{ marginTop: '0.35rem', color: '#fff', fontSize: '1.8rem', fontWeight: 700 }}>
                {currentOverview?.amount_text || '未登録'}
              </div>
              {currentOverview?.summary && (
                <div style={{ marginTop: '0.55rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{currentOverview.summary}</div>
              )}
            </article>
            <article
              style={{
                padding: '1rem',
                borderRadius: '18px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(148, 163, 184, 0.18)',
              }}
            >
              <div style={{ color: '#cbd5e1', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                Previous
              </div>
              <div style={{ marginTop: '0.45rem', fontSize: '1.35rem', fontWeight: 700 }}>
                {previousYear ? `${previousYear}年度` : '比較対象なし'}
              </div>
              <div style={{ marginTop: '0.35rem', color: '#fff', fontSize: '1.8rem', fontWeight: 700 }}>
                {previousOverview?.amount_text || '未登録'}
              </div>
              {previousOverview?.summary && (
                <div style={{ marginTop: '0.55rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{previousOverview.summary}</div>
              )}
            </article>
            <article
              style={{
                padding: '1rem',
                borderRadius: '18px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(96, 165, 250, 0.18)',
              }}
            >
              <div style={{ color: '#93c5fd', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                Delta
              </div>
              <div style={{ marginTop: '0.45rem', fontSize: '1.35rem', fontWeight: 700 }}>主な事業差分</div>
              <div style={{ marginTop: '0.35rem', color: '#fff', fontSize: '1.8rem', fontWeight: 700 }}>
                {formatOkuuDelta(totalDelta)}
              </div>
              <div style={{ marginTop: '0.55rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {previousYear ? `${previousYear}年度との比較で、主要事業 edge の増減と有無を一覧化しています。` : '前年ハイライトがないため、差分比較はまだできません。'}
              </div>
            </article>
          </div>

          <div style={{ display: 'grid', gap: '0.8rem' }}>
            {yearComparisonRows.length ? (
              yearComparisonRows.map((row) => (
                <article
                  key={row.targetId}
                  style={{
                    padding: '1rem',
                    borderRadius: '18px',
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${row.deltaOku >= 0 ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 700, lineHeight: 1.45 }}>{row.title}</div>
                    <div style={{ color: row.deltaOku >= 0 ? '#86efac' : '#fda4af', fontWeight: 700 }}>
                      {formatOkuuDelta(row.deltaOku)}
                    </div>
                  </div>
                  <div style={{ marginTop: '0.45rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{currentYear}年度</div>
                      <div style={{ marginTop: '0.2rem', fontWeight: 600 }}>
                        {row.current ? formatExactBudgetAmount(row.current.value_usd) : '未掲載'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{previousYear}年度</div>
                      <div style={{ marginTop: '0.2rem', fontWeight: 600 }}>
                        {row.previous ? formatExactBudgetAmount(row.previous.value_usd) : '未掲載'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>出典</div>
                      <div style={{ marginTop: '0.2rem', fontWeight: 600 }}>
                        {row.current?.source_title || row.previous?.source_title || row.current?.source_dataset || row.previous?.source_dataset || '未登録'}
                      </div>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div
                style={{
                  padding: '1.2rem',
                  borderRadius: '18px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(148, 163, 184, 0.16)',
                  color: 'var(--text-muted)',
                }}
              >
                {previousYear ? '比較できる主要事業 edge がまだありません。' : '前年データがないため、年度比較はまだできません。'}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      visibleMajorPrograms.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem' }}>
          {visibleMajorPrograms.map((program) => (
            <article
              key={`${program.source_id}-${program.target_id}-${program.year}`}
              style={{
                padding: '1rem',
                borderRadius: '18px',
                background: program.target_id === focusTargetId ? 'rgba(96, 165, 250, 0.12)' : 'rgba(255,255,255,0.04)',
                border: program.target_id === focusTargetId ? '1px solid rgba(96, 165, 250, 0.38)' : '1px solid rgba(96, 165, 250, 0.18)',
                boxShadow: program.target_id === focusTargetId ? '0 0 0 1px rgba(191, 219, 254, 0.18) inset' : 'none',
              }}
            >
              <div style={{ marginBottom: '0.55rem' }}>{renderEvidenceBadge(program.evidenceStatus)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' }}>
                <div style={{ fontWeight: 700, lineHeight: 1.45 }}>{program.sub_category || program.targetName}</div>
                <div style={{ color: TAB_ACCENTS.major_program, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {formatExactBudgetAmount(program.value_usd)}
                </div>
              </div>
              <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                {program.targetName}
              </div>
              {program.description && (
                <div style={{ marginTop: '0.45rem', color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6 }}>
                  {program.description}
                </div>
              )}
              {renderSourceLink(
                { source_url: program.source_url, source_title: program.source_title || '元の資料', page_number: program.page_number },
                TAB_ACCENTS.major_program
              )}
            </article>
          ))}
        </div>
      ) : (
        renderEmptyTabState('この年度の主な事業 edge は、現在の evidence フィルタ条件では表示できません。')
      )
    );
  }, [
    activeTab,
    activeEntityId,
    availableKnowledgeYears,
    availableImplementationSiteYears,
    availableStructuredFactYears,
    availableYears,
    currentYear,
    focusTargetId,
    hasHiddenBudgetHighlights,
    hasHiddenResearchItems,
    hasVisibleBudgetHighlights,
    previousOverviewWithEvidence,
    previousYear,
    selectedEntityName,
    visibleImplementationSites,
    visibleIncreaseDrivers,
    visibleIndividualProjects,
    visibleKnowledgeNotes,
    visibleMajorPrograms,
    visibleOverview,
    visiblePolicyFrames,
    visibleResearchItemCount,
    visibleStructuredFacts,
    yearComparisonRows,
  ]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '2rem',
        paddingTop: '5rem',
        background: 'radial-gradient(circle at top, rgba(22, 28, 45, 0.98) 0%, #03050a 62%, #000 100%)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1.2rem' }}>
        <div>
          <div style={{ color: '#fbbf24', fontSize: '0.78rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            Budget View
          </div>
          <h1 style={{ margin: '0.35rem 0 0', fontSize: '2rem', fontWeight: 700 }}>
            予算ハイライト専用ページ
          </h1>
          <p style={{ margin: '0.45rem 0 0', color: 'var(--text-muted)' }}>
            3D / 2D のフロー画面と分離し、資料根拠付きの予算サマリーだけを読みやすくまとめています。
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            background: 'rgba(255,255,255,0.04)',
            padding: '1rem',
            borderRadius: '14px',
            border: '1px solid rgba(148, 163, 184, 0.14)',
            minWidth: '260px',
          }}
        >
          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>対象省庁 / 主体</label>
          <select
            value={activeEntityId}
            onChange={(event) => onSelectedEntityChange(event.target.value)}
            style={{
              background: '#000',
              color: '#fff',
              border: '1px solid #333',
              padding: '0.65rem 0.75rem',
              borderRadius: '10px',
              fontFamily: 'inherit',
            }}
          >
            {entityOptions.map((option) => (
              <option key={option.entityId} value={option.entityId}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          borderRadius: '22px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{selectedEntityName}</div>
          <div style={{ marginTop: '0.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {currentYear}年度の登録済み予算ハイライト / 調査ナレッジ
          </div>
          {coverageStatus && (
            <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
              {renderEvidenceBadge(coverageStatus)}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {EVIDENCE_BADGE_STYLE[coverageStatus].description}
              </span>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gap: '0.8rem',
            minWidth: '280px',
            padding: '0.95rem 1rem',
            borderRadius: '18px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(148, 163, 184, 0.12)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#cbd5e1', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                Evidence Mix
              </div>
              <div style={{ marginTop: '0.25rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                Budget / research に表示する根拠の種類
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', fontSize: '0.86rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={reviewedOnly}
                onChange={(event) => setReviewedOnly(event.target.checked)}
                style={{ accentColor: '#86efac' }}
              />
              実データのみ表示
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {(['reviewed', 'model-based'] as const).map((status) => (
              <div
                key={status}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.45rem 0.7rem',
                  borderRadius: '999px',
                  background: EVIDENCE_BADGE_STYLE[status].background,
                  border: `1px solid ${EVIDENCE_BADGE_STYLE[status].border}`,
                }}
              >
                {renderEvidenceBadge(status)}
                <span style={{ color: 'var(--text-main)', fontSize: '0.84rem', fontWeight: 600 }}>
                  {reviewedOnly ? evidenceSummary.visibleCounts[status] : evidenceSummary.allCounts[status]}件
                </span>
              </div>
            ))}
          </div>
          {reviewedOnly && evidenceSummary.hiddenModelBasedCount > 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.6 }}>
              model-based 項目 {evidenceSummary.hiddenModelBasedCount} 件を非表示にしています。
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
          {(Object.keys(TAB_LABELS) as BudgetTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setManualTabState({ scopeKey: tabScopeKey, tab })}
              style={{
                background: activeTab === tab ? TAB_ACCENTS[tab] : 'rgba(255,255,255,0.04)',
                color: activeTab === tab ? '#081018' : 'var(--text-main)',
                border: `1px solid ${activeTab === tab ? TAB_ACCENTS[tab] : 'rgba(148, 163, 184, 0.16)'}`,
                padding: '0.55rem 0.85rem',
                borderRadius: '999px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          borderRadius: '22px',
          padding: '1.15rem',
        }}
      >
        {tabContent}
      </div>
    </div>
  );
};
