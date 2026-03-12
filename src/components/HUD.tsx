import React from 'react';
import type { Edge, Node } from '../data/mockGenerator';
import { formatCurrency } from '../utils/currencyFormatter';

interface HUDProps {
  hoveredEdge: Edge | null;
  hoveredNode: Node | null;
  currency: 'USD' | 'JPY';
}
export const HUD: React.FC<HUDProps> = ({ hoveredEdge, hoveredNode, currency }) => {
  if (!hoveredEdge && !hoveredNode) return null;

  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      top: '1rem',
      right: '1rem',
      width: '280px',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      zIndex: 10,
      pointerEvents: 'none' // allow clicking through
    }}>
      {hoveredEdge ? (
        <>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: `var(--color-${hoveredEdge.category})` }}>
            【{hoveredEdge.category.toUpperCase()}】 フロー
          </h3>
          <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>送金元:</span>
              <strong>{hoveredEdge.source_id}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>送金先:</span>
              <strong>{hoveredEdge.target_id}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>推定フロー金額:</span>
              <strong>{formatCurrency(hoveredEdge.value_usd, currency)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>データソース:</span>
              <span>{hoveredEdge.source_dataset}</span>
            </div>
            {hoveredEdge.description && (
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: '0.25rem' }}>
                <span style={{ color: 'var(--accent-color)', fontSize: '0.8rem' }}>【情報源 / 詳細】</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.4' }}>{hoveredEdge.description}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>信頼度:</span>
              <span style={{ 
                color: hoveredEdge.confidence > 0.8 ? '#4ade80' : 
                       hoveredEdge.confidence > 0.5 ? '#eab308' : '#f43f5e' 
              }}>
                {Math.round(hoveredEdge.confidence * 100)}%
              </span>
            </div>
          </div>
        </>
      ) : hoveredNode ? (
        <>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--accent-color)' }}>
            {hoveredNode.name}
          </h3>
          <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>ISO3:</span>
              <span>{hoveredNode.id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>地域:</span>
              <span>{hoveredNode.region}</span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
