const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
let isQRReady = false;
let pairingCodes = new Map();
let botStatus = 'initializing';

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
    // If missing either, regenerate
    return generateAlphanumericCode();
  }
  
  return code;
}

function generateSessionId() {
  return `${CONFIG.SESSION_PREFIX}_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// ==================== WHATSAPP BOT INITIALIZATION ====================
async function initWhatsApp() {
  console.log(`${CONFIG.COMPANY_NAME} - Initializing WhatsApp connection...`);
  botStatus = 'connecting';
  
  try {
    // Create auth directory if it doesn't exist
    const authDir = path.join(__dirname, 'auth_info');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: require('pino')({ level: 'silent' }),
      browser: [`${CONFIG.COMPANY_NAME} Pairing`, "Chrome", "120.0.0.0"]
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update;
      
      if (qr) {
        console.log(`\n✅ ${CONFIG.COMPANY_NAME} - QR Code Generated`);
        currentQR = qr;
        isQRReady = true;
        botStatus = 'qr_ready';
        
        console.log('\n📱 SCAN THIS QR WITH WHATSAPP:');
        qrcode.generate(qr, { small: true });
        console.log('\n');
      }
      
      if (connection === 'open') {
        console.log(`✅ ${CONFIG.COMPANY_NAME} - WhatsApp Bot is ONLINE`);
        console.log(`📞 Bot User ID:`, sock.user?.id || 'Not available');
        isQRReady = false;
        currentQR = null;
        botStatus = 'online';
        
        // Update all pending codes to linked status
        for (const [code, data] of pairingCodes.entries()) {
          if (data.status === 'pending') {
            data.status = 'linked';
            data.linkedAt = new Date();
            data.linkedTo = sock.user?.id;
            data.sessionId = generateSessionId();
            pairingCodes.set(code, data);
          }
        }
      }
      
      if (connection === 'close') {
        console.log('⚠️ Connection closed. Reconnecting in 15s...');
        botStatus = 'reconnecting';
        setTimeout(initWhatsApp, 15000);
      }
    });

    sock.ev.on('creds.update', saveCreds);
    
    activeSocket = sock;
    console.log(`🤖 ${CONFIG.COMPANY_NAME} Bot client initialized`);
    return sock;
    
  } catch (error) {
    console.error(`❌ ${CONFIG.COMPANY_NAME} - WhatsApp init failed:`, error.message);
    botStatus = 'error';
    console.log('Retrying in 20 seconds...');
    setTimeout(initWhatsApp, 20000);
  }
}

// ==================== PAIRING CODE MANAGEMENT ====================
function generateNewPairingCode() {
  let code;
  let attempts = 0;
  
  do {
    code = generateAlphanumericCode();
    attempts++;
  } while (pairingCodes.has(code) && attempts < 10);
  
  if (attempts >= 10) {
    // Fallback to ensure uniqueness
    code = generateAlphanumericCode() + '_' + Date.now().toString().slice(-4);
  }
  
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + CONFIG.CODE_EXPIRY_MINUTES * 60 * 1000);
  
  pairingCodes.set(code, {
    code: code,
    sessionId: sessionId,
    status: 'pending',
    createdAt: new Date(),
    expiresAt: expiresAt,
    linkedAt: null,
    linkedTo: null,
    qrData: currentQR,
    attempts: 0
  });
  
  console.log(`🔤 Generated alphanumeric code: ${code} (Session: ${sessionId})`);
  
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

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

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
              --accent-color: #667eea;
              --dark-color: #075E54;
          }
          
          * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
          }
          
          body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
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
              box-shadow: 0 25px 75px rgba(0,0,0,0.3);
              max-width: 550px;
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
          
          .logo-container {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 15px;
              margin-bottom: 20px;
          }
          
          .logo-img {
              width: 60px;
              height: 60px;
              border-radius: 12px;
              object-fit: cover;
              border: 3px solid var(--primary-color);
          }
          
          h1 {
              color: var(--dark-color);
              font-size: 32px;
              font-weight: 700;
              margin-bottom: 10px;
          }
          
          .subtitle {
              color: #666;
              font-size: 16px;
              line-height: 1.5;
          }
          
          .status-card {
              background: #f8f9fa;
              border-radius: 15px;
              padding: 20px;
              margin: 25px 0;
              border-left: 4px solid var(--accent-color);
          }
          
          .status-item {
              display: flex;
              justify-content: space-between;
              margin-bottom: 10px;
              padding-bottom: 10px;
              border-bottom: 1px solid #eee;
          }
          
          .status-label {
              color: #666;
              font-weight: 500;
          }
          
          .status-value {
              color: var(--dark-color);
              font-weight: 600;
          }
          
          .status-value.online { color: var(--primary-color); }
          .status-value.offline { color: #ff6b6b; }
          .status-value.ready { color: #4cd964; }
          
          .code-section {
              background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
              color: white;
              padding: 30px;
              border-radius: 18px;
              margin: 30px 0;
              text-align: center;
              position: relative;
              overflow: hidden;
          }
          
          .code-section::before {
              content: '';
              position: absolute;
              top: -50%;
              left: -50%;
              width: 200%;
              height: 200%;
              background: radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px);
              background-size: 20px 20px;
              animation: moveBackground 20s linear infinite;
          }
          
          @keyframes moveBackground {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
          }
          
          .pairing-code {
              font-size: 56px;
              font-weight: 800;
              letter-spacing: 8px;
              margin: 25px 0;
              font-family: 'Courier New', monospace;
              text-shadow: 2px 4px 8px rgba(0,0,0,0.2);
              position: relative;
              z-index: 1;
          }
          
          .qr-container {
              margin: 30px auto;
              padding: 25px;
              background: white;
              border-radius: 18px;
              display: inline-block;
              box-shadow: 0 15px 35px rgba(0,0,0,0.1);
              position: relative;
              z-index: 1;
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
              min-width: 180px;
          }
          
          .btn-primary {
              background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
              color: white;
          }
          
          .btn-secondary {
              background: linear-gradient(135deg, var(--accent-color) 0%, #764ba2 100%);
              color: white;
          }
          
          .btn:hover {
              transform: translateY(-3px);
              box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          }
          
          .btn:active {
              transform: translateY(0);
          }
          
          .instructions {
              background: #f8f9fa;
              border-radius: 15px;
              padding: 25px;
              margin-top: 30px;
              border-left: 4px solid var(--primary-color);
          }
          
          .instructions h4 {
              color: var(--dark-color);
              margin-bottom: 15px;
              display: flex;
              align-items: center;
              gap: 10px;
          }
          
          ol {
              padding-left: 20px;
              color: #555;
              line-height: 1.8;
          }
          
          li {
              margin-bottom: 10px;
          }
          
          .footer {
              text-align: center;
              margin-top: 30px;
              color: #888;
              font-size: 14px;
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
              animation: slideIn 0.3s ease-out;
          }
          
          @keyframes slideIn {
              from { opacity: 0; transform: translateX(100%); }
              to { opacity: 1; transform: translateX(0); }
          }
          
          .counter {
              background: rgba(255,255,255,0.2);
              padding: 8px 16px;
              border-radius: 20px;
              font-size: 14px;
              margin-top: 10px;
              display: inline-block;
          }
          
          @media (max-width: 600px) {
              .container {
                  padding: 25px;
              }
              
              .pairing-code {
                  font-size: 40px;
                  letter-spacing: 4px;
              }
              
              .controls {
                  flex-direction: column;
              }
              
              .btn {
                  width: 100%;
              }
          }
      </style>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  </head>
  <body>
      <div class="notification" id="notification"></div>
      
      <div class="container">
          <div class="header">
              <div class="logo-container">
                  <img src="${CONFIG.LOGO_URL}" alt="${CONFIG.COMPANY_NAME} Logo" class="logo-img">
                  <div>
                      <h1>${CONFIG.COMPANY_NAME}</h1>
                      <p class="subtitle">WhatsApp Device Pairing Service</p>
                  </div>
              </div>
          </div>
          
          <div class="status-card">
              <div class="status-item">
                  <span class="status-label">Bot Status:</span>
                  <span class="status-value" id="botStatus">Checking...</span>
              </div>
              <div class="status-item">
                  <span class="status-label">Connection:</span>
                  <span class="status-value" id="connectionStatus">Initializing</span>
              </div>
              <div class="status-item">
                  <span class="status-label">Active Codes:</span>
                  <span class="status-value" id="activeCodes">0</span>
              </div>
              <div class="status-item">
                  <span class="status-label">Session ID:</span>
                  <span class="status-value" id="sessionId">Generating...</span>
              </div>
          </div>
          
          <div id="codeDisplaySection" style="display: none;">
              <div class="code-section">
                  <h3 style="color: white; margin-bottom: 15px;">
                      <i class="fas fa-key"></i> Your Pairing Code
                  </h3>
                  <div id="pairingCodeDisplay" class="pairing-code">A1B2C3D4</div>
                  <div class="counter" id="expiryTimer">Expires in 10:00</div>
              </div>
              
              <div id="qrDisplayContainer" style="text-align: center; display: none;">
                  <div class="qr-container">
                      <h4 style="color: #333; margin-bottom: 15px;">
                          <i class="fas fa-qrcode"></i> Scan QR Code
                      </h4>
                      <img id="qrImage" alt="WhatsApp QR Code">
                      <p style="color: #666; margin-top: 15px; font-size: 14px;">
                          Open WhatsApp → Linked Devices → Scan QR Code
                      </p>
                  </div>
              </div>
          </div>
          
          <div class="controls">
              <button class="btn btn-primary" onclick="getAlphanumericCode()">
                  <i class="fas fa-key"></i> Get Alphanumeric Code
              </button>
              <button class="btn btn-secondary" onclick="getQRCode()">
                  <i class="fas fa-qrcode"></i> Get QR Code
              </button>
              <button class="btn" onclick="copyCode()" style="background: #6c757d; color: white;">
                  <i class="fas fa-copy"></i> Copy Code
              </button>
          </div>
          
          <div class="instructions">
              <h4><i class="fas fa-info-circle"></i> How to Link Your Device</h4>
              <p><strong>Option 1 - Alphanumeric Code:</strong></p>
              <ol>
                  <li>Click "Get Alphanumeric Code" to generate a unique code</li>
                  <li>Open WhatsApp on your mobile device</li>
                  <li>Go to <strong>Settings → Linked Devices → Link a Device</strong></li>
                  <li>Select <strong>"Use pairing code instead"</strong></li>
                  <li>Enter the 8-character code (letters and numbers)</li>
                  <li>Tap <strong>Link</strong> to connect</li>
              </ol>
              <p><strong>Option 2 - QR Code:</strong></p>
              <ol>
                  <li>Click "Get QR Code" to display QR</li>
                  <li>Open WhatsApp → Linked Devices → Link a Device</li>
                  <li>Tap <strong>Scan QR Code</strong></li>
                  <li>Point your camera at the QR code above</li>
              </ol>
          </div>
          
          <div class="footer">
              <p>🔒 Secure & Encrypted Connection | ⚡ Powered by ${CONFIG.COMPANY_NAME}</p>
              <p style="font-size: 12px; margin-top: 10px;">Session IDs begin with: ${CONFIG.SESSION_PREFIX}</p>
          </div>
      </div>
      
      <script>
          let currentCode = '';
          let currentSessionId = '';
          let expiryTime = null;
          let expiryInterval = null;
          
          async function updateStatus() {
              try {
                  const response = await fetch('/status');
                  const data = await response.json();
                  
                  document.getElementById('botStatus').textContent = data.bot.charAt(0).toUpperCase() + data.bot.slice(1);
                  document.getElementById('botStatus').className = 'status-value ' + data.bot;
                  
                  document.getElementById('connectionStatus').textContent = data.hasQR ? 'QR Ready' : data.bot === 'online' ? 'Connected' : 'Connecting';
                  document.getElementById('connectionStatus').className = 'status-value ' + (data.bot === 'online' ? 'online' : data.hasQR ? 'ready' : 'offline');
                  
                  document.getElementById('activeCodes').textContent = data.pairingCodes;
                  document.getElementById('sessionId').textContent = currentSessionId || 'Not generated';
              } catch (error) {
                  console.log('Status update error:', error);
              }
          }
          
          async function getAlphanumericCode() {
              try {
                  const response = await fetch('/generate-code');
                  const data = await response.json();
                  
                  if (data.success) {
                      currentCode = data.code;
                      currentSessionId = data.sessionId;
                      expiryTime = new Date(data.expiresAt);
                      
                      // Display the code
                      document.getElementById('pairingCodeDisplay').textContent = currentCode;
                      document.getElementById('codeDisplaySection').style.display = 'block';
                      document.getElementById('qrDisplayContainer').style.display = 'none';
                      document.getElementById('sessionId').textContent = currentSessionId;
                      
                      // Start expiry timer
                      startExpiryTimer();
                      
                      // Auto-copy to clipboard
                      setTimeout(copyCode, 1000);
                      
                      showNotification('✅ Alphanumeric code generated and copied!', 'success');
                  } else {
                      showNotification('❌ ' + data.message, 'error');
                  }
              } catch (error) {
                  showNotification('❌ Network error. Please try again.', 'error');
              }
          }
          
          async function getQRCode() {
              try {
                  const response = await fetch('/getqr');
                  const data = await response.json();
                  
                  if (data.success && data.qrImage) {
                      document.getElementById('qrImage').src = data.qrImage;
                      document.getElementById('qrDisplayContainer').style.display = 'block';
                      document.getElementById('codeDisplaySection').style.display = 'block';
                      
                      if (data.pairingCode) {
                          currentCode = data.pairingCode;
                          currentSessionId = data.sessionId || generateSessionId();
                          expiryTime = new Date(Date.now() + ${CONFIG.CODE_EXPIRY_MINUTES} * 60000);
                          
                          document.getElementById('pairingCodeDisplay').textContent = currentCode;
                          document.getElementById('sessionId').textContent = currentSessionId;
                          startExpiryTimer();
                      }
                      
                      showNotification('✅ QR Code displayed. Scan with WhatsApp!', 'success');
                  } else {
                      showNotification(data.message || 'QR code not ready yet', 'warning');
                  }
              } catch (error) {
                  showNotification('❌ Error loading QR code', 'error');
              }
          }
          
          function copyCode() {
              if (!currentCode) {
                  showNotification('❌ No code to copy', 'warning');
                  return;
              }
              
              navigator.clipboard.writeText(currentCode).then(() => {
                  showNotification('✅ Code copied to clipboard: ' + currentCode, 'success');
              }).catch(() => {
                  // Fallback for older browsers
                  const textArea = document.createElement('textarea');
                  textArea.value = currentCode;
                  document.body.appendChild(textArea);
                  textArea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textArea);
                  showNotification('✅ Code copied: ' + currentCode, 'success');
              });
          }
          
          function startExpiryTimer() {
              if (expiryInterval) clearInterval(expiryInterval);
              
              function updateTimer() {
                  if (!expiryTime) return;
                  
                  const now = new Date();
                  const diff = expiryTime - now;
                  
                  if (diff <= 0) {
                      document.getElementById('expiryTimer').textContent = 'EXPIRED';
                      clearInterval(expiryInterval);
                      showNotification('⚠️ Code has expired. Generate a new one.', 'warning');
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
              notification.style.background = type === 'success' ? '#25D366' : type === 'error' ? '#ff6b6b' : '#ffa502';
              notification.style.display = 'block';
              
              setTimeout(() => {
                  notification.style.display = 'none';
              }, 3000);
          }
          
          function generateSessionId() {
              return '${CONFIG.SESSION_PREFIX}_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6).toUpperCase();
          }
          
          // Initial status update
          updateStatus();
          setInterval(updateStatus, 3000);
      </script>
  </body>
  </html>
  `);
});

// ==================== API ENDPOINTS ====================
app.get('/generate-code', (req, res) => {
  try {
    if (!isQRReady && botStatus !== 'online') {
      return res.json({ 
        success: false, 
        message: 'WhatsApp connection not ready. Please wait...' 
      });
    }
    
    const { code, sessionId, expiresAt } = generateNewPairingCode();
    
    res.json({ 
      success: true, 
      code: code,
      sessionId: sessionId,
      expiresAt: expiresAt,
      message: `Use this code in WhatsApp: Linked Devices → Link a Device → Use pairing code`
    });
  } catch (error) {
    console.error('Code generation error:', error);
    res.json({ success: false, message: 'Error generating code' });
  }
});

app.get('/getqr', async (req, res) => {
  try {
    if (currentQR && isQRReady) {
      const qrImageDataUrl = await QRCode.toDataURL(currentQR);
      const { code, sessionId } = generateNewPairingCode();
      
      res.json({ 
        success: true, 
        qrImage: qrImageDataUrl,
        pairingCode: code,
        sessionId: sessionId,
        message: 'Scan QR with WhatsApp or use the pairing code'
      });
    } else if (botStatus === 'online') {
      const { code, sessionId } = generateNewPairingCode();
      
      res.json({ 
        success: true, 
        qrImage: null,
        pairingCode: code,
        sessionId: sessionId,
        message: '✅ Bot is online. Use the pairing code to link.'
      });
    } else {
      res.json({ 
        success: false, 
        message: 'QR code not ready yet. Bot status: ' + botStatus 
      });
    }
  } catch (error) {
    console.error('QR error:', error);
    res.json({ success: false, message: 'Error generating QR' });
  }
});

app.get('/check/:code', (req, res) => {
  const { code } = req.params;
  
  if (!pairingCodes.has(code)) {
    return res.json({ 
      valid: false, 
      status: 'not_found',
      message: 'Code not found' 
    });
  }
  
  const codeData = pairingCodes.get(code);
  
  if (Date.now() > new Date(codeData.expiresAt).getTime()) {
    codeData.status = 'expired';
    pairingCodes.set(code, codeData);
    
    return res.json({ 
      valid: false, 
      status: 'expired',
      message: 'Code has expired' 
    });
  }
  
  res.json({
    valid: true,
    status: codeData.status,
    sessionId: codeData.sessionId,
    createdAt: codeData.createdAt,
    expiresAt: codeData.expiresAt,
    linkedTo: codeData.linkedTo,
    attempts: codeData.attempts || 0
  });
});

app.post('/verify/:code', (req, res) => {
  const { code } = req.params;
  
  if (!pairingCodes.has(code)) {
    return res.json({ 
      success: false, 
      valid: false,
      message: 'Invalid code' 
    });
  }
  
  const codeData = pairingCodes.get(code);
  
  // Check expiry
  if (Date.now() > new Date(codeData.expiresAt).getTime()) {
    codeData.status = 'expired';
    pairingCodes.set(code, codeData);
    
    return res.json({ 
      success: false, 
      valid: false,
      status: 'expired' 
    });
  }
  
  // Increment attempt counter
  codeData.attempts = (codeData.attempts || 0) + 1;
  pairingCodes.set(code, codeData);
  
  // If bot is online, mark as linked
  if (botStatus === 'online' && codeData.status === 'pending') {
    codeData.status = 'linked';
    codeData.linkedAt = new Date();
    codeData.linkedTo = activeSocket?.user?.id || 'unknown';
    pairingCodes.set(code, codeData);
  }
  
  res.json({
    success: true,
    valid: true,
    status: codeData.status,
    sessionId: codeData.sessionId,
    attempts: codeData.attempts,
    message: codeData.status === 'linked' ? 'Device linked successfully!' : 'Code is valid'
  });
});

app.get('/status', (req, res) => {
  res.json({ 
    bot: botStatus,
    hasQR: isQRReady,
    pairingCodes: pairingCodes.size,
    activeSocket: !!activeSocket,
    online: botStatus === 'online',
    company: CONFIG.COMPANY_NAME,
    sessionPrefix: CONFIG.SESSION_PREFIX,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  const health = {
    status: 'running',
    version: '5.0.0',
    company: CONFIG.COMPANY_NAME,
    bot: {
      status: botStatus,
      online: botStatus === 'online',
      hasQR: isQRReady
    },
    codes: {
      total: pairingCodes.size,
      pending: Array.from(pairingCodes.values()).filter(c => c.status === 'pending').length,
      linked: Array.from(pairingCodes.values()).filter(c => c.status === 'linked').length
    },
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: process.platform
    },
    sessionIds: Array.from(pairingCodes.values()).map(c => c.sessionId).filter(id => id && id.startsWith(CONFIG.SESSION_PREFIX))
  };
  
  res.json(health);
});

// ==================== ADMIN ENDPOINTS ====================
app.get('/admin/codes', (req, res) => {
  const codes = Array.from(pairingCodes.entries()).map(([code, data]) => ({
    code,
    sessionId: data.sessionId,
    status: data.status,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    linkedAt: data.linkedAt,
    attempts: data.attempts || 0
  }));
  
  res.json({
    success: true,
    total: codes.length,
    codes: codes
  });
});

app.delete('/admin/cleanup', (req, res) => {
  const before = pairingCodes.size;
  
  for (const [code, data] of pairingCodes.entries()) {
    if (Date.now() > new Date(data.expiresAt).getTime()) {
      pairingCodes.delete(code);
    }
  }
  
  res.json({
    success: true,
    removed: before - pairingCodes.size,
    remaining: pairingCodes.size
  });
});

// ==================== START SERVER ====================
// Initialize WhatsApp bot
initWhatsApp();

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '═'.repeat(65));
  console.log(`   🤖 ${CONFIG.COMPANY_NAME} WHATSAPP PAIRING SERVICE v5.0.0`);
  console.log('   🔗 Server: http://0.0.0.0:' + PORT);
  console.log('   🎯 Features: Alphanumeric Codes + QR + Session Management');
  console.log('═'.repeat(65));
  console.log('\n📊 CONFIGURATION:');
  console.log(`   • Company: ${CONFIG.COMPANY_NAME}`);
  console.log(`   • Session Prefix: ${CONFIG.SESSION_PREFIX}`);
  console.log(`   • Code Length: ${CONFIG.CODE_LENGTH} characters`);
  console.log(`   • Code Expiry: ${CONFIG.CODE_EXPIRY_MINUTES} minutes`);
  console.log(`   • Logo URL: ${CONFIG.LOGO_URL}`);
  console.log('═'.repeat(65));
  console.log('🚀 Server started successfully!');
  console.log(`🌐 Visit: https://bot-pairing-2-1--ianmuhaz76.replit.app`);
  console.log('🔧 Health Check: /health');
  console.log('📊 Admin Panel: /admin/codes');
  console.log('═'.repeat(65));
  
  // Periodic cleanup
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
  }, 60000); // Every minute
});
