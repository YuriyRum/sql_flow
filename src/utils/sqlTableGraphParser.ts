/**
 * SQL Table Dependency & Condition Parser for SAP HANA
 * Extracts all table occurrences (including across multiple UNION / UNION ALL / INTERSECT / EXCEPT branches),
 * aliases, join relationships, ON conditions on edges, and specific WHERE conditions per table occurrence.
 */

export interface TableNodeData {
  id: string; // unique identifier e.g. "TBL_B1_1_VBAK_v"
  tableName: string; // "VBAK"
  schemaName?: string; // "SAP_S4HANA"
  fullTableName: string; // '"SAP_S4HANA"."VBAK"' or 'VBAK'
  alias: string; // "v" or ""
  displayName: string; // '"SAP_S4HANA"."VBAK" (v)' or 'VBAK (Branch 1)'
  joinType: 'FROM' | 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN' | 'CROSS JOIN' | 'CTE' | 'TARGET' | 'UNION' | 'UNION ALL' | 'EXCEPT' | 'INTERSECT';
  whereConditions: string[]; // WHERE conditions specific to this table occurrence
  columns: string[]; // Referenced columns from this table
  isRoot: boolean;
  orderIndex: number;
  branchIndex?: number;
  branchName?: string; // e.g. "Branch 1", "Branch 2 (UNION ALL)"
  isOperator?: boolean; // true if this is a UNION / UNION ALL combiner node
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
  joinType: string; // 'INNER JOIN', 'LEFT JOIN', 'UNION ALL', etc.
  onCondition: string; // e.g. 'v."SALES_DOCUMENT" = p."SALES_DOCUMENT"'
  detailedConditions: string[];
  isUnionEdge?: boolean;
}

export interface ParsedTableGraph {
  nodes: TableNodeData[];
  edges: TableEdgeData[];
  globalWhereConditions: string[]; // WHERE conditions not tied to a single table
  statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'UNKNOWN';
  cteCount: number;
  branchCount: number;
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
 * Clean identifier: removes quotes, brackets, backticks
 */
function stripQuotes(id: string): string {
  if (!id) return '';
  return id.replace(/^["'`\[\]]+|["'`\[\]]+$/g, '').trim();
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
  const table = stripQuotes(clean);
  return { schema: undefined, table, fullName: clean };
}

interface ExtractedSubquery {
  sql: string;
  fullMatch: string;
  subqueryType: 'FROM' | 'JOIN' | 'WHERE_IN' | 'WHERE_EXISTS' | 'CTE' | 'SCALAR';
  alias?: string;
  joinType?: string;
  onCondition?: string;
  wherePredicate?: string;
  outerPos: number;
}

/**
 * Finds subqueries enclosed in parentheses (SELECT or WITH)
 */
function findSubqueriesInSql(cleanText: string): ExtractedSubquery[] {
  const subqueries: ExtractedSubquery[] = [];
  const len = cleanText.length;

  for (let i = 0; i < len; i++) {
    if (cleanText[i] === '(') {
      const afterParen = cleanText.substring(i + 1).trimStart();
      if (/^(?:SELECT|WITH)\b/i.test(afterParen)) {
        let depth = 1;
        let j = i + 1;
        let inQuotes = false;
        let quoteChar = '';

        while (j < len && depth > 0) {
          const char = cleanText[j];
          if (!inQuotes && (char === "'" || char === '"')) {
            inQuotes = true;
            quoteChar = char;
          } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
          } else if (!inQuotes) {
            if (char === '(') depth++;
            else if (char === ')') depth--;
          }
          j++;
        }

        if (depth === 0) {
          const innerSql = cleanText.substring(i + 1, j - 1).trim();
          const fullMatch = cleanText.substring(i, j);

          const prefix = cleanText.substring(Math.max(0, i - 120), i).trim();
          const suffix = cleanText.substring(j, Math.min(len, j + 150)).trim();

          let subqueryType: ExtractedSubquery['subqueryType'] = 'SCALAR';
          let alias = '';
          let joinType = '';
          let onCondition = '';
          let wherePredicate = '';

          if (/\bFROM\s*$/i.test(prefix)) {
            subqueryType = 'FROM';
            const aliasMatch = suffix.match(/^(?:AS\s+)?([A-Za-z0-9_"`\[\]-]+)/i);
            if (aliasMatch && !['WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'CROSS', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT'].includes(aliasMatch[1].toUpperCase())) {
              alias = stripQuotes(aliasMatch[1]);
            }
          } else if (/\b(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|JOIN)\s*$/i.test(prefix)) {
            subqueryType = 'JOIN';
            const joinMatch = prefix.match(/\b(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|JOIN)\s*$/i);
            if (joinMatch) {
              joinType = joinMatch[1].toUpperCase().replace(/\s+/g, ' ');
            }
            const aliasOnMatch = suffix.match(/^(?:AS\s+)?([A-Za-z0-9_"`\[\]-]+)?(?:\s+ON\s+([\s\S]*?)(?=\b(?:INNER|LEFT|RIGHT|FULL|CROSS|JOIN|WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT)\b|$))?/i);
            if (aliasOnMatch) {
              if (aliasOnMatch[1] && !['ON', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'CROSS', 'GROUP', 'ORDER', 'LIMIT'].includes(aliasOnMatch[1].toUpperCase())) {
                alias = stripQuotes(aliasOnMatch[1]);
              }
              if (aliasOnMatch[2]) {
                onCondition = aliasOnMatch[2].trim();
              }
            }
          } else if (/\b(?:IN|NOT\s+IN)\s*$/i.test(prefix)) {
            subqueryType = 'WHERE_IN';
            const predMatch = prefix.match(/([A-Za-z0-9_".`\/\[\]-]+\s+(?:NOT\s+)?IN)\s*$/i);
            if (predMatch) {
              wherePredicate = `${predMatch[1]} (Subquery)`;
            }
          } else if (/\b(?:EXISTS|NOT\s+EXISTS)\s*$/i.test(prefix)) {
            subqueryType = 'WHERE_EXISTS';
            wherePredicate = prefix.match(/NOT\s+EXISTS/i) ? 'NOT EXISTS (Subquery)' : 'EXISTS (Subquery)';
          } else if (/\bAS\s*$/i.test(prefix)) {
            const cteMatch = prefix.match(/\bWITH\s+([A-Za-z0-9_"`\[\]-]+)\s+AS\s*$/i) || prefix.match(/,\s*([A-Za-z0-9_"`\[\]-]+)\s+AS\s*$/i);
            if (cteMatch) {
              subqueryType = 'CTE';
              alias = stripQuotes(cteMatch[1]);
            }
          }

          subqueries.push({
            sql: innerSql,
            fullMatch,
            subqueryType,
            alias,
            joinType,
            onCondition,
            wherePredicate,
            outerPos: i,
          });
        }
      }
    }
  }

  return subqueries;
}

/**
 * Recursively parses subqueries embedded within SQL text (FROM subquery, JOIN subquery, WHERE IN/EXISTS subquery, CTEs).
 * Extracts all nested table references, creates graph nodes for them, and constructs join/filter edges.
 */
function processSubqueriesInText(
  sqlText: string,
  branch: QueryBranch,
  branchNodes: TableNodeData[],
  branchTableAliasMap: Map<string, string>,
  branchTableNameMap: Map<string, string>,
  nodes: TableNodeData[],
  edges: TableEdgeData[],
  strings: string[],
  isMultiBranch: boolean,
  depth: number = 0
) {
  if (depth > 10) return;

  const subqueries = findSubqueriesInSql(sqlText);

  for (let sqIdx = 0; sqIdx < subqueries.length; sqIdx++) {
    const sq = subqueries[sqIdx];
    const innerSql = sq.sql;

    let sqLabel = 'Subquery';
    if (sq.subqueryType === 'FROM') {
      sqLabel = sq.alias ? `Subquery in FROM (${sq.alias})` : 'Subquery in FROM';
    } else if (sq.subqueryType === 'JOIN') {
      sqLabel = sq.alias ? `Subquery in JOIN (${sq.alias})` : 'Subquery in JOIN';
    } else if (sq.subqueryType === 'WHERE_IN') {
      sqLabel = 'Subquery in WHERE (IN)';
    } else if (sq.subqueryType === 'WHERE_EXISTS') {
      sqLabel = 'Subquery in WHERE (EXISTS)';
    } else if (sq.subqueryType === 'CTE') {
      sqLabel = `Subquery in CTE (${sq.alias})`;
    }

    const extractedSubqueryTables: TableNodeData[] = [];

    // 1. Extract FROM tables inside subquery
    const fromMatch = innerSql.match(/\bFROM\s+([A-Za-z0-9_".`\/\[\]-]+(?:\s+(?:AS\s+)?[A-Za-z0-9_"`\[\]-]+)?(?:\s*,\s*[A-Za-z0-9_".`\/\[\]-]+(?:\s+(?:AS\s+)?[A-Za-z0-9_"`\[\]-]+)?)*)/i);
    if (fromMatch) {
      const fromSection = fromMatch[1];
      const commaTables = fromSection.split(/\s*,\s*/);

      commaTables.forEach((entry, idx) => {
        const trimmedEntry = entry.trim();
        if (!trimmedEntry) return;

        const parts = trimmedEntry.split(/\s+(?:AS\s+)?/i);
        const rawTable = parts[0];
        const tableAlias = parts.length > 1 ? stripQuotes(parts[1]) : sq.alias || '';
        const { schema, table, fullName } = parseSchemaAndTable(rawTable);

        if (['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) return;

        const occurrenceNumber = nodes.length + 1;
        const nodeId = `TBL_B${branch.branchIndex}_SQ${sqIdx}_F${idx}_${table.toUpperCase()}${tableAlias ? '_' + tableAlias : ''}_${occurrenceNumber}`;

        const branchPrefix = isMultiBranch ? `[Branch ${branch.branchIndex}] ` : '';
        const displayName = tableAlias
          ? `${branchPrefix}[Subquery] ${fullName} (${tableAlias})`
          : `${branchPrefix}[Subquery] ${fullName}`;

        const node: TableNodeData = {
          id: nodeId,
          tableName: table,
          schemaName: schema,
          fullTableName: fullName,
          alias: tableAlias,
          displayName,
          joinType: sq.subqueryType === 'JOIN' ? (sq.joinType as any) || 'INNER JOIN' : 'FROM',
          whereConditions: [],
          columns: [],
          isRoot: false,
          orderIndex: nodes.length,
          branchIndex: branch.branchIndex,
          branchName: sqLabel,
        };

        nodes.push(node);
        branchNodes.push(node);
        extractedSubqueryTables.push(node);

        if (tableAlias) branchTableAliasMap.set(tableAlias.toUpperCase(), nodeId);
        if (sq.alias) branchTableAliasMap.set(sq.alias.toUpperCase(), nodeId);
        branchTableNameMap.set(table.toUpperCase(), nodeId);
        branchTableNameMap.set(fullName.toUpperCase(), nodeId);
      });
    }

    // 2. Extract JOIN tables inside subquery
    const joinRegex = /\b(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|JOIN)\s+([A-Za-z0-9_".`\/\[\]-]+)(?:\s+(?:AS\s+)?([A-Za-z0-9_"`\[\]-]+))?(?:\s+ON\s+([\s\S]*?)(?=\b(?:INNER|LEFT|RIGHT|FULL|CROSS|JOIN|WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT)\b|$))?/gi;
    let joinMatch: RegExpExecArray | null;
    let joinIdx = 0;
    while ((joinMatch = joinRegex.exec(innerSql)) !== null) {
      joinIdx++;
      const rawJoinType = joinMatch[1].toUpperCase().replace(/\s+/g, ' ');
      const rawTable = joinMatch[2];
      const tableAlias = joinMatch[3] ? stripQuotes(joinMatch[3]) : '';
      const rawOnCondition = joinMatch[4] ? joinMatch[4].trim() : '';

      const { schema, table, fullName } = parseSchemaAndTable(rawTable);
      if (['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) continue;

      let normalizedJoinType: TableNodeData['joinType'] = 'INNER JOIN';
      if (rawJoinType.includes('LEFT')) normalizedJoinType = 'LEFT JOIN';
      else if (rawJoinType.includes('RIGHT')) normalizedJoinType = 'RIGHT JOIN';
      else if (rawJoinType.includes('FULL')) normalizedJoinType = 'FULL JOIN';
      else if (rawJoinType.includes('CROSS')) normalizedJoinType = 'CROSS JOIN';
      else normalizedJoinType = 'INNER JOIN';

      const occurrenceNumber = nodes.length + 1;
      const nodeId = `TBL_B${branch.branchIndex}_SQ${sqIdx}_J${joinIdx}_${table.toUpperCase()}${tableAlias ? '_' + tableAlias : ''}_${occurrenceNumber}`;

      const branchPrefix = isMultiBranch ? `[Branch ${branch.branchIndex}] ` : '';
      const displayName = tableAlias
        ? `${branchPrefix}[Subquery] ${fullName} (${tableAlias})`
        : `${branchPrefix}[Subquery] ${fullName}`;

      const targetNode: TableNodeData = {
        id: nodeId,
        tableName: table,
        schemaName: schema,
        fullTableName: fullName,
        alias: tableAlias,
        displayName,
        joinType: normalizedJoinType,
        whereConditions: [],
        columns: [],
        isRoot: false,
        orderIndex: nodes.length,
        branchIndex: branch.branchIndex,
        branchName: sqLabel,
      };

      nodes.push(targetNode);
      branchNodes.push(targetNode);
      extractedSubqueryTables.push(targetNode);

      if (tableAlias) branchTableAliasMap.set(tableAlias.toUpperCase(), nodeId);
      branchTableNameMap.set(table.toUpperCase(), nodeId);
      branchTableNameMap.set(fullName.toUpperCase(), nodeId);

      const prevSubNode = extractedSubqueryTables[0];
      if (prevSubNode && prevSubNode.id !== targetNode.id) {
        const restoredOn = rawOnCondition ? restoreStrings(rawOnCondition, strings) : '';
        edges.push({
          id: `EDGE_SQ_${prevSubNode.id}_TO_${targetNode.id}_${edges.length}`,
          sourceId: prevSubNode.id,
          targetId: targetNode.id,
          sourceName: prevSubNode.displayName,
          targetName: targetNode.displayName,
          sourceAlias: prevSubNode.alias,
          targetAlias: targetNode.alias,
          joinType: normalizedJoinType,
          onCondition: restoredOn || 'Subquery Join',
          detailedConditions: restoredOn ? restoredOn.split(/\s+AND\s+/i) : ['Subquery Join'],
        });
      }
    }

    // 3. Extract WHERE conditions inside innerSql for subquery tables
    const innerWhereMatch = innerSql.match(/\bWHERE\s+([\s\S]*?)(?=\b(?:GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|WINDOW)\b|$)/i);
    if (innerWhereMatch) {
      const rawInnerWhere = innerWhereMatch[1].trim();
      const restoredInnerWhere = restoreStrings(rawInnerWhere, strings);
      const innerPredicates = splitTopLevelAnd(restoredInnerWhere);

      for (const pred of innerPredicates) {
        const cleanP = pred.trim();
        if (!cleanP) continue;
        extractedSubqueryTables.forEach((st) => {
          if (!st.whereConditions.includes(cleanP)) {
            st.whereConditions.push(cleanP);
          }
        });
      }
    }

    // 4. Create Edges connecting subquery tables to outer query tables
    if (extractedSubqueryTables.length > 0) {
      const subNode = extractedSubqueryTables[0];
      const primaryOuterTable = branchNodes.find((n) => !extractedSubqueryTables.some((st) => st.id === n.id));

      if (primaryOuterTable) {
        if (sq.subqueryType === 'JOIN' && sq.onCondition) {
          const restoredOn = restoreStrings(sq.onCondition, strings);
          edges.push({
            id: `EDGE_SQ_JOIN_${primaryOuterTable.id}_TO_${subNode.id}_${edges.length}`,
            sourceId: primaryOuterTable.id,
            targetId: subNode.id,
            sourceName: primaryOuterTable.displayName,
            targetName: subNode.displayName,
            sourceAlias: primaryOuterTable.alias,
            targetAlias: subNode.alias,
            joinType: sq.joinType || 'JOIN (Subquery)',
            onCondition: restoredOn,
            detailedConditions: restoredOn.split(/\s+AND\s+/i),
          });
        } else if (sq.subqueryType === 'WHERE_IN' || sq.subqueryType === 'WHERE_EXISTS') {
          const condText = sq.wherePredicate || (sq.subqueryType === 'WHERE_IN' ? 'IN (Subquery)' : 'EXISTS (Subquery)');
          edges.push({
            id: `EDGE_SQ_FILTER_${primaryOuterTable.id}_TO_${subNode.id}_${edges.length}`,
            sourceId: primaryOuterTable.id,
            targetId: subNode.id,
            sourceName: primaryOuterTable.displayName,
            targetName: subNode.displayName,
            sourceAlias: primaryOuterTable.alias,
            targetAlias: subNode.alias,
            joinType: sq.subqueryType === 'WHERE_IN' ? 'WHERE IN' : 'WHERE EXISTS',
            onCondition: condText,
            detailedConditions: [condText],
          });
        }
      }
    }

    // 5. Recursively process nested subqueries inside this subquery
    processSubqueriesInText(
      innerSql,
      branch,
      branchNodes,
      branchTableAliasMap,
      branchTableNameMap,
      nodes,
      edges,
      strings,
      isMultiBranch,
      depth + 1
    );
  }
}

interface QueryBranch {
  branchIndex: number;
  branchType: 'SELECT' | 'UNION' | 'UNION ALL' | 'EXCEPT' | 'EXCEPT ALL' | 'INTERSECT' | 'INTERSECT ALL' | 'MINUS' | 'CTE';
  branchLabel: string;
  sql: string;
}

/**
 * Splits SQL into top-level branches (CTEs and UNION/EXCEPT/INTERSECT branches)
 * while respecting parentheses.
 */
function splitIntoBranches(cleanText: string): QueryBranch[] {
  const branches: QueryBranch[] = [];

  // Remove WITH clause from main body first if present
  let mainBody = cleanText;
  const withMatch = mainBody.match(/^\s*WITH\s+([\s\S]*?)\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)/i);
  if (withMatch) {
    const withLength = withMatch[0].length - withMatch[2].length;
    mainBody = mainBody.substring(withLength);
  }

  // Scan top-level set operators
  let currentStart = 0;
  let parenDepth = 0;
  let currentBranchType: QueryBranch['branchType'] = 'SELECT';
  let branchCount = 1;

  for (let i = 0; i < mainBody.length; i++) {
    const char = mainBody[i];
    if (char === '(') {
      parenDepth++;
      continue;
    }
    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (parenDepth === 0) {
      const remaining = mainBody.substring(i);
      const opMatch = remaining.match(/^(\b(?:UNION\s+ALL|UNION(?:\s+DISTINCT)?|EXCEPT\s+ALL|EXCEPT|INTERSECT\s+ALL|INTERSECT|MINUS)\b)/i);
      if (opMatch) {
        const opStr = opMatch[1].toUpperCase().replace(/\s+/g, ' ');
        const branchSql = mainBody.substring(currentStart, i).trim();
        if (branchSql) {
          branches.push({
            branchIndex: branchCount,
            branchType: currentBranchType,
            branchLabel: branchCount === 1 ? 'Branch 1 (Initial SELECT)' : `Branch ${branchCount} (${currentBranchType})`,
            sql: branchSql,
          });
          branchCount++;
        }

        if (opStr.includes('UNION ALL')) currentBranchType = 'UNION ALL';
        else if (opStr.includes('UNION')) currentBranchType = 'UNION';
        else if (opStr.includes('EXCEPT ALL')) currentBranchType = 'EXCEPT ALL';
        else if (opStr.includes('EXCEPT') || opStr.includes('MINUS')) currentBranchType = 'EXCEPT';
        else if (opStr.includes('INTERSECT ALL')) currentBranchType = 'INTERSECT ALL';
        else if (opStr.includes('INTERSECT')) currentBranchType = 'INTERSECT';
        else currentBranchType = 'UNION';

        i += opMatch[1].length - 1;
        currentStart = i + 1;
      }
    }
  }

  const lastBranchSql = mainBody.substring(currentStart).trim();
  if (lastBranchSql) {
    branches.push({
      branchIndex: branchCount,
      branchType: currentBranchType,
      branchLabel: branchCount === 1 ? 'Branch 1 (Initial SELECT)' : `Branch ${branchCount} (${currentBranchType})`,
      sql: lastBranchSql,
    });
  }

  return branches;
}

/**
 * Main parser function to extract table graph, ON conditions on edges,
 * and WHERE conditions per node, showing all occurrences across all UNION branches.
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
      branchCount: 0,
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

  // 1. Extract CTEs if present: WITH cte_name AS (SELECT ...)
  let cteCount = 0;
  const cteRegex = /\bWITH\s+([A-Za-z0-9_"]+)\s+AS\s*\(/gi;
  let cteMatch: RegExpExecArray | null;
  while ((cteMatch = cteRegex.exec(cleanText)) !== null) {
    cteCount++;
    const cteName = stripQuotes(cteMatch[1]);
    const nodeId = `CTE_${cteName.toUpperCase()}_${cteCount}`;
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
      branchName: 'CTE Definition',
    };
    nodes.push(cteNode);
  }

  // 2. Extract TARGET Table for INSERT / UPDATE / MERGE / DELETE
  if (statementType === 'INSERT' || statementType === 'UPDATE' || statementType === 'MERGE') {
    const targetMatch = cleanText.match(/\b(?:INTO|UPDATE|MERGE\s+INTO)\s+([A-Za-z0-9_".`\/\[\]-]+)(?:\s+(?:AS\s+)?([A-Za-z0-9_"`\[\]-]+))?/i);
    if (targetMatch) {
      const rawTarget = targetMatch[1];
      const targetAlias = targetMatch[2] ? stripQuotes(targetMatch[2]) : '';
      const { schema, table, fullName } = parseSchemaAndTable(rawTarget);
      const nodeId = `TARGET_${table.toUpperCase()}${targetAlias ? '_' + targetAlias : ''}_${nodes.length}`;

      const targetNode: TableNodeData = {
        id: nodeId,
        tableName: table,
        schemaName: schema,
        fullTableName: fullName,
        alias: targetAlias,
        displayName: targetAlias ? `${fullName} (${targetAlias}) [TARGET]` : `${fullName} [TARGET]`,
        joinType: 'TARGET',
        whereConditions: [],
        columns: [],
        isRoot: true,
        orderIndex: nodes.length,
        branchName: 'Target Table',
      };

      nodes.push(targetNode);
    }
  }

  // 3. Decompose into Query Branches (e.g. UNION ALL, UNION, INTERSECT, etc.)
  const branches = splitIntoBranches(cleanText);
  const isMultiBranch = branches.length > 1;

  // Track branch root nodes to connect to UNION operator if multi-branch
  const branchRootNodes: TableNodeData[] = [];

  branches.forEach((branch) => {
    const branchText = branch.sql;
    const branchTableAliasMap = new Map<string, string>(); // alias.toUpperCase() -> nodeId
    const branchTableNameMap = new Map<string, string>(); // tableName.toUpperCase() -> nodeId
    const branchNodes: TableNodeData[] = [];

    // 3a. Extract FROM clause base tables for this branch
    // Matches: FROM table1 [AS t1], table2 [AS t2]
    const fromMatch = branchText.match(/\bFROM\s+([A-Za-z0-9_".`\/\[\]-]+(?:\s+(?:AS\s+)?[A-Za-z0-9_"`\[\]-]+)?(?:\s*,\s*[A-Za-z0-9_".`\/\[\]-]+(?:\s+(?:AS\s+)?[A-Za-z0-9_"`\[\]-]+)?)*)/i);

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

        const occurrenceNumber = nodes.length + 1;
        const nodeId = `TBL_B${branch.branchIndex}_${idx + 1}_${table.toUpperCase()}${alias ? '_' + alias : ''}_${occurrenceNumber}`;

        const branchPrefix = isMultiBranch ? `[Branch ${branch.branchIndex}] ` : '';
        const displayName = alias ? `${branchPrefix}${fullName} (${alias})` : `${branchPrefix}${fullName}`;

        const node: TableNodeData = {
          id: nodeId,
          tableName: table,
          schemaName: schema,
          fullTableName: fullName,
          alias,
          displayName,
          joinType: idx === 0 ? 'FROM' : 'CROSS JOIN',
          whereConditions: [],
          columns: [],
          isRoot: idx === 0,
          orderIndex: nodes.length,
          branchIndex: branch.branchIndex,
          branchName: branch.branchLabel,
        };

        nodes.push(node);
        branchNodes.push(node);
        if (idx === 0) {
          branchRootNodes.push(node);
        }

        if (alias) branchTableAliasMap.set(alias.toUpperCase(), nodeId);
        branchTableNameMap.set(table.toUpperCase(), nodeId);
        branchTableNameMap.set(fullName.toUpperCase(), nodeId);
      });
    }

    // 3b. Extract JOIN clauses in this branch (INNER, LEFT, RIGHT, FULL, CROSS)
    const joinRegex = /\b(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|JOIN)\s+([A-Za-z0-9_".`\/\[\]-]+)(?:\s+(?:AS\s+)?([A-Za-z0-9_"`\[\]-]+))?(?:\s+ON\s+([\s\S]*?)(?=\b(?:INNER|LEFT|RIGHT|FULL|CROSS|JOIN|WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT)\b|$))?/gi;

    let joinMatch: RegExpExecArray | null;
    let joinIndex = 0;
    while ((joinMatch = joinRegex.exec(branchText)) !== null) {
      joinIndex++;
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

      const occurrenceNumber = nodes.length + 1;
      const nodeId = `TBL_B${branch.branchIndex}_J${joinIndex}_${table.toUpperCase()}${alias ? '_' + alias : ''}_${occurrenceNumber}`;

      const branchPrefix = isMultiBranch ? `[Branch ${branch.branchIndex}] ` : '';
      const displayName = alias ? `${branchPrefix}${fullName} (${alias})` : `${branchPrefix}${fullName}`;

      const targetNode: TableNodeData = {
        id: nodeId,
        tableName: table,
        schemaName: schema,
        fullTableName: fullName,
        alias,
        displayName,
        joinType: normalizedJoinType,
        whereConditions: [],
        columns: [],
        isRoot: false,
        orderIndex: nodes.length,
        branchIndex: branch.branchIndex,
        branchName: branch.branchLabel,
      };

      nodes.push(targetNode);
      branchNodes.push(targetNode);

      if (alias) branchTableAliasMap.set(alias.toUpperCase(), nodeId);
      branchTableNameMap.set(table.toUpperCase(), nodeId);
      branchTableNameMap.set(fullName.toUpperCase(), nodeId);

      // Analyze ON Condition
      if (rawOnCondition) {
        const restoredOnCondition = restoreStrings(rawOnCondition, strings).trim();

        // Extract aliases or table names in the ON condition
        const idMatches = Array.from(rawOnCondition.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*[A-Za-z0-9_"]+/g));
        const referencedNodeIds = new Set<string>();

        for (const m of idMatches) {
          const refAlias = stripQuotes(m[1]).toUpperCase();
          if (branchTableAliasMap.has(refAlias)) {
            referencedNodeIds.add(branchTableAliasMap.get(refAlias)!);
          } else if (branchTableNameMap.has(refAlias)) {
            referencedNodeIds.add(branchTableNameMap.get(refAlias)!);
          }
        }

        referencedNodeIds.delete(nodeId);

        let sourceNodeId: string | null = null;
        if (referencedNodeIds.size > 0) {
          sourceNodeId = Array.from(referencedNodeIds)[0];
        } else {
          // Default to the first table of this branch
          sourceNodeId = branchNodes[0]?.id || null;
        }

        if (sourceNodeId && sourceNodeId !== nodeId) {
          const sourceNode = nodes.find((n) => n.id === sourceNodeId);
          const edgeId = `EDGE_${sourceNodeId}_TO_${nodeId}_${edges.length}`;

          const subConditions = restoredOnCondition
            .split(/\s+AND\s+/i)
            .map((c) => c.trim())
            .filter(Boolean);

          edges.push({
            id: edgeId,
            sourceId: sourceNodeId,
            targetId: nodeId,
            sourceName: sourceNode?.displayName || sourceNodeId,
            targetName: targetNode.displayName,
            sourceAlias: sourceNode?.alias || '',
            targetAlias: targetNode.alias,
            joinType: normalizedJoinType,
            onCondition: restoredOnCondition,
            detailedConditions: subConditions.length > 0 ? subConditions : [restoredOnCondition],
          });
        }
      } else if (normalizedJoinType === 'CROSS JOIN') {
        const prevNode = branchNodes[0];
        if (prevNode && prevNode.id !== nodeId) {
          edges.push({
            id: `EDGE_CROSS_${prevNode.id}_TO_${nodeId}`,
            sourceId: prevNode.id,
            targetId: nodeId,
            sourceName: prevNode.displayName,
            targetName: targetNode.displayName,
            sourceAlias: prevNode.alias,
            targetAlias: targetNode.alias,
            joinType: 'CROSS JOIN',
            onCondition: '(Cartesian Product / Cross Join)',
            detailedConditions: ['CROSS JOIN: No explicit ON condition'],
          });
        }
      }
    }

    // 3c. Extract WHERE Clause for this specific branch
    const whereMatch = branchText.match(/\bWHERE\s+([\s\S]*?)(?=\b(?:GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|WINDOW)\b|$)/i);

    if (whereMatch) {
      const rawWhere = whereMatch[1].trim();
      const restoredWhere = restoreStrings(rawWhere, strings);
      const predicates = splitTopLevelAnd(restoredWhere);

      for (const predicate of predicates) {
        const cleanPred = predicate.trim();
        if (!cleanPred) continue;

        const referencedNodeIds = new Set<string>();

        // Check alias.col or table.col in this branch
        const aliasColMatches = Array.from(cleanPred.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*[A-Za-z0-9_"]+/g));
        for (const m of aliasColMatches) {
          const ref = stripQuotes(m[1]).toUpperCase();
          if (branchTableAliasMap.has(ref)) {
            referencedNodeIds.add(branchTableAliasMap.get(ref)!);
          } else if (branchTableNameMap.has(ref)) {
            referencedNodeIds.add(branchTableNameMap.get(ref)!);
          }
        }

        if (referencedNodeIds.size === 1) {
          const targetNodeId = Array.from(referencedNodeIds)[0];
          const targetNode = branchNodes.find((n) => n.id === targetNodeId);
          if (targetNode && !targetNode.whereConditions.includes(cleanPred)) {
            targetNode.whereConditions.push(cleanPred);
          }
        } else if (referencedNodeIds.size > 1) {
          // Multi-table comparison in WHERE (implicit join in this branch)
          const nodeArray = Array.from(referencedNodeIds);
          const node1 = branchNodes.find((n) => n.id === nodeArray[0]);
          const node2 = branchNodes.find((n) => n.id === nodeArray[1]);

          if (node1 && node2) {
            let existingEdge = edges.find(
              (e) => (e.sourceId === node1.id && e.targetId === node2.id) || (e.sourceId === node2.id && e.targetId === node1.id)
            );

            if (!existingEdge) {
              existingEdge = {
                id: `EDGE_IMPLICIT_${node1.id}_${node2.id}`,
                sourceId: node1.id,
                targetId: node2.id,
                sourceName: node1.displayName,
                targetName: node2.displayName,
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
          globalWhereConditions.push(isMultiBranch ? `[Branch ${branch.branchIndex}] ${cleanPred}` : cleanPred);
        } else {
          // Unqualified predicate -> if branch has 1 table, attribute to it
          if (branchNodes.length === 1) {
            branchNodes[0].whereConditions.push(cleanPred);
          } else {
            globalWhereConditions.push(isMultiBranch ? `[Branch ${branch.branchIndex}] ${cleanPred}` : cleanPred);
          }
        }
      }
    }

    // 3d. Attribute column references in this branch
    const colRefMatches = Array.from(branchText.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*([A-Za-z0-9_"]+)/g));
    for (const m of colRefMatches) {
      const alias = stripQuotes(m[1]).toUpperCase();
      const col = stripQuotes(m[2]);

      let targetNodeId: string | undefined;
      if (branchTableAliasMap.has(alias)) targetNodeId = branchTableAliasMap.get(alias);
      else if (branchTableNameMap.has(alias)) targetNodeId = branchTableNameMap.get(alias);

      if (targetNodeId) {
        const node = branchNodes.find((n) => n.id === targetNodeId);
        if (node && !node.columns.includes(col)) {
          node.columns.push(col);
        }
      }
    }

    // 3e. Extract tables from subqueries in FROM, JOIN, and WHERE (IN / EXISTS) clauses
    processSubqueriesInText(
      branchText,
      branch,
      branchNodes,
      branchTableAliasMap,
      branchTableNameMap,
      nodes,
      edges,
      strings,
      isMultiBranch
    );
  });

  // 4. If multi-branch (UNION / UNION ALL / INTERSECT / EXCEPT), create a UNION combiner node
  if (isMultiBranch) {
    const unionType = branches[1]?.branchType || 'UNION ALL';
    const unionNodeId = `OP_UNION_RESULT_${nodes.length}`;
    const unionNode: TableNodeData = {
      id: unionNodeId,
      tableName: unionType,
      fullTableName: `${unionType} Output`,
      alias: '',
      displayName: `${unionType} (${branches.length} Branches)`,
      joinType: unionType.includes('UNION ALL') ? 'UNION ALL' : 'UNION',
      whereConditions: [],
      columns: [],
      isRoot: false,
      orderIndex: nodes.length,
      branchName: 'Set Operation Combiner',
      isOperator: true,
    };

    nodes.push(unionNode);

    // Connect the last table of each branch to the UNION node
    branches.forEach((branch) => {
      const branchNodesList = nodes.filter((n) => n.branchIndex === branch.branchIndex && !n.isOperator);
      const lastBranchNode = branchNodesList[branchNodesList.length - 1];

      if (lastBranchNode) {
        edges.push({
          id: `EDGE_UNION_B${branch.branchIndex}_TO_COMBINER`,
          sourceId: lastBranchNode.id,
          targetId: unionNode.id,
          sourceName: lastBranchNode.displayName,
          targetName: unionNode.displayName,
          sourceAlias: lastBranchNode.alias,
          targetAlias: '',
          joinType: branch.branchIndex === 1 ? 'INPUT (Initial)' : `INPUT (${branch.branchType})`,
          onCondition: `Feeds into ${unionType} output`,
          detailedConditions: [`Branch ${branch.branchIndex} dataset concatenated into ${unionType}`],
          isUnionEdge: true,
        });
      }
    });
  }

  // Calculate layout coordinates with clean spacing for parallel branches
  calculateNodeLayoutPositions(nodes, edges, isMultiBranch);

  return {
    nodes,
    edges,
    globalWhereConditions,
    statementType,
    cteCount,
    branchCount: branches.length,
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
 * Organizes multiple branches into dedicated parallel rows for crystal clear hierarchy.
 */
function calculateNodeLayoutPositions(nodes: TableNodeData[], edges: TableEdgeData[], isMultiBranch: boolean) {
  if (nodes.length === 0) return;

  const nodeWidth = 330;
  const nodeHeight = 230;
  const horizontalGap = 160;
  const branchRowGap = 60;

  if (isMultiBranch) {
    // Multi-branch layout: Each branch occupies its own horizontal lane (row band)
    const branchMap = new Map<number, TableNodeData[]>();
    let operatorNode: TableNodeData | null = null;

    nodes.forEach((n) => {
      if (n.isOperator) {
        operatorNode = n;
      } else {
        const bIdx = n.branchIndex || 1;
        if (!branchMap.has(bIdx)) {
          branchMap.set(bIdx, []);
        }
        branchMap.get(bIdx)!.push(n);
      }
    });

    const startX = 80;
    let currentY = 80;
    let maxBranchX = startX;

    const sortedBranches = Array.from(branchMap.keys()).sort((a, b) => a - b);

    sortedBranches.forEach((bIdx) => {
      const branchNodes = branchMap.get(bIdx)!;

      // Group nodes within this branch by in-degree / order
      branchNodes.forEach((node, idxInBranch) => {
        const x = startX + idxInBranch * (nodeWidth + horizontalGap);
        const y = currentY;
        node.x = x;
        node.y = y;
        maxBranchX = Math.max(maxBranchX, x + nodeWidth);
      });

      currentY += nodeHeight + branchRowGap;
    });

    // Position operator node (UNION ALL combiner) to the right, centered vertically
    if (operatorNode) {
      const totalGraphHeight = currentY - branchRowGap - 80;
      operatorNode.x = maxBranchX + horizontalGap;
      operatorNode.y = Math.max(80, 80 + (totalGraphHeight - nodeHeight) / 2);
    }
  } else {
    // Standard DAG topological layout
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

    const layerGroups = new Map<number, TableNodeData[]>();
    nodes.forEach((n) => {
      const layer = layers.get(n.id) ?? n.orderIndex;
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, []);
      }
      layerGroups.get(layer)!.push(n);
    });

    const startX = 80;
    const startY = 80;
    const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);

    sortedLayers.forEach((layerIdx) => {
      const group = layerGroups.get(layerIdx)!;
      const x = startX + layerIdx * (nodeWidth + horizontalGap);
      const totalHeight = group.length * nodeHeight + (group.length - 1) * branchRowGap;
      const layerStartY = Math.max(startY, startY + (300 - totalHeight) / 2);

      group.forEach((node, idx) => {
        const y = layerStartY + idx * (nodeHeight + branchRowGap);
        node.x = x;
        node.y = y;
      });
    });
  }
}
