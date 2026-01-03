
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== CONFIGURATION ====================
const CONFIG = {
  COMPANY_NAME: "IAN TECH",
  SESSION_PREFIX: "IAN TECH",
  LOGO_URL: "https://files.catbox.moe/fkelmv.jpg",
  CODE_LENGTH: 8,
  CODE_EXPIRY_MINUTES: 10
};

// ==================== GLOBAL STATE ====================
let activeSocket = null;
let currentQR = null;
let qrImageDataUrl = null;
let pairingCodes = new Map();
let botStatus = 'disconnected';

// ==================== UTILITY FUNCTIONS ====================
function generateAlphanumericCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  
  for (let i = 0; i < CONFIG.CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Ensure it contains both letters and numbers
  const hasLetters = /[A-Z]/.test(code);
  const hasNumbers = /[0-9]/.test(code);
  
  if (!hasLetters || !hasNumbers) {
    return generateAlphanumericCode();
  }
  
  return code;
}

function generateSessionId() {
  return `${CONFIG.SESSION_PREFIX}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// ==================== CLEAN AUTH FOLDER ====================
function cleanAuthFolder() {
  try {
    const authDir = path.join(__dirname, 'auth_info');
    
    // Delete auth folder if it exists
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      console.log(`🗑️ Deleted existing auth_info folder`);
    }
    
    // Create fresh auth directory
    fs.mkdirSync(authDir, { recursive: true });
    console.log(`📁 Created fresh auth_info folder`);
    
    return authDir;
  } catch (error) {
    console.error('Error cleaning auth folder:', error);
    return path.join(__dirname, 'auth_info');
  }
}

// ==================== WHATSAPP BOT INITIALIZATION ====================
async function initWhatsApp() {
  console.log(`${CONFIG.COMPANY_NAME} - Initializing WhatsApp connection...`);
  botStatus = 'connecting';
  
  try {
    // Clean and create fresh auth folder
    const authDir = cleanAuthFolder();
    
    // Initialize fresh authentication state
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    
    // Create WhatsApp socket with fresh credentials
    const sock = makeWASocket({
      auth: state,
      logger: require('pino')({ level: 'error' }),
      browser: ['IAN TECH Bot', 'Chrome', '120.0.0.0'],
      printQRInTerminal: true
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;
      
      if (qr) {
        console.log(`\n✅ QR Code Generated!`);
        console.log(`📱 Scan this QR code with WhatsApp to link the bot`);
        currentQR = qr;
        botStatus = 'qr_ready';
        
        try {
          // Generate QR code image for web display
          qrImageDataUrl = await QRCode.toDataURL(qr);
          console.log(`🌐 QR code ready for web display`);
          
        } catch (error) {
          console.error('QR generation error:', error);
        }
      }
      
      if (connection === 'open') {
        console.log(`\n✅ ${CONFIG.COMPANY_NAME} - WhatsApp Bot is ONLINE`);
        console.log(`📞 Connected to:`, sock.user?.id || 'Unknown');
        botStatus = 'online';
        
        // Mark all pending codes as linked
        for (const [code, data] of pairingCodes.entries()) {
          if (data.status === 'pending') {
            data.status = 'linked';
            data.linkedAt = new Date();
            data.linkedTo = sock.user?.id;
            pairingCodes.set(code, data);
          }
        }
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`⚠️ Connection closed. Status code: ${statusCode}`);
        
        if (statusCode === 401) {
          // Unauthorized - need new QR scan
          console.log(`🔄 Authentication expired. Cleaning up and restarting...`);
          cleanAuthFolder();
          setTimeout(initWhatsApp, 3000);
        } else {
          // Other error - try reconnection
          console.log(`🔄 Reconnecting in 10 seconds...`);
          botStatus = 'reconnecting';
          setTimeout(initWhatsApp, 10000);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
    
    activeSocket = sock;
    console.log(`🤖 ${CONFIG.COMPANY_NAME} Bot client ready - Waiting for QR scan`);
    return sock;
    
  } catch (error) {
    console.error(`❌ WhatsApp initialization failed:`, error.message);
    botStatus = 'error';
    console.log(`🔄 Retrying in 15 seconds...`);
    setTimeout(initWhatsApp, 15000);
  }
}

// ==================== PAIRING CODE MANAGEMENT ====================
function generateNewPairingCode(phoneNumber = null) {
  let code;
  let attempts = 0;
  
  do {
    code = generateAlphanumericCode();
    attempts++;
  } while (pairingCodes.has(code) && attempts < 10);
  
  if (attempts >= 10) {
    code = generateAlphanumericCode() + '_' + Date.now().toString().slice(-4);
  }
  
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + CONFIG.CODE_EXPIRY_MINUTES * 60 * 1000);
  
  pairingCodes.set(code, {
    code: code,
    phoneNumber: phoneNumber,
    sessionId: sessionId,
    status: 'pending',
    createdAt: new Date(),
    expiresAt: expiresAt,
    linkedAt: null,
    linkedTo: null,
    attempts: 0
  });
  
  console.log(`🔤 Generated pairing code for ${phoneNumber || 'anonymous'}: ${code}`);
  
  // Auto-cleanup after expiry
  setTimeout(() => {
    if (pairingCodes.has(code) && pairingCodes.get(code).status === 'pending') {
      pairingCodes.delete(code);
      console.log(`🗑️ Expired code removed: ${code}`);
    }
  }, CONFIG.CODE_EXPIRY_MINUTES * 60 * 1000);
  
  return { code, sessionId, expiresAt };
}

// ==================== EXPRESS SERVER SETUP ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== ROUTES ====================
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>${CONFIG.COMPANY_NAME} WhatsApp Pairing</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
          :root {
              --primary-color: #25D366;
              --secondary-color: #128C7E;
              --dark-color: #075E54;
          }
          
          body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              display: flex;
              align-items: center;
              justify-content: center;
          }
          
          .container {
              background: white;
              border-radius: 24px;
              padding: 40px;
              box-shadow: 0 25px 75px rgba(0,0,0,0.3);
              max-width: 550px;
              width: 100%;
              text-align: center;
          }
          
          .header {
              margin-bottom: 30px;
          }
          
          .logo-img {
              width: 80px;
              height: 80px;
              border-radius: 20px;
              object-fit: cover;
              border: 4px solid var(--primary-color);
              margin-bottom: 20px;
          }
          
          h1 {
              color: var(--dark-color);
              font-size: 32px;
              margin-bottom: 10px;
          }
          
          .subtitle {
              color: #666;
              font-size: 16px;
              margin-bottom: 30px;
          }
          
          .status-badge {
              display: inline-block;
              padding: 8px 20px;
              border-radius: 50px;
              font-weight: 600;
              margin-bottom: 20px;
          }
          
          .status-online { background: #d4edda; color: #155724; }
          .status-qr { background: #fff3cd; color: #856404; }
          .status-offline { background: #f8d7da; color: #721c24; }
          
          /* Phone Number Input Styling */
          .phone-input-container {
              background: #f8f9fa;
              border-radius: 15px;
              padding: 25px;
              margin: 25px 0;
              text-align: left;
              border: 2px dashed #dee2e6;
          }
          
          .phone-input-group {
              display: flex;
              gap: 10px;
              margin-top: 15px;
          }
          
          .country-code {
              background: #e9ecef;
              padding: 12px 15px;
              border-radius: 10px;
              font-weight: 600;
              color: #495057;
              min-width: 80px;
              text-align: center;
          }
          
          input[type="tel"] {
              flex: 1;
              padding: 12px 20px;
              border: 2px solid #dee2e6;
              border-radius: 10px;
              font-size: 16px;
              transition: border-color 0.3s;
          }
          
          input[type="tel"]:focus {
              outline: none;
              border-color: var(--primary-color);
          }
          
          .example-text {
              color: #6c757d;
              font-size: 14px;
              margin-top: 10px;
              font-style: italic;
          }
          
          /* Code Display Styling */
          .code-display {
              background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
              color: white;
              padding: 30px;
              border-radius: 18px;
              margin: 30px 0;
              font-family: 'Courier New', monospace;
          }
          
          .pairing-code {
              font-size: 48px;
              font-weight: 800;
              letter-spacing: 8px;
              margin: 20px 0;
          }
          
          .qr-container {
              margin: 30px auto;
              padding: 25px;
              background: white;
              border-radius: 18px;
              display: inline-block;
              box-shadow: 0 15px 35px rgba(0,0,0,0.1);
          }
          
          #qrImage {
              width: 280px;
              height: 280px;
              border-radius: 12px;
              border: 2px solid #eee;
          }
          
          .controls {
              display: flex;
              gap: 15px;
              justify-content: center;
              margin: 25px 0;
              flex-wrap: wrap;
          }
          
          .btn {
              padding: 16px 32px;
              border-radius: 50px;
              border: none;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.3s ease;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 10px;
              min-width: 200px;
          }
          
          .btn-primary {
              background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
              color: white;
          }
          
          .btn-secondary {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
          }
          
          .btn:hover {
              transform: translateY(-3px);
              box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          }
          
          .instructions {
              background: #f8f9fa;
              border-radius: 15px;
              padding: 25px;
              margin-top: 30px;
              text-align: left;
              border-left: 4px solid var(--primary-color);
          }
          
          .notification {
              position: fixed;
              top: 20px;
              right: 20px;
              background: var(--primary-color);
              color: white;
              padding: 18px 28px;
              border-radius: 12px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.2);
              display: none;
              z-index: 1000;
          }
          
          @media (max-width: 600px) {
              .container { padding: 25px; }
              .pairing-code { font-size: 36px; letter-spacing: 4px; }
              .controls { flex-direction: column; }
              .btn { width: 100%; }
              .phone-input-group { flex-direction: column; }
          }
      </style>
  </head>
  <body>
      <div class="notification" id="notification"></div>
      
      <div class="container">
          <div class="header">
              <img src="${CONFIG.LOGO_URL}" alt="${CONFIG.COMPANY_NAME} Logo" class="logo-img">
              <h1>${CONFIG.COMPANY_NAME}</h1>
              <p class="subtitle">WhatsApp Device Pairing Service v5.3</p>
              
              <div id="statusBadge" class="status-badge status-offline">
                  <span id="statusText">Disconnected</span>
              </div>
          </div>
          
          <!-- Connection Status -->
          <div id="connectionInfo" style="display: none;" class="phone-input-container">
              <h3 style="color: var(--dark-color); margin-bottom: 15px;">
                  <span>🔗</span> Connection Status
              </h3>
              <p id="connectionMessage" style="color: #6c757d; margin-bottom: 15px;">
                  Waiting for WhatsApp connection...
              </p>
          </div>
          
          <!-- Phone Number Input Section -->
          <div class="phone-input-container">
              <h3 style="color: var(--dark-color); margin-bottom: 15px;">
                  <span>📱</span> Enter Your WhatsApp Number
              </h3>
              <p style="color: #6c757d; margin-bottom: 15px;">
                  Enter your phone number to receive a personalized pairing code
              </p>
              
              <div class="phone-input-group">
                  <div class="country-code">+254</div>
                  <input 
                      type="tel" 
                      id="phoneNumber" 
                      placeholder="723 278 526"
                      pattern="[0-9]{9}"
                      maxlength="9"
                      title="Enter 9-digit Kenyan phone number"
                  >
              </div>
              
              <p class="example-text">Example: 723 278 526 (your number)</p>
          </div>
          
          <!-- Code Display Section -->
          <div id="codeSection" style="display: none;">
              <div class="code-display">
                  <h3>Your Pairing Code</h3>
                  <div id="pairingCodeDisplay" class="pairing-code">A1B2C3D4</div>
                  <div id="phoneDisplay" style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 10px 0;">
                      For: <span id="registeredPhone"></span>
                  </div>
                  <div id="expiryTimer" style="color: rgba(255,255,255,0.9);">Expires in 10:00</div>
              </div>
          </div>
          
          <!-- QR Code Section -->
          <div id="qrSection" style="display: none;">
              <div class="qr-container">
                  <h3>Scan QR Code</h3>
                  <img id="qrImage" alt="WhatsApp QR Code">
                  <p style="color: #666; margin-top: 15px;">
                      Open WhatsApp → Linked Devices → Scan QR Code
                  </p>
              </div>
          </div>
          
          <!-- Control Buttons -->
          <div class="controls">
              <button class="btn btn-primary" onclick="getPairingCode()" id="generateBtn">
                  <span>🔢</span> Generate Code
              </button>
              <button class="btn btn-secondary" onclick="getQRCode()" id="qrBtn">
                  <span>📱</span> Get QR Code
              </button>
              <button class="btn" onclick="copyCode()" style="background: #6c757d; color: white;" id="copyBtn">
                  <span>📋</span> Copy Code
              </button>
          </div>
          
          <!-- Instructions -->
          <div class="instructions">
              <h4>How to Link Your Device</h4>
              <p><strong>Step 1: Link the Bot</strong></p>
              <p>Check the Replit console for a QR code. Scan it with WhatsApp to link the bot first.</p>
              
              <p><strong>Option 1 - QR Code:</strong></p>
              <ol>
                  <li>Enter your phone number above</li>
                  <li>Click "Get QR Code"</li>
                  <li>Open WhatsApp → Linked Devices → Link a Device</li>
                  <li>Tap "Scan QR Code" and scan the code</li>
              </ol>
              <p><strong>Option 2 - 8-Digit Code:</strong></p>
              <ol>
                  <li>Enter your phone number above</li>
                  <li>Click "Generate Code"</li>
                  <li>Copy the 8-character code</li>
                  <li>Open WhatsApp → Linked Devices → Link a Device</li>
                  <li>Tap "Use pairing code instead"</li>
                  <li>Enter the code: <span id="exampleCode">A1B2C3D4</span></li>
              </ol>
          </div>
          
          <div style="margin-top: 30px; color: #888; font-size: 14px;">
              <p>🔒 Secure Connection | ⚡ Powered by ${CONFIG.COMPANY_NAME}</p>
          </div>
      </div>
      
      <script>
          let currentCode = '';
          let currentPhone = '';
          let expiryInterval = null;
          
          // Format phone number as user types
          document.getElementById('phoneNumber').addEventListener('input', function(e) {
              let value = e.target.value.replace(/\D/g, '');
              if (value.length > 3 && value.length <= 6) {
                  value = value.replace(/(\d{3})(\d+)/, '$1 $2');
              } else if (value.length > 6) {
                  value = value.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
              }
              e.target.value = value;
          });
          
          function validatePhoneNumber(phone) {
              const cleanPhone = phone.replace(/\D/g, '');
              return cleanPhone.length === 9 && /^[0-9]+$/.test(cleanPhone);
          }
          
          async function updateStatus() {
              try {
                  const response = await fetch('/status');
                  const data = await response.json();
                  
                  const statusBadge = document.getElementById('statusBadge');
                  const statusText = document.getElementById('statusText');
                  const connectionInfo = document.getElementById('connectionInfo');
                  const connectionMessage = document.getElementById('connectionMessage');
                  
                  if (data.bot === 'online') {
                      statusBadge.className = 'status-badge status-online';
                      statusText.textContent = 'ONLINE';
                      connectionInfo.style.display = 'block';
                      connectionMessage.textContent = '✅ Bot is connected and ready!';
                      document.getElementById('generateBtn').disabled = false;
                      document.getElementById('qrBtn').disabled = false;
                  } else if (data.bot === 'qr_ready') {
                      statusBadge.className = 'status-badge status-qr';
                      statusText.textContent = 'QR READY';
                      connectionInfo.style.display = 'block';
                      connectionMessage.textContent = '📱 QR code generated! Check Replit console and scan with WhatsApp.';
                      document.getElementById('generateBtn').disabled = false;
                      document.getElementById('qrBtn').disabled = false;
                  } else {
                      statusBadge.className = 'status-badge status-offline';
                      statusText.textContent = 'OFFLINE';
                      connectionInfo.style.display = 'block';
                      connectionMessage.textContent = '⏳ Connecting to WhatsApp... Please wait.';
                      document.getElementById('generateBtn').disabled = true;
                      document.getElementById('qrBtn').disabled = true;
                  }
              } catch (error) {
                  console.log('Status update error:', error);
              }
          }
          
          async function getPairingCode() {
              const phoneInput = document.getElementById('phoneNumber');
              const phone = phoneInput.value.replace(/\D/g, '');
              
              if (!validatePhoneNumber(phone)) {
                  showNotification('❌ Please enter a valid 9-digit phone number', 'error');
                  phoneInput.focus();
                  return;
              }
              
              try {
                  const response = await fetch('/generate-code', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phoneNumber: phone })
                  });
                  
                  const data = await response.json();
                  
                  if (data.success) {
                      currentCode = data.code;
                      currentPhone = '+254' + phone;
                      
                      document.getElementById('pairingCodeDisplay').textContent = currentCode;
                      document.getElementById('registeredPhone').textContent = currentPhone;
                      document.getElementById('exampleCode').textContent = currentCode;
                      document.getElementById('codeSection').style.display = 'block';
                      document.getElementById('qrSection').style.display = 'none';
                      
                      startExpiryTimer(data.expiresAt);
                      showNotification(\`✅ Code generated for \${currentPhone}\`, 'success');
                      setTimeout(copyCode, 500);
                  } else {
                      showNotification('❌ ' + data.message, 'error');
                  }
              } catch (error) {
                  showNotification('❌ Network error', 'error');
              }
          }
          
          async function getQRCode() {
              const phoneInput = document.getElementById('phoneNumber');
              const phone = phoneInput.value.replace(/\D/g, '');
              
              if (!validatePhoneNumber(phone)) {
                  showNotification('❌ Please enter your phone number first', 'error');
                  phoneInput.focus();
                  return;
              }
              
              try {
                  const response = await fetch('/getqr', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ phoneNumber: phone })
                  });
                  
                  const data = await response.json();
                  
                  if (data.success) {
                      if (data.qrImage) {
                          document.getElementById('qrImage').src = data.qrImage;
                          document.getElementById('qrSection').style.display = 'block';
                          document.getElementById('codeSection').style.display = 'block';
                          
                          if (data.pairingCode) {
                              currentCode = data.pairingCode;
                              currentPhone = '+254' + phone;
                              document.getElementById('pairingCodeDisplay').textContent = currentCode;
                              document.getElementById('registeredPhone').textContent = currentPhone;
                              document.getElementById('exampleCode').textContent = currentCode;
                          }
                          
                          showNotification(\`✅ QR Code ready for \${'+254' + phone}\`, 'success');
                      }
                  } else {
                      showNotification(data.message, 'warning');
                  }
              } catch (error) {
                  showNotification('❌ Error loading QR', 'error');
              }
          }
          
          function copyCode() {
              if (!currentCode) {
                  showNotification('❌ No code to copy', 'warning');
                  return;
              }
              
              navigator.clipboard.writeText(currentCode).then(() => {
                  showNotification(\`✅ Copied: \${currentCode}\`, 'success');
              });
          }
          
          function startExpiryTimer(expiryTime) {
              if (expiryInterval) clearInterval(expiryInterval);
              
              const expiryDate = new Date(expiryTime);
              
              function updateTimer() {
                  const now = new Date();
                  const diff = expiryDate - now;
                  
                  if (diff <= 0) {
                      document.getElementById('expiryTimer').textContent = 'EXPIRED';
                      clearInterval(expiryInterval);
                      showNotification('⚠️ Code expired', 'warning');
                      return;
                  }
                  
                  const minutes = Math.floor(diff / 60000);
                  const seconds = Math.floor((diff % 60000) / 1000);
                  
                  document.getElementById('expiryTimer').textContent = 
                      \`Expires in \${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
              }
              
              updateTimer();
              expiryInterval = setInterval(updateTimer, 1000);
          }
          
          function showNotification(message, type) {
              const notification = document.getElementById('notification');
              notification.textContent = message;
              notification.style.background = type === 'success' ? '#25D366' : 
                                            type === 'error' ? '#ff6b6b' : '#ffa502';
              notification.style.display = 'block';
              
              setTimeout(() => {
                  notification.style.display = 'none';
              }, 3000);
          }
          
          // Auto-fill example number on page load
          document.addEventListener('DOMContentLoaded', function() {
              document.getElementById('phoneNumber').value = '723 278 526';
          });
          
          // Initial setup
          updateStatus();
          setInterval(updateStatus, 3000);
      </script>
  </body>
  </html>
  `);
});

// ==================== API ENDPOINTS ====================

// Generate pairing code with phone number
app.post('/generate-code', (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber || !/^[0-9]{9}$/.test(phoneNumber)) {
      return res.json({ 
        success: false, 
        message: 'Please enter a valid 9-digit phone number' 
      });
    }
    
    if (botStatus !== 'qr_ready' && botStatus !== 'online') {
      return res.json({ 
        success: false, 
        message: 'WhatsApp connection not ready. Please scan QR code first.' 
      });
    }
    
    const { code, sessionId, expiresAt } = generateNewPairingCode('+254' + phoneNumber);
    
    res.json({ 
      success: true, 
      code: code,
      phoneNumber: '+254' + phoneNumber,
      sessionId: sessionId,
      expiresAt: expiresAt,
      message: 'Code generated successfully'
    });
  } catch (error) {
    console.error('Code generation error:', error);
    res.json({ success: false, message: 'Error generating code' });
  }
});

// Get QR code with phone number
app.post('/getqr', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber || !/^[0-9]{9}$/.test(phoneNumber)) {
      return res.json({ 
        success: false, 
        message: 'Please enter a valid 9-digit phone number' 
      });
    }
    
    if (botStatus === 'qr_ready' && currentQR) {
      try {
        const qrImageDataUrl = await QRCode.toDataURL(currentQR);
        const { code, sessionId } = generateNewPairingCode('+254' + phoneNumber);
        
        res.json({ 
          success: true, 
          qrImage: qrImageDataUrl,
          pairingCode: code,
          phoneNumber: '+254' + phoneNumber,
          sessionId: sessionId,
          message: 'QR code ready for scanning'
        });
      } catch (qrError) {
        console.error('QR generation error:', qrError);
        res.json({ success: false, message: 'Error generating QR image' });
      }
    } else if (botStatus === 'online') {
      const { code, sessionId } = generateNewPairingCode('+254' + phoneNumber);
      
      res.json({ 
        success: true, 
        qrImage: null,
        pairingCode: code,
        phoneNumber: '+254' + phoneNumber,
        sessionId: sessionId,
        message: 'Bot is online. Use the pairing code to link.'
      });
    } else {
      res.json({ 
        success: false, 
        message: 'QR code not ready yet. Please wait for connection...' 
      });
    }
  } catch (error) {
    console.error('QR error:', error);
    res.json({ success: false, message: 'Error generating QR' });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    bot: botStatus,
    hasQR: botStatus === 'qr_ready',
    pairingCodes: pairingCodes.size,
    company: CONFIG.COMPANY_NAME,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    version: '5.3.0',
    bot: botStatus,
    qrReady: botStatus === 'qr_ready',
    codes: pairingCodes.size
  });
});

// ==================== START SERVER ====================
// Initialize WhatsApp bot with fresh credentials
initWhatsApp();

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '═'.repeat(65));
  console.log(`   🤖 ${CONFIG.COMPANY_NAME} WHATSAPP PAIRING SERVICE v5.3.0`);
  console.log(`   🔗 Server: http://0.0.0.0:${PORT}`);
  console.log('   📱 FEATURE: Fresh authentication on every restart');
  console.log('═'.repeat(65));
  console.log('🚀 Server started!');
  console.log('📱 Please check the CONSOLE for QR code to scan with WhatsApp');
  console.log(`🌐 Web interface: https://bot-pairing-2-1--ianmuhaz76.replit.app`);
  console.log('═'.repeat(65));
});

// Cleanup expired codes every minute
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [code, data] of pairingCodes.entries()) {
    if (now > new Date(data.expiresAt).getTime() && data.status === 'pending') {
      pairingCodes.delete(code);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🔄 Cleaned ${cleaned} expired codes`);
  }
}, 60000);
