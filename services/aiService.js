

/**
 * CareBank AI Service — Node.js
 * Uses Hugging Face Inference API only.
 * Falls back to general financial advice if no CSV uploaded.
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { listUserCSVs, downloadCSV } = require('./csvStorage');

const router = express.Router();

// ============================================
// Configuration
// ============================================
// const HF_API_TOKEN  = process.env.HF_TOKEN || '';
// const HF_MODEL_NAME = 'meta-llama/Llama-3.2-3B-Instruct';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME     = 'gemini-2.5-flash-lite';

const BASE_DIR          = path.join(__dirname, '..');
const UPLOAD_CSV_FOLDER = path.join(BASE_DIR, 'uploadsCSVs');

// ============================================
// In-Memory CSV Cache  (TTL = 5 minutes)
// ============================================
const CSV_CACHE    = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================
// CSV Helpers
// ============================================
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = splitCSVLine(lines[0]);
    const rows    = [];

    for (let i = 1; i < lines.length; i++) {
        const values = splitCSVLine(lines[i]);
        if (values.length === 0) continue;
        const row = {};
        headers.forEach((h, idx) => {
            row[h.trim()] = (values[idx] || '').trim();
        });
        rows.push(row);
    }
    return rows;
}

function splitCSVLine(line) {
    const result = [];
    let current  = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

// ============================================
// Load CSV from MongoDB GridFS
// ============================================
async function loadUserCSVFiles(userId) {
    console.log(`📂 Loading CSV files from MongoDB for user: ${userId}`);

    const files = await listUserCSVs(userId);

    if (!files || files.length === 0) {
        throw new Error(`No CSV files found for user: ${userId}`);
    }

    const csvData = {};

    for (const file of files) {
        try {
            const content          = await downloadCSV(file.id);
            csvData[file.filename] = parseCSV(content);
            console.log(`   ✅ Loaded: ${file.filename} (${csvData[file.filename].length} rows)`);
        } catch (err) {
            console.warn(`   ⚠️ Could not read ${file.filename}: ${err.message}`);
        }
    }

    return csvData;
}

// ============================================
// CSV Cache
// ============================================
async function getCachedCSVData(userId) {
    const now   = Date.now();
    const entry = CSV_CACHE[userId];

    if (entry && (now - entry.timestamp) < CACHE_TTL_MS) {
        console.log(`📦 CACHE HIT — User: ${userId}`);
        return entry.data;
    }

    console.log(`🔄 CACHE MISS — Loading from MongoDB for user: ${userId}`);
    const data = await loadUserCSVFiles(userId);
    CSV_CACHE[userId] = { data, timestamp: now };
    return data;
}

function invalidateCache(userId = null) {
    if (userId) {
        delete CSV_CACHE[userId];
        console.log(`🗑️ Cache invalidated for user: ${userId}`);
    } else {
        Object.keys(CSV_CACHE).forEach(k => delete CSV_CACHE[k]);
        console.log(`🗑️ All cache invalidated`);
    }
}

// ============================================
// Context Builder
// ============================================
function buildContext(csvData, question = '') {
    const parts = [];
    const q     = question.toLowerCase();

    for (const [filename, rows] of Object.entries(csvData)) {
        if (rows.length === 0) continue;

        let totalSpend  = 0;
        let totalIncome = 0;

        for (const row of rows) {
            const amt  = parseFloat(row.amount) || 0;
            const type = (row.transaction_type || row.type || '').toLowerCase();
            if (type === 'debit')  totalSpend  += amt;
            if (type === 'credit') totalIncome += amt;
        }

        parts.push(`File: ${filename} (${rows.length} rows)`);
        if (totalSpend  > 0) parts.push(`  Total debit:  ₹${totalSpend.toFixed(2)}`);
        if (totalIncome > 0) parts.push(`  Total credit: ₹${totalIncome.toFixed(2)}`);

        const keywords = q.split(/\s+/).filter(w => w.length > 3);
        let sample     = rows;

        if (keywords.length > 0) {
            const filtered = rows.filter(row =>
                keywords.some(kw =>
                    Object.values(row).some(v => String(v).toLowerCase().includes(kw))
                )
            );
            sample = filtered.length > 0 ? filtered.slice(0, 10) : rows.slice(0, 5);
        } else {
            sample = rows.slice(0, 5);
        }

        if (sample.length > 0) {
            const headers = Object.keys(sample[0]);
            parts.push('  Sample rows:');
            parts.push('  ' + headers.join(' | '));
            for (const row of sample) {
                parts.push('  ' + headers.map(h => row[h] || '').join(' | '));
            }
        }
    }

    return parts.join('\n');
}

// ============================================
// Hugging Face API
// ============================================
async function queryGemini(prompt) {
    const start = Date.now();

    if (!GEMINI_API_KEY) {
        return {
            success:  false,
            response: 'Gemini API key not configured. Set GEMINI_API_KEY in your .env file.',
            error:    'missing_token',
            provider: 'gemini',
        };
    }

    console.log(`✨ [Gemini] Sending request to ${MODEL_NAME}`);
    console.log(`   📝 Prompt length: ${prompt.length} chars`);

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: {
                        parts: [{ text: 'You are a helpful financial data analyst. Answer based on the CSV data accurately and concisely.' }]
                    },
                    contents: [{
                        role: 'user',
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        maxOutputTokens: 512,
                        temperature:     0.1,
                    },
                }),
                signal: AbortSignal.timeout(30_000),
            }
        );

        const apiDurationMs = Date.now() - start;

        if (!res.ok) {
            const errText = await res.text();
            console.error(`❌ [Gemini] API Error ${res.status}: ${errText.slice(0, 200)}`);
            return {
                success:  false,
                response: `Gemini API error: ${res.status}`,
                error:    errText,
                provider: 'gemini',
            };
        }

        const result       = await res.json();
        const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

        console.log(`✅ [Gemini] Success — ${apiDurationMs}ms`);
        console.log(`   📥 Response preview: ${responseText.slice(0, 150)}...`);

        return {
            success:      true,
            response:     responseText,
            model:        MODEL_NAME,
            provider:     'gemini',
            apiDurationMs,
        };

    } catch (err) {
        const apiDurationMs = Date.now() - start;
        const isTimeout     = err.name === 'TimeoutError' || err.name === 'AbortError';
        console.error(`❌ [Gemini] ${isTimeout ? 'Timeout' : 'Exception'}: ${err.message}`);

        return {
            success:      false,
            response:     isTimeout
                ? 'Gemini API timeout. Please try again.'
                : `Gemini error: ${err.message}`,
            error:        err.message,
            provider:     'gemini',
            apiDurationMs,
        };
    }
}

// ============================================
// Main Query Orchestrator
// ============================================
async function queryAIWithCSV(userId, question) {
    console.log('='.repeat(60));
    console.log(`📨 NEW QUERY`);
    console.log(`👤 User: ${userId}`);
    console.log(`💬 Question: "${question}"`);
    console.log('='.repeat(60));

    const totalStart = Date.now();

    // Greeting shortcut — no CSV needed
    if (['hi', 'hello', 'hey'].includes(question.toLowerCase().trim())) {
        return {
            success:        true,
            response:       'Hello! Ask me about your spending, totals, or categories.',
            model:          MODEL_NAME,
            provider:       'greeting',
            userId,
            responseTimeMs: Date.now() - totalStart,
        };
    }

    // Default context — used when no CSV uploaded yet
    let context = 'No transaction data uploaded yet. Answer as a general financial advisor.';

    // Try loading CSV from MongoDB — don't crash if missing
    try {
        const csvData = await getCachedCSVData(userId);
        const built   = buildContext(csvData, question);
        if (built.trim()) {
            context = built;
            console.log(`🔍 Context built from CSV (${context.length} chars)`);
        }
    } catch (csvErr) {
        console.log(`⚠️ No CSV data for user ${userId} — using general mode`);
    }

    // Call HuggingFace
    try {
        const prompt  = `Based on this financial data:\n${context}\n\nAnswer concisely in English: ${question}`;
        const result  = await queryGemini(prompt);
        const totalMs = Date.now() - totalStart;

        console.log('='.repeat(60));
        console.log(`📤 RESPONSE SENT`);
        console.log(`🔧 Provider: ${result.provider?.toUpperCase()}`);
        console.log(`⏱️  Total: ${totalMs}ms | API: ${result.apiDurationMs || 0}ms`);
        console.log(`📝 Preview: "${(result.response || '').slice(0, 150)}"`);
        console.log('='.repeat(60));

        return {
            success:        result.success,
            response:       result.response,
            model:          result.model    || MODEL_NAME,
            provider:       result.provider || 'gemini',
            userId,
            responseTimeMs: totalMs,
            apiTimeMs:      result.apiDurationMs || 0,
        };

    } catch (err) {
        const totalMs = Date.now() - totalStart;
        console.error(`❌ ERROR — User: ${userId} | ${err.message}`);
        return {
            success:        false,
            response:       `Error: ${err.message}`,
            error:          err.message,
            responseTimeMs: totalMs,
        };
    }
}

// ============================================
// Routes
// ============================================

// POST /chat/transaction
router.post('/chat/transaction', async (req, res) => {
    const { user_id, question } = req.body || {};

    console.log(`🌐 POST /chat/transaction — User: ${user_id}`);

    if (!user_id || !question) {
        return res.status(400).json({
            success: false,
            message: 'user_id and question are required'
        });
    }

    const result = await queryAIWithCSV(user_id, question);
    return res.json(result);
});

// GET /user/csv_files?user_id=xxx
router.get('/user/csv_files', async (req, res) => {
    const { user_id } = req.query;

    console.log(`🌐 GET /user/csv_files — User: ${user_id}`);

    if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id is required' });
    }

    try {
        const files = await listUserCSVs(user_id);
        return res.json({ success: true, user_id, csv_files: files, total_files: files.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /health
router.get('/health', (_req, res) => {
    console.log(`🌐 GET /health`);
    return res.json({
        success:                true,
        status:                 'running',
        primary_model:          MODEL_NAME,
        primary_provider:       'gemini',
        gemini_configured:      Boolean(GEMINI_API_KEY),
        rag_available:          false,
        timestamp:              new Date().toISOString(),
    });
});

// POST /user/cache/invalidate
router.post('/user/cache/invalidate', (req, res) => {
    const userId = req.body?.user_id || null;
    invalidateCache(userId);
    return res.json({
        success: true,
        message: userId
            ? `Cache invalidated for user ${userId}`
            : 'All cache invalidated',
    });
});

// GET /provider/status
router.get('/provider/status', (_req, res) => {
    return res.json({
        success: true,
        primary: {
            name:       'gemini',
            model:      MODEL_NAME,
            configured: Boolean(GEMINI_API_KEY),
            available:  Boolean(GEMINI_API_KEY),
        },
    });
});

// ============================================
// Export router
// ============================================
module.exports = router;

// ============================================
// Standalone mode  (node aiService.js)
// ============================================
if (require.main === module) {
    const app  = express();
    const PORT = process.env.AI_PORT || 5000;

    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use('/', router);

    app.listen(PORT, '0.0.0.0', () => {
        console.log('\n' + '='.repeat(70));
        console.log('🚀 CareBank AI Service (Node.js)');
        console.log('='.repeat(70));
        console.log(`🤖 Model    : ${MODEL_NAME}`);
        console.log(`🔑 Token    : ${GEMINI_API_KEY ? '✅ Configured' : '❌ Missing — set GEMINI_API_KEY in .env'}`);
        console.log(`💻 Port     : ${PORT}`);
        console.log('='.repeat(70) + '\n');
    });
}