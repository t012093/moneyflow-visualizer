import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import type { SankeyLinkDatum, SankeyNodeDatum } from '@nivo/sankey';
import type { Edge, Node } from '../data/mockGenerator';
import type { AppMetadata } from '../types/frontendData';
import { formatCurrency } from '../utils/currencyFormatter';

interface FlowDashboardProps {
  edges: Edge[];
  nodes: Node[];
  currentYear: number;
  currency: 'USD' | 'JPY';
  metadata: AppMetadata;
  budgetEntityIds: string[];
  selectedEntityId: string;
  onSelectedEntityChange: (entityId: string) => void;
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

const MODELED_DATASET_MARKERS = ['省庁別主要経費推計', '想定', '按分', 'Proxy', 'Approximation', 'Estimated', 'meti_data'];
type EdgeEvidenceStatus = 'reviewed' | 'model-based';
type EdgeEvidenceCounts = Record<EdgeEvidenceStatus, number>;
type EntityDrilldownState = {
  visibleEdges: Edge[];
  outboundDepthByNodeId: Map<string, number>;
  expandableNodeIds: Set<string>;
};

const EVIDENCE_STYLES: Record<
  EdgeEvidenceStatus,
  {
    label: string;
    description: string;
    linkColor: string;
    background: string;
    border: string;
    color: string;
  }
> = {
  reviewed: {
    label: 'reviewed',
    description: '実データ',
    linkColor: '#4ade80',
    background: 'rgba(74, 222, 128, 0.14)',
    border: '1px solid rgba(74, 222, 128, 0.32)',
    color: '#bbf7d0',
  },
  'model-based': {
    label: 'model-based',
    description: '配分モデル',
    linkColor: '#c084fc',
    background: 'rgba(192, 132, 252, 0.14)',
    border: '1px solid rgba(192, 132, 252, 0.32)',
    color: '#e9d5ff',
  },
};

const getNearestAvailableYear = (years: number[], targetYear: number) => {
  if (!years.length) {
    return targetYear;
  }
  return years.reduce(
    (nearest, year) => (Math.abs(year - targetYear) < Math.abs(nearest - targetYear) ? year : nearest),
    years[0]
  );
};

const isModeledEdge = (edge: Edge) => MODELED_DATASET_MARKERS.some((marker) => (edge.source_dataset || '').includes(marker));
const getEdgeEvidenceStatus = (edge: Edge): EdgeEvidenceStatus => (isModeledEdge(edge) ? 'model-based' : 'reviewed');
const getEdgeDisplayKey = (edge: Edge) => [
  edge.year,
  edge.source_id,
  edge.target_id,
  edge.value_usd,
  edge.source_dataset,
  edge.page_number || '',
].join(':');
const createEmptyEvidenceCounts = (): EdgeEvidenceCounts => ({ reviewed: 0, 'model-based': 0 });
const countEdgeEvidence = (edges: Edge[]): EdgeEvidenceCounts =>
  edges.reduce<EdgeEvidenceCounts>((counts, edge) => {
    counts[getEdgeEvidenceStatus(edge)] += 1;
    return counts;
  }, createEmptyEvidenceCounts());
const getEntityDrilldownState = (
  edges: Edge[],
  activeEntityId: string,
  expandedNodeIds: Set<string>
): EntityDrilldownState => {
  const scoped = new Map<string, Edge>();
  const directEdges = edges.filter((edge) => edge.source_id === activeEntityId || edge.target_id === activeEntityId);
  const outboundDepthByNodeId = new Map<string, number>();
  const expandableNodeIds = new Set<string>();

  directEdges.forEach((edge) => {
    scoped.set(getEdgeDisplayKey(edge), edge);
  });

  const directTargetIds = [...new Set(
    directEdges
      .filter((edge) => edge.source_id === activeEntityId)
      .map((edge) => edge.target_id)
  )];

  directTargetIds.forEach((targetId) => {
    outboundDepthByNodeId.set(targetId, 1);
    if (edges.some((edge) => edge.source_id === targetId)) {
      expandableNodeIds.add(targetId);
    }
  });

  const queue = directTargetIds.filter((targetId) => expandedNodeIds.has(targetId));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId || visited.has(currentNodeId)) {
      continue;
    }
    visited.add(currentNodeId);

    const currentDepth = outboundDepthByNodeId.get(currentNodeId) || 1;
    const childEdges = edges.filter((edge) => edge.source_id === currentNodeId);
    childEdges.forEach((edge) => {
      scoped.set(getEdgeDisplayKey(edge), edge);
      const nextDepth = currentDepth + 1;
      const existingDepth = outboundDepthByNodeId.get(edge.target_id);
      if (existingDepth === undefined || nextDepth < existingDepth) {
        outboundDepthByNodeId.set(edge.target_id, nextDepth);
      }
      if (edges.some((candidate) => candidate.source_id === edge.target_id)) {
        expandableNodeIds.add(edge.target_id);
      }
      if (expandedNodeIds.has(edge.target_id)) {
        queue.push(edge.target_id);
      }
    });
  }

  return {
    visibleEdges: [...scoped.values()],
    outboundDepthByNodeId,
    expandableNodeIds,
  };
};
const getSankeyDisplayValue = (valueUsd: number, compressScale: boolean) => {
  if (!compressScale) {
    return valueUsd;
  }
  return Math.sqrt(Math.max(valueUsd, 1));
};

type SankeyNodeData = {
  id: string;
  nodeColor: string;
  label: string;
  actualNodeId?: string;
  kind?: 'root' | 'entity' | 'category' | 'aggregate';
  direction?: 'in' | 'out' | 'aggregate';
  depth?: number;
  expandable?: boolean;
  expanded?: boolean;
};

type SankeyLinkData = {
  source: string;
  target: string;
  value: number;
  linkColor: string;
  edgeRef?: Edge;
};

type SankeyNodeRecord = SankeyNodeDatum<SankeyNodeData, SankeyLinkData>;
type SankeyLinkRecord = SankeyLinkDatum<SankeyNodeData, SankeyLinkData>;
type SankeyInteractionRecord = SankeyNodeRecord | SankeyLinkRecord;

const getProvenanceBadge = (edge: Edge) => {
  const evidence = EVIDENCE_STYLES[getEdgeEvidenceStatus(edge)];
  return {
    label: evidence.label,
    background: evidence.background,
    border: evidence.border,
    color: evidence.color,
  };
};

const formatSankeyNodeLabel = (nodeId: string) => {
  if (nodeId.startsWith('IN: ')) return nodeId.replace('IN: ', '');
  if (nodeId.startsWith('OUT: ')) return nodeId.replace('OUT: ', '');
  if (nodeId.startsWith('OUT2: ')) return nodeId.replace('OUT2: ', '');
  if (nodeId.startsWith('OUT3: ')) return nodeId.replace('OUT3: ', '');
  if (nodeId.startsWith('SRC: ')) return nodeId.replace('SRC: ', '');
  if (nodeId.startsWith('TRG: ')) return nodeId.replace('TRG: ', '');

  const categoryMatch = nodeId.match(/^(IN|OUT)\(([^)]+)\): \[(.+)\]$/);
  if (categoryMatch) {
    return '';
  }

  const macroCategoryMatch = nodeId.match(/^CAT\((.+)->(.+)\): \[(.+)\]$/);
  if (macroCategoryMatch) {
    return `[${macroCategoryMatch[3]}]`;
  }

  return nodeId;
};
const ENTITY_ROOT_NODE_ID = 'ENTITY_ROOT';
const getOutboundNodeId = (depth: number, nodeId: string) => `OUTNODE|${depth}|${nodeId}`;
const getInboundNodeId = (nodeId: string) => `INNODE|${nodeId}`;
const getCategoryNodeId = (
  direction: 'in' | 'out',
  depth: number,
  sourceId: string,
  targetId: string,
  category: string
) => `CATNODE|${direction}|${depth}|${sourceId}|${targetId}|${category}`;
const getDrilldownNodeColor = (depth: number) => {
  const palette = ['#30363d', '#2dd4bf', '#f59e0b', '#fb7185', '#60a5fa'];
  return palette[Math.max(0, (depth - 1) % palette.length)];
};
const getCollapsedBranchNodeIds = (edges: Edge[], rootNodeId: string) => {
  const removedIds = new Set<string>([rootNodeId]);
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId) {
      continue;
    }
    edges
      .filter((edge) => edge.source_id === currentNodeId)
      .forEach((edge) => {
        if (!removedIds.has(edge.target_id)) {
          removedIds.add(edge.target_id);
          queue.push(edge.target_id);
        }
      });
  }

  return removedIds;
};

export const FlowDashboard: React.FC<FlowDashboardProps> = ({
  nodes,
  edges,
  currentYear,
  currency,
  metadata,
  budgetEntityIds,
  selectedEntityId,
  onSelectedEntityChange,
}) => {
  const [viewLevel, setViewLevel] = useState<'entity' | 'type'>('entity');
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [selectedLinkDetails, setSelectedLinkDetails] = useState<Edge | null>(null);
  const [expandedNodeIdsByScope, setExpandedNodeIdsByScope] = useState<Record<string, string[]>>({});
  const activeEntityId = nodes.some((node) => node.id === selectedEntityId) ? selectedEntityId : 'MIN_CFA';
  const useCompressedEntityScale = viewLevel === 'entity';
  const drilldownScopeKey = `${viewLevel}:${activeEntityId}`;
  const expandedNodeIds = useMemo(
    () => expandedNodeIdsByScope[drilldownScopeKey] || [],
    [drilldownScopeKey, expandedNodeIdsByScope]
  );
  const evidenceFilteredEdges = useMemo(
    () => (reviewedOnly ? edges.filter((edge) => !isModeledEdge(edge)) : edges),
    [edges, reviewedOnly]
  );
  const expandedNodeIdSet = useMemo(() => new Set(expandedNodeIds), [expandedNodeIds]);
  const nodeNameById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.name])),
    [nodes]
  );
  const entityDrilldownState = useMemo(
    () => getEntityDrilldownState(evidenceFilteredEdges, activeEntityId, expandedNodeIdSet),
    [activeEntityId, evidenceFilteredEdges, expandedNodeIdSet]
  );
  const visibleExpandedNodeCount = useMemo(
    () => expandedNodeIds.filter((nodeId) => entityDrilldownState.outboundDepthByNodeId.has(nodeId)).length,
    [entityDrilldownState.outboundDepthByNodeId, expandedNodeIds]
  );

  const evidenceSummary = useMemo(() => {
    const fullScopeEdges = viewLevel === 'entity'
      ? getEntityDrilldownState(edges, activeEntityId, expandedNodeIdSet).visibleEdges
      : edges;
    const visibleScopeEdges = viewLevel === 'entity' ? entityDrilldownState.visibleEdges : evidenceFilteredEdges;
    const allCounts = countEdgeEvidence(fullScopeEdges);
    const visibleCounts = countEdgeEvidence(visibleScopeEdges);

    return {
      allCounts,
      visibleCounts,
      hiddenModeledCount: Math.max(0, allCounts['model-based'] - visibleCounts['model-based']),
      scopeLabel: viewLevel === 'entity' ? 'この主体の表示フロー' : 'この年度の表示フロー',
    };
  }, [activeEntityId, edges, entityDrilldownState.visibleEdges, evidenceFilteredEdges, expandedNodeIdSet, viewLevel]);
  const activeSelectedLinkDetails = useMemo(() => {
    if (!selectedLinkDetails) {
      return null;
    }
    const selectedKey = getEdgeDisplayKey(selectedLinkDetails);
    return evidenceFilteredEdges.find((edge) => getEdgeDisplayKey(edge) === selectedKey) || null;
  }, [evidenceFilteredEdges, selectedLinkDetails]);

  useEffect(() => {
    if (selectedEntityId !== activeEntityId) {
      onSelectedEntityChange(activeEntityId);
    }
  }, [activeEntityId, onSelectedEntityChange, selectedEntityId]);
  const updateExpandedNodeIds = (updater: (current: string[]) => string[]) => {
    setExpandedNodeIdsByScope((current) => {
      const nextExpandedNodeIds = updater(current[drilldownScopeKey] || []);
      if (nextExpandedNodeIds.length === 0) {
        const rest = { ...current };
        delete rest[drilldownScopeKey];
        return rest;
      }
      return {
        ...current,
        [drilldownScopeKey]: nextExpandedNodeIds,
      };
    });
  };

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
    const nodeMap = new Map<string, SankeyNodeData>();
    const sLinks: SankeyLinkData[] = [];
    const addNode = (node: SankeyNodeData) => {
      const existing = nodeMap.get(node.id);
      if (existing) {
        nodeMap.set(node.id, { ...existing, ...node });
        return;
      }
      nodeMap.set(node.id, node);
    };

    if (viewLevel === 'entity') {
      const selectedEdges = entityDrilldownState.visibleEdges;
      const focusNodeName = nodeNameById.get(activeEntityId) || activeEntityId;
      addNode({
        id: ENTITY_ROOT_NODE_ID,
        nodeColor: '#ffffff',
        label: focusNodeName,
        actualNodeId: activeEntityId,
        kind: 'root',
        depth: 0,
      });

      selectedEdges.forEach((edge) => {
        const sourceName = nodeNameById.get(edge.source_id) || edge.source_id;
        const targetName = nodeNameById.get(edge.target_id) || edge.target_id;
        const categoryLabel = `[${CATEGORY_LABELS[edge.category] || edge.category.toUpperCase()}]`;
        const catColor = CATEGORY_COLORS[edge.category] || '#aaa';
        const evidenceColor = EVIDENCE_STYLES[getEdgeEvidenceStatus(edge)].linkColor;
        const displayValue = getSankeyDisplayValue(edge.value_usd, useCompressedEntityScale);

        if (edge.target_id === activeEntityId) {
          const sourceNodeId = getInboundNodeId(edge.source_id);
          const catNodeId = getCategoryNodeId('in', 1, edge.source_id, edge.target_id, edge.category);
          addNode({
            id: sourceNodeId,
            nodeColor: '#30363d',
            label: sourceName,
            actualNodeId: edge.source_id,
            kind: 'entity',
            direction: 'in',
            depth: 1,
            expandable: false,
            expanded: false,
          });
          addNode({
            id: catNodeId,
            nodeColor: catColor,
            label: categoryLabel,
            kind: 'category',
            direction: 'in',
            depth: 1,
          });
          sLinks.push({ source: sourceNodeId, target: catNodeId, value: displayValue, linkColor: evidenceColor, edgeRef: edge });
          sLinks.push({ source: catNodeId, target: ENTITY_ROOT_NODE_ID, value: displayValue, linkColor: evidenceColor, edgeRef: edge });
        } else if (edge.source_id === activeEntityId) {
          const targetDepth = entityDrilldownState.outboundDepthByNodeId.get(edge.target_id) || 1;
          const targetNodeId = getOutboundNodeId(targetDepth, edge.target_id);
          const catNodeId = getCategoryNodeId('out', targetDepth, edge.source_id, edge.target_id, edge.category);
          const isExpanded = expandedNodeIdSet.has(edge.target_id);
          const isExpandable = entityDrilldownState.expandableNodeIds.has(edge.target_id);
          addNode({
            id: targetNodeId,
            nodeColor: getDrilldownNodeColor(targetDepth),
            label: isExpandable ? `${targetName} ${isExpanded ? '▾' : '▸'}` : targetName,
            actualNodeId: edge.target_id,
            kind: 'entity',
            direction: 'out',
            depth: targetDepth,
            expandable: isExpandable,
            expanded: isExpanded,
          });
          addNode({
            id: catNodeId,
            nodeColor: catColor,
            label: categoryLabel,
            kind: 'category',
            direction: 'out',
            depth: targetDepth,
          });
          sLinks.push({ source: ENTITY_ROOT_NODE_ID, target: catNodeId, value: displayValue, linkColor: evidenceColor, edgeRef: edge });
          sLinks.push({ source: catNodeId, target: targetNodeId, value: displayValue, linkColor: evidenceColor, edgeRef: edge });
        } else {
          const sourceDepth = entityDrilldownState.outboundDepthByNodeId.get(edge.source_id);
          if (!sourceDepth) {
            return;
          }
          const sourceNodeId = getOutboundNodeId(sourceDepth, edge.source_id);
          const targetDepth = entityDrilldownState.outboundDepthByNodeId.get(edge.target_id) || (sourceDepth + 1);
          const targetNodeId = getOutboundNodeId(targetDepth, edge.target_id);
          const catNodeId = getCategoryNodeId('out', targetDepth, edge.source_id, edge.target_id, edge.category);
          const sourceExpanded = expandedNodeIdSet.has(edge.source_id);
          const sourceExpandable = entityDrilldownState.expandableNodeIds.has(edge.source_id);
          const targetExpanded = expandedNodeIdSet.has(edge.target_id);
          const targetExpandable = entityDrilldownState.expandableNodeIds.has(edge.target_id);
          addNode({
            id: sourceNodeId,
            nodeColor: getDrilldownNodeColor(sourceDepth),
            label: sourceExpandable ? `${sourceName} ${sourceExpanded ? '▾' : '▸'}` : sourceName,
            actualNodeId: edge.source_id,
            kind: 'entity',
            direction: 'out',
            depth: sourceDepth,
            expandable: sourceExpandable,
            expanded: sourceExpanded,
          });
          addNode({
            id: targetNodeId,
            nodeColor: getDrilldownNodeColor(targetDepth),
            label: targetExpandable ? `${targetName} ${targetExpanded ? '▾' : '▸'}` : targetName,
            actualNodeId: edge.target_id,
            kind: 'entity',
            direction: 'out',
            depth: targetDepth,
            expandable: targetExpandable,
            expanded: targetExpanded,
          });
          addNode({
            id: catNodeId,
            nodeColor: catColor,
            label: categoryLabel,
            kind: 'category',
            direction: 'out',
            depth: targetDepth,
          });
          sLinks.push({ source: sourceNodeId, target: catNodeId, value: displayValue, linkColor: evidenceColor, edgeRef: edge });
          sLinks.push({ source: catNodeId, target: targetNodeId, value: displayValue, linkColor: evidenceColor, edgeRef: edge });
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

      evidenceFilteredEdges.forEach(edge => {
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

        addNode({
          id: source,
          nodeColor: nodeColorSource,
          label: formatSankeyNodeLabel(source),
          kind: 'aggregate',
          direction: 'aggregate',
        });
        addNode({
          id: target,
          nodeColor: nodeColorTarget,
          label: formatSankeyNodeLabel(target),
          kind: 'aggregate',
          direction: 'aggregate',
        });
        sLinks.push({ source, target, value, linkColor: catColor });
      });
    }

    return { nodes: [...nodeMap.values()], links: sLinks };
  }, [
    activeEntityId,
    entityDrilldownState.expandableNodeIds,
    entityDrilldownState.outboundDepthByNodeId,
    entityDrilldownState.visibleEdges,
    evidenceFilteredEdges,
    expandedNodeIdSet,
    nodeNameById,
    nodes,
    useCompressedEntityScale,
    viewLevel,
  ]);

  const hasData = sankeyData.links.length > 0;
  const researchYearsByEntity = useMemo(() => {
    const mapping = new Map<string, number[]>();
    [...(metadata.knowledgeNotes || []), ...(metadata.structuredFacts || []), ...(metadata.implementationSites || [])].forEach((item) => {
      const existing = mapping.get(item.entity_id) || [];
      if (!existing.includes(item.fiscal_year)) {
        existing.push(item.fiscal_year);
      }
      mapping.set(item.entity_id, existing.sort((a, b) => a - b));
    });
    return mapping;
  }, [metadata.implementationSites, metadata.knowledgeNotes, metadata.structuredFacts]);
  const budgetYearsByEntity = useMemo(() => {
    const mapping = new Map<string, number[]>();
    (metadata.budgetHighlights || []).forEach((item) => {
      const existing = mapping.get(item.entity_id) || [];
      if (!existing.includes(item.fiscal_year)) {
        existing.push(item.fiscal_year);
      }
      mapping.set(item.entity_id, existing.sort((a, b) => a - b));
    });
    return mapping;
  }, [metadata.budgetHighlights]);
  const activeEntityResearchYears = useMemo(
    () => researchYearsByEntity.get(activeEntityId) || [],
    [activeEntityId, researchYearsByEntity]
  );
  const activeEntityResearchLink = useMemo(() => {
    if (!activeEntityResearchYears.length) {
      return null;
    }
    const targetYear = activeEntityResearchYears.includes(currentYear)
      ? currentYear
      : getNearestAvailableYear(activeEntityResearchYears, currentYear);
    const params = new URLSearchParams({
      view: 'budget',
      year: String(targetYear),
      entity: activeEntityId,
      tab: 'research_note',
    });
    return `${window.location.pathname}?${params.toString()}`;
  }, [activeEntityId, activeEntityResearchYears, currentYear]);
  const sankeyViewportMinHeight = useMemo(
    () => (viewLevel === 'entity' ? Math.max(860, sankeyData.nodes.length * 56) : 860),
    [sankeyData.nodes.length, viewLevel]
  );
  const budgetDeepLink = useMemo(() => {
    if (!activeSelectedLinkDetails) {
      return null;
    }
    if (isModeledEdge(activeSelectedLinkDetails)) {
      return null;
    }
    const preferredEntityId = [activeSelectedLinkDetails.source_id, activeEntityId, activeSelectedLinkDetails.target_id].find((id) =>
      budgetEntityIds.includes(id) && (budgetYearsByEntity.get(id) || []).length > 0
    );
    if (!preferredEntityId) {
      return null;
    }
    const entityBudgetYears = budgetYearsByEntity.get(preferredEntityId) || [];
    const targetYear = entityBudgetYears.includes(currentYear)
      ? currentYear
      : getNearestAvailableYear(entityBudgetYears, currentYear);
    const params = new URLSearchParams({
      view: 'budget',
      year: String(targetYear),
      entity: preferredEntityId,
      tab: 'major_program',
      focus: activeSelectedLinkDetails.target_id,
    });
    return `${window.location.pathname}?${params.toString()}`;
  }, [activeEntityId, activeSelectedLinkDetails, budgetEntityIds, budgetYearsByEntity, currentYear]);
  const researchDeepLink = useMemo(() => {
    if (!activeSelectedLinkDetails) {
      return activeEntityResearchLink;
    }
    const preferredEntityId = [activeEntityId, activeSelectedLinkDetails.source_id, activeSelectedLinkDetails.target_id].find((id) =>
      (researchYearsByEntity.get(id) || []).length > 0
    );
    if (!preferredEntityId) {
      return activeEntityResearchLink;
    }
    const entityResearchYears = researchYearsByEntity.get(preferredEntityId) || [];
    const targetYear = entityResearchYears.includes(currentYear)
      ? currentYear
      : getNearestAvailableYear(entityResearchYears, currentYear);
    const params = new URLSearchParams({
      view: 'budget',
      year: String(targetYear),
      entity: preferredEntityId,
      tab: 'research_note',
    });
    return `${window.location.pathname}?${params.toString()}`;
  }, [activeEntityId, activeEntityResearchLink, activeSelectedLinkDetails, currentYear, researchYearsByEntity]);
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
        {!edge.source_url && isModeledEdge(edge) && (
          <div style={{ color: '#cbd5e1', lineHeight: 1.55 }}>
            モデル由来のデータです。一次資料 URL を個別には紐付けていません。
          </div>
        )}
      </div>
    );
  };

  const compactPanelStyle: React.CSSProperties = {
    display: 'grid',
    gap: '0.3rem',
    background: 'rgba(255,255,255,0.05)',
    padding: '0.45rem 0.6rem',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', padding: '2rem', paddingTop: '5rem', background: 'radial-gradient(circle at center, #111 0%, #000 100%)' }}>
      
	      {/* Entity Selector Header */}
	      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.8rem', zIndex: 10, flexWrap: 'wrap' }}>
	        <div>
	          <h1 style={{ margin: 0, fontSize: '1.55rem', fontWeight: 600, lineHeight: 1.15 }}>エンティティ別 資金フロー解析</h1>
	          <p style={{ margin: '0.12rem 0 0', color: 'var(--text-muted)', fontSize: '0.84rem' }}>{currentYear}年における詳細な資金の流入と流出を分析</p>
        </div>
        
        <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'stretch', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* View Level Toggle */}
          <div style={{ ...compactPanelStyle, minWidth: '190px' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>集計レベル</label>
            <div style={{ display: 'flex', gap: '0.15rem', background: '#000', padding: '0.15rem', borderRadius: '7px', border: '1px solid #333' }}>
              <button 
                onClick={() => setViewLevel('entity')}
                style={{ 
                  background: viewLevel === 'entity' ? '#fff' : 'transparent', 
                  color: viewLevel === 'entity' ? '#000' : 'var(--text-muted)',
                  border: 'none', padding: '0.18rem 0.5rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 500
                }}
              >
                特定エンティティ
              </button>
              <button 
                onClick={() => setViewLevel('type')}
                style={{ 
                  background: viewLevel === 'type' ? '#fff' : 'transparent', 
                  color: viewLevel === 'type' ? '#000' : 'var(--text-muted)',
                  border: 'none', padding: '0.18rem 0.5rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 500
                }}
              >
                マクロカテゴリ別
              </button>
            </div>
          </div>

          {/* Entity Selector (Only visible in entity mode) */}
	          {viewLevel === 'entity' && (
	            <div style={{ ...compactPanelStyle, minWidth: '220px' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>対象エンティティ</label>
              <select 
                value={activeEntityId} 
                onChange={(e) => onSelectedEntityChange(e.target.value)}
                style={{
                  background: '#000',
                  color: '#fff',
                  border: '1px solid #333',
                  padding: '0.34rem 0.45rem',
                  borderRadius: '7px',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  minWidth: '200px',
                  fontSize: '0.82rem'
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

	          <div style={{ ...compactPanelStyle, minWidth: '290px', maxWidth: '390px' }}>
	            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
	              <div style={{ display: 'grid', gap: '0.12rem' }}>
	                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>表示情報</div>
	                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{evidenceSummary.scopeLabel}</div>
	              </div>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.74rem',
                  color: '#fff',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <input
                  type="checkbox"
                  checked={reviewedOnly}
                  onChange={(event) => setReviewedOnly(event.target.checked)}
                  aria-label="実データのみ表示"
                  style={{ accentColor: '#4ade80' }}
                />
                実データのみ表示
              </label>
            </div>
	            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.32rem' }}>
              {(['reviewed', 'model-based'] as const).map((status) => (
                <div
                  key={status}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.24rem 0.45rem',
                    borderRadius: '999px',
                    background: EVIDENCE_STYLES[status].background,
                    border: EVIDENCE_STYLES[status].border,
                  }}
                >
                  <span
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '999px',
                      background: EVIDENCE_STYLES[status].linkColor,
                      boxShadow: `0 0 10px ${EVIDENCE_STYLES[status].linkColor}`,
                    }}
                  />
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: EVIDENCE_STYLES[status].color }}>
                    {status === 'reviewed' ? 'R' : 'M'}
                  </span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: EVIDENCE_STYLES[status].color }}>
                    {EVIDENCE_STYLES[status].label}
                  </span>
                  <span
                    data-testid={`evidence-summary-${status}`}
                    style={{ fontSize: '0.76rem', fontWeight: 700, color: '#fff' }}
                  >
                    {evidenceSummary.visibleCounts[status]}本
                  </span>
                  {status === 'model-based' && reviewedOnly && evidenceSummary.hiddenModeledCount > 0 && (
                    <span
                      data-testid="evidence-hidden-modeled"
                      style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}
                    >
                      非表示 {evidenceSummary.hiddenModeledCount}本
                    </span>
                  )}
                </div>
              ))}
	            </div>
	            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
	              <div style={{ display: 'grid', gap: '0.08rem', fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
	                <span>緑=一次資料ベース、紫=配分モデル</span>
	                {viewLevel === 'entity' && (
	                  <span>
	                    下流ノードをクリックすると次段を展開
	                    {visibleExpandedNodeCount > 0 ? `（展開中 ${visibleExpandedNodeCount}）` : ''}
	                  </span>
	                )}
	              </div>
	              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
	                {viewLevel === 'entity' && visibleExpandedNodeCount > 0 ? (
	                  <button
	                    type="button"
	                    onClick={() => updateExpandedNodeIds(() => [])}
	                    style={{
	                      padding: '0.24rem 0.55rem',
	                      background: 'rgba(255,255,255,0.06)',
	                      color: '#fff',
	                      borderRadius: '999px',
	                      border: '1px solid rgba(255,255,255,0.16)',
	                      fontWeight: 600,
	                      fontSize: '0.72rem',
	                      cursor: 'pointer',
	                    }}
	                  >
	                    展開をリセット
	                  </button>
	                ) : null}
	                {viewLevel === 'entity' && activeEntityResearchLink ? (
	                  <>
	                    <span
	                      style={{
	                        display: 'inline-flex',
	                        alignItems: 'center',
	                        padding: '0.18rem 0.42rem',
	                        borderRadius: '999px',
	                        fontSize: '0.68rem',
	                        fontWeight: 700,
	                        color: '#d9f99d',
	                        background: 'rgba(163, 230, 53, 0.1)',
	                        border: '1px solid rgba(163, 230, 53, 0.22)',
	                      }}
	                    >
	                      調査ノートあり
	                    </span>
	                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
	                      {activeEntityResearchYears.includes(currentYear) ? `${currentYear}年対応` : `登録年 ${activeEntityResearchYears.join(', ')}`}
	                    </span>
	                    <a
	                      href={activeEntityResearchLink}
	                      style={{
	                        display: 'inline-block',
	                        padding: '0.24rem 0.55rem',
	                        background: 'rgba(163, 230, 53, 0.14)',
	                        color: '#d9f99d',
	                        textDecoration: 'none',
	                        borderRadius: '999px',
	                        fontWeight: 600,
	                        fontSize: '0.72rem',
	                        textAlign: 'center',
	                        border: '1px solid rgba(163, 230, 53, 0.28)',
	                      }}
	                    >
	                      調査ノートを開く
	                    </a>
	                  </>
	                ) : null}
	              </div>
	            </div>
	          </div>

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
          overflowX: 'hidden',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: `${sankeyViewportMinHeight}px`,
            minWidth: 0,
            width: '100%',
            position: 'relative',
          }}
        >
          {!hasData ? (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--text-muted)' }}>
              現在のフィルタ条件では、該当する資金フローデータの記録がありません。
            </div>
          ) : (
            <ResponsiveSankey<SankeyNodeData, SankeyLinkData>
              data={sankeyData}
              margin={{ top: 36, right: 140, bottom: 48, left: 140 }}
              align="justify"
              colors={(node) => node.nodeColor}
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
	              label={(node) => sankeyData.nodes.find((candidate) => candidate.id === node.id)?.label || formatSankeyNodeLabel(node.id)}
              labelPosition="outside"
              labelOrientation="horizontal"
              labelPadding={12}
              labelTextColor="#ffffff"
              theme={{
                tooltip: {
                  container: { background: '#111', color: '#fff', fontSize: '12px', border: '1px solid #333' }
                }
              }}
	              onClick={(datum: SankeyInteractionRecord) => {
	                if ('source' in datum && 'target' in datum) {
	                  if (datum.edgeRef) {
	                    setSelectedLinkDetails(datum.edgeRef);
	                  }
	                  return;
	                }

	                if (datum.id === undefined) {
	                  return;
	                }

	                setSelectedLinkDetails(null);

	                if (viewLevel === 'type') {
	                  const typeToSearch = datum.label;
	                  const mapTypeToInternal: Record<string, string> = {
	                    国家: 'country',
	                    グローバル企業: 'corporation',
	                    '個人/属性': 'individual',
	                    'マクロ主体(政府/日銀/家計)': 'macro_entity',
	                    都道府県: 'prefecture',
	                    国内企業: 'corporation_jp',
	                    '国家予算(歳入)': 'mof_revenue',
	                    '国家予算(歳出)': 'mof_expenditure',
	                    社会保障制度: 'mhlw_benefit',
	                    '受給者/産業': 'recipient',
	                  };
	                  const internalType = mapTypeToInternal[typeToSearch];
	                  if (!internalType) {
	                    return;
	                  }
	                  const firstEntity = nodes.find((node) => node.type === internalType);
	                  if (firstEntity) {
	                    setViewLevel('entity');
	                    onSelectedEntityChange(firstEntity.id);
	                  }
	                  return;
	                }

	                if (datum.kind === 'entity' && datum.direction === 'out' && datum.actualNodeId && datum.expandable) {
	                  updateExpandedNodeIds((current) => {
	                    if (current.includes(datum.actualNodeId!)) {
	                      const collapsedNodeIds = getCollapsedBranchNodeIds(evidenceFilteredEdges, datum.actualNodeId!);
	                      return current.filter((nodeId) => !collapsedNodeIds.has(nodeId));
	                    }
	                    return [...current, datum.actualNodeId!];
	                  });
	                }
	              }}
	              nodeTooltip={({ node }: { node: SankeyNodeRecord }) => {
	              const isClickable = viewLevel === 'type'
	                ? node.id.startsWith('SRC: ') || node.id.startsWith('TRG: ')
	                : Boolean(node.kind === 'entity' && node.direction === 'out' && node.expandable);
	              const actionHint = viewLevel === 'type'
	                ? 'クリックしてこのカテゴリの詳細へ'
	                : node.kind === 'entity' && node.direction === 'out' && node.expandable
	                  ? `クリックして次の資金フローを${node.expanded ? '閉じる' : '展開'}`
	                  : null;

	              return (
	                <div style={{ whiteSpace: 'nowrap', background: '#111', padding: '8px', border: '1px solid #333', borderRadius: '4px' }}>
	                  <strong style={{ color: node.color }}>{node.label}</strong>
	                  {viewLevel !== 'entity' && (
	                    <div style={{ marginTop: '4px' }}>
	                      合計: {formatCurrency(node.value, currency)}
                    </div>
                  )}
                  {viewLevel === 'entity' && (
                    <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)' }}>
	                      線幅は視認性のため圧縮補正しています。金額は詳細カードで確認してください。
	                    </div>
	                  )}
	                  {viewLevel === 'entity' && node.kind === 'entity' && node.direction === 'out' && !node.expandable && (
	                    <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)' }}>
	                      このノードより先の下流フローは未登録です。
	                    </div>
	                  )}
	                  {isClickable && (
	                    <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--accent-color)' }}>
	                      {actionHint}
	                    </div>
	                  )}
	                </div>
	              );
	            }}
	              linkTooltip={({ link }: { link: SankeyLinkRecord }) => (
	            <div style={{ whiteSpace: 'nowrap', background: '#111', padding: '8px', border: '1px solid #333', borderRadius: '4px' }}>
	              <strong style={{ color: link.linkColor }}>{link.source.label} &rarr; {link.target.label}</strong>
	              <br />
	                {formatCurrency(link.edgeRef?.value_usd || link.value, currency)}
	                
	                {/* Find original edge data to display description/URL if present */}
	                {(() => {
	                  const originalEdge = link.edgeRef;

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
      {activeSelectedLinkDetails && (
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
             {nodes.find(n => n.id === activeSelectedLinkDetails.source_id)?.name || activeSelectedLinkDetails.source_id} <span style={{ color: 'var(--text-muted)' }}>&rarr;</span> {nodes.find(n => n.id === activeSelectedLinkDetails.target_id)?.name || activeSelectedLinkDetails.target_id}
          </div>

          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-color)' }}>
            {formatCurrency(activeSelectedLinkDetails.value_usd, currency)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            {getProvenanceBadge(activeSelectedLinkDetails) && (
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
                    background: getProvenanceBadge(activeSelectedLinkDetails)?.background,
                    border: getProvenanceBadge(activeSelectedLinkDetails)?.border,
                    color: getProvenanceBadge(activeSelectedLinkDetails)?.color,
                  }}
                >
                  {getProvenanceBadge(activeSelectedLinkDetails)?.label}
                </span>
              </div>
            )}
            {(activeSelectedLinkDetails.source_title || activeSelectedLinkDetails.source_dataset) && (
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block' }}>出典資料</span>
                {(activeSelectedLinkDetails.source_title || activeSelectedLinkDetails.source_dataset)}
                {activeSelectedLinkDetails.page_number ? ` p.${activeSelectedLinkDetails.page_number}` : ''}
              </div>
            )}
            
            {(activeSelectedLinkDetails.evidence_text || activeSelectedLinkDetails.description) && (
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>AI抽出・根拠テキスト</span>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '6px', borderLeft: '3px solid var(--accent-color)' }}>
                  {activeSelectedLinkDetails.evidence_text && <div style={{ fontStyle: 'italic', marginBottom: activeSelectedLinkDetails.description ? '0.5rem' : '0' }}>"{activeSelectedLinkDetails.evidence_text}"</div>}
                  {activeSelectedLinkDetails.description && <div style={{ color: '#ccc' }}>{activeSelectedLinkDetails.description}</div>}
                </div>
              </div>
            )}

            {isModeledEdge(activeSelectedLinkDetails) && (
              <div style={{ background: 'rgba(192, 132, 252, 0.12)', border: '1px solid rgba(192, 132, 252, 0.22)', borderRadius: '8px', padding: '0.8rem', color: '#e9d5ff', lineHeight: 1.55 }}>
                このフローは model-based データです。Budget ページの reviewed 主要事業とは分けて扱っています。
              </div>
            )}

            {(activeSelectedLinkDetails.source_url || budgetDeepLink || researchDeepLink) && (
              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {activeSelectedLinkDetails.source_url && (
                  <a
                    href={activeSelectedLinkDetails.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      padding: '0.5rem 1rem',
                      background: 'var(--accent-color)',
                      color: '#000',
                      textDecoration: 'none',
                      borderRadius: '20px',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    元の資料・PDFを開く
                  </a>
                )}
                {budgetDeepLink && (
                  <a
                    href={budgetDeepLink}
                    style={{
                      display: 'inline-block',
                      padding: '0.5rem 1rem',
                      background: 'rgba(96, 165, 250, 0.14)',
                      color: '#bfdbfe',
                      textDecoration: 'none',
                      borderRadius: '20px',
                      fontWeight: 600,
                      textAlign: 'center',
                      border: '1px solid rgba(96, 165, 250, 0.28)',
                    }}
                  >
                    この年度の予算ページへ
                  </a>
                )}
                {researchDeepLink && (
                  <a
                    href={researchDeepLink}
                    style={{
                      display: 'inline-block',
                      padding: '0.5rem 1rem',
                      background: 'rgba(163, 230, 53, 0.12)',
                      color: '#d9f99d',
                      textDecoration: 'none',
                      borderRadius: '20px',
                      fontWeight: 600,
                      textAlign: 'center',
                      border: '1px solid rgba(163, 230, 53, 0.28)',
                    }}
                  >
                    調査ノートへ
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
