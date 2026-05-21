const express = require('express');
const path = require('path');
require('dotenv').config();
const fs = require('fs');
const json2csv = require('json2csv').parse;
const User = require('./models/User');

// Import configurations - NOTE: Use object destructuring
const { connectDB, initializeDatabase } = require('./config/database');

// Import middleware
const { corsMiddleware } = require('./middleware/cors');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const couponRoutes = require('./routes/couponRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const aiRoutes = require('./routes/aiRoutes');
const fileRoutes = require('./routes/fileRoutes');

const app = express();

// ========== GLOBAL VARIABLES ==========
const UPLOADS_CSV_DIR = 'uploadsCSVs'; // Global directory name
const BASE_UPLOAD_DIR = path.join(__dirname, UPLOADS_CSV_DIR);

// Ensure base upload directory exists
if (!fs.existsSync(BASE_UPLOAD_DIR)) {
    fs.mkdirSync(BASE_UPLOAD_DIR, { recursive: true });
    console.log(`📁 Created base upload directory: ${UPLOADS_CSV_DIR}`);
}

// Helper function to get user directory
function getUserUploadDirectory(userIdentifier) {
    if (!userIdentifier) {
        userIdentifier = 'unknown_user';
    }
    
    // Sanitize the identifier to create a valid folder name
    const folderName = userIdentifier.toString().replace(/[^a-zA-Z0-9@._-]/g, '_');
    const userFolder = path.join(BASE_UPLOAD_DIR, folderName);
    
    // Ensure user folder exists
    if (!fs.existsSync(userFolder)) {
        fs.mkdirSync(userFolder, { recursive: true });
    }
    
    return userFolder;
}

// Helper function to convert to CSV
function convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of data) {
        const values = headers.map(header => {
            const value = row[header] || '';
            const escaped = String(value).replace(/"/g, '""');
            return escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') 
                ? `"${escaped}"` 
                : escaped;
        });
        csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
}

// ========== MIDDLEWARE ==========
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger);
app.use(express.static(path.join(__dirname, 'public')));

// ========== ROUTES ==========
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api', transactionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/files', fileRoutes);

// Health check
app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'Server is running!', timestamp: new Date().toISOString() });
});

// Test endpoint to check Python service connection
app.get('/api/ai/test-python', async (req, res) => {
    try {
        const axios = require('axios');
        const response = await axios.get('http://localhost:5000/health');
        res.json({ success: true, pythonService: response.data });
    } catch (error) {
        res.json({ success: false, error: 'Python service not running on port 5000' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        mongodb: 'connected', 
        csv_directory: UPLOADS_CSV_DIR,
        csv_path: BASE_UPLOAD_DIR,
        timestamp: new Date().toISOString()
    });
});

// ============================================
// DEVICE REGISTRATION ENDPOINT
// ============================================
app.post('/api/devices/register', async (req, res) => {
    try {
        console.log('\n📱 Device registration request received');
        console.log('📦 Request body:', req.body);
        
        const { email, uuid, device_id, device_name } = req.body;
        
        // Try to get user info from JWT token if available (optional)
        let userIdFromToken = null;
        let userEmailFromToken = null;
        
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.decode(token);
                userIdFromToken = decoded?.id || decoded?.userId || decoded?._id || decoded?.sub;
                userEmailFromToken = decoded?.email || decoded?.userEmail;
                console.log(`   🔑 Token user ID: ${userIdFromToken}`);
                console.log(`   🔑 Token email: ${userEmailFromToken}`);
            } catch(err) {
                console.log(`   ⚠️ Token decode error: ${err.message}`);
            }
        }
        
        // Determine final email (priority: token > body)
        const finalEmail = userEmailFromToken || email;
        const finalUuid = userIdFromToken || uuid;
        
        if (!finalEmail && !finalUuid) {
            return res.status(400).json({
                success: false,
                message: 'Either email or UUID is required'
            });
        }
        
        console.log(`   📧 Final email: ${finalEmail}`);
        console.log(`   🆔 Final UUID: ${finalUuid}`);
        
        // Get user identifier
        const userIdentifier = finalUuid || finalEmail;
        
        // Create user-specific folder using helper
        const userFolder = getUserUploadDirectory(userIdentifier);
        const folderName = path.basename(userFolder);
        
        // Store device registration in a JSON file
        const devicesFile = path.join(BASE_UPLOAD_DIR, 'registered_devices.json');
        let devices = {};
        
        if (fs.existsSync(devicesFile)) {
            try {
                const devicesData = fs.readFileSync(devicesFile, 'utf8');
                devices = JSON.parse(devicesData);
            } catch(e) {
                console.log('⚠️ Could not parse devices file, creating new');
            }
        }
        
        // Update or add device
        const deviceKey = userIdentifier;
        devices[deviceKey] = {
            email: finalEmail,
            uuid: finalUuid,
            device_id: device_id || 'web_browser',
            device_name: device_name || 'Web Browser',
            folder_name: folderName,
            last_registered: new Date().toISOString(),
            registration_count: (devices[deviceKey]?.registration_count || 0) + 1
        };
        
        fs.writeFileSync(devicesFile, JSON.stringify(devices, null, 2));
        console.log(`✅ Device registered: ${deviceKey}`);
        
        res.json({
            success: true,
            message: 'Device registered successfully',
            device: {
                email: finalEmail,
                uuid: finalUuid,
                folder_name: folderName
            }
        });
        
    } catch (error) {
        console.error('❌ Device registration error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================
// SMS BATCH ENDPOINT
// ============================================
app.post('/api/sms/batch', async (req, res) => {
    try {
        console.log('\n📨 Received SMS batch request');
        console.log('📦 Request body keys:', Object.keys(req.body));

        const { user_email, user_uuid, messages, device_id } = req.body;
        
        console.log(`Received SMS for user: ${user_email}`);
        console.log(`UUID: ${user_uuid}`);
        console.log(`Messages: ${messages?.length || 0}`);
        
        // Try to get user info from JWT token if available
        let userIdFromToken = null;
        let userEmailFromToken = null;
        
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.decode(token);
                userIdFromToken = decoded?.id || decoded?.userId || decoded?._id || decoded?.sub;
                userEmailFromToken = decoded?.email || decoded?.userEmail;
                console.log(`   🔑 Token user ID: ${userIdFromToken}`);
                console.log(`   🔑 Token email: ${userEmailFromToken}`);
            } catch(err) {
                console.log(`   ⚠️ Token decode error: ${err.message}`);
            }
        }
        
        // Determine final user info (priority: token > body)
        const finalUserEmail = userEmailFromToken || user_email;
        const finalUserUuid = userIdFromToken || user_uuid;
        
        if (!messages || messages.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No messages in batch'
            });
        }
        
        // Get user identifier
        const userIdentifier = finalUserUuid || finalUserEmail;
        
        if (!userIdentifier) {
            return res.status(400).json({
                success: false,
                message: 'User identification required (email or UUID)'
            });
        }
        
        // Get user-specific folder using helper
        const userFolder = getUserUploadDirectory(userIdentifier);
        const folderName = path.basename(userFolder);
        
        console.log(`\n📊 PROCESSING SUMMARY:`);
        console.log(`   📧 User email: ${finalUserEmail || 'NOT PROVIDED'}`);
        console.log(`   🆔 User UUID: ${finalUserUuid || 'NOT PROVIDED'}`);
        console.log(`   📁 Folder name: ${folderName}`);
        console.log(`   📨 Total messages: ${messages.length}`);
        
        // Filter financial messages
        const financialMessages = [];
        
        for (const msg of messages) {
            const messageText = msg.message || msg.body || '';
            
            if (isDebitOrCredit(messageText)) {
                const amount = extractAmount(messageText);
                const type = getTransactionType(messageText);
                
                financialMessages.push({
                    sender: msg.sender || msg.address || 'Unknown',
                    message: messageText.substring(0, 500),
                    timestamp: msg.timestamp_readable || new Date(msg.timestamp || Date.now()).toISOString(),
                    device_id: msg.device_id || device_id || 'unknown',
                    raw_timestamp: msg.timestamp || Date.now(),
                    amount: amount,
                    transaction_type: type,
                    merchant: extractMerchant(messageText),
                    category: categorizeTransaction(messageText),
                    user_id: userIdentifier,
                    user_email: finalUserEmail || 'unknown'
                });
            }
        }
        
        console.log(`   ✅ Financial transactions: ${financialMessages.length}`);
        console.log(`   ⏭️  Ignored messages: ${messages.length - financialMessages.length}`);
        
        if (financialMessages.length === 0) {
            return res.json({
                success: true,
                message: 'No financial transactions found in SMS',
                total_received: messages.length,
                financial_count: 0,
                csv_saved: false,
                email_received: finalUserEmail,
                uuid_found: finalUserUuid
            });
        }
        
        // Save CSV file
        const date = new Date();
        const timestamp_str = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}_${String(date.getHours()).padStart(2,'0')}-${String(date.getMinutes()).padStart(2,'0')}-${String(date.getSeconds()).padStart(2,'0')}`;
        
        const csvFileName = `transactions_${timestamp_str}.csv`;
        const csvPath = path.join(userFolder, csvFileName);
        
        // Convert to CSV
        const csvData = financialMessages.map(msg => ({
            timestamp: msg.timestamp,
            sender: msg.sender,
            transaction_type: msg.transaction_type,
            amount: msg.amount || 'N/A',
            merchant: msg.merchant,
            category: msg.category,
            user_email: msg.user_email,
            user_uuid: msg.user_id,
            message: msg.message.substring(0, 100)
        }));
        
        const csv = convertToCSV(csvData);
        fs.writeFileSync(csvPath, csv, 'utf8');
        
        const fileSizeKB = (fs.statSync(csvPath).size / 1024).toFixed(2);
        
        // Calculate statistics
        const totalDebit = financialMessages
            .filter(m => m.transaction_type === 'debit')
            .reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);
        
        const totalCredit = financialMessages
            .filter(m => m.transaction_type === 'credit')
            .reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);
        
        console.log(`\n✅ CSV SAVED SUCCESSFULLY!`);
        console.log(`   📁 Location: ${UPLOADS_CSV_DIR}/${folderName}/${csvFileName}`);
        console.log(`   💾 Size: ${fileSizeKB} KB`);
        
        res.json({
            success: true,
            message: `Successfully processed ${financialMessages.length} financial transactions`,
            email_received: finalUserEmail,
            user_uuid: finalUserUuid,
            folder_name: folderName,
            total_received: messages.length,
            financial_count: financialMessages.length,
            ignored_count: messages.length - financialMessages.length,
            csv_saved: true,
            csv_file: csvFileName,
            csv_size_kb: fileSizeKB,
            statistics: {
                total_debit: totalDebit,
                total_credit: totalCredit,
                net_balance: totalCredit - totalDebit,
                debit_count: financialMessages.filter(m => m.transaction_type === 'debit').length,
                credit_count: financialMessages.filter(m => m.transaction_type === 'credit').length
            }
        });
        
    } catch (error) {
        console.error('❌ Error processing SMS batch:', error);
        res.status(500).json({
            success: false,
            message: error.message,
            error: error.toString()
        });
    }
});

// ============================================
// LIST USER FILES ENDPOINT
// ============================================
app.get('/api/sms/user-files', async (req, res) => {
    try {
        // Get user ID from token
        const authHeader = req.headers.authorization;
        let userId = null;
        let userEmail = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
                userId = decoded.id || decoded.userId || decoded._id;
                userEmail = decoded.email;
            } catch (err) {
                return res.status(401).json({ success: false, message: 'Invalid token' });
            }
        }
        
        // Also allow query param for testing
        const { user_identifier } = req.query;
        const userIdentifier = userId || userEmail || user_identifier;
        
        if (!userIdentifier) {
            return res.status(400).json({ 
                success: false, 
                message: 'User identifier required. Provide auth token or user_identifier query param' 
            });
        }
        
        const userFolder = getUserUploadDirectory(userIdentifier);
        
        if (!fs.existsSync(userFolder)) {
            return res.json({
                success: true,
                user_identifier: userIdentifier,
                directory: UPLOADS_CSV_DIR,
                files: [],
                message: 'No files found for this user'
            });
        }
        
        const files = fs.readdirSync(userFolder)
            .filter(f => f.endsWith('.csv') || f.endsWith('.json'))
            .map(f => {
                const filePath = path.join(userFolder, f);
                const stats = fs.statSync(filePath);
                return {
                    name: f,
                    type: f.endsWith('.csv') ? 'csv' : 'json',
                    size_kb: (stats.size / 1024).toFixed(2),
                    created: stats.birthtime,
                    modified: stats.mtime,
                    path: `${UPLOADS_CSV_DIR}/${path.basename(userFolder)}/${f}`
                };
            })
            .sort((a, b) => b.created - a.created);
        
        res.json({
            success: true,
            user_identifier: userIdentifier,
            directory: UPLOADS_CSV_DIR,
            folder_name: path.basename(userFolder),
            file_count: files.length,
            files: files
        });
        
    } catch (error) {
        console.error('Error listing user files:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// DOWNLOAD USER FILE ENDPOINT
// ============================================
app.get('/api/sms/download/:userIdentifier/:filename', async (req, res) => {
    try {
        const { userIdentifier, filename } = req.params;
        
        // Security: Validate filename to prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ success: false, message: 'Invalid filename' });
        }
        
        // Verify user has access (optional: check token)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
                const tokenUserId = decoded.id || decoded.userId || decoded._id;
                if (tokenUserId && tokenUserId !== userIdentifier) {
                    // Log warning but still allow if userIdentifier matches token
                    console.log(`⚠️ User ${tokenUserId} accessing ${userIdentifier}'s files`);
                }
            } catch (err) {
                // Token invalid but still allow download for now
                console.log('Token verification failed but proceeding with download');
            }
        }
        
        const userFolder = getUserUploadDirectory(userIdentifier);
        const filePath = path.join(userFolder, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'File not found' });
        }
        
        // Set proper headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        res.download(filePath, filename);
        
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// DELETE OLD FILES ENDPOINT
// ============================================
app.delete('/api/sms/clear-old', async (req, res) => {
    try {
        const { days = 1, user_identifier } = req.query;
        const daysToKeep = parseInt(days);
        const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        
        let deletedCount = 0;
        let deletedFiles = [];
        
        if (user_identifier) {
            // Clear files for specific user only
            const userFolder = getUserUploadDirectory(user_identifier);
            if (fs.existsSync(userFolder)) {
                const files = fs.readdirSync(userFolder);
                for (const file of files) {
                    const filePath = path.join(userFolder, file);
                    const stats = fs.statSync(filePath);
                    if (stats.birthtimeMs < cutoffTime) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                        deletedFiles.push(file);
                        console.log(`🗑️ Deleted old file: ${user_identifier}/${file}`);
                    }
                }
            }
        } else {
            // Clear files for all users
            const userFolders = fs.readdirSync(BASE_UPLOAD_DIR);
            
            for (const folder of userFolders) {
                // Skip the registered_devices.json file
                if (folder === 'registered_devices.json') continue;
                
                const folderPath = path.join(BASE_UPLOAD_DIR, folder);
                if (fs.statSync(folderPath).isDirectory()) {
                    const files = fs.readdirSync(folderPath);
                    for (const file of files) {
                        const filePath = path.join(folderPath, file);
                        const stats = fs.statSync(filePath);
                        if (stats.birthtimeMs < cutoffTime) {
                            fs.unlinkSync(filePath);
                            deletedCount++;
                            deletedFiles.push(`${folder}/${file}`);
                            console.log(`🗑️ Deleted old file: ${folder}/${file}`);
                        }
                    }
                }
            }
        }
        
        res.json({
            success: true,
            message: `Deleted ${deletedCount} old CSV files (older than ${daysToKeep} day(s))`,
            deleted_count: deletedCount,
            deleted_files: deletedFiles,
            days_kept: daysToKeep
        });
        
    } catch (error) {
        console.error('Error clearing old files:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// HELPER FUNCTIONS FOR SMS FILTERING
// ============================================

function isDebitOrCredit(messageText) {
    const text = (messageText || '').toLowerCase();
    
    const debitKeywords = [
        'debited', 'spent', 'paid', 'purchase', 'withdrawn', 
        'transfer to', 'payment to', 'bought', 'ordered', 
        'swiggy', 'zomato', 'amazon', 'flipkart', 'uber', 'ola',
        'electricity bill', 'water bill', 'recharge', 'subscription'
    ];
    
    const creditKeywords = [
        'credited', 'received', 'salary', 'deposit', 'refund',
        'cashback', 'interest', 'transfer from', 'payment from',
        'upi credit', 'money received'
    ];
    
    const amountPattern = /(?:rs\.?|inr|₹)\s*([\d,]+\.?\d*)/i;
    const hasAmount = amountPattern.test(text);
    
    const isDebit = debitKeywords.some(keyword => text.includes(keyword));
    const isCredit = creditKeywords.some(keyword => text.includes(keyword));
    
    return hasAmount && (isDebit || isCredit);
}

function extractAmount(messageText) {
    const patterns = [
        /(?:rs\.?|inr|₹)\s*([\d,]+\.?\d*)/i,
        /(?:amount|amt)\s*:?\s*([\d,]+\.?\d*)/i,
        /([\d,]+\.?\d*)\s*(?:rs\.?|inr|₹)/i
    ];
    
    for (const pattern of patterns) {
        const match = messageText.match(pattern);
        if (match) {
            return parseFloat(match[1].replace(/,/g, ''));
        }
    }
    return null;
}

function getTransactionType(messageText) {
    const text = messageText.toLowerCase();
    
    if (text.includes('credited') || text.includes('received') || 
        text.includes('salary') || text.includes('deposit') ||
        text.includes('refund') || text.includes('cashback')) {
        return 'credit';
    }
    
    if (text.includes('debited') || text.includes('spent') || 
        text.includes('paid') || text.includes('purchase') ||
        text.includes('withdrawn') || text.includes('transfer to')) {
        return 'debit';
    }
    
    return text.includes('received') ? 'credit' : 'debit';
}

function extractMerchant(messageText) {
    const text = messageText.toLowerCase();
    const merchants = {
        'swiggy': 'Swiggy', 'zomato': 'Zomato',
        'amazon': 'Amazon', 'flipkart': 'Flipkart',
        'uber': 'Uber', 'ola': 'Ola',
        'netflix': 'Netflix', 'prime': 'Amazon Prime',
        'paytm': 'Paytm', 'phonepe': 'PhonePe',
        'google pay': 'Google Pay', 'electricity': 'Electricity Bill',
        'water': 'Water Bill', 'gas': 'Gas Bill'
    };
    
    for (const [key, name] of Object.entries(merchants)) {
        if (text.includes(key)) return name;
    }
    return 'Other';
}

function categorizeTransaction(messageText) {
    const text = messageText.toLowerCase();
    
    if (text.includes('swiggy') || text.includes('zomato') || text.includes('restaurant')) 
        return 'Food & Dining';
    if (text.includes('amazon') || text.includes('flipkart') || text.includes('myntra')) 
        return 'Shopping';
    if (text.includes('uber') || text.includes('ola') || text.includes('metro')) 
        return 'Transport';
    if (text.includes('netflix') || text.includes('prime') || text.includes('hotstar')) 
        return 'Entertainment';
    if (text.includes('electricity') || text.includes('water') || text.includes('gas')) 
        return 'Utilities';
    if (text.includes('salary') || text.includes('income')) 
        return 'Income';
    if (text.includes('refund') || text.includes('cashback')) 
        return 'Refund';
    
    return 'Other';
}

// Error handling middleware (should be last)
app.use(errorHandler);

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Connect to database and start server
connectDB().then(async () => {
    await initializeDatabase();
    
    // Get local network IP addresses
    const networkInterfaces = require('os').networkInterfaces();
    const localIPs = [];
    
    for (const interfaceName in networkInterfaces) {
        for (const iface of networkInterfaces[interfaceName]) {
            if (!iface.internal && iface.family === 'IPv4') {
                localIPs.push(iface.address);
            }
        }
    }
    
    app.listen(PORT, HOST, () => {
        console.log("\n" + "=".repeat(100));
        console.log("🚀 SERVER STARTED SUCCESSFULLY");
        console.log("=".repeat(100));
        console.log(`\n📁 Upload Directory: ${UPLOADS_CSV_DIR}`);
        console.log(`📂 Full Path: ${BASE_UPLOAD_DIR}`);
        console.log(`\n🌐 Server running on:`);
        console.log(`   📍 Local:    http://localhost:${PORT}`);
        console.log(`   📍 Local:    http://127.0.0.1:${PORT}`);
        
        if (localIPs.length > 0) {
            localIPs.forEach(ip => {
                console.log(`   📍 Network:  http://${ip}:${PORT}`);
            });
        }
        
        console.log(`\n📡 Available Endpoints:`);
        console.log(`   Health:     http://localhost:${PORT}/health`);
        console.log(`   Test:       http://localhost:${PORT}/api/test`);
        console.log(`   Device Reg: POST http://localhost:${PORT}/api/devices/register`);
        console.log(`   SMS Batch:  POST http://localhost:${PORT}/api/sms/batch`);
        console.log(`   List Files: GET  http://localhost:${PORT}/api/sms/user-files`);
        console.log(`   Download:   GET  http://localhost:${PORT}/api/sms/download/:userId/:filename`);
        console.log(`\n🔐 Auth Endpoints:`);
        console.log(`   Login:      POST http://localhost:${PORT}/api/auth/login`);
        console.log(`   Coupons:    POST http://localhost:${PORT}/api/coupons/validate`);
        console.log(`   List Coups: GET  http://localhost:${PORT}/api/coupons/list`);
        console.log("\n" + "=".repeat(100));
    });
}).catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});