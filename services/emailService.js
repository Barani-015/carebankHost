// emailService.js - Direct HTTP API approach (100% reliable)
const axios = require('axios');

// Generate 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email via direct Brevo HTTP API
const sendOTPEmail = async (email, otp) => {
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
        <div class="header"><h2>🔐 CareBank Email Verification</h2></div>
        <p>Hello,</p>
        <p>Use the verification code below to complete your registration:</p>
        <div class="otp-code">${otp}</div>
        <p>This code will expire in <strong>5 minutes</strong>.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <div class="footer"><p>Stay secure with CareBank — Your Autonomous Financial AI</p></div>
      </div>
    </body>
    </html>`;

    try {
        // Direct API call to Brevo - no SDK issues
        const response = await axios({
            method: 'post',
            url: 'https://api.brevo.com/v3/smtp/email',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            data: {
                sender: {
                    name: 'CareBank',
                    email: process.env.BREVO_SENDER_EMAIL
                },
                to: [{
                    email: email
                }],
                subject: 'CareBank - Your Verification Code',
                htmlContent: html
            }
        });

        console.log(`✅ Email sent to ${email}: ${response.data.messageId}`);
        return true;

    } catch (error) {
        console.error('❌ Email send error:', error.message);
        
        // Log detailed error for debugging
        if (error.response) {
            console.error('API Error Response:', error.response.data);
            console.error('Status Code:', error.response.status);
        }
        
        if (process.env.NODE_ENV === 'production') {
            console.log(`⚠️ OTP for ${email} (email failed): ${otp}`);
        }
        return false;
    }
};

// Test configuration
const testEmailConfig = async () => {
    if (!process.env.BREVO_API_KEY) {
        console.error('❌ Email transporter failed: BREVO_API_KEY not set');
        return false;
    }
    if (!process.env.BREVO_SENDER_EMAIL) {
        console.error('❌ Email transporter failed: BREVO_SENDER_EMAIL not set');
        return false;
    }
    
    // Test the API key by making a simple request
    try {
        const testResponse = await axios({
            method: 'get',
            url: 'https://api.brevo.com/v3/account',
            headers: {
                'api-key': process.env.BREVO_API_KEY
            }
        });
        console.log('✅ Brevo API connection successful');
        console.log('✅ Email transporter ready (Direct HTTP API)');
        return true;
    } catch (error) {
        console.error('❌ Brevo API connection failed:', error.response?.data?.message || error.message);
        return false;
    }
};

// Only run test in production
if (process.env.NODE_ENV === 'production') {
    testEmailConfig();
}

module.exports = { generateOTP, sendOTPEmail, testEmailConfig };