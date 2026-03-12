import React, { useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from '../data/mockGenerator';
import type { AppMetadata, BudgetHighlight } from '../types/frontendData';
import { JPY_RATE } from '../utils/currencyFormatter';

type BudgetTab = 'overview' | 'increase_driver' | 'policy_frame' | 'major_program' | 'individual_project' | 'year_compare';

interface BudgetReportPageProps {
  currentYear: number;
  nodes: Node[];
  edges: Edge[];
  metadata: AppMetadata;
}

const TAB_LABELS: Record<BudgetTab, string> = {
  overview: '総額',
  increase_driver: '増要因',
  policy_frame: '政策枠',
  major_program: '主な事業',
  individual_project: '個別施策',
  year_compare: '年度比較',
};

const TAB_ACCENTS: Record<BudgetTab, string> = {
  overview: '#fde68a',
  increase_driver: '#fbbf24',
  policy_frame: '#34d399',
  major_program: '#60a5fa',
  individual_project: '#c084fc',
  year_compare: '#fca5a5',
};

type BudgetEvidenceStatus = 'reviewed' | 'model-based' | 'hybrid';

const MODEL_BUDGET_DATASETS = new Set(['省庁別主要経費推計', '財務省 一般会計（所管別）', '財務省一般会計', 'ministries_data']);

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

function inferEvidenceStatus(item: { source_dataset?: string | null; source_url?: string | null }): BudgetEvidenceStatus {
  if (item.source_dataset && MODEL_BUDGET_DATASETS.has(item.source_dataset)) {
    return 'model-based';
  }
  if (item.source_url && item.source_url.toLowerCase().includes('.pdf')) {
    return 'reviewed';
  }
  return 'model-based';
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
  const allowedTabs = new Set<BudgetTab>(['overview', 'increase_driver', 'policy_frame', 'major_program', 'individual_project', 'year_compare']);
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

function renderHighlightGrid(items: BudgetHighlight[], accent: string) {
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
          <div style={{ marginBottom: '0.55rem' }}>{renderEvidenceBadge(inferEvidenceStatus({ source_url: item.source_url }))}</div>
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

export const BudgetReportPage: React.FC<BudgetReportPageProps> = ({ currentYear, nodes, edges, metadata }) => {
  const budgetHighlights = metadata.budgetHighlights || [];
  const budgetPageParams = useMemo(() => parseBudgetPageParams(), []);
  const entityOptions = useMemo(() => {
    return [...new Set(budgetHighlights.map((item) => item.entity_id))]
      .map((entityId) => ({
        entityId,
        name: nodes.find((node) => node.id === entityId)?.name || entityId,
      }))
      .sort((a, b) => {
        if (a.entityId === metadata.featuredEntityId) return -1;
        if (b.entityId === metadata.featuredEntityId) return 1;
        return a.name.localeCompare(b.name, 'ja');
      });
  }, [budgetHighlights, metadata.featuredEntityId, nodes]);

  const [selectedEntityId, setSelectedEntityId] = useState<string>(
    budgetPageParams.entityId || metadata.featuredEntityId || entityOptions[0]?.entityId || ''
  );
  const [activeTab, setActiveTab] = useState<BudgetTab>(
    budgetPageParams.tab || (budgetPageParams.focusTargetId ? 'major_program' : 'overview')
  );
  const focusTargetId = budgetPageParams.focusTargetId;

  useEffect(() => {
    if (!entityOptions.some((item) => item.entityId === selectedEntityId)) {
      setSelectedEntityId(budgetPageParams.entityId || metadata.featuredEntityId || entityOptions[0]?.entityId || '');
    }
  }, [budgetPageParams.entityId, entityOptions, metadata.featuredEntityId, selectedEntityId]);

  useEffect(() => {
    setActiveTab(budgetPageParams.tab || (focusTargetId ? 'major_program' : 'overview'));
  }, [budgetPageParams.tab, currentYear, focusTargetId, selectedEntityId]);

  const currentHighlights = useMemo(
    () =>
      budgetHighlights
        .filter((item) => item.entity_id === selectedEntityId && item.fiscal_year === currentYear)
        .sort((a, b) => a.display_order - b.display_order),
    [budgetHighlights, currentYear, selectedEntityId]
  );

  const overview = currentHighlights.find((item) => item.section_key === 'overview');
  const increaseDrivers = currentHighlights.filter((item) => item.section_key === 'increase_driver');
  const policyFrames = currentHighlights.filter((item) => item.section_key === 'policy_frame');
  const individualProjects = currentHighlights.filter((item) => item.section_key === 'individual_project');
  const availableYears = useMemo(
    () => [...new Set(budgetHighlights.filter((item) => item.entity_id === selectedEntityId).map((item) => item.fiscal_year))].sort(),
    [budgetHighlights, selectedEntityId]
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
            .filter((item) => item.entity_id === selectedEntityId && item.fiscal_year === previousYear)
            .sort((a, b) => a.display_order - b.display_order),
    [budgetHighlights, previousYear, selectedEntityId]
  );

  const majorPrograms = useMemo(() => {
    return edges
      .filter((edge) => edge.source_id === selectedEntityId && edge.year === currentYear)
      .sort((a, b) => b.value_usd - a.value_usd)
      .slice(0, 8)
      .map((edge) => ({
        ...edge,
        targetName: nodes.find((node) => node.id === edge.target_id)?.name || edge.target_id,
      }));
  }, [currentYear, edges, nodes, selectedEntityId]);
  const previousMajorPrograms = useMemo(() => {
    if (previousYear === null) {
      return [];
    }
    return edges
      .filter((edge) => edge.source_id === selectedEntityId && edge.year === previousYear)
      .sort((a, b) => b.value_usd - a.value_usd)
      .slice(0, 8)
      .map((edge) => ({
        ...edge,
        targetName: nodes.find((node) => node.id === edge.target_id)?.name || edge.target_id,
      }));
  }, [edges, nodes, previousYear, selectedEntityId]);
  const yearComparisonRows = useMemo(() => {
    if (previousYear === null) {
      return [];
    }
    const currentMap = new Map(majorPrograms.map((program) => [program.target_id, program]));
    const previousMap = new Map(previousMajorPrograms.map((program) => [program.target_id, program]));
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
  }, [majorPrograms, previousMajorPrograms, previousYear]);

  const selectedEntityName = entityOptions.find((item) => item.entityId === selectedEntityId)?.name || selectedEntityId;
  const coverageStatus = useMemo<BudgetEvidenceStatus | null>(() => {
    const statuses = new Set<BudgetEvidenceStatus>();

    currentHighlights.forEach((item) => statuses.add(inferEvidenceStatus({ source_url: item.source_url })));
    majorPrograms.forEach((program) => statuses.add(inferEvidenceStatus(program)));

    if (statuses.size === 0) {
      return null;
    }
    if (statuses.size > 1) {
      return 'hybrid';
    }
    return Array.from(statuses)[0];
  }, [currentHighlights, majorPrograms]);

  const tabContent = useMemo(() => {
    if (!selectedEntityId || !currentHighlights.length) {
      return (
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
          {selectedEntityName} の {currentYear} 年度ハイライトは未登録です。
          {availableYears.length > 0 ? ` 登録済み年度: ${availableYears.join(', ')}` : ' 登録済みの予算ハイライトがありません。'}
        </div>
      );
    }

    if (activeTab === 'overview' && overview) {
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
          <div style={{ marginTop: '0.6rem', fontSize: '2.4rem', fontWeight: 700, letterSpacing: '-0.04em' }}>
            {overview.amount_text}
          </div>
          {overview.summary && (
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
              {overview.summary}
            </div>
          )}
          {renderSourceLink(overview, TAB_ACCENTS.overview)}
        </section>
      );
    }

    if (activeTab === 'increase_driver') {
      return renderHighlightGrid(increaseDrivers, TAB_ACCENTS.increase_driver);
    }

    if (activeTab === 'policy_frame') {
      return renderHighlightGrid(policyFrames, TAB_ACCENTS.policy_frame);
    }

    if (activeTab === 'individual_project') {
      return renderHighlightGrid(individualProjects, TAB_ACCENTS.individual_project);
    }

    if (activeTab === 'year_compare') {
      const currentOverview = overview;
      const previousOverview = previousHighlights.find((item) => item.section_key === 'overview');
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem' }}>
        {majorPrograms.map((program) => (
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
            <div style={{ marginBottom: '0.55rem' }}>{renderEvidenceBadge(inferEvidenceStatus(program))}</div>
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
    );
  }, [
    activeTab,
    availableYears,
    currentHighlights,
    currentYear,
    increaseDrivers,
    individualProjects,
    majorPrograms,
    overview,
    policyFrames,
    previousHighlights,
    previousMajorPrograms,
    previousYear,
    selectedEntityId,
    selectedEntityName,
    yearComparisonRows,
    focusTargetId,
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
            value={selectedEntityId}
            onChange={(event) => setSelectedEntityId(event.target.value)}
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
            {currentYear}年度の登録済み予算ハイライト
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

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
          {(Object.keys(TAB_LABELS) as BudgetTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
