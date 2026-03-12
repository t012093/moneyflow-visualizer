import React, { useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from '../data/mockGenerator';
import type { AppMetadata, BudgetHighlight } from '../types/frontendData';
import { JPY_RATE } from '../utils/currencyFormatter';

type BudgetTab = 'overview' | 'increase_driver' | 'policy_frame' | 'major_program' | 'individual_project';

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
};

const TAB_ACCENTS: Record<BudgetTab, string> = {
  overview: '#fde68a',
  increase_driver: '#fbbf24',
  policy_frame: '#34d399',
  major_program: '#60a5fa',
  individual_project: '#c084fc',
};

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
    metadata.featuredEntityId || entityOptions[0]?.entityId || ''
  );
  const [activeTab, setActiveTab] = useState<BudgetTab>('overview');

  useEffect(() => {
    if (!entityOptions.some((item) => item.entityId === selectedEntityId)) {
      setSelectedEntityId(metadata.featuredEntityId || entityOptions[0]?.entityId || '');
    }
  }, [entityOptions, metadata.featuredEntityId, selectedEntityId]);

  useEffect(() => {
    setActiveTab('overview');
  }, [currentYear, selectedEntityId]);

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

  const selectedEntityName = entityOptions.find((item) => item.entityId === selectedEntityId)?.name || selectedEntityId;

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

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem' }}>
        {majorPrograms.map((program) => (
          <article
            key={`${program.source_id}-${program.target_id}-${program.year}`}
            style={{
              padding: '1rem',
              borderRadius: '18px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(96, 165, 250, 0.18)',
            }}
          >
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
            {renderSourceLink({ source_url: program.source_url, source_title: '元の資料' }, TAB_ACCENTS.major_program)}
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
    selectedEntityId,
    selectedEntityName,
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
