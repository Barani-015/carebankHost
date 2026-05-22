// const express = require('express');
// const { 
//     uploadCSV, 
//     getUserFiles, 
//     deleteFile,
//     downloadFile
// } = require('../controllers/fileController');
// const { upload } = require('../services/fileUploadService');
// const auth = require('../middleware/auth');

// const router = express.Router();

// // Debug middleware
// router.use((req, res, next) => {
//     console.log('📌 File route hit:', req.method, req.url);
//     console.log('📌 Content-Type:', req.headers['content-type']);
//     next();
// });

// // Upload CSV file - WITHOUT PREMIUM CHECK
// router.post('/upload', auth, upload, uploadCSV);

// // Get user's uploaded files
// router.get('/files', auth, getUserFiles);

// // Download file by ID
// router.get('/download/:fileId', auth, downloadFile);

// // Delete file
// router.delete('/files/:fileId', auth, deleteFile);

// module.exports = router;








const express = require('express');
const multer = require('multer');
const { uploadCSV, listUserCSVs, deleteCSV } = require('../services/csvStorage');
const authMiddleware = require('../middleware/auth'); // ✅ import your auth middleware

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
// Upload CSV
router.post('/upload', authMiddleware,upload.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const userId   = req.user?.id || req.user?._id;
        const filename = `transactions_${Date.now()}.csv`;

        // Save to MongoDB GridFS
        const fileId = await uploadCSV(userId, filename, req.file.buffer);

        res.json({
            success:  true,
            message:  `✅ ${req.file.originalname} uploaded successfully`,
            fileId:   fileId.toString(),
            filename,
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// List user files
router.get('/files',authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const files  = await listUserCSVs(userId);
        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete file
router.delete('/files/:fileId',authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        await deleteCSV(userId, req.params.fileId);
        res.json({ success: true, message: 'File deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;