/**
 * CareBank AI Service — Node.js port of the Python Flask AI service
 * Endpoints mirror the original Python service exactly.
 * Uses Hugging Face Inference API only (Ollama/offline fallback removed).
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();   // ← use as a router inside your main app
// OR run standalone:  const app = express(); app.use(router); app.listen(5000);

// ============================================
// Configuration
// ============================================
const HF_API_TOKEN  = process.env.HF_TOKEN || '';
const HF_MODEL_NAME = 'meta-llama/Llama-3.2-3B-Instruct';

const BASE_DIR          = path.join(__dirname);
const UPLOAD_CSV_FOLDER = path.join(BASE_DIR, 'uploadsCSVs');

// ============================================
// In-Memory CSV Cache  (TTL = 5 minutes)
// ============================================
const CSV_CACHE     = {};   // { userId: { data, timestamp } }
const CACHE_TTL_MS  = 5 * 60 * 1000;

// ============================================
// Helpers
// ============================================

/**
 * Parse a CSV string into an array of row objects.
 * Handles quoted fields and commas inside quotes.
 */
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = splitCSVLine(lines[0]);
    const rows = [];

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
    let current = '';
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

/**
 * Load all CSV files for a user and return { filename: rows[] }.
 * Throws if the user folder does not exist.
 */
function loadUserCSVFiles(userId) {
    const userFolder = path.join(UPLOAD_CSV_FOLDER, String(userId));

    if (!fs.existsSync(userFolder)) {
        const available = fs.existsSync(UPLOAD_CSV_FOLDER)
            ? fs.readdirSync(UPLOAD_CSV_FOLDER).filter(f =>
                fs.statSync(path.join(UPLOAD_CSV_FOLDER, f)).isDirectory())
            : [];
        throw new Error(`User folder "${userId}" not found. Available: [${available.join(', ')}]`);
    }

    const csvData = {};
    const files   = fs.readdirSync(userFolder).filter(f => f.endsWith('.csv'));

    console.log(`📂 Found ${files.length} CSV files for user: ${userId}`);

    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(userFolder, file), 'utf8');
            csvData[file]  = parseCSV(content);
            console.log(`   ✅ Loaded: ${file} (${csvData[file].length} rows)`);
        } catch (err) {
            console.warn(`   ⚠️ Could not read ${file}: ${err.message}`);
        }
    }

    return csvData;
}

/**
 * Return cached CSV data, or load fresh if stale/missing.
 */
function getCachedCSVData(userId) {
    const now   = Date.now();
    const entry = CSV_CACHE[userId];

    if (entry && (now - entry.timestamp) < CACHE_TTL_MS) {
        console.log(`📦 CACHE HIT — User: ${userId}`);
        return entry.data;
    }

    console.log(`🔄 CACHE MISS — Loading fresh data for user: ${userId}`);
    const data = loadUserCSVFiles(userId);
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
// Context Builder  (lightweight, no RAG deps)
// ============================================

/**
 * Build a text summary of the user's CSV data to pass as context to the LLM.
 * Keeps things short to stay within the model's token limit.
 */
function buildContext(csvData, question = '') {
    const parts = [];
    const q     = question.toLowerCase();

    for (const [filename, rows] of Object.entries(csvData)) {
        if (rows.length === 0) continue;

        // --- summary line ---
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

        // --- sample rows (relevance-filtered) ---
        const keywords = q.split(/\s+/).filter(w => w.length > 3);
        let sample = rows;

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

        const headers = Object.keys(sample[0]);
        parts.push('  Sample rows:');
        parts.push('  ' + headers.join(' | '));
        for (const row of sample) {
            parts.push('  ' + headers.map(h => row[h] || '').join(' | '));
        }
    }

    return parts.join('\n');
}

// ============================================
// Hugging Face API
// ============================================

/**
 * Call the HF Inference API with a formatted Llama-3.2 prompt.
 * Returns { success, response, model, provider, apiDurationMs }
 */
async function queryHuggingFace(prompt) {
    const start = Date.now();

    if (!HF_API_TOKEN) {
        return {
            success:  false,
            response: 'Hugging Face API token not configured. Set HF_TOKEN in your .env file.',
            error:    'missing_token',
            provider: 'huggingface',
        };
    }

    // Llama-3.2 chat format
    const formattedPrompt =
        `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n` +
        `You are a helpful financial data analyst. Answer based on the CSV data accurately and concisely.` +
        `<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n` +
        `${prompt}` +
        `<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;

    const payload = {
        inputs: formattedPrompt,
        parameters: {
            max_new_tokens:   512,
            temperature:      0.1,
            top_p:            0.95,
            do_sample:        true,
            return_full_text: false,
        },
    };

    console.log(`🤗 [HuggingFace] Sending request to ${HF_MODEL_NAME}`);
    console.log(`   📝 Prompt length: ${prompt.length} chars`);

    try {
        const res = await fetch(
            `https://api-inference.huggingface.co/models/${HF_MODEL_NAME}`,
            {
                method:  'POST',
                headers: {
                    Authorization:  `Bearer ${HF_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body:    JSON.stringify(payload),
                signal:  AbortSignal.timeout(60_000),   // 60-second timeout
            }
        );

        const apiDurationMs = Date.now() - start;

        if (!res.ok) {
            const errText = await res.text();
            console.error(`❌ [HuggingFace] API Error ${res.status}: ${errText.slice(0, 200)}`);
            return {
                success:  false,
                response: `Hugging Face API error: ${res.status}`,
                error:    errText,
                provider: 'huggingface',
            };
        }

        const result = await res.json();

        let responseText = '';
        if (Array.isArray(result) && result.length > 0) {
            responseText = result[0].generated_text || '';
        } else if (result && typeof result === 'object') {
            responseText = result.generated_text || '';
        } else {
            responseText = String(result);
        }

        console.log(`✅ [HuggingFace] Success — ${apiDurationMs}ms`);
        console.log(`   📥 Response preview: ${responseText.slice(0, 150)}...`);

        return {
            success:      true,
            response:     responseText,
            model:        HF_MODEL_NAME,
            provider:     'huggingface',
            apiDurationMs,
        };

    } catch (err) {
        const apiDurationMs = Date.now() - start;
        const isTimeout     = err.name === 'TimeoutError' || err.name === 'AbortError';
        console.error(`❌ [HuggingFace] ${isTimeout ? 'Timeout' : 'Exception'}: ${err.message}`);

        return {
            success:      false,
            response:     isTimeout ? 'Hugging Face API timeout (60 s)' : `Hugging Face error: ${err.message}`,
            error:        err.message,
            provider:     'huggingface',
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

    // Simple greeting shortcut
    if (['hi', 'hello', 'hey'].includes(question.toLowerCase().trim())) {
        return {
            success:        true,
            response:       'Hello! Ask me about your spending, totals, or categories.',
            model:          HF_MODEL_NAME,
            provider:       'greeting',
            userId,
            responseTimeMs: Date.now() - totalStart,
        };
    }

    try {
        // 1. Load (cached) CSV data
        const csvData = getCachedCSVData(userId);

        // 2. Build context
        const context = buildContext(csvData, question);
        console.log(`🔍 Context built (${context.length} chars)`);

        // 3. Construct prompt
        const prompt = `Based on this financial data:\n${context}\n\nAnswer concisely in English: ${question}`;

        // 4. Call Hugging Face
        const result = await queryHuggingFace(prompt);

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
            model:          result.model   || HF_MODEL_NAME,
            provider:       result.provider || 'huggingface',
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
// Routes  (same paths as the Python service)
// ============================================

/**
 * POST /chat/transaction
 * Body: { user_id, question }
 */
router.post('/chat/transaction', async (req, res) => {
    const { user_id, question } = req.body || {};

    console.log(`🌐 POST /chat/transaction — User: ${user_id}`);

    if (!user_id || !question) {
        return res.status(400).json({ success: false, message: 'user_id and question are required' });
    }

    const result = await queryAIWithCSV(user_id, question);
    return res.json(result);
});

/**
 * GET /user/csv_files?user_id=xxx
 */
router.get('/user/csv_files', (req, res) => {
    const { user_id } = req.query;

    console.log(`🌐 GET /user/csv_files — User: ${user_id}`);

    if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id is required' });
    }

    const userFolder = path.join(UPLOAD_CSV_FOLDER, String(user_id));

    if (!fs.existsSync(userFolder)) {
        return res.status(404).json({ success: false, message: `User "${user_id}" not found` });
    }

    const files = fs.readdirSync(userFolder)
        .filter(f => f.endsWith('.csv'))
        .map(f => {
            const stat = fs.statSync(path.join(userFolder, f));
            return { filename: f, size_kb: +(stat.size / 1024).toFixed(2) };
        });

    return res.json({ success: true, user_id, csv_files: files, total_files: files.length });
});

/**
 * GET /health
 */
router.get('/health', (_req, res) => {
    console.log(`🌐 GET /health`);
    return res.json({
        success:               true,
        status:                'running',
        primary_model:         HF_MODEL_NAME,
        primary_provider:      'huggingface',
        huggingface_configured: Boolean(HF_API_TOKEN),
        rag_available:         false,   // RAG removed (no Python deps)
        timestamp:             new Date().toISOString(),
    });
});

/**
 * POST /user/cache/invalidate
 * Body: { user_id? }  — omit to clear all
 */
router.post('/user/cache/invalidate', (req, res) => {
    const userId = req.body?.user_id || null;
    invalidateCache(userId);
    return res.json({
        success: true,
        message: userId ? `Cache invalidated for user ${userId}` : 'All cache invalidated',
    });
});

/**
 * GET /provider/status
 */
router.get('/provider/status', (_req, res) => {
    return res.json({
        success: true,
        primary: {
            name:       'huggingface',
            model:      HF_MODEL_NAME,
            configured: Boolean(HF_API_TOKEN),
            available:  Boolean(HF_API_TOKEN),
        },
    });
});

// ============================================
// Export (used as a router in server.js)
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

    fs.mkdirSync(UPLOAD_CSV_FOLDER, { recursive: true });

    app.listen(PORT, '0.0.0.0', () => {
        console.log('\n' + '='.repeat(70));
        console.log('🚀 CareBank AI Service (Node.js) Starting');
        console.log('='.repeat(70));
        console.log(`📂 CSV Folder : ${UPLOAD_CSV_FOLDER}`);
        console.log(`\n🤖 AI Configuration:`);
        console.log(`   Provider : Hugging Face`);
        console.log(`   Model    : ${HF_MODEL_NAME}`);
        console.log(`   Token    : ${HF_API_TOKEN ? '✅ Configured' : '❌ Missing — set HF_TOKEN in .env'}`);
        console.log(`\n📋 Endpoints:`);
        console.log(`   POST /chat/transaction       — Chat with CSV data`);
        console.log(`   GET  /user/csv_files         — List user CSV files`);
        console.log(`   GET  /health                 — Health check`);
        console.log(`   POST /user/cache/invalidate  — Clear cache`);
        console.log(`   GET  /provider/status        — Provider status`);
        console.log(`\n💻 Listening on http://0.0.0.0:${PORT}`);
        console.log('='.repeat(70) + '\n');
    });
}