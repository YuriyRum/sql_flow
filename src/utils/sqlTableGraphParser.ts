/**
 * SQL Table Dependency & Condition Parser for SAP HANA
 * Extracts tables, aliases, join relationships, ON conditions on edges,
 * and specific WHERE conditions per table node.
 */

export interface TableNodeData {
  id: string; // unique identifier e.g. "VBAK_v"
  tableName: string; // "VBAK"
  schemaName?: string; // "SAP_S4HANA"
  fullTableName: string; // '"SAP_S4HANA"."VBAK"' or 'VBAK'
  alias: string; // "v" or ""
  displayName: string; // '"SAP_S4HANA"."VBAK" (v)'
  joinType: 'FROM' | 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN' | 'CROSS JOIN' | 'CTE' | 'TARGET';
  whereConditions: string[]; // WHERE conditions specific to this table
  columns: string[]; // Referenced columns from this table
  isRoot: boolean;
  orderIndex: number;
  x?: number;
  y?: number;
}

export interface TableEdgeData {
  id: string;
  sourceId: string; // Source table node ID
  targetId: string; // Target table node ID
  sourceName: string;
  targetName: string;
  sourceAlias: string;
  targetAlias: string;
  joinType: string; // 'INNER JOIN', 'LEFT JOIN', etc.
  onCondition: string; // e.g. 'v."SALES_DOCUMENT" = p."SALES_DOCUMENT"'
  detailedConditions: string[];
}

export interface ParsedTableGraph {
  nodes: TableNodeData[];
  edges: TableEdgeData[];
  globalWhereConditions: string[]; // WHERE conditions not tied to a single table
  statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'UNKNOWN';
  cteCount: number;
  hasErrors: boolean;
  rawSql: string;
}

/**
 * Strips SQL comments and string literals temporarily to allow clean tokenization
 */
function cleanSqlForAnalysis(sql: string): {
  cleanText: string;
  strings: string[];
} {
  const strings: string[] = [];
  let pos = 0;
  let result = '';
  const len = sql.length;

  while (pos < len) {
    const char = sql[pos];
    const nextChar = pos + 1 < len ? sql[pos + 1] : '';

    // Single line comment
    if ((char === '-' && nextChar === '-') || (char === '/' && nextChar === '/')) {
      while (pos < len && sql[pos] !== '\n') {
        pos++;
      }
      result += ' ';
      continue;
    }

    // Block comment
    if (char === '/' && nextChar === '*') {
      pos += 2;
      while (pos < len - 1 && !(sql[pos] === '*' && sql[pos + 1] === '/')) {
        pos++;
      }
      pos = Math.min(len, pos + 2);
      result += ' ';
      continue;
    }

    // String literal '...'
    if (char === "'") {
      let str = "'";
      pos++;
      while (pos < len) {
        if (sql[pos] === "'") {
          str += "'";
          if (pos + 1 < len && sql[pos + 1] === "'") {
            str += "'";
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          str += sql[pos];
          pos++;
        }
      }
      const placeholder = `__STR_${strings.length}__`;
      strings.push(str);
      result += placeholder;
      continue;
    }

    result += char;
    pos++;
  }

  return { cleanText: result, strings };
}

/**
 * Restores string placeholders
 */
function restoreStrings(text: string, strings: string[]): string {
  let res = text;
  strings.forEach((s, idx) => {
    res = res.split(`__STR_${idx}__`).join(s);
  });
  return res;
}

/**
 * Clean identifier: removes quotes, brackets
 */
function stripQuotes(id: string): string {
  return id.replace(/^["'`]|["'`]$/g, '').trim();
}

/**
 * Parses full table name into schema and table
 */
function parseSchemaAndTable(rawName: string): { schema?: string; table: string; fullName: string } {
  const clean = rawName.trim();
  const parts = clean.split('.');
  if (parts.length === 2) {
    const schema = stripQuotes(parts[0]);
    const table = stripQuotes(parts[1]);
    return { schema, table, fullName: clean };
  }
  return { table: stripQuotes(clean), fullName: clean };
}

/**
 * Main parser function to extract table graph, ON conditions on edges,
 * and WHERE conditions per node.
 */
export function parseSqlTableGraph(sql: string): ParsedTableGraph {
  const trimmed = sql.trim();
  if (!trimmed) {
    return {
      nodes: [],
      edges: [],
      globalWhereConditions: [],
      statementType: 'UNKNOWN',
      cteCount: 0,
      hasErrors: false,
      rawSql: sql,
    };
  }

  const { cleanText, strings } = cleanSqlForAnalysis(sql);

  // Detect statement type
  let statementType: ParsedTableGraph['statementType'] = 'SELECT';
  const firstWordMatch = cleanText.match(/^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b/i);
  if (firstWordMatch) {
    const word = firstWordMatch[1].toUpperCase();
    if (word === 'INSERT') statementType = 'INSERT';
    else if (word === 'UPDATE') statementType = 'UPDATE';
    else if (word === 'DELETE') statementType = 'DELETE';
    else if (word === 'MERGE') statementType = 'MERGE';
    else statementType = 'SELECT';
  }

  const nodes: TableNodeData[] = [];
  const edges: TableEdgeData[] = [];
  const globalWhereConditions: string[] = [];
  const tableAliasMap = new Map<string, string>(); // alias.toUpperCase() -> nodeId
  const tableNameMap = new Map<string, string>(); // tableName.toUpperCase() -> nodeId

  // 1. Extract CTEs if present: WITH cte_name AS (SELECT ...)
  let cteCount = 0;
  const cteRegex = /\bWITH\s+([A-Za-z0-9_"]+)\s+AS\s*\(/gi;
  let cteMatch: RegExpExecArray | null;
  while ((cteMatch = cteRegex.exec(cleanText)) !== null) {
    cteCount++;
    const cteName = stripQuotes(cteMatch[1]);
    const nodeId = `CTE_${cteName.toUpperCase()}`;
    const cteNode: TableNodeData = {
      id: nodeId,
      tableName: cteName,
      fullTableName: cteName,
      alias: cteName,
      displayName: `CTE: ${cteName}`,
      joinType: 'CTE',
      whereConditions: [],
      columns: [],
      isRoot: false,
      orderIndex: nodes.length,
    };
    nodes.push(cteNode);
    tableAliasMap.set(cteName.toUpperCase(), nodeId);
    tableNameMap.set(cteName.toUpperCase(), nodeId);
  }

  // 2. Extract TARGET Table for INSERT / UPDATE / MERGE / DELETE
  if (statementType === 'INSERT' || statementType === 'UPDATE' || statementType === 'MERGE') {
    const targetMatch = cleanText.match(/\b(?:INTO|UPDATE|MERGE\s+INTO)\s+([A-Za-z0-9_".]+)(?:\s+(?:AS\s+)?([A-Za-z0-9_"]+))?/i);
    if (targetMatch) {
      const rawTarget = targetMatch[1];
      const targetAlias = targetMatch[2] ? stripQuotes(targetMatch[2]) : '';
      const { schema, table, fullName } = parseSchemaAndTable(rawTarget);
      const nodeId = `TARGET_${table.toUpperCase()}${targetAlias ? '_' + targetAlias : ''}`;

      const targetNode: TableNodeData = {
        id: nodeId,
        tableName: table,
        schemaName: schema,
        fullTableName: fullName,
        alias: targetAlias,
        displayName: targetAlias ? `${fullName} (${targetAlias})` : fullName,
        joinType: 'TARGET',
        whereConditions: [],
        columns: [],
        isRoot: true,
        orderIndex: nodes.length,
      };

      nodes.push(targetNode);
      if (targetAlias) tableAliasMap.set(targetAlias.toUpperCase(), nodeId);
      tableNameMap.set(table.toUpperCase(), nodeId);
      tableNameMap.set(fullName.toUpperCase(), nodeId);
    }
  }

  // 3. Extract FROM clause base table(s)
  // Supports single table, aliased table, or comma separated tables
  const fromMatch = cleanText.match(/\bFROM\s+([A-Za-z0-9_".]+(?:\s+(?:AS\s+)?[A-Za-z0-9_"]+)?(?:\s*,\s*[A-Za-z0-9_".]+(?:\s+(?:AS\s+)?[A-Za-z0-9_"]+)?)*)/i);

  if (fromMatch) {
    const fromSection = fromMatch[1];
    const commaTables = fromSection.split(/\s*,\s*/);

    commaTables.forEach((entry, idx) => {
      const trimmedEntry = entry.trim();
      if (!trimmedEntry) return;

      const parts = trimmedEntry.split(/\s+(?:AS\s+)?/i);
      const rawTable = parts[0];
      const alias = parts.length > 1 ? stripQuotes(parts[1]) : '';
      const { schema, table, fullName } = parseSchemaAndTable(rawTable);

      if (['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) return;

      const nodeId = `TBL_${table.toUpperCase()}${alias ? '_' + alias : `_${idx}`}`;

      // Avoid duplicate root node if already added
      if (!nodes.some((n) => n.id === nodeId)) {
        const node: TableNodeData = {
          id: nodeId,
          tableName: table,
          schemaName: schema,
          fullTableName: fullName,
          alias,
          displayName: alias ? `${fullName} (${alias})` : fullName,
          joinType: idx === 0 ? 'FROM' : 'CROSS JOIN',
          whereConditions: [],
          columns: [],
          isRoot: idx === 0,
          orderIndex: nodes.length,
        };
        nodes.push(node);
        if (alias) tableAliasMap.set(alias.toUpperCase(), nodeId);
        tableNameMap.set(table.toUpperCase(), nodeId);
        tableNameMap.set(fullName.toUpperCase(), nodeId);
      }
    });
  }

  // 4. Extract JOIN clauses (INNER, LEFT, RIGHT, FULL, CROSS) and their ON conditions
  // Regex matches JOIN type, Table name, optional AS alias, and ON condition
  const joinRegex = /\b(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|JOIN)\s+([A-Za-z0-9_".]+)(?:\s+(?:AS\s+)?([A-Za-z0-9_"]+))?(?:\s+ON\s+([\s\S]*?)(?=\b(?:INNER|LEFT|RIGHT|FULL|CROSS|JOIN|WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|UNION)\b|$))?/gi;

  let joinMatch: RegExpExecArray | null;
  while ((joinMatch = joinRegex.exec(cleanText)) !== null) {
    const rawJoinType = joinMatch[1].toUpperCase().replace(/\s+/g, ' ');
    const rawTable = joinMatch[2];
    const alias = joinMatch[3] ? stripQuotes(joinMatch[3]) : '';
    const rawOnCondition = joinMatch[4] ? joinMatch[4].trim() : '';

    const { schema, table, fullName } = parseSchemaAndTable(rawTable);
    if (['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) continue;

    let normalizedJoinType: TableNodeData['joinType'] = 'INNER JOIN';
    if (rawJoinType.includes('LEFT')) normalizedJoinType = 'LEFT JOIN';
    else if (rawJoinType.includes('RIGHT')) normalizedJoinType = 'RIGHT JOIN';
    else if (rawJoinType.includes('FULL')) normalizedJoinType = 'FULL JOIN';
    else if (rawJoinType.includes('CROSS')) normalizedJoinType = 'CROSS JOIN';
    else normalizedJoinType = 'INNER JOIN';

    const nodeId = `TBL_${table.toUpperCase()}${alias ? '_' + alias : `_${nodes.length}`}`;

    let targetNode = nodes.find((n) => n.id === nodeId);
    if (!targetNode) {
      targetNode = {
        id: nodeId,
        tableName: table,
        schemaName: schema,
        fullTableName: fullName,
        alias,
        displayName: alias ? `${fullName} (${alias})` : fullName,
        joinType: normalizedJoinType,
        whereConditions: [],
        columns: [],
        isRoot: false,
        orderIndex: nodes.length,
      };
      nodes.push(targetNode);
      if (alias) tableAliasMap.set(alias.toUpperCase(), nodeId);
      tableNameMap.set(table.toUpperCase(), nodeId);
      tableNameMap.set(fullName.toUpperCase(), nodeId);
    }

    // Now analyze the ON condition to create an Edge
    if (rawOnCondition) {
      const restoredOnCondition = restoreStrings(rawOnCondition, strings).trim();

      // Find referenced source tables in the ON condition
      // Try to find which other table is being connected to
      let sourceNodeId: string | null = null;

      // Extract all identifiers/aliases in the ON condition (e.g. `v."SALES_DOCUMENT" = p."SALES_DOCUMENT"`)
      const idMatches = Array.from(rawOnCondition.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*[A-Za-z0-9_"]+/g));
      const referencedNodeIds = new Set<string>();

      for (const m of idMatches) {
        const refAlias = stripQuotes(m[1]).toUpperCase();
        if (tableAliasMap.has(refAlias)) {
          referencedNodeIds.add(tableAliasMap.get(refAlias)!);
        } else if (tableNameMap.has(refAlias)) {
          referencedNodeIds.add(tableNameMap.get(refAlias)!);
        }
      }

      // Remove the targetNode itself from referenced candidates
      referencedNodeIds.delete(nodeId);

      if (referencedNodeIds.size > 0) {
        // Take the first matching other node as source
        sourceNodeId = Array.from(referencedNodeIds)[0];
      } else {
        // Fallback: connect to the root node (first node) or previous node
        const prevNode = nodes.find((n) => n.id !== nodeId && (n.isRoot || n.orderIndex < targetNode!.orderIndex));
        sourceNodeId = prevNode ? prevNode.id : nodes[0]?.id || null;
      }

      if (sourceNodeId && sourceNodeId !== nodeId) {
        const sourceNode = nodes.find((n) => n.id === sourceNodeId);
        const edgeId = `EDGE_${sourceNodeId}_TO_${nodeId}_${edges.length}`;

        // Break down sub-conditions if connected by AND
        const subConditions = restoredOnCondition
          .split(/\s+AND\s+/i)
          .map((c) => c.trim())
          .filter(Boolean);

        edges.push({
          id: edgeId,
          sourceId: sourceNodeId,
          targetId: nodeId,
          sourceName: sourceNode?.fullTableName || sourceNodeId,
          targetName: targetNode.fullTableName,
          sourceAlias: sourceNode?.alias || '',
          targetAlias: targetNode.alias,
          joinType: normalizedJoinType,
          onCondition: restoredOnCondition,
          detailedConditions: subConditions.length > 0 ? subConditions : [restoredOnCondition],
        });
      }
    } else if (normalizedJoinType === 'CROSS JOIN') {
      // Cross join without explicit ON
      const prevNode = nodes.find((n) => n.id !== nodeId);
      if (prevNode) {
        edges.push({
          id: `EDGE_CROSS_${prevNode.id}_TO_${nodeId}`,
          sourceId: prevNode.id,
          targetId: nodeId,
          sourceName: prevNode.fullTableName,
          targetName: targetNode.fullTableName,
          sourceAlias: prevNode.alias,
          targetAlias: targetNode.alias,
          joinType: 'CROSS JOIN',
          onCondition: '(Cartesian Product / Cross Join)',
          detailedConditions: ['CROSS JOIN: No explicit ON condition'],
        });
      }
    }
  }

  // 5. Extract WHERE Clause and distribute table-specific predicates to nodes
  const whereMatch = cleanText.match(/\bWHERE\s+([\s\S]*?)(?=\b(?:GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|WINDOW)\b|$)/i);

  if (whereMatch) {
    const rawWhere = whereMatch[1].trim();
    const restoredWhere = restoreStrings(rawWhere, strings);

    // Split top-level conditions by AND (respecting parentheses)
    const predicates = splitTopLevelAnd(restoredWhere);

    for (const predicate of predicates) {
      const cleanPred = predicate.trim();
      if (!cleanPred) continue;

      // Find which table aliases or table names are in this predicate
      const referencedNodeIds = new Set<string>();

      // Check for alias.column pattern: `v."STATUS" = 'A'` or `v.ORDER_DATE >= ...`
      const aliasColMatches = Array.from(cleanPred.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*[A-Za-z0-9_"]+/g));
      for (const m of aliasColMatches) {
        const ref = stripQuotes(m[1]).toUpperCase();
        if (tableAliasMap.has(ref)) {
          referencedNodeIds.add(tableAliasMap.get(ref)!);
        } else if (tableNameMap.has(ref)) {
          referencedNodeIds.add(tableNameMap.get(ref)!);
        }
      }

      if (referencedNodeIds.size === 1) {
        // Condition belongs uniquely to one table node!
        const targetNodeId = Array.from(referencedNodeIds)[0];
        const targetNode = nodes.find((n) => n.id === targetNodeId);
        if (targetNode && !targetNode.whereConditions.includes(cleanPred)) {
          targetNode.whereConditions.push(cleanPred);
        }
      } else if (referencedNodeIds.size > 1) {
        // Multi-table comparison in WHERE (e.g. comma join condition `t1.id = t2.id`)
        const nodeArray = Array.from(referencedNodeIds);
        const node1 = nodes.find((n) => n.id === nodeArray[0]);
        const node2 = nodes.find((n) => n.id === nodeArray[1]);

        if (node1 && node2) {
          // Check if an edge already exists
          let existingEdge = edges.find(
            (e) => (e.sourceId === node1.id && e.targetId === node2.id) || (e.sourceId === node2.id && e.targetId === node1.id)
          );

          if (!existingEdge) {
            existingEdge = {
              id: `EDGE_IMPLICIT_${node1.id}_${node2.id}`,
              sourceId: node1.id,
              targetId: node2.id,
              sourceName: node1.fullTableName,
              targetName: node2.fullTableName,
              sourceAlias: node1.alias,
              targetAlias: node2.alias,
              joinType: 'WHERE JOIN (Implicit)',
              onCondition: cleanPred,
              detailedConditions: [cleanPred],
            };
            edges.push(existingEdge);
          } else {
            if (!existingEdge.detailedConditions.includes(cleanPred)) {
              existingEdge.detailedConditions.push(cleanPred);
              existingEdge.onCondition += ` AND ${cleanPred}`;
            }
          }
        }
        globalWhereConditions.push(cleanPred);
      } else {
        // Unqualified column or expression with 1 table in query -> assign to root/single table
        if (nodes.length === 1) {
          nodes[0].whereConditions.push(cleanPred);
        } else {
          globalWhereConditions.push(cleanPred);
        }
      }
    }
  }

  // 6. Extract Column References and attribute to nodes
  const colRefMatches = Array.from(cleanText.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*([A-Za-z0-9_"]+)/g));
  for (const m of colRefMatches) {
    const alias = stripQuotes(m[1]).toUpperCase();
    const col = stripQuotes(m[2]);

    let targetNodeId: string | undefined;
    if (tableAliasMap.has(alias)) targetNodeId = tableAliasMap.get(alias);
    else if (tableNameMap.has(alias)) targetNodeId = tableNameMap.get(alias);

    if (targetNodeId) {
      const node = nodes.find((n) => n.id === targetNodeId);
      if (node && !node.columns.includes(col)) {
        node.columns.push(col);
      }
    }
  }

  // Calculate layout positions (DAG topological left-to-right hierarchy)
  calculateNodeLayoutPositions(nodes, edges);

  return {
    nodes,
    edges,
    globalWhereConditions,
    statementType,
    cteCount,
    hasErrors: false,
    rawSql: sql,
  };
}

/**
 * Splits top-level WHERE predicates by AND, respecting nested parentheses
 */
function splitTopLevelAnd(whereSql: string): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < whereSql.length; i++) {
    const char = whereSql[i];

    if (!inQuotes && (char === "'" || char === '"')) {
      inQuotes = true;
      quoteChar = char;
      current += char;
      continue;
    }

    if (inQuotes) {
      current += char;
      if (char === quoteChar) {
        inQuotes = false;
      }
      continue;
    }

    if (char === '(') {
      parenDepth++;
      current += char;
      continue;
    }

    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    if (parenDepth === 0) {
      const remaining = whereSql.substring(i);
      const andMatch = remaining.match(/^(\s+AND\s+)/i);
      if (andMatch) {
        if (current.trim()) {
          result.push(current.trim());
        }
        current = '';
        i += andMatch[1].length - 1;
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

/**
 * Calculates responsive geometric coordinates for graph layout
 */
function calculateNodeLayoutPositions(nodes: TableNodeData[], edges: TableEdgeData[]) {
  if (nodes.length === 0) return;

  const nodeWidth = 320;
  const nodeHeight = 220;
  const horizontalGap = 160;
  const verticalGap = 40;

  // Build in-degree map for topological layering
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  nodes.forEach((n) => {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  });

  edges.forEach((e) => {
    inDegree.set(e.targetId, (inDegree.get(e.targetId) || 0) + 1);
    adj.get(e.sourceId)?.push(e.targetId);
  });

  // Assign layers (ranks)
  const layers: Map<string, number> = new Map();
  const queue: string[] = [];

  nodes.forEach((n) => {
    if ((inDegree.get(n.id) || 0) === 0 || n.isRoot) {
      layers.set(n.id, 0);
      queue.push(n.id);
    }
  });

  if (queue.length === 0 && nodes.length > 0) {
    layers.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentLayer = layers.get(currentId) || 0;

    const neighbors = adj.get(currentId) || [];
    for (const neighborId of neighbors) {
      const neighborLayer = layers.get(neighborId);
      if (neighborLayer === undefined || neighborLayer < currentLayer + 1) {
        layers.set(neighborId, currentLayer + 1);
        queue.push(neighborId);
      }
    }
  }

  // Group nodes by layer
  const layerGroups = new Map<number, TableNodeData[]>();
  nodes.forEach((n) => {
    const layer = layers.get(n.id) ?? n.orderIndex;
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, []);
    }
    layerGroups.get(layer)!.push(n);
  });

  // Calculate X, Y positions for each node
  const startX = 80;
  const startY = 80;

  const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);
  sortedLayers.forEach((layerIdx) => {
    const group = layerGroups.get(layerIdx)!;
    const x = startX + layerIdx * (nodeWidth + horizontalGap);

    const totalHeight = group.length * nodeHeight + (group.length - 1) * verticalGap;
    const layerStartY = Math.max(startY, startY + (300 - totalHeight) / 2);

    group.forEach((node, idx) => {
      const y = layerStartY + idx * (nodeHeight + verticalGap);
      node.x = x;
      node.y = y;
    });
  });
}
