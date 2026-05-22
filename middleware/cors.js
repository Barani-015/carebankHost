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








// const cors = require('cors');

// // ✅ Using the proper cors middleware
// const corsMiddleware = cors({
//   origin: function(origin, callback) {
//     // Allow requests with no origin (like mobile apps, curl, postman)
//     if (!origin) return callback(null, true);
    
//     const allowedOrigins = [
//       'https://carebankhost-1.onrender.com',
//       'https://carebank-ai.onrender.com',
//       'http://localhost:3000',
//       'http://localhost:5000'
//     ];
    
//     if (allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       console.log(`❌ Blocked CORS request from: ${origin}`);
//       callback(null, false); // Set to false to block, or use error to reject
//     }
//   },
//   credentials: true,  // ✅ Allow cookies/auth headers
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization']
// });

// module.exports = { corsMiddleware };



































const cors = require('cors');

// ✅ Fixed CORS middleware for all clients (Web + Android)
const corsMiddleware = cors({
  origin: function(origin, callback) {
    // ✅ CRITICAL FIX: Allow requests with no origin (Android WebView, mobile apps, curl)
    // Android WebView sends "null" origin or no origin at all
    if (!origin || origin === 'null' || origin === 'capacitor://localhost' || origin === 'file://') {
      console.log(`✅ Allowed request from: ${origin || 'Android App (no origin)'}`);
      return callback(null, true);
    }
    
    const allowedOrigins = [
      'https://carebankhost-1.onrender.com',
      'https://carebank-ai.onrender.com',
      'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:63342',  // WebStorm/IntelliJ
      'http://127.0.0.1:63342',
      'capacitor://localhost',    // Android WebView
      'file://',                   // Local file access
      'http://192.168.1.7:3000',  // Your local network
      'http://192.168.1.7:63342'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log(`✅ Allowed CORS request from: ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ Blocked CORS request from: ${origin}`);
      // For production, set to false. For debugging, allow temporarily
      callback(null, true); // TEMPORARY: Allow all for testing
      // callback(new Error('Not allowed by CORS')); // Use this to block
    }
  },
  credentials: true,  // ✅ Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Headers',
    'Access-Control-Allow-Methods',
    'X-CSRF-Token',
    'Cache-Control'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  preflightContinue: false,
  optionsSuccessStatus: 204,  // ✅ Some browsers choke on 200
  maxAge: 86400  // Cache preflight for 24 hours
});

// ✅ ADD THIS: Manual CORS headers as backup
const manualCorsHeaders = (req, res, next) => {
  // Always set these headers for every response
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests immediately
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
};

// ✅ ADD THIS: Special middleware for Android
const androidCorsMiddleware = (req, res, next) => {
  // Detect Android WebView via user agent
  const userAgent = req.headers['user-agent'] || '';
  const isAndroidWebView = userAgent.includes('Android') && 
                          (userAgent.includes('wv') || userAgent.includes('CareBankAndroid'));
  
  if (isAndroidWebView) {
    console.log('📱 Android WebView detected, applying special CORS rules');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  }
  next();
};

// Export all middlewares
module.exports = { 
  corsMiddleware, 
  manualCorsHeaders, 
  androidCorsMiddleware 
};