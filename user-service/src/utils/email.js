const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const { config } = require('../config');

// Gmail SMTP transport. Requires a Gmail address + an App Password
// (Google Account → Security → 2-Step Verification → App passwords).
// OTP is the only email this service sends — no separate notification service.
const transporter = nodemailer.createTransport({
     service: 'gmail',
     auth: {
          user: config.GMAIL_USER,
          pass: config.GMAIL_APP_PASSWORD,
     },
});

const FROM = config.MAIL_FROM || config.GMAIL_USER;
const MAX_RETRIES = 3;

function otpTemplate(otp, ttlMinutes) {
     return `
    <div style="font-family: Arial, sans-serif; max-width: 420px; margin: auto; padding: 20px; border: 1px solid #e5e5e5; border-radius: 10px; background: #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4A3AFF; margin: 0;">IRCTC</h2>
      </div>
      <p style="font-size: 16px; color: #333;">Hi,</p>
      <p style="font-size: 16px; color: #333;">Use the verification code below to complete your sign up:</p>
      <div style="text-align: center; margin: 30px 0;">
        <div style="display: inline-block; padding: 14px 26px; font-size: 32px; letter-spacing: 8px; font-weight: bold; background: #F4F4FF; border-radius: 8px; color: #4A3AFF; border: 1px solid #e0e0ff;">
          ${otp}
        </div>
      </div>
      <p style="font-size: 15px; color: #555;">This code will expire in <strong>${ttlMinutes} minutes</strong>.</p>
      <p style="font-size: 15px; color: #555;">If this wasn't you, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
      <p style="font-size: 14px; color: #888; text-align: center;">Happy Journey 🚂<br/><strong>Team IRCTC</strong></p>
    </div>
  `;
}

async function sendOtpEmail(email, otp, ttlMinutes) {
     const msg = {
          from: FROM,
          to: email,
          subject: 'Your IRCTC verification code',
          html: otpTemplate(otp, ttlMinutes),
     };

     let lastError;
     for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
               await transporter.sendMail(msg);
               logger.info(`OTP email sent to ${email} (attempt ${attempt})`);
               return { success: true };
          } catch (error) {
               lastError = error;
               logger.error(`OTP email failed (attempt ${attempt}/${MAX_RETRIES})`, {
                    to: email,
                    error: error.message,
               });
               if (attempt < MAX_RETRIES) {
                    await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
               }
          }
     }
     throw lastError;
}

module.exports = { sendOtpEmail };
