// const cors = require('cors');

// // const corsMiddleware = cors({
// //   origin: true,
// //   credentials: true,
// //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
// //   allowedHeaders: ['Content-Type', 'Authorization']
// // });


// const corsMiddleware = (req, res, next) => {
//   res.header('Access-Control-Allow-Origin', '*');  // Allow all
//   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

//   const allowedOrigins = [
//     'https://carebankhost-1.onrender.com',
//     'http://localhost:3000',  // Keep for local development
//     'http://localhost:5000'   // If you test on different ports
//   ];
  
//   if (req.method === 'OPTIONS') {
//     return res.sendStatus(200);
//   }
//   next();
// };


// module.exports = { corsMiddleware };








const cors = require('cors');

// ✅ Using the proper cors middleware
const corsMiddleware = cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://carebankhost-1.onrender.com',
      'https://carebank-ai.onrender.com',
      'http://localhost:3000',
      'http://localhost:5000'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`❌ Blocked CORS request from: ${origin}`);
      callback(null, false); // Set to false to block, or use error to reject
    }
  },
  credentials: true,  // ✅ Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

module.exports = { corsMiddleware };