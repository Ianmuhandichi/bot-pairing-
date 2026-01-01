import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://ian:heruku@cluster0.ra3cm29.mongodb.net/ian_pairing_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Pairing Code Schema
const pairingCodeSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  countryCode: {
    type: String,
    default: '+254'
  },
  fullNumber: {
    type: String,
    required: true,
    unique: true
  },
  pairingCode: {
    type: String,
    required: true,
    unique: true
  },
  sessionId: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'expired', 'used'],
    default: 'pending'
  },
  ipAddress: String,
  userAgent: String,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    index: { expireAfterSeconds: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  linkedAt: Date,
  deviceInfo: {
    platform: String,
    browser: String,
    os: String
  }
});

const PairingCode = mongoose.model('PairingCode', pairingCodeSchema);

// WhatsApp Bot Schema (for integration)
const botSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  phoneNumber: String,
  status: String,
  createdAt: Date,
  lastActive: Date
});

const BotSession = mongoose.model('BotSession', botSessionSchema);

// ==================== HTML TEMPLATES ====================

const htmlTemplates = {
  landingPage: `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>IAN TECH - WhatsApp Pairing Service</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        
        .container {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 500px;
          width: 100%;
          animation: fadeIn 0.5s ease-out;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        
        .logo {
          font-size: 48px;
          margin-bottom: 15px;
        }
        
        h1 {
          color: #333;
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 10px;
        }
        
        .subtitle {
          color: #666;
          font-size: 16px;
          line-height: 1.5;
        }
        
        .form-group {
          margin-bottom: 24px;
        }
        
        label {
          display: block;
          margin-bottom: 8px;
          color: #555;
          font-weight: 500;
          font-size: 14px;
        }
        
        .input-group {
          display: flex;
          border-radius: 12px;
          overflow: hidden;
          border: 2px solid #e1e5e9;
          transition: border-color 0.3s;
        }
        
        .input-group:focus-within {
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .country-code {
          background: #f8f9fa;
          padding: 15px 20px;
          font-weight: 600;
          color: #333;
          border-right: 2px solid #e1e5e9;
          min-width: 100px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        input[type="tel"] {
          flex: 1;
          padding: 15px 20px;
          border: none;
          font-size: 16px;
          outline: none;
          background: white;
        }
        
        input[type="tel"]::placeholder {
          color: #999;
        }
        
        .button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 18px 30px;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          width: 100%;
          transition: transform 0.2s, box-shadow 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        
        .button:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        }
        
        .button:active {
          transform: translateY(0);
        }
        
        .instructions {
          background: #f8f9fa;
          border-radius: 12px;
          padding: 20px;
          margin-top: 30px;
          border-left: 4px solid #667eea;
        }
        
        .instructions h3 {
          color: #333;
          margin-bottom: 10px;
          font-size: 16px;
        }
        
        .instructions ol {
          padding-left: 20px;
          color: #555;
          line-height: 1.6;
        }
        
        .instructions li {
          margin-bottom: 8px;
        }
        
        .footer {
          text-align: center;
          margin-top: 30px;
          color: #888;
          font-size: 14px;
        }
        
        .powered-by {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 10px;
          font-weight: 600;
          color: #667eea;
        }
        
        /* Success Page Styles */
        .success-container {
          text-align: center;
        }
        
        .success-icon {
          font-size: 80px;
          margin-bottom: 20px;
          animation: bounce 1s infinite alternate;
        }
        
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-10px); }
        }
        
        .code-display {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          font-size: 32px;
          font-weight: 700;
          padding: 20px;
          border-radius: 12px;
          margin: 25px 0;
          letter-spacing: 8px;
          text-align: center;
        }
        
        .qr-container {
          margin: 30px auto;
          max-width: 300px;
          padding: 20px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .qr-code {
          width: 100%;
          height: auto;
        }
        
        .timer {
          font-size: 14px;
          color: #666;
          margin-top: 10px;
        }
        
        .timer .expiry {
          font-weight: 600;
          color: #667eea;
        }
        
        .whatsapp-button {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: #25D366;
          color: white;
          text-decoration: none;
          padding: 15px 30px;
          border-radius: 50px;
          font-weight: 600;
          margin-top: 20px;
          transition: transform 0.2s;
        }
        
        .whatsapp-button:hover {
          transform: scale(1.05);
          color: white;
        }
        
        @media (max-width: 480px) {
          .container {
            padding: 25px;
          }
          
          .logo {
            font-size: 40px;
          }
          
          h1 {
            font-size: 24px;
          }
          
          .code-display {
            font-size: 24px;
            letter-spacing: 4px;
          }
        }
      </style>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🤖</div>
          <h1>IAN TECH WhatsApp Pairing</h1>
          <p class="subtitle">Enter your WhatsApp number to receive a secure pairing code</p>
        </div>
        
        <form id="pairingForm" action="/api/generate-code" method="POST">
          <div class="form-group">
            <label for="phoneNumber">WhatsApp Phone Number</label>
            <div class="input-group">
              <div class="country-code" id="countryCodeDisplay">+254</div>
              <input 
                type="tel" 
                id="phoneNumber" 
                name="phoneNumber"
                placeholder="723 278 526"
                pattern="[0-9]{9,12}"
                title="Enter your phone number without country code"
                required
              >
            </div>
          </div>
          
          <button type="submit" class="button">
            <i class="fas fa-key"></i>
            Get Pairing Code
          </button>
        </form>
        
        <div class="instructions">
          <h3>How to Link Your WhatsApp:</h3>
          <ol>
            <li>Enter your WhatsApp phone number above</li>
            <li>Receive a 6-digit pairing code</li>
            <li>Open WhatsApp on your phone</li>
            <li>Go to Settings → Linked Devices → Link a Device</li>
            <li>Enter the pairing code when prompted</li>
          </ol>
        </div>
        
        <div class="footer">
          <p>Secure & encrypted connection</p>
          <div class="powered-by">
            <i class="fas fa-bolt"></i>
            Powered by IAN TECH
          </div>
        </div>
      </div>
      
      <script>
        document.getElementById('pairingForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const phoneNumber = document.getElementById('phoneNumber').value;
          const countryCode = document.getElementById('countryCodeDisplay').textContent;
          
          if (!phoneNumber.match(/^[0-9]{9,12}$/)) {
            alert('Please enter a valid phone number (9-12 digits)');
            return;
          }
          
          const button = e.target.querySelector('button');
          const originalText = button.innerHTML;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating Code...';
          button.disabled = true;
          
          try {
            const response = await fetch('/api/generate-code', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                phoneNumber: phoneNumber,
                countryCode: countryCode
              })
            });
            
            const data = await response.json();
            
            if (data.success) {
              // Redirect to success page with code
              window.location.href = \`/pairing-success?code=\${data.pairingCode}&phone=\${encodeURIComponent(data.fullNumber)}\`;
            } else {
              alert(data.error || 'Failed to generate pairing code');
              button.innerHTML = originalText;
              button.disabled = false;
            }
          } catch (error) {
            alert('Network error. Please try again.');
            button.innerHTML = originalText;
            button.disabled = false;
          }
        });
        
        // Auto-format phone number
        document.getElementById('phoneNumber').addEventListener('input', function(e) {
          let value = e.target.value.replace(/\D/g, '');
          if (value.length > 3 && value.length <= 6) {
            value = value.replace(/(\d{3})(\d+)/, '$1 $2');
          } else if (value.length > 6) {
            value = value.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
          }
          e.target.value = value;
        });
      </script>
    </body>
    </html>
  `,

  successPage: (code, phoneNumber, qrCodeUrl, expiresAt) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pairing Code Ready - IAN TECH</title>
      <style>
        /* Reuse styles from landing page */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        
        .container {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 500px;
          width: 100%;
          animation: fadeIn 0.5s ease-out;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .success-icon {
          font-size: 80px;
          margin-bottom: 20px;
          animation: bounce 1s infinite alternate;
          text-align: center;
        }
        
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-10px); }
        }
        
        h1 {
          color: #333;
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 10px;
          text-align: center;
        }
        
        .subtitle {
          color: #666;
          font-size: 16px;
          line-height: 1.5;
          text-align: center;
          margin-bottom: 30px;
        }
        
        .code-display {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          font-size: 32px;
          font-weight: 700;
          padding: 20px;
          border-radius: 12px;
          margin: 25px 0;
          letter-spacing: 8px;
          text-align: center;
          cursor: pointer;
          transition: transform 0.2s;
        }
        
        .code-display:hover {
          transform: scale(1.02);
        }
        
        .qr-container {
          margin: 30px auto;
          max-width: 300px;
          padding: 20px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          text-align: center;
        }
        
        .qr-code {
          width: 100%;
          height: auto;
          max-width: 250px;
        }
        
        .timer {
          font-size: 14px;
          color: #666;
          margin-top: 10px;
          text-align: center;
        }
        
        .timer .expiry {
          font-weight: 600;
          color: #667eea;
        }
        
        .whatsapp-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          background: #25D366;
          color: white;
          text-decoration: none;
          padding: 15px 30px;
          border-radius: 50px;
          font-weight: 600;
          margin-top: 20px;
          transition: transform 0.2s;
          width: 100%;
          font-size: 16px;
        }
        
        .whatsapp-button:hover {
          transform: scale(1.05);
          color: white;
        }
        
        .instructions {
          background: #f8f9fa;
          border-radius: 12px;
          padding: 20px;
          margin-top: 30px;
          border-left: 4px solid #25D366;
        }
        
        .instructions h3 {
          color: #333;
          margin-bottom: 10px;
          font-size: 16px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .instructions ol {
          padding-left: 20px;
          color: #555;
          line-height: 1.6;
        }
        
        .instructions li {
          margin-bottom: 8px;
        }
        
        .footer {
          text-align: center;
          margin-top: 30px;
          color: #888;
          font-size: 14px;
        }
        
        .powered-by {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 10px;
          font-weight: 600;
          color: #667eea;
        }
        
        .copy-notification {
          position: fixed;
          top: 20px;
          right: 20px;
          background: #25D366;
          color: white;
          padding: 15px 25px;
          border-radius: 10px;
          box-shadow: 0 5px 20px rgba(0,0,0,0.2);
          display: none;
          z-index: 1000;
          animation: slideIn 0.3s ease-out;
        }
        
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @media (max-width: 480px) {
          .container {
            padding: 25px;
          }
          
          .success-icon {
            font-size: 60px;
          }
          
          h1 {
            font-size: 24px;
          }
          
          .code-display {
            font-size: 24px;
            letter-spacing: 4px;
          }
        }
      </style>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body>
      <div class="copy-notification" id="copyNotification">
        <i class="fas fa-check-circle"></i> Code copied to clipboard!
      </div>
      
      <div class="container">
        <div class="success-icon">✅</div>
        <h1>Pairing Code Generated!</h1>
        <p class="subtitle">Your WhatsApp pairing code is ready</p>
        
        <div class="code-display" id="pairingCode" onclick="copyToClipboard('${code}')">
          ${code}
        </div>
        
        <div class="timer">
          Code expires at: <span class="expiry">${expiresAt}</span>
        </div>
        
        ${qrCodeUrl ? `
        <div class="qr-container">
          <h3>Scan QR Code:</h3>
          <img src="${qrCodeUrl}" alt="WhatsApp Pairing QR Code" class="qr-code">
          <p class="timer">Scan with WhatsApp camera</p>
        </div>
        ` : ''}
        
        <a href="whatsapp://send?text=My IAN TECH Pairing Code: ${code}" class="whatsapp-button">
          <i class="fab fa-whatsapp"></i>
          Open WhatsApp
        </a>
        
        <div class="instructions">
          <h3><i class="fas fa-mobile-alt"></i> How to Use This Code:</h3>
          <ol>
            <li>Open <strong>WhatsApp</strong> on your phone</li>
            <li>Tap <strong>Settings</strong> (three dots)</li>
            <li>Select <strong>Linked Devices</strong></li>
            <li>Tap <strong>Link a Device</strong></li>
            <li>Enter this code: <strong>${code}</strong></li>
            <li>Tap <strong>Link</strong> to connect</li>
          </ol>
        </div>
        
        <div class="footer">
          <p>Number registered: <strong>${phoneNumber}</strong></p>
          <div class="powered-by">
            <i class="fas fa-bolt"></i>
            Powered by IAN TECH Innovation
          </div>
        </div>
      </div>
      
      <script>
        function copyToClipboard(text) {
          navigator.clipboard.writeText(text).then(() => {
            const notification = document.getElementById('copyNotification');
            notification.style.display = 'block';
            setTimeout(() => {
              notification.style.display = 'none';
            }, 2000);
          });
        }
        
        // Auto-copy after 2 seconds
        setTimeout(() => {
          copyToClipboard('${code}');
        }, 2000);
        
        // Update timer every minute
        function updateTimer() {
          const expiryTime = new Date('${new Date(expiresAt).toISOString()}').getTime();
          const now = new Date().getTime();
          const distance = expiryTime - now;
          
          if (distance < 0) {
            document.querySelector('.timer').innerHTML = '<span style="color: #ff4757;">Code expired! Please generate a new one.</span>';
            return;
          }
          
          const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((distance % (1000 * 60)) / 1000);
          
          document.querySelector('.timer .expiry').textContent = 
            \`\${minutes}:\${seconds.toString().padStart(2, '0')} minutes remaining\`;
        }
        
        updateTimer();
        setInterval(updateTimer, 1000);
      </script>
    </body>
    </html>
  `
};

// ==================== ROUTES ====================

// Landing page
app.get('/', (req, res) => {
  res.send(htmlTemplates.landingPage);
});

// Generate pairing code API
app.post('/api/generate-code', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+254' } = req.body;
    
    if (!phoneNumber || !phoneNumber.match(/^[0-9]{9,12}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Please enter 9-12 digits.'
      });
    }
    
    const fullNumber = countryCode + phoneNumber.replace(/\D/g, '');
    
    // Check if user already has an active code
    const existingCode = await PairingCode.findOne({
      fullNumber,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    });
    
    if (existingCode) {
      return res.json({
        success: true,
        pairingCode: existingCode.pairingCode,
        fullNumber: existingCode.fullNumber,
        expiresAt: existingCode.expiresAt,
        message: 'Using existing active code'
      });
    }
    
    // Generate unique 6-digit code
    let pairingCode;
    let isUnique = false;
    
    while (!isUnique) {
      pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
      const existing = await PairingCode.findOne({ pairingCode, status: 'pending' });
      if (!existing) isUnique = true;
    }
    
    // Generate session ID for the bot
    const sessionId = `IAN_TECH_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    
    // Create pairing record
    const pairingRecord = new PairingCode({
      phoneNumber,
      countryCode,
      fullNumber,
      pairingCode,
      sessionId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      deviceInfo: {
        platform: req.headers['sec-ch-ua-platform'] || 'Unknown',
        browser: req.get('User-Agent') || 'Unknown',
        os: 'Unknown'
      }
    });
    
    await pairingRecord.save();
    
    // Create bot session record
    const botSession = new BotSession({
      sessionId,
      phoneNumber: fullNumber,
      status: 'pending',
      createdAt: new Date()
    });
    
    await botSession.save();
    
    res.json({
      success: true,
      pairingCode,
      fullNumber,
      sessionId,
      expiresAt: pairingRecord.expiresAt,
      whatsappLink: `https://wa.me/${fullNumber.replace('+', '')}?text=Your%20IAN%20TECH%20Pairing%20Code:%20${pairingCode}`
    });
    
  } catch (error) {
    console.error('Error generating pairing code:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Success page
app.get('/pairing-success', async (req, res) => {
  try {
    const { code, phone } = req.query;
    
    if (!code || !phone) {
      return res.redirect('/');
    }
    
    // Find the pairing record
    const pairingRecord = await PairingCode.findOne({
      pairingCode: code,
      fullNumber: decodeURIComponent(phone)
    });
    
    if (!pairingRecord) {
      return res.redirect('/');
    }
    
    // Generate QR code
    const qrData = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`WHATSAPP:${code}`)}`;
    
    // Format expiry time
    const expiresAt = new Date(pairingRecord.expiresAt);
    const formattedExpiry = expiresAt.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    res.send(htmlTemplates.successPage(
      code,
      decodeURIComponent(phone),
      qrData,
      formattedExpiry
    ));
    
  } catch (error) {
    console.error('Error loading success page:', error);
    res.redirect('/');
  }
});

// Check pairing status (for bot integration)
app.get('/api/pairing-status/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    const pairingRecord = await PairingCode.findOne({ pairingCode: code });
    
    if (!pairingRecord) {
      return res.json({
        success: false,
        error: 'Code not found'
      });
    }
    
    res.json({
      success: true,
      status: pairingRecord.status,
      phoneNumber: pairingRecord.fullNumber,
      sessionId: pairingRecord.sessionId,
      createdAt: pairingRecord.createdAt,
      expiresAt: pairingRecord.expiresAt,
      linkedAt: pairingRecord.linkedAt
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update pairing status (called by bot when linked)
app.post('/api/pairing-linked/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    const pairingRecord = await PairingCode.findOneAndUpdate(
      { pairingCode: code },
      {
        status: 'active',
        linkedAt: new Date()
      },
      { new: true }
    );
    
    if (!pairingRecord) {
      return res.status(404).json({
        success: false,
        error: 'Code not found'
      });
    }
    
    // Update bot session
    await BotSession.findOneAndUpdate(
      { sessionId: pairingRecord.sessionId },
      {
        status: 'active',
        lastActive: new Date()
      }
    );
    
    res.json({
      success: true,
      message: 'Pairing marked as active'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'IAN TECH Pairing Service',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// ==================== INTEGRATION WITH YOUR BOT ====================

// This function should be called from your WhatsApp bot when a pairing code is used
async function verifyPairingCodeInBot(pairingCode) {
  try {
    const response = await fetch(`http://localhost:${process.env.PORT || 3001}/api/pairing-status/${pairingCode}`);
    const data = await response.json();
    
    if (data.success && data.status === 'pending') {
      // Mark as linked
      await fetch(`http://localhost:${process.env.PORT || 3001}/api/pairing-linked/${pairingCode}`, {
        method: 'POST'
      });
      
      return {
        valid: true,
        phoneNumber: data.phoneNumber,
        sessionId: data.sessionId
      };
    }
    
    return {
      valid: false,
      reason: data.status === 'active' ? 'Code already used' : 'Invalid code'
    };
    
  } catch (error) {
    return {
      valid: false,
      reason: 'Verification failed'
    };
  }
}

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('   🤖 IAN TECH WHATSAPP PAIRING SERVICE');
  console.log('   🔗 Users enter phone → Get code → Link WhatsApp');
  console.log('═'.repeat(60));
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`🌐 Landing page: http://localhost:${PORT}`);
  console.log(`📱 API endpoint: http://localhost:${PORT}/api/generate-code`);
  console.log(`🔧 Health check: http://localhost:${PORT}/health`);
  console.log('\n📝 How it works:');
  console.log('   1. User enters phone number on landing page');
  console.log('   2. System generates 6-digit pairing code');
  console.log('   3. User opens WhatsApp → Linked Devices');
  console.log('   4. User enters pairing code');
  console.log('   5. Your bot verifies and links the device');
  console.log('\n🚀 Ready for deployment to Render/Heroku!');
});