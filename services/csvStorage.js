const { getBucket } = require('../config/gridfs');
const mongoose = require('mongoose');
const { Readable } = require('stream');

// ── Upload CSV buffer to GridFS ──
async function uploadCSV(userId, filename, buffer) {
    const bucket = getBucket();

    // Delete existing file with same name for this user
    await deleteCSV(userId, filename);

    return new Promise((resolve, reject) => {
        const readStream = Readable.from(buffer);
        const uploadStream = bucket.openUploadStream(filename, {
            metadata: { userId, uploadedAt: new Date() }
        });

        readStream.pipe(uploadStream);

        uploadStream.on('finish', () => {
            console.log(`✅ Uploaded: ${filename} for user: ${userId}`);
            resolve(uploadStream.id);
        });

        uploadStream.on('error', reject);
    });
}

// ── Download CSV from GridFS as string ──
async function downloadCSV(fileId) {
    const bucket = getBucket();
    const chunks = [];

    return new Promise((resolve, reject) => {
        const downloadStream = bucket.openDownloadStream(
            new mongoose.Types.ObjectId(fileId)
        );

        downloadStream.on('data', chunk => chunks.push(chunk));
        downloadStream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        downloadStream.on('error', reject);
    });
}

// ── List all CSV files for a user ──
async function listUserCSVs(userId) {
    const bucket = getBucket();
    const files = await bucket.find({ 'metadata.userId': userId }).toArray();
    return files.map(f => ({
        id:           f._id.toString(),
        filename:     f.filename,
        size_kb:      +(f.length / 1024).toFixed(2),
        uploadedAt:   f.metadata?.uploadedAt,
    }));
}

// ── Delete a specific CSV ──
async function deleteCSV(userId, filename) {
    const bucket = getBucket();
    const files  = await bucket.find({
        filename,
        'metadata.userId': userId
    }).toArray();

    for (const file of files) {
        await bucket.delete(file._id);
        console.log(`🗑️ Deleted: ${file.filename}`);
    }
}

// ── Delete all CSVs for a user ──
async function deleteAllUserCSVs(userId) {
    const bucket = getBucket();
    const files  = await bucket.find({ 'metadata.userId': userId }).toArray();

    for (const file of files) {
        await bucket.delete(file._id);
    }
    console.log(`🗑️ Deleted all files for user: ${userId}`);
}

module.exports = {
    uploadCSV,
    downloadCSV,
    listUserCSVs,
    deleteCSV,
    deleteAllUserCSVs,
};