const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const { getAllUserTransactionsFromGridFS } = require('../services/gridfsService');
require('dotenv').config();

const migrateGridFSToTransactions = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
        
        // Get all unique user IDs from GridFS files
        const { initGridFSBucket } = require('../services/gridfsService');
        initGridFSBucket();
        
        const { gfsBucket } = require('../services/gridfsService');
        const files = await gfsBucket.find().toArray();
        
        const userFiles = {};
        for (const file of files) {
            const userId = file.metadata?.userId;
            if (userId) {
                if (!userFiles[userId]) userFiles[userId] = [];
                userFiles[userId].push(file);
            }
        }
        
        // Process each user's files
        for (const [userId, userFileList] of Object.entries(userFiles)) {
            console.log(`Processing user ${userId} with ${userFileList.length} files`);
            
            for (const file of userFileList) {
                const { readCSVFile, parseCSVContent } = require('../services/gridfsService');
                const csvContent = await readCSVFile(file._id);
                const transactions = parseCSVContent(csvContent);
                
                for (const tx of transactions) {
                    // Check if transaction already exists
                    const existing = await Transaction.findOne({
                        userId: mongoose.Types.ObjectId(userId),
                        date: tx.timestamp || tx.Date,
                        amount: parseFloat(tx.amount) || 0,
                        name: tx.merchant || tx.Description
                    });
                    
                    if (!existing) {
                        const newTransaction = new Transaction({
                            userId: mongoose.Types.ObjectId(userId),
                            name: tx.merchant || tx.Description || 'Transaction',
                            amount: parseFloat(tx.amount) || 0,
                            date: tx.timestamp || tx.Date || new Date().toLocaleDateString(),
                            category: tx.category || 'Other',
                            type: tx.transaction_type === 'credit' ? 'credit' : 'debit',
                            status: 'success',
                            userEmail: file.metadata?.userEmail || 'unknown',
                            userUuid: file.metadata?.userUuid || userId,
                            source: 'gridfs_migration'
                        });
                        
                        await newTransaction.save();
                        console.log(`Migrated: ${newTransaction.name} - ${newTransaction.amount}`);
                    }
                }
            }
        }
        
        console.log('Migration completed!');
        process.exit(0);
    } catch (error) {
        console.error('Migration error:', error);
        process.exit(1);
    }
};

migrateGridFSToTransactions();