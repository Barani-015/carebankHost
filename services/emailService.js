// emailService.js - Working solution for Brevo v2.x
const brevo = require('@getbrevo/brevo');

// Generate 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email via Brevo API
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
        // Initialize API instance
        const apiInstance = new brevo.TransactionalEmailsApi();
        
        // Set API key using the correct method (not direct property access)
        apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
        
        // Create email object
        const sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.subject = 'CareBank - Your Verification Code';
        sendSmtpEmail.htmlContent = html;
        sendSmtpEmail.sender = { name: 'CareBank', email: process.env.BREVO_SENDER_EMAIL };
        sendSmtpEmail.to = [{ email: email }];

        // Send email
        const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`✅ Email sent to ${email}: ${response.messageId}`);
        return true;

    } catch (error) {
        console.error('❌ Email send error:', error.message);
        if (error.response && error.response.body) {
            console.error('Error details:', error.response.body);
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
    console.log('✅ Email transporter ready (Brevo HTTP API)');
    return true;
};

if (process.env.NODE_ENV === 'production') {
    testEmailConfig();
}

module.exports = { generateOTP, sendOTPEmail, testEmailConfig };