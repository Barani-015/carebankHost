// const nodemailer = require('nodemailer');

// // Configure email transporter
// const transporter = nodemailer.createTransport({
//   service: 'gmail', // or 'smtp.gmail.com'
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS
//   }
// });

// // Generate 6-digit OTP
// const generateOTP = () => {
//   return Math.floor(100000 + Math.random() * 900000).toString();
// };

// // Send OTP email
// const sendOTPEmail = async (email, otp) => {
//   const html = `
//     <!DOCTYPE html>
//     <html>
//     <head>
//       <style>
//         body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//         .container { max-width: 500px; margin: 0 auto; padding: 20px; }
//         .header { text-align: center; padding: 20px; background: linear-gradient(135deg, #7c6af7, #a78bfa); border-radius: 12px; color: white; }
//         .otp-code { font-size: 36px; font-weight: bold; text-align: center; padding: 20px; letter-spacing: 8px; background: #f1f3f5; border-radius: 12px; margin: 20px 0; }
//         .footer { text-align: center; font-size: 12px; color: #666; margin-top: 20px; }
//       </style>
//     </head>
//     <body>
//       <div class="container">
//         <div class="header">
//           <h2>🔐 CareBank Email Verification</h2>
//         </div>
//         <p>Hello,</p>
//         <p>We received a request to verify your email address. Use the verification code below to complete your registration:</p>
//         <div class="otp-code">${otp}</div>
//         <p>This code will expire in <strong>5 minutes</strong>.</p>
//         <p>If you didn't request this, please ignore this email.</p>
//         <div class="footer">
//           <p>Stay secure with CareBank — Your Autonomous Financial AI</p>
//         </div>
//       </div>
//     </body>
//     </html>
//   `;

//   const mailOptions = {
//     from: `"CareBank" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: 'CareBank - Your Verification Code',
//     html: html
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     return true;
//   } catch (error) {
//     console.error('Email send error:', error);
//     return false;
//   }
// };

// module.exports = { generateOTP, sendOTPEmail };






const nodemailer = require('nodemailer');
const dns = require('dns');

// ✅ CRITICAL: Force IPv4 globally (Fixes Render's IPv6 issue)
dns.setDefaultResultOrder('ipv4first');

// Configure email transporter with IPv4 fix
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',  // Use explicit host instead of 'service'
  port: 465,                // SSL port
  secure: true,             // Use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  // ✅ CRITICAL: Force IPv4 (fixes Render's IPv6 ENETUNREACH error)
  family: 4,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
const sendOTPEmail = async (email, otp) => {
  // For development without email config
  if (process.env.NODE_ENV === 'development' && !process.env.EMAIL_USER) {
    console.log(`📧 DEV MODE - OTP for ${email}: ${otp}`);
    return true;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 500px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 20px; background: linear-gradient(135deg, #7c6af7, #a78bfa); border-radius: 12px; color: white; }
        .otp-code { font-size: 36px; font-weight: bold; text-align: center; padding: 20px; letter-spacing: 8px; background: #f1f3f5; border-radius: 12px; margin: 20px 0; }
        .footer { text-align: center; font-size: 12px; color: #666; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🔐 CareBank Email Verification</h2>
        </div>
        <p>Hello,</p>
        <p>We received a request to verify your email address. Use the verification code below to complete your registration:</p>
        <div class="otp-code">${otp}</div>
        <p>This code will expire in <strong>5 minutes</strong>.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <div class="footer">
          <p>Stay secure with CareBank — Your Autonomous Financial AI</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"CareBank" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'CareBank - Your Verification Code',
    html: html
  };

  try {
    // Verify connection before sending
    await transporter.verify();
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${email}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Email send error:', error);
    
    // Log OTP for debugging in production
    if (process.env.NODE_ENV === 'production') {
      console.log(`⚠️ OTP for ${email} (email failed): ${otp}`);
    }
    return false;
  }
};

// Test email configuration on startup
const testEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email transporter ready (IPv4 forced)');
    return true;
  } catch (error) {
    console.error('❌ Email transporter failed:', error.message);
    return false;
  }
};

// Run test if not in development
if (process.env.NODE_ENV === 'production') {
  testEmailConfig();
}

module.exports = { generateOTP, sendOTPEmail, testEmailConfig };