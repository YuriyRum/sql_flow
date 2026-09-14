export interface SqlSnippet {
  id: string;
  label: string;
  trigger: string;
  category: 'Basic' | 'Aggregation' | 'Window & Analytics' | 'Joins & Star Schema' | 'CTE & Subqueries' | 'SAP ERP Tables' | 'Date & Time';
  description: string;
  snippet: string;
}

export interface AutocompleteItem {
  label: string;
  type: 'keyword' | 'function' | 'datatype' | 'table' | 'column' | 'snippet';
  detail?: string;
  insertText: string;
  snippetObj?: SqlSnippet;
}

export const SQL_SNIPPETS: SqlSnippet[] = [
  {
    id: 'select_basic',
    label: 'Basic SELECT with Alias & WHERE',
    trigger: 'select_basic',
    category: 'Basic',
    description: 'Standard SELECT statement with schema table, explicit columns, alias, and WHERE filter',
    snippet: `SELECT 
    T1."ID",
    T1."NAME",
    T1."STATUS",
    T1."CREATED_AT"
FROM "SAP_S4HANA"."CUSTOMER_MASTER" T1
WHERE T1."STATUS" = 'ACTIVE'
ORDER BY T1."CREATED_AT" DESC;`,
  },
  {
    id: 'select_agg_group_by',
    label: 'SELECT Aggregation & GROUP BY',
    trigger: 'select_agg',
    category: 'Aggregation',
    description: 'Aggregation query with COUNT, SUM, AVG, GROUP BY, and HAVING clause',
    snippet: `SELECT 
    "REGION",
    "CATEGORY",
    COUNT(*) AS "TOTAL_ORDERS",
    SUM("GROSS_AMOUNT") AS "SUM_GROSS_AMOUNT",
    ROUND(AVG("NET_AMOUNT"), 2) AS "AVG_NET_AMOUNT"
FROM "SAP_S4HANA"."SALES_DOCUMENTS"
WHERE "DOCUMENT_DATE" >= ADD_DAYS(CURRENT_DATE, -365)
GROUP BY "REGION", "CATEGORY"
HAVING SUM("GROSS_AMOUNT") > 100000
ORDER BY "SUM_GROSS_AMOUNT" DESC;`,
  },
  {
    id: 'select_window_row_number',
    label: 'SELECT Window ROW_NUMBER() / DENSE_RANK()',
    trigger: 'select_window',
    category: 'Window & Analytics',
    description: 'Analytics query using ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)',
    snippet: `SELECT 
    "CUSTOMER_ID",
    "ORDER_ID",
    "ORDER_DATE",
    "TOTAL_AMOUNT",
    ROW_NUMBER() OVER (
        PARTITION BY "CUSTOMER_ID" 
        ORDER BY "ORDER_DATE" DESC
    ) AS "RANK_BY_CUSTOMER"
FROM "SAP_S4HANA"."SALES_ORDERS";`,
  },
  {
    id: 'select_cte_sequence',
    label: 'WITH CTE Sequence & Final SELECT',
    trigger: 'select_cte',
    category: 'CTE & Subqueries',
    description: 'Common Table Expression (WITH) block followed by a clean transformation SELECT',
    snippet: `WITH "FILTERED_ORDERS" AS (
    SELECT 
        "SALES_DOC_ID",
        "CUSTOMER_ID",
        "NET_AMOUNT",
        "STATUS"
    FROM "SAP_S4HANA"."VBAK"
    WHERE "STATUS" IN ('COMPLETED', 'SHIPPED')
),
"CUSTOMER_SUMS" AS (
    SELECT 
        "CUSTOMER_ID",
        COUNT(*) AS "ORDER_COUNT",
        SUM("NET_AMOUNT") AS "TOTAL_SPEND"
    FROM "FILTERED_ORDERS"
    GROUP BY "CUSTOMER_ID"
)
SELECT 
    C."CUSTOMER_ID",
    C."ORDER_COUNT",
    C."TOTAL_SPEND",
    CASE 
        WHEN C."TOTAL_SPEND" >= 50000 THEN 'PLATINUM'
        WHEN C."TOTAL_SPEND" >= 10000 THEN 'GOLD'
        ELSE 'SILVER'
    END AS "TIER"
FROM "CUSTOMER_SUMS" C
ORDER BY C."TOTAL_SPEND" DESC;`,
  },
  {
    id: 'select_left_join_coalesce',
    label: 'Star Schema LEFT OUTER JOIN & COALESCE',
    trigger: 'select_join',
    category: 'Joins & Star Schema',
    description: 'Multi-table join combining header and item tables with null safety',
    snippet: `SELECT 
    H."VBELN" AS "SALES_DOC",
    H."KUNNR" AS "CUSTOMER_CODE",
    COALESCE(C."NAME1", 'UNSPECIFIED CUSTOMER') AS "CUSTOMER_NAME",
    I."POSNR font" AS "ITEM_NUM",
    I."MATNR" AS "MATERIAL_NUM",
    I."NETWR" AS "ITEM_NET_VALUE",
    H."WAERK" AS "CURRENCY"
FROM "SAP_S4HANA"."VBAK" H
LEFT OUTER JOIN "SAP_S4HANA"."VBAP" I
    ON H."MANDT" = I."MANDT" AND H."VBELN" = I."VBELN"
LEFT OUTER JOIN "SAP_S4HANA"."KNA1" C
    ON H."MANDT" = C."MANDT" AND H."KUNNR" = C."KUNNR"
WHERE H."MANDT" = '100';`,
  },
  {
    id: 'select_case_when_pivot',
    label: 'Conditional CASE WHEN Aggregation (Pivot)',
    trigger: 'select_case',
    category: 'Aggregation',
    description: 'Pivoting status totals using conditional SUM(CASE WHEN ... THEN ... ELSE 0 END)',
    snippet: `SELECT 
    "COMPANY_CODE",
    "FISCAL_YEAR",
    SUM(CASE WHEN "STATUS" = 'APPROVED' THEN "AMOUNT" ELSE 0 END) AS "APPROVED_TOTAL",
    SUM(CASE WHEN "STATUS" = 'PENDING' THEN "AMOUNT" ELSE 0 END) AS "PENDING_TOTAL",
    SUM(CASE WHEN "STATUS" = 'REJECTED' THEN "AMOUNT" ELSE 0 END) AS "REJECTED_TOTAL",
    COUNT(CASE WHEN "STATUS" = 'PENDING' THEN 1 END) AS "PENDING_COUNT"
FROM "SAP_S4HANA"."FINANCIAL_ITEMS"
GROUP BY "COMPANY_CODE", "FISCAL_YEAR";`,
  },
  {
    id: 'select_date_hana_functions',
    label: 'SAP HANA Date Functions & Time Range Filter',
    trigger: 'select_date',
    category: 'Date & Time',
    description: 'Date calculations using ADD_DAYS, ADD_MONTHS, CURRENT_DATE, and TO_VARCHAR',
    snippet: `SELECT 
    "INVOICE_ID",
    "INVOICE_DATE",
    ADD_DAYS("INVOICE_DATE", 30) AS "DUE_DATE",
    DAYS_BETWEEN("INVOICE_DATE", CURRENT_DATE) AS "AGE_IN_DAYS",
    TO_VARCHAR("INVOICE_DATE", 'YYYY-MM') AS "YEAR_MONTH",
    CURRENT_TIMESTAMP AS "EXTRACT_TIMESTAMP"
FROM "SAP_S4HANA"."INVOICE_HEADER"
WHERE "INVOICE_DATE" >= ADD_MONTHS(CURRENT_DATE, -12);`,
  },
  {
    id: 'select_sap_vbak_vbap',
    label: 'SAP S/4HANA Sales Document Header & Items (VBAK/VBAP)',
    trigger: 'select_vbak',
    category: 'SAP ERP Tables',
    description: 'S/4HANA standard sales order extraction with mandt, document type, and currency',
    snippet: `SELECT 
    VBAK."MANDT",
    VBAK."VBELN" AS "SALES_ORDER",
    VBAK."ERDAT" AS "CREATION_DATE",
    VBAK."AUART" AS "ORDER_TYPE",
    VBAK."KUNNR" AS "SOLD_TO_PARTY",
    VBAP."POSNR" AS "ITEM_NUMBER",
    VBAP."MATNR" AS "MATERIAL_NUMBER",
    VBAP."KWMENG" AS "ORDER_QUANTITY",
    VBAP."MEINS" AS "BASE_UNIT",
    VBAP."NETWR" AS "NET_VALUE",
    VBAK."WAERK" AS "CURRENCY"
FROM "SAP_S4HANA"."VBAK" VBAK
INNER JOIN "SAP_S4HANA"."VBAP" VBAP
    ON VBAK."MANDT" = VBAP."MANDT" 
   AND VBAK."VBELN" = VBAP."VBELN"
WHERE VBAK."MANDT" = '100'
  AND VBAK."ERDAT" >= '20240101';`,
  },
  {
    id: 'select_sap_sflight',
    label: 'SAP SFLIGHT Analytical Query (Flight Metrics)',
    trigger: 'select_sflight',
    category: 'SAP ERP Tables',
    description: 'SAP SFLIGHT demo table query calculating occupancy rate and revenue',
    snippet: `SELECT 
    S1."CARRID" AS "AIRLINE",
    S1."CONNID font" AS "FLIGHT_NUMBER",
    S1."FLDATE" AS "FLIGHT_DATE",
    S1."PRICE" AS "TICKET_PRICE",
    S1."CURRENCY",
    S1."SEATSMAX" AS "MAX_SEATS",
    S1."SEATSOCC" AS "OCCUPIED_SEATS",
    (S1."SEATSOCC" * S1."PRICE") AS "REVENUE",
    ROUND((S1."SEATSOCC" / NULLIF(S1."SEATSMAX", 0)) * 100, 2) AS "OCCUPANCY_RATE_PCT"
FROM "SAP_S4HANA"."SFLIGHT" S1
WHERE S1."SEATSOCC" > 0
ORDER BY "REVENUE" DESC;`,
  },
];

export const SAP_COMMON_TABLES = [
  { label: '"VBAK"', detail: 'Sales Document Header (S/4HANA)' },
  { label: '"VBAP"', detail: 'Sales Document Item (S/4HANA)' },
  { label: '"SFLIGHT"', detail: 'Flight Demo Table' },
  { label: '"MARA"', detail: 'General Material Data' },
  { label: '"MAKT"', detail: 'Material Descriptions' },
  { label: '"KNA1"', detail: 'Customer Master General Data' },
  { label: '"LFA1"', detail: 'Vendor Master General Data' },
  { label: '"BSEG"', detail: 'Accounting Document Segment' },
  { label: '"BKPF"', detail: 'Accounting Document Header' },
  { label: '"ACDOCA"', detail: 'Universal Journal Entry Line Items' },
  { label: '"EKKO"', detail: 'Purchasing Document Header' },
  { label: '"EKPO"', detail: 'Purchasing Document Item' },
];

export const SAP_COMMON_COLUMNS = [
  { label: '"VBELN"', detail: 'Sales Document Number' },
  { label: '"POSNR"', detail: 'Item Number' },
  { label: '"MATNR"', detail: 'Material Number' },
  { label: '"KUNNR"', detail: 'Customer / Sold-to Party' },
  { label: '"LIFNR"', detail: 'Vendor Account Number' },
  { label: '"NETWR"', detail: 'Net Value of Sales Order' },
  { label: '"WAERK"', detail: 'Currency Key' },
  { label: '"MANDT"', detail: 'Client / Tenant ID' },
  { label: '"ERDAT"', detail: 'Record Creation Date' },
  { label: '"CARRID"', detail: 'Airline Code' },
  { label: '"CONNID"', detail: 'Flight Connection ID' },
  { label: '"FLDATE"', detail: 'Flight Date' },
  { label: '"PRICE"', detail: 'Airfare Price' },
  { label: '"CURRENCY"', detail: 'Currency Code' },
  { label: '"SEATSMAX"', detail: 'Maximum Capacity' },
  { label: '"SEATSOCC"', detail: 'Occupied Seats' },
];

export const KEYWORDS_LIST = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'ON', 'AS',
  'UNION ALL', 'WITH', 'CASE WHEN', 'THEN', 'ELSE', 'END', 'OVER (PARTITION BY ...)',
  'ROW_NUMBER()', 'RANK()', 'DENSE_RANK()', 'COALESCE()', 'CONCAT()', 'ADD_DAYS()',
  'ADD_MONTHS()', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'SUM()', 'COUNT()', 'AVG()', 'MIN()', 'MAX()'
];
