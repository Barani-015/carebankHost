/**
 * CareBank AI Service — Node.js
 * Uses NVIDIA DeepSeek V4 API only.
 * Falls back to general financial advice if no CSV uploaded.
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { listUserCSVs, downloadCSV } = require('./csvStorage');

// Import OpenAI using require (CommonJS compatible)
const OpenAI = require('openai');

const router = express.Router();

// ============================================
// Configuration
// ============================================
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const MODEL_NAME     = 'deepseek-ai/deepseek-v4-pro';

// Initialize OpenAI with NVIDIA configuration
const openai = new OpenAI({
  apiKey: NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

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
// DeepSeek V4 API (via NVIDIA)
// ============================================
async function queryDeepSeek(prompt) {
    const start = Date.now();

    // Check for NVIDIA API key
    if (!NVIDIA_API_KEY) {
        return {
            success:  false,
            response: 'NVIDIA API key not configured. Set NVIDIA_API_KEY in your .env file.',
            error:    'missing_token',
            provider: 'deepseek',
        };
    }

    console.log(`✨ [DeepSeek] Sending request to ${MODEL_NAME}`);
    console.log(`   📝 Prompt length: ${prompt.length} chars`);

    try {
        const completion = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                {
                    role: "system",
                    content: "You are a helpful financial data analyst. Answer based on the CSV data accurately and concisely."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.1,
            top_p: 0.95,
            max_tokens: 512,
            chat_template_kwargs: { thinking: false },
            stream: false
        });

        const apiDurationMs = Date.now() - start;
        const responseText = completion.choices[0]?.message?.content || '';

        console.log(`✅ [DeepSeek] Success — ${apiDurationMs}ms`);
        console.log(`   📥 Response preview: ${responseText.slice(0, 150)}...`);

        return {
            success: true,
            response: responseText,
            model: MODEL_NAME,
            provider: 'deepseek',
            apiDurationMs,
        };

    } catch (err) {
        const apiDurationMs = Date.now() - start;
        const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
        console.error(`❌ [DeepSeek] ${isTimeout ? 'Timeout' : 'Exception'}: ${err.message}`);

        return {
            success: false,
            response: isTimeout
                ? 'DeepSeek API timeout. Please try again.'
                : `DeepSeek error: ${err.message}`,
            error: err.message,
            provider: 'deepseek',
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

    // Call DeepSeek
    try {
        const prompt  = `Based on this financial data:\n${context}\n\nAnswer concisely in English: ${question}`;
        const result  = await queryDeepSeek(prompt);
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
            provider:       result.provider || 'deepseek',
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


// Add this after the existing routes
router.get('/analyze/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log(`🌐 GET /analyze/${userId}`);
    
    try {
        // Get user's transaction data
        const csvData = await getCachedCSVData(userId);
        
        // Analyze the data
        const analysis = {
            success: true,
            userId: userId,
            totalTransactions: 0,
            totalDebit: 0,
            totalCredit: 0,
            categoryBreakdown: {},
            monthlySpending: {},
            trends: {},
            message: 'Analysis complete'
        };
        
        // Process the CSV data
        for (const [filename, rows] of Object.entries(csvData)) {
            analysis.totalTransactions += rows.length;
            
            for (const row of rows) {
                const amount = parseFloat(row.amount) || 0;
                const type = (row.transaction_type || row.type || '').toLowerCase();
                
                if (type === 'debit') {
                    analysis.totalDebit += amount;
                } else if (type === 'credit') {
                    analysis.totalCredit += amount;
                }
                
                // Category breakdown
                const category = row.category || 'Uncategorized';
                analysis.categoryBreakdown[category] = (analysis.categoryBreakdown[category] || 0) + amount;
            }
        }
        
        analysis.netBalance = analysis.totalCredit - analysis.totalDebit;
        
        return res.json(analysis);
        
    } catch (error) {
        console.error(`❌ Error analyzing user ${userId}:`, error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to analyze transactions'
        });
    }
});


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
        primary_provider:       'nvidia-deepseek',
        nvidia_configured:      Boolean(NVIDIA_API_KEY),
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
            name:       'nvidia-deepseek',
            model:      MODEL_NAME,
            configured: Boolean(NVIDIA_API_KEY),
            available:  Boolean(NVIDIA_API_KEY),
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
        console.log(`🔑 NVIDIA Key: ${NVIDIA_API_KEY ? '✅ Configured' : '❌ Missing — set NVIDIA_API_KEY in .env'}`);
        console.log(`💻 Port     : ${PORT}`);
        console.log('='.repeat(70) + '\n');
    });
}