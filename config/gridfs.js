const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

let bucket;

const initGridFS = () => {
    const db = mongoose.connection.db;
    bucket = new GridFSBucket(db, { bucketName: 'csvFiles' });
    console.log('✅ GridFS initialized');
    return bucket;
};

const getBucket = () => {
    if (!bucket) initGridFS();
    return bucket;
};

module.exports = { initGridFS, getBucket };