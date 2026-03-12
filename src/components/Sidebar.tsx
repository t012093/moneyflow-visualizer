import React from 'react';
import { Layers, ShieldCheck } from 'lucide-react';

interface SidebarProps {
  categories: string[];
  activeCategories: string[];
  toggleCategory: (cat: string) => void;
  confidenceThreshold: number;
  setConfidenceThreshold: (val: number) => void;
  currency: 'USD' | 'JPY';
  setCurrency: (val: 'USD' | 'JPY') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  categories,
  activeCategories,
  toggleCategory,
  confidenceThreshold,
  setConfidenceThreshold,
  currency,
  setCurrency,
}) => {
  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      top: '1rem',
      left: '1rem',
      width: '280px',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.5rem',
      zIndex: 10
    }}>
      <div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Layers size={18} color="var(--accent-color)" /> Data Layers
        </h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Select economic flows to visualize on the globe.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {categories.map(cat => (
          <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={activeCategories.includes(cat)}
              onChange={() => toggleCategory(cat)}
            />
            <span style={{ textTransform: 'capitalize' }}>{cat}</span>
            <span style={{ 
              width: 12, height: 12, borderRadius: '50%', 
              backgroundColor: `var(--color-${cat})` || 'white',
              marginLeft: 'auto'
            }} />
          </label>
        ))}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--panel-border)', margin: 0 }} />

      <div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={18} color="var(--accent-color)" /> Confidence
        </h2>
        <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Filter out highly estimated or low-reliability data (e.g., crypto, remittances).
        </p>
        
        <input 
          type="range" 
          min={0} 
          max={1} 
          step={0.05} 
          value={confidenceThreshold}
          onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
          style={{ width: '100%', cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginTop: '0.25rem' }}>
          <span>Any</span>
          <span>{Math.round(confidenceThreshold * 100)}% +</span>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--panel-border)', margin: 0 }} />

      <div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Currency Display
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem', background: '#000', padding: '0.25rem', borderRadius: '8px', border: '1px solid #333' }}>
          <button 
            onClick={() => setCurrency('JPY')}
            style={{ 
              flex: 1,
              background: currency === 'JPY' ? 'var(--accent-color)' : 'transparent', 
              color: currency === 'JPY' ? '#000' : 'var(--text-muted)',
              border: 'none', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600
            }}
          >
            JPY (円)
          </button>
          <button 
            onClick={() => setCurrency('USD')}
            style={{ 
              flex: 1,
              background: currency === 'USD' ? 'var(--accent-color)' : 'transparent', 
              color: currency === 'USD' ? '#000' : 'var(--text-muted)',
              border: 'none', padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600
            }}
          >
            USD ($)
          </button>
        </div>
      </div>
    </div>
  );
};
