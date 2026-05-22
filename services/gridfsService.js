const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

let gfsBucket;

// Initialize GridFS bucket
const initGridFSBucket = () => {
    const conn = mongoose.connection;
    if (conn && conn.db) {
        gfsBucket = new GridFSBucket(conn.db, {
            bucketName: 'csvFiles'  // Your bucket name from the screenshot
        });
        console.log('✅ GridFS bucket initialized for csvFiles');
    }
};

// Get all CSV files for a user
const getUserCSVFiles = async (userId) => {
    try {
        if (!gfsBucket) initGridFSBucket();
        
        const files = await gfsBucket.find({ 
            'metadata.userId': userId.toString() 
        }).toArray();
        
        return files.map(file => ({
            id: file._id,
            filename: file.filename,
            uploadDate: file.uploadDate,
            length: file.length,
            contentType: file.contentType,
            metadata: file.metadata
        }));
    } catch (error) {
        console.error('Error fetching files:', error);
        return [];
    }
};

// Read CSV file content from GridFS
const readCSVFile = async (fileId) => {
    return new Promise((resolve, reject) => {
        if (!gfsBucket) initGridFSBucket();
        
        const chunks = [];
        const downloadStream = gfsBucket.openDownloadStream(fileId);
        
        downloadStream.on('data', (chunk) => {
            chunks.push(chunk);
        });
        
        downloadStream.on('error', (error) => {
            reject(error);
        });
        
        downloadStream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const content = buffer.toString('utf8');
            resolve(content);
        });
    });
};

// Parse CSV content to JSON
const parseCSVContent = (csvContent) => {
    const lines = csvContent.split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const transactions = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            const transaction = {};
            headers.forEach((header, index) => {
                transaction[header] = values[index] || '';
            });
            transactions.push(transaction);
        }
    }
    
    return transactions;
};

// Get all transactions from all CSV files for a user
const getAllUserTransactionsFromGridFS = async (userId) => {
    try {
        const files = await getUserCSVFiles(userId);
        let allTransactions = [];
        
        for (const file of files) {
            try {
                const csvContent = await readCSVFile(file.id);
                const transactions = parseCSVContent(csvContent);
                allTransactions = [...allTransactions, ...transactions];
                console.log(`Read ${transactions.length} transactions from ${file.filename}`);
            } catch (err) {
                console.error(`Error reading file ${file.filename}:`, err);
            }
        }
        
        return allTransactions;
    } catch (error) {
        console.error('Error reading user transactions:', error);
        return [];
    }
};

// Get a specific CSV file as downloadable
const downloadCSVFile = async (fileId, res) => {
    return new Promise((resolve, reject) => {
        if (!gfsBucket) initGridFSBucket();
        
        const downloadStream = gfsBucket.openDownloadStream(fileId);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="export.csv"`);
        
        downloadStream.pipe(res);
        
        downloadStream.on('error', (error) => {
            reject(error);
        });
        
        downloadStream.on('end', () => {
            resolve();
        });
    });
};

// Save CSV string to GridFS
const saveCSVToGridFS = async (csvContent, filename, metadata = {}) => {
    return new Promise((resolve, reject) => {
        if (!gfsBucket) initGridFSBucket();
        
        const uploadStream = gfsBucket.openUploadStream(filename, {
            contentType: 'text/csv',
            metadata: metadata
        });
        
        uploadStream.write(csvContent);
        uploadStream.end();
        
        uploadStream.on('finish', () => {
            resolve(uploadStream.id);
        });
        
        uploadStream.on('error', (error) => {
            reject(error);
        });
    });
};

module.exports = {
    initGridFSBucket,
    getUserCSVFiles,
    readCSVFile,
    parseCSVContent,
    getAllUserTransactionsFromGridFS,
    downloadCSVFile,
    saveCSVToGridFS
};