import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Lazy Google GenAI Client
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
});

// AI SQL Syntax & Logic Deep Validator for SAP HANA
app.post('/api/ai/validate-sql', async (req, res) => {
  try {
    const { sql, queryType, nodeName } = req.body;
    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL string is required' });
    }

    const ai = getAIClient();
    if (!ai) {
      return res.json({
        available: false,
        message: 'Gemini API Key is not configured. Built-in client validation active.',
      });
    }

    const prompt = `You are a world-class SAP HANA SQL and SQLScript Database Architect.
Analyze the following SAP HANA SQL query for syntactical correctness, HANA-specific dialect compliance (e.g. COLUMN TABLE, UPSERT WITH PRIMARY KEY, MERGE INTO, SQLScript DO BEGIN...END;, proper SAP HANA data types like NVARCHAR, ALPHANUM, DECIMAL, SECONDDATE, and built-in functions like TO_NVARCHAR, MAP, IFNULL, SERIES_GENERATE, etc.).

Query Name: "${nodeName || 'SQL Node'}"
Query Category: "${queryType || 'Generic'}"

SQL Query:
\`\`\`sql
${sql}
\`\`\`

Provide a strict JSON response with this schema:
{
  "isValid": boolean,
  "summary": string,
  "hanaDialectScore": number (1 to 100),
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "line": number,
      "message": string,
      "rule": string,
      "suggestion": string
    }
  ],
  "performanceTips": string[],
  "inferredTargetTable": string | null,
  "inferredSourceTables": string[]
}

Return valid JSON only without markdown code blocks.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let resultJson;
    try {
      resultJson = JSON.parse(response.text || '{}');
    } catch {
      resultJson = { summary: response.text, isValid: true, issues: [] };
    }

    res.json({ available: true, ...resultJson });
  } catch (err: any) {
    console.error('Error in /api/ai/validate-sql:', err);
    res.status(500).json({ error: err.message || 'Failed to validate SQL with AI' });
  }
});

// AI Explain SAP HANA SQL Query
app.post('/api/ai/explain-sql', async (req, res) => {
  try {
    const { sql, queryType, nodeName } = req.body;
    const ai = getAIClient();
    if (!ai) {
      return res.json({
        available: false,
        explanation: 'Gemini API Key is not configured in settings. Local explanation available.',
      });
    }

    const prompt = `You are an SAP HANA Database Engineer. Explain clearly and concisely what this SAP HANA SQL query does, how data flows through it in the pipeline, and its in-memory execution characteristics (columnar scans, delta storage merges, partition pruning).

Node Name: "${nodeName || 'SQL Step'}"
Type: "${queryType || 'SQL'}"
SQL:
\`\`\`sql
${sql}
\`\`\`

Format your response as markdown with:
1. **Summary & Objective**: (What this query accomplishes in 2 sentences)
2. **Step-by-Step Operations**: (Numbered list explaining the transformation logic, joins, filters, or aggregations)
3. **SAP HANA Engine Insights**: (Columnar vs Row storage behavior, parallelism, memory usage considerations)
4. **Data Contract**: (Expected input tables and generated output)`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    res.json({ available: true, explanation: response.text });
  } catch (err: any) {
    console.error('Error in /api/ai/explain-sql:', err);
    res.status(500).json({ error: err.message || 'Failed to generate explanation' });
  }
});

// AI Optimize SAP HANA SQL Query
app.post('/api/ai/optimize-sql', async (req, res) => {
  try {
    const { sql, queryType, nodeName } = req.body;
    const ai = getAIClient();
    if (!ai) {
      return res.json({
        available: false,
        message: 'Gemini API Key is not configured.',
      });
    }

    const prompt = `You are an SAP HANA Performance Optimization Expert. Review and optimize the following SAP HANA SQL query for maximum in-memory speed, vector engine utilization, proper join order, filter pushdown, and columnar index efficiency.

Node: "${nodeName || 'SQL Query'}"
Original SQL:
\`\`\`sql
${sql}
\`\`\`

Return a JSON object with:
{
  "optimizedSql": string (the full formatted optimized SAP HANA SQL query),
  "improvements": string[] (list of specific optimizations made),
  "estimatedSpeedup": string (e.g., "15-30% faster columnar scan with partition pruning"),
  "explanation": string
}
Only valid JSON without markdown wrapping.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let resultJson;
    try {
      resultJson = JSON.parse(response.text || '{}');
    } catch {
      resultJson = { explanation: response.text };
    }

    res.json({ available: true, ...resultJson });
  } catch (err: any) {
    console.error('Error in /api/ai/optimize-sql:', err);
    res.status(500).json({ error: err.message || 'Failed to optimize SQL' });
  }
});

// Start Server with Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SAP HANA SQL Flow Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
