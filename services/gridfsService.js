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
        console.log('✅ GridFS bucket initialized');
    }
};

// Get all CSV files for a user
const getUserCSVFiles = async (userId) => {
    try {
        const files = await gfsBucket.find({ 
            'metadata.userId': userId 
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
    const headers = lines[0].split(',');
    const transactions = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
            const values = lines[i].split(',');
            const transaction = {};
            headers.forEach((header, index) => {
                transaction[header.trim()] = values[index]?.trim() || '';
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
            const csvContent = await readCSVFile(file.id);
            const transactions = parseCSVContent(csvContent);
            allTransactions = [...allTransactions, ...transactions];
        }
        
        return allTransactions;
    } catch (error) {
        console.error('Error reading user transactions:', error);
        return [];
    }
};

// Get a specific CSV file as downloadable
const downloadCSVFile = async (fileId, res) => {
    try {
        const downloadStream = gfsBucket.openDownloadStream(fileId);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="export.csv"`);
        
        downloadStream.pipe(res);
        
        downloadStream.on('error', (error) => {
            res.status(404).json({ error: 'File not found' });
        });
    } catch (error) {
        throw error;
    }
};

// Save CSV string to GridFS
const saveCSVToGridFS = async (csvContent, filename, metadata = {}) => {
    return new Promise((resolve, reject) => {
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