const Transaction = require('../models/Transaction');
const { getAllUserTransactionsFromGridFS, readCSVFile, parseCSVContent, getUserCSVFiles, downloadCSVFile } = require('../services/gridfsService');
const mongoose = require('mongoose');

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

// ADD THIS FUNCTION - Import transactions from CSV/JSON
const importTransactions = async (req, res) => {
    try {
        const { transactions, fileId } = req.body;

        console.log('Importing transactions:', transactions?.length || 0, 'transactions');
        
        if (!transactions || !Array.isArray(transactions)) {
            return res.status(400).json({ success: false, message: 'Invalid transactions data' });
        }
        
        const importedTransactions = [];
        for (const tx of transactions) {
            const transactionData = {
                userId: req.user._id,
                name: tx.name || tx.description || tx.merchant || 'Transaction',
                amount: tx.amount || 0,
                date: tx.date || new Date().toLocaleDateString(),
                category: tx.category || 'Other',
                type: tx.type && ['credit', 'debit'].includes(tx.type) ? tx.type : 'debit',
                status: tx.status || 'success',
                userEmail: req.user.email || tx.userEmail,
                userUuid: req.user.uuid || tx.userUuid
            };

            console.log('Saving transaction:', transactionData);
            
            // Only add fileId if provided (optional)
            if (fileId) {
                transactionData.fileId = fileId;
            }
            
            const transaction = new Transaction(transactionData);
            const saved = await transaction.save();
            importedTransactions.push(saved);
        }
        
        res.json({
            success: true,
            transactions: importedTransactions,
            importedCount: importedTransactions.length
        });
    } catch (error) {
        console.error('Import transactions error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ADD THIS FUNCTION - Create a single transaction
const createTransaction = async (req, res) => {
    try {
        const transactionData = {
            userId: req.user._id,
            name: req.body.name || req.body.description || 'Transaction',
            amount: req.body.amount || 0,
            date: req.body.date || new Date().toLocaleDateString(),
            category: req.body.category || 'Other',
            type: req.body.type && ['credit', 'debit'].includes(req.body.type) ? req.body.type : 'debit',
            status: req.body.status || 'success',
            userEmail: req.user.email || req.body.userEmail,
            userUuid: req.user.uuid || req.body.userUuid
        };
        
        // If fileId is provided, use it
        if (req.body.fileId) {
            transactionData.fileId = req.body.fileId;
        }
        
        const transaction = new Transaction(transactionData);
        const saved = await transaction.save();
        res.json({ success: true, transaction: saved });
    } catch (error) {
        console.error('Create transaction error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// List all CSV files in GridFS
const listCSVFiles = async (req, res) => {
    try {
        const files = await getUserCSVFiles(req.user._id);
        
        res.json({
            success: true,
            files: files,
            count: files.length
        });
    } catch (error) {
        console.error('List CSV files error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Download a specific CSV file from GridFS
const downloadCSV = async (req, res) => {
    try {
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
    importTransactions,   // NOW DEFINED ✅
    createTransaction,    // NOW DEFINED ✅
    listCSVFiles,
    downloadCSV
};