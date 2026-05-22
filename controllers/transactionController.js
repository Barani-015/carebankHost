const Transaction = require('../models/Transaction');
const { getAllUserTransactionsFromGridFS, readCSVFile, parseCSVContent } = require('../services/gridfsService');

const getTransactions = async (req, res) => {
    try {
        const { limit = 100, offset = 0, includeFromGridFS = true } = req.query;
        
        // Get from MongoDB transactions collection first
        let transactions = await Transaction.find({ userId: req.user._id })
            .sort({ date: -1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit))
            .populate('fileId', 'originalName uploadDate');
        
        // If requested, also get from GridFS CSV files
        if (includeFromGridFS === 'true') {
            const gridFSTransactions = await getAllUserTransactionsFromGridFS(req.user._id);
            
            // Convert GridFS transactions to match your schema
            const formattedGridFSTransactions = gridFSTransactions.map(tx => ({
                userId: req.user._id,
                name: tx.merchant || tx.Description || 'Transaction',
                amount: parseFloat(tx.amount) || 0,
                date: tx.timestamp || tx.Date || new Date().toLocaleDateString(),
                category: tx.category || 'Other',
                type: tx.transaction_type === 'credit' ? 'credit' : 'debit',
                status: 'success',
                source: 'gridfs'
            }));
            
            // Merge and deduplicate (keep MongoDB first, then add GridFS ones)
            transactions = [...transactions, ...formattedGridFSTransactions];
            
            // Remove duplicates based on date, amount, and name
            const uniqueTransactions = [];
            const seen = new Set();
            for (const tx of transactions) {
                const key = `${tx.date}|${tx.amount}|${tx.name}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueTransactions.push(tx);
                }
            }
            transactions = uniqueTransactions;
        }
        
        const total = transactions.length;
        
        res.json({ 
            success: true, 
            transactions: transactions.slice(0, parseInt(limit)),
            total,
            page: Math.floor(offset / limit) + 1,
            limit: parseInt(limit),
            source: includeFromGridFS === 'true' ? 'mongodb+gridfs' : 'mongodb'
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// New endpoint to list all CSV files in GridFS
const listCSVFiles = async (req, res) => {
    try {
        const { getUserCSVFiles } = require('../services/gridfsService');
        const files = await getUserCSVFiles(req.user._id);
        
        res.json({
            success: true,
            files: files,
            count: files.length
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// New endpoint to download a specific CSV file from GridFS
const downloadCSV = async (req, res) => {
    try {
        const { downloadCSVFile } = require('../services/gridfsService');
        const fileId = req.params.fileId;
        
        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ success: false, message: 'Invalid file ID' });
        }
        
        await downloadCSVFile(mongoose.Types.ObjectId(fileId), res);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getTransactions, 
    importTransactions, 
    createTransaction,
    listCSVFiles,
    downloadCSV
};