import { useState, useEffect, useMemo } from 'react';
import { GlobeView } from './components/GlobeView';
import { FlowDashboard } from './components/FlowDashboard';
import { BudgetReportPage } from './components/BudgetReportPage';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { HUD } from './components/HUD';
import type { Edge, Node } from './data/mockGenerator';
import unifiedDataRaw from './data/unified_data.json';
import { FileText, Globe, GitMerge } from 'lucide-react';
import type { UnifiedData } from './types/frontendData';
import './index.css';

const CATEGORIES = ['trade', 'banking', 'crypto', 'remittance', 'bop', 'welfare', 'services', 'technology', 'education', 'infrastructure', 'tax'];
const MODELED_DATASET_MARKERS = ['省庁別主要経費推計', '想定', 'Proxy', 'Approximation', 'Estimated', 'ministries_data', '財務省 一般会計（所管別）', '財務省一般会計', 'meti_data'];

// Type assertion for the imported unified JSON (from SQLite DB export)
const unifiedData = unifiedDataRaw as unknown as UnifiedData;
const YEARS = unifiedData.metadata?.fiscal_years?.length
  ? unifiedData.metadata.fiscal_years
  : [2021, 2022, 2023, 2024, 2025];
const DEFAULT_YEAR = unifiedData.metadata?.latestFiscalYear || YEARS[YEARS.length - 1];

const getInitialYear = () => {
  const params = new URLSearchParams(window.location.search);
  const requestedYear = Number(params.get('year'));
  if (Number.isFinite(requestedYear) && YEARS.includes(requestedYear)) {
    return requestedYear;
  }
  return DEFAULT_YEAR;
};

const getInitialViewMode = (): '3D' | '2D' | 'Budget' => {
  const params = new URLSearchParams(window.location.search);
  const requestedView = (params.get('view') || '').toLowerCase();

  if (requestedView === '2d' || requestedView === 'flow') {
    return '2D';
  }
  if (requestedView === 'budget' || requestedView === 'report') {
    return 'Budget';
  }
  return '3D';
};

const getInitialEntityId = (fallback: string) => {
  const params = new URLSearchParams(window.location.search);
  return params.get('entity') || fallback;
};

const hasRealDataEdge = (edge: Edge) => {
  const dataset = edge.source_dataset || '';
  return dataset !== '' && !MODELED_DATASET_MARKERS.some((marker) => dataset.includes(marker));
};

const getNearestAvailableYear = (years: number[], targetYear: number) => {
  if (!years.length) {
    return targetYear;
  }
  return years.reduce((nearest, year) =>
    Math.abs(year - targetYear) < Math.abs(nearest - targetYear) ? year : nearest
  , years[0]);
};

export const GLOBAL_NODES = unifiedData.nodes;

// Group edges by year for the timeline playback
const datasetByYear: Record<number, Edge[]> = {};
unifiedData.edges.forEach((edge: Edge) => {
  if (!datasetByYear[edge.year]) datasetByYear[edge.year] = [];
  datasetByYear[edge.year].push(edge);
});

function App() {
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [currentYear, setCurrentYear] = useState(getInitialYear);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<'3D' | '2D' | 'Budget'>(getInitialViewMode);
  const [selectedFlowEntityId, setSelectedFlowEntityId] = useState(() => getInitialEntityId('MIN_CFA'));
  const [selectedBudgetEntityId, setSelectedBudgetEntityId] = useState(() => getInitialEntityId(unifiedData.metadata.featuredEntityId || 'MIN_CFA'));
  
  const [activeCategories, setActiveCategories] = useState<string[]>(['trade', 'banking', 'bop', 'remittance', 'crypto', 'welfare', 'services', 'technology', 'education', 'infrastructure', 'tax']);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.7);
  const [currency, setCurrency] = useState<'USD' | 'JPY'>('JPY');

  const [hoveredEdge, setHoveredEdge] = useState<Edge | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const budgetEntityIds = useMemo(
    () =>
      [
        ...(unifiedData.metadata.budgetHighlights || []).map((item) => item.entity_id),
        ...(unifiedData.metadata.knowledgeNotes || []).map((item) => item.entity_id),
        ...(unifiedData.metadata.structuredFacts || []).map((item) => item.entity_id),
      ].filter((value, index, array) => array.indexOf(value) === index),
    []
  );
  const available3DYears = useMemo(
    () => YEARS.filter((year) => (datasetByYear[year] || []).some((edge) => hasRealDataEdge(edge))),
    []
  );
  const available2DYears = useMemo(
    () =>
      YEARS.filter((year) =>
        (datasetByYear[year] || []).some(
          (edge) => (edge.source_id === selectedFlowEntityId || edge.target_id === selectedFlowEntityId) && hasRealDataEdge(edge)
        )
      ),
    [selectedFlowEntityId]
  );
  const availableBudgetYears = useMemo(
    () =>
      YEARS.filter((year) =>
        (unifiedData.metadata.budgetHighlights || []).some((item) => item.entity_id === selectedBudgetEntityId && item.fiscal_year === year) ||
        (unifiedData.metadata.knowledgeNotes || []).some((item) => item.entity_id === selectedBudgetEntityId && item.fiscal_year === year) ||
        (unifiedData.metadata.structuredFacts || []).some((item) => item.entity_id === selectedBudgetEntityId && item.fiscal_year === year)
      ),
    [selectedBudgetEntityId]
  );
  const selectableYears = useMemo(() => {
    if (viewMode === '2D') {
      return available2DYears;
    }
    if (viewMode === 'Budget') {
      return availableBudgetYears;
    }
    return available3DYears;
  }, [available2DYears, available3DYears, availableBudgetYears, viewMode]);
  const effectiveCurrentYear = selectableYears.includes(currentYear)
    ? currentYear
    : getNearestAvailableYear(selectableYears, currentYear);

  // Filter Edges
  const visibleEdges = useMemo(() => {
    const currentData = datasetByYear[effectiveCurrentYear] || [];
    return currentData.filter((edge: Edge) => 
      activeCategories.includes(edge.category) && 
      edge.confidence >= confidenceThreshold
    );
  }, [effectiveCurrentYear, activeCategories, confidenceThreshold]);

  // For 2D view, show ALL edges for the year (no category filter)
  const allEdgesForYear = useMemo(() => {
    return datasetByYear[effectiveCurrentYear] || [];
  }, [effectiveCurrentYear]);

  const toggleCategory = (cat: string) => {
    setActiveCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  // Handle Playback
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && viewMode === '3D' && selectableYears.length > 1) {
      interval = setInterval(() => {
        setCurrentYear(y => {
          const currentIndex = selectableYears.indexOf(y);
          if (currentIndex === -1) {
            return selectableYears[0];
          }
          if (currentIndex >= selectableYears.length - 1) {
            setIsPlaying(false);
            return y;
          }
          return selectableYears[currentIndex + 1];
        });
      }, 2000); // 2 seconds per year
    }
    return () => clearInterval(interval);
  }, [isPlaying, selectableYears, viewMode]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      
      {/* View Toggle (Top Right) */}
      <div style={{
        position: 'absolute',
        top: '1.5rem',
        right: '1.5rem',
        zIndex: 20,
        display: 'flex',
        gap: '0.5rem',
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(16px)',
        padding: '0.5rem',
        borderRadius: '24px',
        border: '1px solid var(--panel-border)'
      }}>
        <button
          onClick={() => {
            setIsPlaying(false);
            setViewMode('3D');
          }}
          style={{
            background: viewMode === '3D' ? 'var(--accent-color)' : 'transparent',
            color: viewMode === '3D' ? '#000' : 'var(--text-main)',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontWeight: 500
          }}
        >
          <Globe size={16} /> 3D グローブ
        </button>
        <button
          onClick={() => {
            setIsPlaying(false);
            setViewMode('2D');
          }}
          style={{
            background: viewMode === '2D' ? 'var(--accent-color)' : 'transparent',
            color: viewMode === '2D' ? '#000' : 'var(--text-main)',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontWeight: 500
          }}
        >
          <GitMerge size={16} style={{ transform: 'rotate(90deg)' }} /> 2D 解析フロー
        </button>
        <button
          onClick={() => {
            setIsPlaying(false);
            setViewMode('Budget');
          }}
          style={{
            background: viewMode === 'Budget' ? 'var(--accent-color)' : 'transparent',
            color: viewMode === 'Budget' ? '#000' : 'var(--text-main)',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontWeight: 500
          }}
        >
          <FileText size={16} /> 予算ページ
        </button>
      </div>

      {/* Main View Area */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        {viewMode === '3D' ? (
          <GlobeView 
            edges={visibleEdges} 
            nodes={GLOBAL_NODES} 
            width={dimensions.width} 
            height={dimensions.height}
            onHoverEdge={setHoveredEdge}
            onHoverNode={setHoveredNode}
          />
        ) : viewMode === '2D' ? (
          <FlowDashboard 
            edges={allEdgesForYear} 
            nodes={GLOBAL_NODES} 
            currentYear={effectiveCurrentYear}
            currency={currency}
            metadata={unifiedData.metadata}
            budgetEntityIds={budgetEntityIds}
            selectedEntityId={selectedFlowEntityId}
            onSelectedEntityChange={setSelectedFlowEntityId}
          />
        ) : (
          <BudgetReportPage
            currentYear={effectiveCurrentYear}
            nodes={GLOBAL_NODES}
            edges={allEdgesForYear}
            metadata={unifiedData.metadata}
            selectedEntityId={selectedBudgetEntityId}
            onSelectedEntityChange={setSelectedBudgetEntityId}
          />
        )}
      </div>

      {/* Common UI Overlays */}
      <div style={{ display: viewMode === '3D' ? 'block' : 'none' }}>
        <Sidebar 
          categories={CATEGORIES}
          activeCategories={activeCategories}
          toggleCategory={toggleCategory}
          confidenceThreshold={confidenceThreshold}
          setConfidenceThreshold={setConfidenceThreshold}
          currency={currency}
          setCurrency={setCurrency}
        />
      </div>

      <Timeline 
        years={selectableYears}
        currentYear={effectiveCurrentYear}
        setCurrentYear={setCurrentYear}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        showPlaybackControls={viewMode === '3D'}
      />

      {viewMode === '3D' && (
        <HUD 
          hoveredEdge={hoveredEdge}
          hoveredNode={hoveredNode}
          currency={currency}
        />
      )}
      
      {/* Title / Branding */}
      <div style={{
        position: 'absolute',
        top: '1.5rem',
        left: '320px', // avoid sidebar overlap
        pointerEvents: 'none',
        zIndex: 10
      }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 300, letterSpacing: '2px', color: 'var(--text-main)', textShadow: '0 0 10px rgba(255,255,255,0.5)' }}>
          世界の資金フロー俯瞰システム
        </h1>
        <div style={{ fontSize: '0.85rem', color: 'var(--accent-color)', marginTop: '0.25rem', letterSpacing: '1px' }}>
          次世代 経済動態ビジュアライザー
        </div>
      </div>
    </div>
  );
}

export default App;
