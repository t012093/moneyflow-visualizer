import React, { useEffect, useRef, useState, useMemo } from 'react';
import Globe from 'react-globe.gl';
import type { Node, Edge } from '../data/mockGenerator';


const CATEGORY_COLORS: Record<string, string> = {
  trade: '#4ade80', // Green
  banking: '#3b82f6', // Blue
  crypto: '#f43f5e', // Red
  remittance: '#eab308', // Yellow
  bop: '#d946ef', // Purple
  welfare: '#a78bfa',
  infrastructure: '#facc15',
  education: '#34d399',
  services: '#f87171',
  technology: '#60a5fa',
  tax: '#fb923c'
};

interface GlobeViewProps {
  edges: Edge[];
  nodes: Node[];
  width: number;
  height: number;
  onHoverEdge?: (edge: Edge | null) => void;
  onHoverNode?: (node: Node | null) => void;
}

export const GlobeView: React.FC<GlobeViewProps> = ({ 
  edges, 
  nodes, 
  width, 
  height,
  onHoverEdge,
  onHoverNode
}) => {
  const globeEl = useRef<any>(null);
  const [countries, setCountries] = useState<any>({ features: [] });

  // Load geojson for polygon drawing
  useEffect(() => {
    // We use topojson to get the features if possible, or just raw geojson
    fetch('https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(res => res.json())
      .then(setCountries)
      .catch(console.error);
  }, []);

  useEffect(() => {
    // Customize globe controls if needed
    if (globeEl.current) {
      globeEl.current.controls().autoRotate = true;
      globeEl.current.controls().autoRotateSpeed = 0.5;
      // Set initial point of view
      globeEl.current.pointOfView({ lat: 30, lng: 0, altitude: 2 });
    }
  }, []);

  // Format the arcs data so globe can consume it: 
  // It needs { startLat, startLng, endLat, endLng, color } etc.
  const arcsData = useMemo(() => {
    return edges.map(e => {
      const source = nodes.find(n => n.id === e.source_id);
      const target = nodes.find(n => n.id === e.target_id);
      if (!source || !target) return null;

      // Map value to thickness (stroke)
      // Volume is up to 50B * growth
      const stroke = Math.max(0.2, (e.value_usd / 50_000_000_000) * 1.5);
      
      return {
        ...e,
        startLat: source.lat,
        startLng: source.lng,
        endLat: target.lat,
        endLng: target.lng,
        color: CATEGORY_COLORS[e.category] || '#ffffff',
        stroke
      };
    }).filter(Boolean);
  }, [edges, nodes]);

  return (
    <Globe
      ref={globeEl}
      width={width}
      height={height}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
      bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      
      // Polygons (Countries)
      polygonsData={countries.features}
      polygonAltitude={0.01}
      polygonCapColor={(d: any) => {
        // Highlight G20 nodes slightly differently
        const isG20 = nodes.find(n => n.id === d.properties.ISO_A3);
        return isG20 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.1)';
      }}
      polygonSideColor={() => 'rgba(0, 0, 0, 0.15)'}
      polygonStrokeColor={() => '#30363d'}
      onPolygonHover={(d: any) => {
        if (!d) return;
        const matchedNode = nodes.find(n => n.id === d.properties.ISO_A3);
        if (onHoverNode) onHoverNode(matchedNode || null);
      }}

      // Nodes (G20 Highlights)
      htmlElementsData={nodes}
      htmlElement={(d: any) => {
        const el = document.createElement('div');
        el.innerHTML = `<div style="color: white; font-size: 10px; text-shadow: 0 0 4px #000; pointer-events: none;">${d.name}</div>`;
        return el;
      }}

      // Arcs
      arcsData={arcsData as object[]}
      arcColor="color"
      arcDashLength={0.4}
      arcDashGap={0.2}
      arcDashAnimateTime={() => {
        // Faster animation for higher volume, capped
        return 2000 + Math.random() * 2000;
        //return Math.max(1000, 4000 - d.stroke * 1000);
      }}
      arcStroke="stroke"
      onArcHover={(arc: any) => {
        if (onHoverEdge) onHoverEdge(arc || null);
        if (globeEl.current) {
          // Pause auto-rotate when inspecting an arc
          globeEl.current.controls().autoRotate = !arc;
        }
      }}
    />
  );
};
