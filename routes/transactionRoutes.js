// const express = require('express');
// const { getTransactions, importTransactions, createTransaction } = require('../controllers/transactionController');
// const auth = require('../middleware/auth');

// const router = express.Router();

// router.get('/transactions', auth, getTransactions);
// router.post('/transactions/import', auth, importTransactions);
// router.post('/transactions', auth, createTransaction);

// module.exports = router;



const express = require('express');
const { 
    getTransactions, 
    importTransactions, 
    createTransaction,
    listCSVFiles,
    downloadCSV 
} = require('../controllers/transactionController');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/transactions', auth, getTransactions);
router.post('/transactions/import', auth, importTransactions);
router.post('/transactions', auth, createTransaction);
router.get('/transactions/csv-files', auth, listCSVFiles);
router.get('/transactions/download/:fileId', auth, downloadCSV);

module.exports = router;