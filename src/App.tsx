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

// Type assertion for the imported unified JSON (from SQLite DB export)
const unifiedData = unifiedDataRaw as unknown as UnifiedData;
const YEARS = unifiedData.metadata?.fiscal_years?.length
  ? unifiedData.metadata.fiscal_years
  : [2021, 2022, 2023, 2024, 2025];
const DEFAULT_YEAR = unifiedData.metadata?.latestFiscalYear || YEARS[YEARS.length - 1];

export const GLOBAL_NODES = unifiedData.nodes;

// Group edges by year for the timeline playback
const datasetByYear: Record<number, Edge[]> = {};
unifiedData.edges.forEach((edge: Edge) => {
  if (!datasetByYear[edge.year]) datasetByYear[edge.year] = [];
  datasetByYear[edge.year].push(edge);
});

function App() {
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [currentYear, setCurrentYear] = useState(DEFAULT_YEAR);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<'3D' | '2D' | 'Budget'>('3D');
  
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

  // Handle Playback
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentYear(y => {
          if (y >= YEARS[YEARS.length - 1]) {
            setIsPlaying(false);
            return y;
          }
          return y + 1;
        });
      }, 2000); // 2 seconds per year
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Filter Edges
  const visibleEdges = useMemo(() => {
    const currentData = datasetByYear[currentYear] || [];
    return currentData.filter((edge: Edge) => 
      activeCategories.includes(edge.category) && 
      edge.confidence >= confidenceThreshold
    );
  }, [currentYear, activeCategories, confidenceThreshold]);

  // For 2D view, show ALL edges for the year (no category filter)
  const allEdgesForYear = useMemo(() => {
    return datasetByYear[currentYear] || [];
  }, [currentYear]);

  const toggleCategory = (cat: string) => {
    setActiveCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

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
          onClick={() => setViewMode('3D')}
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
          onClick={() => setViewMode('2D')}
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
          onClick={() => setViewMode('Budget')}
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
            currentYear={currentYear}
            currency={currency}
          />
        ) : (
          <BudgetReportPage
            currentYear={currentYear}
            nodes={GLOBAL_NODES}
            edges={allEdgesForYear}
            metadata={unifiedData.metadata}
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
        years={YEARS}
        currentYear={currentYear}
        setCurrentYear={setCurrentYear}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
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
