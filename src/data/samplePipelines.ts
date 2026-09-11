import { FlowPipeline } from '../types';

export const SAMPLE_PIPELINES: FlowPipeline[] = [
  {
    id: 'pipe-s4-sales-etl',
    name: 'S/4HANA Sales & Revenue Analytics Pipeline',
    description: 'Sequenced SAP HANA data analysis pipeline extracting ERP sales orders, applying currency conversion, calculating regional KPIs, and materializing executive data marts using pure SELECT queries.',
    category: 'Sales & Distribution',
    author: 'SAP HANA Enterprise Architect',
    targetHanaVersion: 'SAP HANA Cloud 2026.Q3',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-10T14:30:00Z',
    edges: [
      { id: 'e1-2', source: 'node-1', target: 'node-2', label: 'Order Feed' },
      { id: 'e2-3', source: 'node-2', target: 'node-3', label: 'Enriched Customers' },
      { id: 'e3-4', source: 'node-3', target: 'node-4', label: 'Item Windowing' },
      { id: 'e4-5', source: 'node-4', target: 'node-5', label: 'Executive Metrics' },
    ],
    nodes: [
      {
        id: 'node-1',
        name: '01. Extract Active ERP Sales Orders',
        description: 'Select active sales order headers from S/4HANA VBAK table filtered by target sales org and date range with parameter binding.',
        queryType: 'SELECT',
        targetSchema: 'STAGE',
        targetTable: 'V_SALES_ORDERS_RAW',
        inputTables: ['"SAP_S4HANA"."VBAK"'],
        parameters: [
          { name: 'IP_START_DATE', type: 'DATE', defaultValue: "'2026-09-01'", description: 'Ingestion starting date' },
          { name: 'IP_SALES_ORG', type: 'NVARCHAR(4)', defaultValue: "'1010'", description: 'Target sales organization' }
        ],
        executionOrder: 1,
        status: 'success',
        enabled: true,
        position: { x: 80, y: 160 },
        nextNodeIds: ['node-2'],
        sqlContent: `SELECT 
    v."VBELN" AS "SALES_ORDER_ID",
    v."VKORG" AS "SALES_ORG",
    TO_DATE(v."ERDAT", 'YYYYMMDD') AS "DOC_DATE",
    v."KUNNR" AS "CUSTOMER_ID",
    v."WAERK" AS "CURRENCY",
    TO_DECIMAL(v."NETWR", 15, 2) AS "NET_AMOUNT",
    TO_DECIMAL(IFNULL(v."MWSBP", 0.00), 15, 2) AS "TAX_AMOUNT",
    CURRENT_UTCTIMESTAMP AS "EXTRACTION_TIMESTAMP"
FROM "SAP_S4HANA"."VBAK" AS v
WHERE v."ERDAT" >= :IP_START_DATE
  AND v."VKORG" = :IP_SALES_ORG
ORDER BY v."ERDAT" DESC;`,
        simulatedOutput: {
          columns: ['SALES_ORDER_ID', 'SALES_ORG', 'DOC_DATE', 'CUSTOMER_ID', 'CURRENCY', 'NET_AMOUNT', 'TAX_AMOUNT', 'EXTRACTION_TIMESTAMP'],
          rows: [
            { SALES_ORDER_ID: 'SO-902140', SALES_ORG: '1010', DOC_DATE: '2026-09-10', CUSTOMER_ID: 'CUST-00891', CURRENCY: 'EUR', NET_AMOUNT: 14500.50, TAX_AMOUNT: 2755.10, EXTRACTION_TIMESTAMP: '2026-09-10 14:00:01' },
            { SALES_ORDER_ID: 'SO-902141', SALES_ORG: '1010', DOC_DATE: '2026-09-10', CUSTOMER_ID: 'CUST-00432', CURRENCY: 'USD', NET_AMOUNT: 8920.00, TAX_AMOUNT: 713.60, EXTRACTION_TIMESTAMP: '2026-09-10 14:00:01' },
            { SALES_ORDER_ID: 'SO-902142', SALES_ORG: '1010', DOC_DATE: '2026-09-10', CUSTOMER_ID: 'CUST-00911', CURRENCY: 'GBP', NET_AMOUNT: 22400.00, TAX_AMOUNT: 4480.00, EXTRACTION_TIMESTAMP: '2026-09-10 14:00:01' }
          ],
          affectedRows: 4280,
          executionTimeMs: 48,
          memoryUsageMb: 2.8,
          timestamp: '2026-09-10 14:00:01'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      },
      {
        id: 'node-2',
        name: '02. Enrich Customer & Geography Dimensions',
        description: 'Select orders joined with Customer master (KNA1) to derive country code, clean city names, and calculate normalized EUR revenue.',
        queryType: 'SELECT',
        targetSchema: 'STAGE',
        targetTable: 'V_SALES_CUSTOMER_ENRICHED',
        inputTables: ['"SAP_S4HANA"."VBAK"', '"SAP_S4HANA"."KNA1"'],
        parameters: [
          { name: 'IP_START_DATE', type: 'DATE', defaultValue: "'2026-09-01'", description: 'Batch ingestion start date' },
          { name: 'IP_SALES_ORG', type: 'NVARCHAR(4)', defaultValue: "'1010'", description: 'Target sales organization code' }
        ],
        executionOrder: 2,
        status: 'success',
        enabled: true,
        position: { x: 380, y: 160 },
        nextNodeIds: ['node-3'],
        sqlContent: `SELECT 
    v."VBELN" AS "SALES_ORDER_ID",
    v."VKORG" AS "SALES_ORG",
    TO_DATE(v."ERDAT", 'YYYYMMDD') AS "DOC_DATE",
    v."KUNNR" AS "CUSTOMER_ID",
    cust."NAME1" AS "CUSTOMER_NAME",
    cust."LAND1" AS "COUNTRY_CODE",
    IFNULL(cust."ORT01", 'UNKNOWN') AS "CITY",
    v."WAERK" AS "CURRENCY",
    TO_DECIMAL(v."NETWR", 15, 2) AS "NET_AMOUNT",
    -- In-memory EUR currency normalisation
    CASE 
        WHEN v."WAERK" = 'EUR' THEN TO_DECIMAL(v."NETWR", 15, 2)
        WHEN v."WAERK" = 'USD' THEN ROUND(TO_DECIMAL(v."NETWR", 15, 2) * 0.92, 2)
        WHEN v."WAERK" = 'GBP' THEN ROUND(TO_DECIMAL(v."NETWR", 15, 2) * 1.18, 2)
        ELSE TO_DECIMAL(v."NETWR", 15, 2)
    END AS "NORMALIZED_EUR_AMOUNT"
FROM "SAP_S4HANA"."VBAK" AS v
LEFT OUTER JOIN "SAP_S4HANA"."KNA1" AS cust 
    ON v."KUNNR" = cust."KUNNR"
WHERE v."ERDAT" >= :IP_START_DATE
  AND v."VKORG" = :IP_SALES_ORG
ORDER BY "DOC_DATE" DESC;`,
        simulatedOutput: {
          columns: ['SALES_ORDER_ID', 'CUSTOMER_NAME', 'COUNTRY_CODE', 'CITY', 'CURRENCY', 'NET_AMOUNT', 'NORMALIZED_EUR_AMOUNT'],
          rows: [
            { SALES_ORDER_ID: 'SO-902140', CUSTOMER_NAME: 'Siemens AG', COUNTRY_CODE: 'DE', CITY: 'Munich', CURRENCY: 'EUR', NET_AMOUNT: 14500.50, NORMALIZED_EUR_AMOUNT: 14500.50 },
            { SALES_ORDER_ID: 'SO-902141', CUSTOMER_NAME: 'Boeing Co', COUNTRY_CODE: 'US', CITY: 'Chicago', CURRENCY: 'USD', NET_AMOUNT: 8920.00, NORMALIZED_EUR_AMOUNT: 8206.40 },
            { SALES_ORDER_ID: 'SO-902142', CUSTOMER_NAME: 'Vodafone Group', COUNTRY_CODE: 'GB', CITY: 'London', CURRENCY: 'GBP', NET_AMOUNT: 22400.00, NORMALIZED_EUR_AMOUNT: 26432.00 }
          ],
          affectedRows: 4280,
          executionTimeMs: 85,
          memoryUsageMb: 5.2,
          timestamp: '2026-09-10 14:00:05'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      },
      {
        id: 'node-3',
        name: '03. Join Line Items & Material Master with Window Ranking',
        description: 'Select line items (VBAP) and Material master (MARA), applying analytical window ranking for customer purchase frequency and order sequence.',
        queryType: 'SELECT',
        targetSchema: 'ANALYTICS',
        targetTable: 'V_FACT_SALES_ENRICHED',
        inputTables: ['"SAP_S4HANA"."VBAP"', '"SAP_S4HANA"."VBAK"', '"SAP_S4HANA"."KNA1"', '"SAP_S4HANA"."MARA"'],
        parameters: [],
        executionOrder: 3,
        status: 'idle',
        enabled: true,
        position: { x: 680, y: 160 },
        nextNodeIds: ['node-4'],
        sqlContent: `SELECT 
    head."VBELN" AS "SALES_ORDER_ID",
    item."POSNR" AS "LINE_ITEM_ID",
    TO_DATE(head."ERDAT", 'YYYYMMDD') AS "DOC_DATE",
    head."KUNNR" AS "CUSTOMER_ID",
    cust."NAME1" AS "CUSTOMER_NAME",
    cust."LAND1" AS "COUNTRY_CODE",
    item."MATNR" AS "MATERIAL_ID",
    mat."MTART" AS "MATERIAL_TYPE",
    item."KWMENG" AS "QUANTITY",
    item."VRKME" AS "UNIT_OF_MEASURE",
    item."NETWR" AS "LINE_NET_AMOUNT",
    head."WAERK" AS "CURRENCY",
    -- SAP HANA Window Function for customer order sequence
    ROW_NUMBER() OVER (PARTITION BY head."KUNNR" ORDER BY head."ERDAT" DESC) AS "CUST_ORDER_SEQ",
    -- Regional revenue percentile rank
    DENSE_RANK() OVER (PARTITION BY cust."LAND1" ORDER BY item."NETWR" DESC) AS "REGIONAL_ITEM_RANK"
FROM "SAP_S4HANA"."VBAP" AS item
INNER JOIN "SAP_S4HANA"."VBAK" AS head 
    ON item."VBELN" = head."VBELN"
LEFT OUTER JOIN "SAP_S4HANA"."KNA1" AS cust 
    ON head."KUNNR" = cust."KUNNR"
LEFT OUTER JOIN "SAP_S4HANA"."MARA" AS mat 
    ON item."MATNR" = mat."MATNR"
WHERE head."ERDAT" >= '2026-09-01'
ORDER BY item."NETWR" DESC;`,
        simulatedOutput: {
          columns: ['SALES_ORDER_ID', 'LINE_ITEM_ID', 'CUSTOMER_NAME', 'COUNTRY_CODE', 'MATERIAL_TYPE', 'QUANTITY', 'LINE_NET_AMOUNT', 'CUST_ORDER_SEQ', 'REGIONAL_ITEM_RANK'],
          rows: [
            { SALES_ORDER_ID: 'SO-902140', LINE_ITEM_ID: '000010', CUSTOMER_NAME: 'Siemens AG', COUNTRY_CODE: 'DE', MATERIAL_TYPE: 'FERT', QUANTITY: 50, LINE_NET_AMOUNT: 9500.00, CUST_ORDER_SEQ: 1, REGIONAL_ITEM_RANK: 1 },
            { SALES_ORDER_ID: 'SO-902140', LINE_ITEM_ID: '000020', CUSTOMER_NAME: 'Siemens AG', COUNTRY_CODE: 'DE', MATERIAL_TYPE: 'HAWA', QUANTITY: 25, LINE_NET_AMOUNT: 5000.50, CUST_ORDER_SEQ: 1, REGIONAL_ITEM_RANK: 2 },
            { SALES_ORDER_ID: 'SO-902141', LINE_ITEM_ID: '000010', CUSTOMER_NAME: 'Boeing Co', COUNTRY_CODE: 'US', MATERIAL_TYPE: 'FERT', QUANTITY: 120, LINE_NET_AMOUNT: 8920.00, CUST_ORDER_SEQ: 3, REGIONAL_ITEM_RANK: 1 }
          ],
          affectedRows: 8950,
          executionTimeMs: 142,
          memoryUsageMb: 9.6,
          timestamp: '2026-09-10 14:00:12'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      },
      {
        id: 'node-4',
        name: '04. Calculate Regional Revenue & Material Aggregations',
        description: 'Select aggregate KPIs grouped by country and material type, computing distinct order counts, total volume, and average order value.',
        queryType: 'SELECT',
        targetSchema: 'ANALYTICS',
        targetTable: 'V_AGG_REGIONAL_SALES',
        inputTables: ['"SAP_S4HANA"."VBAP"', '"SAP_S4HANA"."VBAK"', '"SAP_S4HANA"."KNA1"', '"SAP_S4HANA"."MARA"'],
        parameters: [
          { name: 'IP_FISCAL_YEAR', type: 'INTEGER', defaultValue: '2026', description: 'Current reporting fiscal year' }
        ],
        executionOrder: 4,
        status: 'idle',
        enabled: true,
        position: { x: 980, y: 160 },
        nextNodeIds: ['node-5'],
        sqlContent: `SELECT 
    cust."LAND1" AS "COUNTRY_CODE",
    mat."MTART" AS "MATERIAL_TYPE",
    COUNT(DISTINCT head."VBELN") AS "ORDER_COUNT",
    SUM(item."NETWR") AS "TOTAL_REVENUE_EUR",
    ROUND(AVG(item."NETWR"), 2) AS "AVG_ORDER_VALUE",
    MIN(item."NETWR") AS "MIN_LINE_VALUE",
    MAX(item."NETWR") AS "MAX_LINE_VALUE",
    COUNT(item."POSNR") AS "TOTAL_LINE_ITEMS"
FROM "SAP_S4HANA"."VBAP" AS item
INNER JOIN "SAP_S4HANA"."VBAK" AS head 
    ON item."VBELN" = head."VBELN"
LEFT OUTER JOIN "SAP_S4HANA"."KNA1" AS cust 
    ON head."KUNNR" = cust."KUNNR"
LEFT OUTER JOIN "SAP_S4HANA"."MARA" AS mat 
    ON item."MATNR" = mat."MATNR"
WHERE EXTRACT(YEAR FROM TO_DATE(head."ERDAT", 'YYYYMMDD')) = :IP_FISCAL_YEAR
GROUP BY cust."LAND1", mat."MTART"
HAVING SUM(item."NETWR") > 0
ORDER BY "TOTAL_REVENUE_EUR" DESC;`,
        simulatedOutput: {
          columns: ['COUNTRY_CODE', 'MATERIAL_TYPE', 'ORDER_COUNT', 'TOTAL_REVENUE_EUR', 'AVG_ORDER_VALUE', 'MIN_LINE_VALUE', 'MAX_LINE_VALUE', 'TOTAL_LINE_ITEMS'],
          rows: [
            { COUNTRY_CODE: 'DE', MATERIAL_TYPE: 'FERT', ORDER_COUNT: 1420, TOTAL_REVENUE_EUR: 3840900.00, AVG_ORDER_VALUE: 2704.85, MIN_LINE_VALUE: 150.00, MAX_LINE_VALUE: 24500.00, TOTAL_LINE_ITEMS: 3200 },
            { COUNTRY_CODE: 'US', MATERIAL_TYPE: 'FERT', ORDER_COUNT: 980, TOTAL_REVENUE_EUR: 2910400.50, AVG_ORDER_VALUE: 2969.79, MIN_LINE_VALUE: 220.00, MAX_LINE_VALUE: 18900.00, TOTAL_LINE_ITEMS: 2150 },
            { COUNTRY_CODE: 'GB', MATERIAL_TYPE: 'HAWA', ORDER_COUNT: 650, TOTAL_REVENUE_EUR: 1120000.00, AVG_ORDER_VALUE: 1723.07, MIN_LINE_VALUE: 90.00, MAX_LINE_VALUE: 11400.00, TOTAL_LINE_ITEMS: 1400 }
          ],
          affectedRows: 48,
          executionTimeMs: 115,
          memoryUsageMb: 6.4,
          timestamp: '2026-09-10 14:00:20'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      },
      {
        id: 'node-5',
        name: '05. Executive Analytics Calculation View Query',
        description: 'Select executive dashboard metrics with customer market share, dense ranking, and top contributor segmentation.',
        queryType: 'SELECT',
        targetSchema: 'REPORTING',
        targetTable: 'CV_EXECUTIVE_SALES_DASHBOARD',
        inputTables: ['"SAP_S4HANA"."VBAK"', '"SAP_S4HANA"."VBAP"', '"SAP_S4HANA"."KNA1"', '"SAP_S4HANA"."MARA"'],
        parameters: [],
        executionOrder: 5,
        status: 'idle',
        enabled: true,
        position: { x: 1280, y: 160 },
        nextNodeIds: [],
        sqlContent: `SELECT 
    cust."LAND1" AS "COUNTRY_CODE",
    cust."NAME1" AS "CUSTOMER_NAME",
    mat."MTART" AS "MATERIAL_TYPE",
    SUM(item."NETWR") AS "TOTAL_SALES_AMOUNT",
    COUNT(item."POSNR") AS "ITEMS_SOLD_COUNT",
    -- In-memory rank calculation
    DENSE_RANK() OVER (PARTITION BY cust."LAND1" ORDER BY SUM(item."NETWR") DESC) AS "REGIONAL_RANK",
    ROUND(SUM(item."NETWR") / NULLIF(SUM(SUM(item."NETWR")) OVER (PARTITION BY cust."LAND1"), 0) * 100, 2) AS "SHARE_OF_COUNTRY_PCT"
FROM "SAP_S4HANA"."VBAP" AS item
INNER JOIN "SAP_S4HANA"."VBAK" AS head 
    ON item."VBELN" = head."VBELN"
LEFT OUTER JOIN "SAP_S4HANA"."KNA1" AS cust 
    ON head."KUNNR" = cust."KUNNR"
LEFT OUTER JOIN "SAP_S4HANA"."MARA" AS mat 
    ON item."MATNR" = mat."MATNR"
GROUP BY 
    cust."LAND1", 
    cust."NAME1", 
    mat."MTART"
ORDER BY 
    cust."LAND1" ASC, 
    "TOTAL_SALES_AMOUNT" DESC
LIMIT 100;`,
        simulatedOutput: {
          columns: ['COUNTRY_CODE', 'CUSTOMER_NAME', 'MATERIAL_TYPE', 'TOTAL_SALES_AMOUNT', 'ITEMS_SOLD_COUNT', 'REGIONAL_RANK', 'SHARE_OF_COUNTRY_PCT'],
          rows: [
            { COUNTRY_CODE: 'DE', CUSTOMER_NAME: 'Siemens AG', MATERIAL_TYPE: 'FERT', TOTAL_SALES_AMOUNT: 940000.00, ITEMS_SOLD_COUNT: 340, REGIONAL_RANK: 1, SHARE_OF_COUNTRY_PCT: 24.47 },
            { COUNTRY_CODE: 'DE', CUSTOMER_NAME: 'BASF SE', MATERIAL_TYPE: 'FERT', TOTAL_SALES_AMOUNT: 620000.00, ITEMS_SOLD_COUNT: 210, REGIONAL_RANK: 2, SHARE_OF_COUNTRY_PCT: 16.14 },
            { COUNTRY_CODE: 'US', CUSTOMER_NAME: 'Boeing Co', MATERIAL_TYPE: 'FERT', TOTAL_SALES_AMOUNT: 890000.00, ITEMS_SOLD_COUNT: 290, REGIONAL_RANK: 1, SHARE_OF_COUNTRY_PCT: 30.58 }
          ],
          affectedRows: 100,
          executionTimeMs: 68,
          memoryUsageMb: 3.9,
          timestamp: '2026-09-10 14:00:25'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      }
    ]
  },
  {
    id: 'pipe-gl-reconciliation',
    name: 'Financial Ledger & BSEG Month-End Reconciliation',
    description: 'Finance pipeline verifying debit/credit equilibrium across company codes, identifying ledger variances, and generating balance sheet extracts using pure SELECT statements.',
    category: 'Finance & Controlling',
    author: 'SAP FI/CO Data Architect',
    targetHanaVersion: 'SAP HANA Cloud 2026',
    createdAt: '2026-09-05T10:00:00Z',
    updatedAt: '2026-09-09T18:20:00Z',
    edges: [
      { id: 'egl-1-2', source: 'node-gl-1', target: 'node-gl-2', label: 'Header Feed' },
      { id: 'egl-2-3', source: 'node-gl-2', target: 'node-gl-3', label: 'Variance Check' },
      { id: 'egl-3-4', source: 'node-gl-3', target: 'node-gl-4', label: 'Balance Sheet View' },
    ],
    nodes: [
      {
        id: 'node-gl-1',
        name: '01. Select Journal Headers (BKPF)',
        description: 'Select posted accounting document headers for target company code and closed fiscal period.',
        queryType: 'SELECT',
        targetSchema: 'FINANCE',
        targetTable: 'V_BKPF_FILTERED',
        inputTables: ['"SAP_S4HANA"."BKPF"'],
        parameters: [
          { name: 'IP_BUKRS', type: 'NVARCHAR(4)', defaultValue: "'1000'", description: 'Company code' },
          { name: 'IP_GJAHR', type: 'INTEGER', defaultValue: '2026', description: 'Fiscal Year' },
          { name: 'IP_MONAT', type: 'INTEGER', defaultValue: '8', description: 'Fiscal Period (Month)' }
        ],
        executionOrder: 1,
        status: 'success',
        enabled: true,
        position: { x: 100, y: 160 },
        nextNodeIds: ['node-gl-2'],
        sqlContent: `SELECT 
    b."BUKRS" AS "COMPANY_CODE",
    b."BELNR" AS "DOC_NUMBER",
    b."GJAHR" AS "FISCAL_YEAR",
    b."BLART" AS "DOC_TYPE",
    b."BLDAT" AS "DOC_DATE",
    b."BUDAT" AS "POSTING_DATE",
    b."MONAT" AS "FISCAL_PERIOD",
    b."WAERS" AS "DOC_CURRENCY",
    b."HWAER" AS "LOCAL_CURRENCY"
FROM "SAP_S4HANA"."BKPF" AS b
WHERE b."BUKRS" = :IP_BUKRS
  AND b."GJAHR" = :IP_GJAHR
  AND b."MONAT" = :IP_MONAT
  AND b."BSTAT" = '' -- Only posted non-parked documents
ORDER BY b."BUDAT" DESC;`,
        simulatedOutput: {
          columns: ['COMPANY_CODE', 'DOC_NUMBER', 'FISCAL_YEAR', 'DOC_TYPE', 'POSTING_DATE', 'DOC_CURRENCY'],
          rows: [
            { COMPANY_CODE: '1000', DOC_NUMBER: '100000491', FISCAL_YEAR: 2026, DOC_TYPE: 'SA', POSTING_DATE: '2026-08-31', DOC_CURRENCY: 'EUR' },
            { COMPANY_CODE: '1000', DOC_NUMBER: '100000492', FISCAL_YEAR: 2026, DOC_TYPE: 'KR', POSTING_DATE: '2026-08-31', DOC_CURRENCY: 'USD' }
          ],
          affectedRows: 12450,
          executionTimeMs: 75,
          memoryUsageMb: 4.2,
          timestamp: '2026-09-09 18:00:00'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      },
      {
        id: 'node-gl-2',
        name: '02. Aggregate Debits, Credits & Balance Check',
        description: 'Select aggregated debits (SHKZG = S) and credits (SHKZG = H), computing delta variances and balance equilibrium status.',
        queryType: 'SELECT',
        targetSchema: 'FINANCE',
        targetTable: 'V_GL_BALANCES',
        inputTables: ['"SAP_S4HANA"."BKPF"', '"SAP_S4HANA"."BSEG"'],
        parameters: [
          { name: 'IP_BUKRS', type: 'NVARCHAR(4)', defaultValue: "'1000'", description: 'Company code' },
          { name: 'IP_GJAHR', type: 'INTEGER', defaultValue: '2026', description: 'Fiscal Year' }
        ],
        executionOrder: 2,
        status: 'idle',
        enabled: true,
        position: { x: 450, y: 160 },
        nextNodeIds: ['node-gl-3'],
        sqlContent: `SELECT 
    h."BUKRS" AS "COMPANY_CODE",
    h."BELNR" AS "DOC_NUMBER",
    h."GJAHR" AS "FISCAL_YEAR",
    SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE 0.00 END) AS "TOTAL_DEBIT",
    SUM(CASE WHEN item."SHKZG" = 'H' THEN item."DMBTR" ELSE 0.00 END) AS "TOTAL_CREDIT",
    SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE -item."DMBTR" END) AS "VARIANCE_AMOUNT",
    CASE 
        WHEN ABS(SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE -item."DMBTR" END)) < 0.01 THEN 'BALANCED'
        ELSE 'UNBALANCED'
    END AS "BALANCE_STATUS"
FROM "SAP_S4HANA"."BKPF" AS h
INNER JOIN "SAP_S4HANA"."BSEG" AS item 
    ON h."BUKRS" = item."BUKRS"
   AND h."BELNR" = item."BELNR"
   AND h."GJAHR" = item."GJAHR"
WHERE h."BUKRS" = :IP_BUKRS
  AND h."GJAHR" = :IP_GJAHR
GROUP BY 
    h."BUKRS", 
    h."BELNR", 
    h."GJAHR"
ORDER BY ABS(SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE -item."DMBTR" END)) DESC;`,
        simulatedOutput: {
          columns: ['COMPANY_CODE', 'DOC_NUMBER', 'TOTAL_DEBIT', 'TOTAL_CREDIT', 'VARIANCE_AMOUNT', 'BALANCE_STATUS'],
          rows: [
            { COMPANY_CODE: '1000', DOC_NUMBER: '100000491', TOTAL_DEBIT: 50000.00, TOTAL_CREDIT: 50000.00, VARIANCE_AMOUNT: 0.00, BALANCE_STATUS: 'BALANCED' },
            { COMPANY_CODE: '1000', DOC_NUMBER: '100000492', TOTAL_DEBIT: 12400.50, TOTAL_CREDIT: 12400.50, VARIANCE_AMOUNT: 0.00, BALANCE_STATUS: 'BALANCED' }
          ],
          affectedRows: 12450,
          executionTimeMs: 160,
          memoryUsageMb: 8.9,
          timestamp: '2026-09-09 18:00:15'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      },
      {
        id: 'node-gl-3',
        name: '03. Filter Out-of-Balance Exception Records',
        description: 'Select journal entries where variance amount is non-zero to isolate reconciliation discrepancies for Finance Controller review.',
        queryType: 'SELECT',
        targetSchema: 'FINANCE',
        targetTable: 'V_AUDIT_UNBALANCED_DOCS',
        inputTables: ['"SAP_S4HANA"."BKPF"', '"SAP_S4HANA"."BSEG"'],
        parameters: [
          { name: 'IP_BUKRS', type: 'NVARCHAR(4)', defaultValue: "'1000'", description: 'Company code' },
          { name: 'IP_GJAHR', type: 'INTEGER', defaultValue: '2026', description: 'Fiscal Year' }
        ],
        executionOrder: 3,
        status: 'idle',
        enabled: true,
        position: { x: 800, y: 160 },
        nextNodeIds: ['node-gl-4'],
        sqlContent: `SELECT 
    h."BUKRS" AS "COMPANY_CODE",
    h."BELNR" AS "DOC_NUMBER",
    h."GJAHR" AS "FISCAL_YEAR",
    SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE 0.00 END) AS "TOTAL_DEBIT",
    SUM(CASE WHEN item."SHKZG" = 'H' THEN item."DMBTR" ELSE 0.00 END) AS "TOTAL_CREDIT",
    ROUND(SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE -item."DMBTR" END), 2) AS "VARIANCE_AMOUNT",
    'UNBALANCED_DOC_AUDIT_TRIGGERED' AS "AUDIT_REASON",
    CURRENT_UTCTIMESTAMP AS "AUDIT_TIMESTAMP"
FROM "SAP_S4HANA"."BKPF" AS h
INNER JOIN "SAP_S4HANA"."BSEG" AS item 
    ON h."BUKRS" = item."BUKRS"
   AND h."BELNR" = item."BELNR"
   AND h."GJAHR" = item."GJAHR"
WHERE h."BUKRS" = :IP_BUKRS
  AND h."GJAHR" = :IP_GJAHR
GROUP BY 
    h."BUKRS", 
    h."BELNR", 
    h."GJAHR"
HAVING ABS(SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE -item."DMBTR" END)) >= 0.01
ORDER BY ABS("VARIANCE_AMOUNT") DESC;`,
        simulatedOutput: {
          columns: ['COMPANY_CODE', 'DOC_NUMBER', 'TOTAL_DEBIT', 'TOTAL_CREDIT', 'VARIANCE_AMOUNT', 'AUDIT_REASON'],
          rows: [],
          affectedRows: 0,
          executionTimeMs: 25,
          memoryUsageMb: 1.8,
          timestamp: '2026-09-09 18:00:20'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      },
      {
        id: 'node-gl-4',
        name: '04. Consolidated Balance Sheet Summary View',
        description: 'Select company code total debit sum, credit sum, and net reconciliation difference across the fiscal year.',
        queryType: 'SELECT',
        targetSchema: 'FINANCE',
        targetTable: 'V_BALANCE_SHEET_CONSOLIDATED',
        inputTables: ['"SAP_S4HANA"."BKPF"', '"SAP_S4HANA"."BSEG"'],
        parameters: [
          { name: 'IP_BUKRS', type: 'NVARCHAR(4)', defaultValue: "'1000'", description: 'Company code' },
          { name: 'IP_GJAHR', type: 'INTEGER', defaultValue: '2026', description: 'Fiscal Year' }
        ],
        executionOrder: 4,
        status: 'idle',
        enabled: true,
        position: { x: 1150, y: 160 },
        nextNodeIds: [],
        sqlContent: `SELECT 
    h."BUKRS" AS "COMPANY_CODE",
    h."GJAHR" AS "FISCAL_YEAR",
    SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE 0.00 END) AS "PERIOD_DEBIT_SUM",
    SUM(CASE WHEN item."SHKZG" = 'H' THEN item."DMBTR" ELSE 0.00 END) AS "PERIOD_CREDIT_SUM",
    ROUND(SUM(CASE WHEN item."SHKZG" = 'S' THEN item."DMBTR" ELSE -item."DMBTR" END), 2) AS "NET_BALANCE_DIFFERENCE"
FROM "SAP_S4HANA"."BKPF" AS h
INNER JOIN "SAP_S4HANA"."BSEG" AS item 
    ON h."BUKRS" = item."BUKRS"
   AND h."BELNR" = item."BELNR"
   AND h."GJAHR" = item."GJAHR"
WHERE h."BUKRS" = :IP_BUKRS
  AND h."GJAHR" = :IP_GJAHR
GROUP BY 
    h."BUKRS", 
    h."GJAHR";`,
        simulatedOutput: {
          columns: ['COMPANY_CODE', 'FISCAL_YEAR', 'PERIOD_DEBIT_SUM', 'PERIOD_CREDIT_SUM', 'NET_BALANCE_DIFFERENCE'],
          rows: [
            { COMPANY_CODE: '1000', FISCAL_YEAR: 2026, PERIOD_DEBIT_SUM: 48291040.00, PERIOD_CREDIT_SUM: 48291040.00, NET_BALANCE_DIFFERENCE: 0.00 }
          ],
          affectedRows: 1,
          executionTimeMs: 38,
          memoryUsageMb: 2.7,
          timestamp: '2026-09-09 18:00:25'
        },
        validationSummary: { isValid: true, errors: 0, warnings: 0 }
      }
    ]
  }
];
