import React from 'react';
import { Play, Pause, FastForward, Rewind } from 'lucide-react';

interface TimelineProps {
  years: number[];
  currentYear: number;
  setCurrentYear: (year: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  showPlaybackControls?: boolean;
}

export const Timeline: React.FC<TimelineProps> = ({
  years,
  currentYear,
  setCurrentYear,
  isPlaying,
  setIsPlaying,
  showPlaybackControls = true,
}) => {
  const selectableYears = [...years].sort((a, b) => a - b);
  const currentIndex = Math.max(0, selectableYears.indexOf(currentYear));

  if (!selectableYears.length) {
    return null;
  }

  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      bottom: '2rem',
      left: '2rem',
      width: '280px',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      zIndex: 10
    }}>
      {/* Header & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '1px' }}>
          {currentYear}年度
        </div>
        
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button 
            onClick={() => setCurrentYear(selectableYears[Math.max(0, currentIndex - 1)])}
            title="前年度"
            style={{ 
              background: 'var(--bg-panel)', border: '1px solid var(--border-color)', 
              borderRadius: '6px', padding: '0.4rem', color: 'var(--text-main)', cursor: 'pointer' 
            }}
          >
            <Rewind size={16} />
          </button>

          {showPlaybackControls && (
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              title={isPlaying ? "一時停止" : "自動再生"}
              style={{ 
                background: isPlaying ? 'var(--accent-color)' : 'var(--bg-panel)', 
                border: '1px solid ' + (isPlaying ? 'var(--accent-color)' : 'var(--border-color)'), 
                borderRadius: '6px', padding: '0.4rem', 
                color: isPlaying ? '#000' : 'var(--text-main)', cursor: 'pointer' 
              }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
          )}

          <button 
            onClick={() => setCurrentYear(selectableYears[Math.min(selectableYears.length - 1, currentIndex + 1)])}
            title="翌年度"
            style={{ 
              background: 'var(--bg-panel)', border: '1px solid var(--border-color)', 
              borderRadius: '6px', padding: '0.4rem', color: 'var(--text-main)', cursor: 'pointer' 
            }}
          >
            <FastForward size={16} />
          </button>
        </div>
      </div>

      {/* Year Slider */}
      <input 
        type="range" 
        min={0} 
        max={Math.max(0, selectableYears.length - 1)} 
        step={1} 
        value={currentIndex}
        onChange={(e) => {
          setIsPlaying(false);
          setCurrentYear(selectableYears[parseInt(e.target.value, 10)]);
        }}
        style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-color)' }}
      />
      
      {/* Year Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        {selectableYears.map((year) => (
          <span
            key={year}
            style={{
              color: year === currentYear ? 'var(--text-main)' : 'var(--text-muted)',
              fontWeight: year === currentYear ? 700 : 500,
            }}
          >
            {year}
          </span>
        ))}
      </div>
    </div>
  );
};
