import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import type { Edge, Node } from '../data/mockGenerator';
import { formatCurrency } from '../utils/currencyFormatter';

interface FlowDashboardProps {
  edges: Edge[];
  nodes: Node[];
  currentYear: number;
  currency: 'USD' | 'JPY';
}

const CATEGORY_COLORS: Record<string, string> = {
  trade: '#4ade80',      // green
  banking: '#38bdf8',    // blue
  crypto: '#c084fc',     // purple
  remittance: '#f472b6', // pink
  bop: '#fb923c',        // orange
  welfare: '#a78bfa',    // purple-ish for social security
  pension: '#60a5fa',    // light blue
  medical: '#f43f5e',    // rose
  childcare: '#fbbf24',  // amber
  debt: '#94a3b8',       // slate
  debt_service: '#cbd5e1',
  local_grants: '#2dd4bf', // teal
  infrastructure: '#facc15', // yellow
  education: '#34d399',  // emerald
  defense: '#475569',    // dark slate
  other: '#a3a3a3',       // gray
  services: '#f87171',   // red
  technology: '#60a5fa', // blue
  tax: '#fb923c'         // orange
};

const CATEGORY_LABELS: Record<string, string> = {
  trade: '貿易',
  banking: '銀行口座',
  crypto: '暗号資産',
  remittance: '個人送金',
  bop: '国際収支',
  welfare: '社会保障',
  pension: '年金',
  medical: '医療',
  childcare: '子育て',
  debt: '国債',
  debt_service: '国債費',
  local_grants: '地方交付金',
  infrastructure: '公共事業',
  education: '教育',
  defense: '防衛',
  other: 'その他',
  services: 'サービス・業務委託',
  technology: 'IT・システム',
  tax: '税金'
};

const MODELED_DATASET_MARKERS = ['省庁別主要経費推計', '想定', 'Proxy', 'Approximation', 'Estimated'];

const getProvenanceBadge = (edge: Edge) => {
  const dataset = edge.source_dataset || '';
  const sourceUrl = edge.source_url || '';

  if (MODELED_DATASET_MARKERS.some((marker) => dataset.includes(marker))) {
    return {
      label: '推計配分',
      background: 'rgba(192, 132, 252, 0.14)',
      border: '1px solid rgba(192, 132, 252, 0.32)',
      color: '#e9d5ff',
    };
  }

  if (sourceUrl.includes('.pdf')) {
    return {
      label: '公式PDF',
      background: 'rgba(74, 222, 128, 0.14)',
      border: '1px solid rgba(74, 222, 128, 0.32)',
      color: '#bbf7d0',
    };
  }

  return null;
};

export const FlowDashboard: React.FC<FlowDashboardProps> = ({ nodes, edges, currentYear, currency }) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string>('MIN_CFA');
  const [viewLevel, setViewLevel] = useState<'entity' | 'type'>('entity');
  const [selectedLinkDetails, setSelectedLinkDetails] = useState<Edge | null>(null);

  useEffect(() => {
    if (!nodes.some((node) => node.id === selectedEntityId)) {
      setSelectedEntityId('MIN_CFA');
    }
  }, [nodes, selectedEntityId]);

  // Group nodes by type for the dropdown
  const groupedNodes = useMemo(() => {
    const groups: Record<string, Node[]> = {
      country: [],
      corporation: [],
      individual: [],
      macro_entity: [],
      prefecture: [],
      corporation_jp: [],
      mof_revenue: [],
      mof_expenditure: [],
      mhlw_benefit: [],
      recipient: [],
      local_gov: [],
      ministry: []
    };
    nodes.forEach(n => {
      // Avoid duplicate GOV_JP or EXP_SOCIAL if it exists in multiple datasets
      const existing = groups[n.type]?.find(existingNode => existingNode.id === n.id);
      if (!existing && groups[n.type]) {
          groups[n.type].push(n);
      }
    });
    return groups;
  }, [nodes]);

  // Construct Sankey Data based on viewLevel
  const sankeyData = useMemo(() => {
    const sNodes: { id: string; nodeColor: string }[] = [];
    const sLinks: { source: string; target: string; value: number; linkColor: string; edgeRef?: Edge }[] = [];
    const nodeSet = new Set<string>();
    
    const addNode = (id: string, color: string = '#888') => {
      if (!nodeSet.has(id)) {
        nodeSet.add(id);
        sNodes.push({ id, nodeColor: color });
      }
    };

    if (viewLevel === 'entity') {
      const selectedEdges = edges.filter(e => e.source_id === selectedEntityId || e.target_id === selectedEntityId);
      const focusNodeName = nodes.find(n => n.id === selectedEntityId)?.name || selectedEntityId;
      addNode(focusNodeName, '#ffffff');

      selectedEdges.forEach(edge => {
        const sourceName = nodes.find(n => n.id === edge.source_id)?.name || edge.source_id;
        const targetName = nodes.find(n => n.id === edge.target_id)?.name || edge.target_id;
        const categoryLabel = `[${CATEGORY_LABELS[edge.category] || edge.category.toUpperCase()}]`;
        const catColor = CATEGORY_COLORS[edge.category] || '#aaa';

        if (edge.target_id === selectedEntityId) {
          const sourceNodeId = `IN: ${sourceName}`;
          const catNodeId = `IN(${edge.source_id}): ${categoryLabel}`;
          addNode(sourceNodeId, '#30363d');
          addNode(catNodeId, catColor);
          sLinks.push({ source: sourceNodeId, target: catNodeId, value: edge.value_usd, linkColor: catColor, edgeRef: edge });
          sLinks.push({ source: catNodeId, target: focusNodeName, value: edge.value_usd, linkColor: catColor, edgeRef: edge });
        } else if (edge.source_id === selectedEntityId) {
          const targetNodeId = `OUT: ${targetName}`;
          const catNodeId = `OUT(${edge.target_id}): ${categoryLabel}`;
          addNode(targetNodeId, '#30363d');
          addNode(catNodeId, catColor);
          sLinks.push({ source: focusNodeName, target: catNodeId, value: edge.value_usd, linkColor: catColor, edgeRef: edge });
          sLinks.push({ source: catNodeId, target: targetNodeId, value: edge.value_usd, linkColor: catColor, edgeRef: edge });
        }
      });

      // Auto-expand: show next-hop flows for downstream targets
      // Only expands if the child itself has outgoing edges (hub nodes like EXP_SOCIAL)
      const directTargetIds = [...new Set(
        selectedEdges
          .filter(e => e.source_id === selectedEntityId)
          .map(e => e.target_id)
      )];

      directTargetIds.forEach(childId => {
        const childEdges = edges.filter(e => e.source_id === childId);
        if (childEdges.length > 0) {
          const childName = nodes.find(n => n.id === childId)?.name || childId;
          // The parent entity view created this node as `OUT: ${childName}`
          const childSankeyId = `OUT: ${childName}`;
          
          childEdges.forEach(ce => {
            const grandchildName = nodes.find(n => n.id === ce.target_id)?.name || ce.target_id;
            const ceCatColor = CATEGORY_COLORS[ce.category] || '#aaa';
            const grandchildNodeId = `OUT2: ${grandchildName}`;
            
            // Only add if the source node actually exists
            if (nodeSet.has(childSankeyId)) {
              addNode(grandchildNodeId, '#2dd4bf');
              sLinks.push({ 
                source: childSankeyId, 
                target: grandchildNodeId, 
                value: ce.value_usd, 
                linkColor: ceCatColor,
                edgeRef: ce,
              });
            }
          });
        }
      });
    } else {
      // Macro Type Aggregation View (Country / Corporation / Individual)
      // Flows: SourceType -> Category -> TargetType
      
      const typeTranslations: Record<string, string> = {
        country: '国家',
        corporation: 'グローバル企業',
        individual: '個人/属性',
        macro_entity: 'マクロ主体(政府/日銀/家計)',
        ministry: '各省庁',
        prefecture: '都道府県',
        local_gov: '市町村',
        corporation_jp: '国内企業',
        mof_revenue: '国家予算(歳入)',
        mof_expenditure: '国家予算(歳出)',
        mhlw_benefit: '社会保障制度',
        recipient: '受給者/産業'
      };

      const typeColors: Record<string, string> = {
        country: '#ffffff',
        corporation: '#a8a29e', // warm gray
        individual: '#facc15', // yellow
        macro_entity: '#fb923c', // orange
        ministry: '#60a5fa', // blue
        prefecture: '#38bdf8', // light blue
        local_gov: '#818cf8', // indigo/cyan mixed
        corporation_jp: '#f472b6', // pink
        mof_revenue: '#4ade80', // green
        mof_expenditure: '#f87171', // red
        mhlw_benefit: '#a78bfa', // purple
        recipient: '#2dd4bf' // teal
      };

      // Aggregate edges by source_type -> category -> target_type
      const aggFlows: Record<string, number> = {};

      edges.forEach(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source_id);
        const targetNode = nodes.find(n => n.id === edge.target_id);
        if (!sourceNode || !targetNode) return;

        const srcTypeLabel = typeTranslations[sourceNode.type] || sourceNode.type;
        const trgTypeLabel = typeTranslations[targetNode.type] || targetNode.type;
        const srcTypeKey = `SRC: ${srcTypeLabel}`;
        const trgTypeKey = `TRG: ${trgTypeLabel}`;
        const catLabel = `[${CATEGORY_LABELS[edge.category] || edge.category.toUpperCase()}]`;
        const centerCatKey = `CAT(${srcTypeLabel}->${trgTypeLabel}): ${catLabel}`;

        const key1 = `${srcTypeKey}|${centerCatKey}|${edge.category}|${sourceNode.type}`;
        const key2 = `${centerCatKey}|${trgTypeKey}|${edge.category}|${targetNode.type}`;

        aggFlows[key1] = (aggFlows[key1] || 0) + edge.value_usd;
        aggFlows[key2] = (aggFlows[key2] || 0) + edge.value_usd;
      });

      // Build Sankey Elements from aggregates
      Object.entries(aggFlows).forEach(([compoundKey, value]) => {
        const [source, target, catRaw, nodeTypeRef] = compoundKey.split('|');
        const catColor = CATEGORY_COLORS[catRaw] || '#aaa';
        
        let nodeColorSource = '#30363d';
        let nodeColorTarget = '#30363d';

        if (source.startsWith('SRC: ') || source.startsWith('TRG: ')) {
          nodeColorSource = typeColors[nodeTypeRef as keyof typeof typeColors] || '#fff';
        } else {
          nodeColorSource = catColor;
        }

        if (target.startsWith('SRC: ') || target.startsWith('TRG: ')) {
          nodeColorTarget = typeColors[nodeTypeRef as keyof typeof typeColors] || '#fff';
        } else {
          nodeColorTarget = catColor;
        }

        addNode(source, nodeColorSource);
        addNode(target, nodeColorTarget);
        sLinks.push({ source, target, value, linkColor: catColor });
      });
    }

    return { nodes: sNodes, links: sLinks };
  }, [edges, selectedEntityId, nodes, viewLevel]);

  const hasData = sankeyData.links.length > 0;
  const renderSourceMeta = (edge: Edge, labelColor: string) => {
    const sourceLabel = edge.source_title || edge.source_dataset;
    const pageSuffix = edge.page_number ? ` p.${edge.page_number}` : '';
    const provenanceBadge = getProvenanceBadge(edge);

    if (!sourceLabel && !edge.source_url) {
      return null;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {provenanceBadge && (
          <div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.14rem 0.5rem',
                borderRadius: '999px',
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: provenanceBadge.background,
                border: provenanceBadge.border,
                color: provenanceBadge.color,
              }}
            >
              {provenanceBadge.label}
            </span>
          </div>
        )}
        {sourceLabel && (
          <div style={{ color: '#aaa', lineHeight: 1.45 }}>
            <span style={{ fontWeight: 'bold', color: labelColor }}>[出典資料]</span> {sourceLabel}{pageSuffix}
          </div>
        )}
        {edge.source_url && (
          <div>
            <a href={edge.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
              元の資料を開く
            </a>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', padding: '2rem', paddingTop: '5rem', background: 'radial-gradient(circle at center, #111 0%, #000 100%)' }}>
      
      {/* Entity Selector Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', zIndex: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 600 }}>エンティティ別 資金フロー解析</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>{currentYear}年における詳細な資金の流入と流出を分析</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          {/* View Level Toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>集計レベル</label>
            <div style={{ display: 'flex', gap: '0.25rem', background: '#000', padding: '0.25rem', borderRadius: '8px', border: '1px solid #333' }}>
              <button 
                onClick={() => setViewLevel('entity')}
                style={{ 
                  background: viewLevel === 'entity' ? '#fff' : 'transparent', 
                  color: viewLevel === 'entity' ? '#000' : 'var(--text-muted)',
                  border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500
                }}
              >
                特定エンティティ
              </button>
              <button 
                onClick={() => setViewLevel('type')}
                style={{ 
                  background: viewLevel === 'type' ? '#fff' : 'transparent', 
                  color: viewLevel === 'type' ? '#000' : 'var(--text-muted)',
                  border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500
                }}
              >
                マクロカテゴリ別
              </button>
            </div>
          </div>

          {/* Entity Selector (Only visible in entity mode) */}
          {viewLevel === 'entity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>対象エンティティ</label>
              <select 
                value={selectedEntityId} 
                onChange={(e) => setSelectedEntityId(e.target.value)}
                style={{
                  background: '#000',
                  color: '#fff',
                  border: '1px solid #333',
                  padding: '0.5rem',
                  borderRadius: '8px',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  minWidth: '200px'
                }}
              >
                <optgroup label="国家">
                  {groupedNodes.country.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="国内マクロ主体 (日銀・政府・家計)">
                  {groupedNodes.macro_entity.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="各省庁">
                  {groupedNodes.ministry?.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="国庫 歳入 (税収・公債金)">
                  {groupedNodes.mof_revenue.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="国庫 歳出 (社会保障・防衛費など)">
                  {groupedNodes.mof_expenditure.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="社会保障制度分類">
                  {groupedNodes.mhlw_benefit.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="社会保障受給者 (個人/産業)">
                  {groupedNodes.recipient.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="都道府県">
                  {groupedNodes.prefecture.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="市町村 (富山など)">
                  {groupedNodes.local_gov.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="国内上場企業">
                  {groupedNodes.corporation_jp.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="グローバル大企業">
                  {groupedNodes.corporation.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
                <optgroup label="個人的属性">
                  {groupedNodes.individual.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </optgroup>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Sankey Dashboard Diagram */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.05)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
          {!hasData ? (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--text-muted)' }}>
              現在のフィルタ条件では、該当する資金フローデータの記録がありません。
            </div>
          ) : (
            <ResponsiveSankey
              data={sankeyData}
              margin={{ top: 20, right: 100, bottom: 20, left: 100 }}
              align="justify"
              colors={(node: any) => node.nodeColor}
              nodeOpacity={1}
              nodeHoverOthersOpacity={0.1}
              nodeThickness={24}
              nodeSpacing={24}
              nodeBorderWidth={0}
              nodeBorderColor={{ from: 'color', modifiers: [ [ 'darker', 0.8 ] ] }}
              linkOpacity={0.3}
              linkHoverOthersOpacity={0.05}
              linkBlendMode="screen"
              enableLinkGradient={true}
              labelPosition="outside"
              labelOrientation="horizontal"
              labelPadding={16}
              labelTextColor="#ffffff"
              theme={{
                tooltip: {
                  container: { background: '#111', color: '#fff', fontSize: '12px', border: '1px solid #333' }
                }
              }}
              onClick={(node: any) => {
              // Clicked on a Link
              if (node.source && node.target) {
                  let edgeSrc = node.source.id;
                  let edgeTgt = node.target.id;
                  
                  if (edgeSrc.startsWith('IN: ')) edgeSrc = edgeSrc.replace('IN: ', '');
                  if (edgeSrc.startsWith('OUT: ')) edgeSrc = edgeSrc.replace('OUT: ', '');
                  if (edgeTgt.startsWith('IN: ')) edgeTgt = edgeTgt.replace('IN: ', '');
                  if (edgeTgt.startsWith('OUT: ')) edgeTgt = edgeTgt.replace('OUT: ', '');
                  if (edgeTgt.startsWith('OUT2: ')) edgeTgt = edgeTgt.replace('OUT2: ', '');
                  
                  const srcMatch = edgeSrc.match(/^(IN|OUT)\(([^)]+)\)/);
                  if (srcMatch && srcMatch[2]) edgeSrc = srcMatch[2];
                  
                  const tgtMatch = edgeTgt.match(/^(IN|OUT)\(([^)]+)\)/);
                  if (tgtMatch && tgtMatch[2]) edgeTgt = tgtMatch[2];

                  const originalEdge = node.edgeRef || edges.find(e => {
                    const srcName = nodes.find(n => n.id === e.source_id)?.name || e.source_id;
                    const tgtName = nodes.find(n => n.id === e.target_id)?.name || e.target_id;
                    return (srcName === edgeSrc || e.source_id === edgeSrc) && 
                           (tgtName === edgeTgt || e.target_id === edgeTgt) &&
                           e.value_usd === node.value;
                  });

                  if (originalEdge) {
                    setSelectedLinkDetails(originalEdge);
                  }
                  return;
              }

              // Clicked on a Node
              if (node.id === undefined) return;
              setSelectedLinkDetails(null); // Clear link selection when clicking node

              if (viewLevel === 'type') {
                 // In Type mode, if they click a type node, switch to Entity mode and default to the first entity of that type
                 const typeToSearch = node.id.replace('SRC: ', '').replace('TRG: ', '');
                 const mapTypeToInternal: Record<string, string> = { 
                   '国家': 'country', 
                   'グローバル企業': 'corporation', 
                   '個人/属性': 'individual',
                   'マクロ主体(政府/日銀/家計)': 'macro_entity',
                   '都道府県': 'prefecture',
                   '国内企業': 'corporation_jp',
                   '国家予算(歳入)': 'mof_revenue',
                   '国家予算(歳出)': 'mof_expenditure',
                   '社会保障制度': 'mhlw_benefit',
                   '受給者/産業': 'recipient'
                 };
                 const internalType = mapTypeToInternal[typeToSearch];

                 if (internalType) {
                   const firstEntity = nodes.find(n => n.type === internalType);
                   if (firstEntity) {
                     setViewLevel('entity');
                     setSelectedEntityId(firstEntity.id);
                   }
                 }
                 return;
              }

              // Extract original entity ID or Name from node.id
              let searchName = node.id;
              if (searchName.startsWith('IN: ')) searchName = searchName.replace('IN: ', '');
              if (searchName.startsWith('OUT: ')) searchName = searchName.replace('OUT: ', '');

              // Check if it's a known name
              const foundByName = nodes.find(n => n.name === searchName);
              if (foundByName) {
                setSelectedEntityId(foundByName.id);
                return;
              }

              // Otherwise check if it's a category node containing the ID
              const match = node.id.match(/^(IN|OUT)\(([^)]+)\)/);
              if (match && match[2]) {
                const foundById = nodes.find(n => n.id === match[2]);
                if (foundById) {
                  setSelectedEntityId(foundById.id);
                  }
              }
            }}
              nodeTooltip={(node: any) => {
              // Calculate if it's a clickable node
              let isClickable = false;

              if (viewLevel === 'type') {
                 if (node.node.id.startsWith('SRC: ') || node.node.id.startsWith('TRG: ')) {
                     isClickable = true;
                 }
              } else {
                let searchName = node.node.id;
                if (searchName.startsWith('IN: ')) searchName = searchName.replace('IN: ', '');
                if (searchName.startsWith('OUT: ')) searchName = searchName.replace('OUT: ', '');
                if (nodes.some(n => n.name === searchName)) isClickable = true;
                
                const match = node.node.id.match(/^(IN|OUT)\(([^)]+)\)/);
                if (match && match[2] && nodes.some(n => n.id === match[2])) isClickable = true;
              }

              return (
                <div style={{ whiteSpace: 'nowrap', background: '#111', padding: '8px', border: '1px solid #333', borderRadius: '4px' }}>
                  <strong style={{ color: node.node.color }}>{node.node.id}</strong>
                  <div style={{ marginTop: '4px' }}>
                    合計: {formatCurrency(node.node.value, currency)}
                  </div>
                  {isClickable && (
                    <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--accent-color)' }}>
                       {viewLevel === 'type' ? 'クリックしてこのカテゴリの詳細へ' : 'クリックしてこのエンティティの詳細フローを見る'}
                    </div>
                  )}
                </div>
              );
            }}
              linkTooltip={(node: any) => (
              <div style={{ whiteSpace: 'nowrap', background: '#111', padding: '8px', border: '1px solid #333', borderRadius: '4px' }}>
                <strong style={{ color: node.link.linkColor }}>{node.link.source.id} &rarr; {node.link.target.id}</strong>
                <br />
                {formatCurrency(node.link.value, currency)}
                
                {/* Find original edge data to display description/URL if present */}
                {(() => {
                  let edgeSrc = node.link.source.id;
                  let edgeTgt = node.link.target.id;
                  
                  // Clean up auto-generated sankey prefixes to match original edge IDs
                  if (edgeSrc.startsWith('IN: ')) edgeSrc = edgeSrc.replace('IN: ', '');
                  if (edgeSrc.startsWith('OUT: ')) edgeSrc = edgeSrc.replace('OUT: ', '');
                  if (edgeTgt.startsWith('IN: ')) edgeTgt = edgeTgt.replace('IN: ', '');
                  if (edgeTgt.startsWith('OUT: ')) edgeTgt = edgeTgt.replace('OUT: ', '');
                  if (edgeTgt.startsWith('OUT2: ')) edgeTgt = edgeTgt.replace('OUT2: ', '');
                  
                  // Handle intermediate category nodes
                  const srcMatch = edgeSrc.match(/^(IN|OUT)\(([^)]+)\)/);
                  if (srcMatch && srcMatch[2]) edgeSrc = srcMatch[2];
                  
                  const tgtMatch = edgeTgt.match(/^(IN|OUT)\(([^)]+)\)/);
                  if (tgtMatch && tgtMatch[2]) edgeTgt = tgtMatch[2];

                  // We lookup by name since sankey nodes use names.
                  const originalEdge = node.link.edgeRef || edges.find(e => {
                    const srcName = nodes.find(n => n.id === e.source_id)?.name || e.source_id;
                    const tgtName = nodes.find(n => n.id === e.target_id)?.name || e.target_id;
                    
                    return (srcName === edgeSrc || e.source_id === edgeSrc) && 
                           (tgtName === edgeTgt || e.target_id === edgeTgt) &&
                           e.value_usd === node.link.value;
                  });

                  if (!originalEdge) return null;

                  return (
                    <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: '300px' }}>
                      {originalEdge.evidence_text && (
                        <div style={{ marginBottom: '6px' }}>
                          <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>[データ出典箇所]</span>
                          <div style={{ padding: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', fontStyle: 'italic', marginTop: '2px', borderLeft: '2px solid var(--accent-color)' }}>
                            "{originalEdge.evidence_text}"
                          </div>
                        </div>
                      )}
                      
                      {originalEdge.description && (
                         <div style={{ marginBottom: '4px' }}>
                            <span style={{ color: '#aaa', fontWeight: 'bold' }}>[備考]</span> {originalEdge.description}
                         </div>
                      )}

                      {renderSourceMeta(originalEdge, '#aaa')}
                    </div>
                  );
                })()}
              </div>
            )}
            />
          )}
        </div>
      </div>

      {/* Selected Link Details Overlay */}
      {selectedLinkDetails && (
        <div style={{
          position: 'absolute',
          bottom: '2rem',
          right: '2rem',
          width: '380px',
          background: 'var(--panel-bg)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--accent-color)',
          borderRadius: '12px',
          padding: '1.25rem',
          zIndex: 50,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: 'var(--text-main)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              フロー詳細情報
            </div>
            <button 
              onClick={() => setSelectedLinkDetails(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: '1rem', padding: '0' }}
            >
              &times;
            </button>
          </div>
          
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
             {nodes.find(n => n.id === selectedLinkDetails.source_id)?.name || selectedLinkDetails.source_id} <span style={{ color: 'var(--text-muted)' }}>&rarr;</span> {nodes.find(n => n.id === selectedLinkDetails.target_id)?.name || selectedLinkDetails.target_id}
          </div>

          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-color)' }}>
            {formatCurrency(selectedLinkDetails.value_usd, currency)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            {getProvenanceBadge(selectedLinkDetails) && (
              <div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '999px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    background: getProvenanceBadge(selectedLinkDetails)?.background,
                    border: getProvenanceBadge(selectedLinkDetails)?.border,
                    color: getProvenanceBadge(selectedLinkDetails)?.color,
                  }}
                >
                  {getProvenanceBadge(selectedLinkDetails)?.label}
                </span>
              </div>
            )}
            {(selectedLinkDetails.source_title || selectedLinkDetails.source_dataset) && (
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block' }}>出典資料</span>
                {(selectedLinkDetails.source_title || selectedLinkDetails.source_dataset)}
                {selectedLinkDetails.page_number ? ` p.${selectedLinkDetails.page_number}` : ''}
              </div>
            )}
            
            {(selectedLinkDetails.evidence_text || selectedLinkDetails.description) && (
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>AI抽出・根拠テキスト</span>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '6px', borderLeft: '3px solid var(--accent-color)' }}>
                  {selectedLinkDetails.evidence_text && <div style={{ fontStyle: 'italic', marginBottom: selectedLinkDetails.description ? '0.5rem' : '0' }}>"{selectedLinkDetails.evidence_text}"</div>}
                  {selectedLinkDetails.description && <div style={{ color: '#ccc' }}>{selectedLinkDetails.description}</div>}
                </div>
              </div>
            )}

            {selectedLinkDetails.source_url && (
              <a 
                href={selectedLinkDetails.source_url} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  display: 'inline-block', 
                  marginTop: '0.5rem',
                  padding: '0.5rem 1rem', 
                  background: 'var(--accent-color)', 
                  color: '#000', 
                  textDecoration: 'none', 
                  borderRadius: '20px', 
                  fontWeight: 600, 
                  textAlign: 'center',
                  alignSelf: 'flex-start'
                }}
              >
                元の資料・PDFを開く
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
