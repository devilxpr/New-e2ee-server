import express from "express";
import http from "http";
import fs from "fs";
import login from "stfca";

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// State Variables
let isRunning = false;
let stopRequested = false;
let currentApi = null;
let autoReconnectTimer = null;

const APPSTATE_FILE = "./appstate.json";

// SSE Logs
let logClients = [];
function sendLog(message) {
  console.log(message);
  logClients.forEach((client) => {
    client.res.write(`data: ${JSON.stringify({ message, time: new Date().toLocaleTimeString() })}\n\n`);
  });
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Raw Cookie to AppState Converter
function convertRawToAppState(rawCookieString) {
  const appState = [];
  const cookies = rawCookieString.split(';').map(c => c.trim()).filter(c => c.length > 0);
  
  cookies.forEach(cookie => {
    const [key, ...valueParts] = cookie.split('=');
    const value = valueParts.join('=');
    if (key && value) {
      appState.push({
        key: key.trim(),
        value: value.trim(),
        domain: ".facebook.com",
        path: "/",
        secure: true,
        httpOnly: true
      });
    }
  });
  return appState;
}

// Login Promise Wrapper
function loginAsync(credentials) {
  return new Promise((resolve, reject) => {
    login(credentials, (err, api) => {
      if (err) reject(err);
      else resolve(api);
    });
  });
}

// 🔥 Auto Reconnect Logic
async function attemptReconnect() {
    if (stopRequested || !isRunning) return;
    
    sendLog("🔄 Reconnecting in 5 seconds...");
    await sleep(5);

    if (stopRequested || !isRunning) return;

    try {
        sendLog("🔄 Trying to reconnect...");
        if (!fs.existsSync(APPSTATE_FILE)) {
            sendLog("❌ AppState file not found. Cannot auto-reconnect.");
            isRunning = false;
            return;
        }

        const appState = JSON.parse(fs.readFileSync(APPSTATE_FILE, 'utf-8'));
        currentApi = await loginAsync({ appState, enableE2EE: true });
        await currentApi.connectE2EE();
        sendLog("✅ Reconnected successfully!");
        
        // Restart Messaging Loop if it was running
        if (isRunning && !stopRequested) {
             runMessagingLoop();
        }

    } catch (err) {
        sendLog("❌ Reconnect failed: " + err.message);
        attemptReconnect(); // Keep trying
    }
}

// 🔥 Main Messaging Loop (Separated for reusability)
let messagesList = [];
let prefixText = "";
let targetId = "";
let delayTime = 30;

async function runMessagingLoop() {
    let index = 0;
    while (isRunning && !stopRequested) {
      const currentMsgText = messagesList[index];
      const finalPayloadText = (prefixText ? prefixText + " " : "") + currentMsgText;

      try {
        sendLog(`[SENDING] Sending message to: ${targetId}`);
        await new Promise((res, rej) => {
            currentApi.sendMessage(finalPayloadText, targetId, (err) => err ? rej(err) : res());
        });
        sendLog(`[SUCCESS] Message Sent: "${finalPayloadText}"`);
      } catch (sendError) {
        sendLog(`[SEND ERROR]: ${sendError.message}`);
        if (sendError.message.includes("timeout") || sendError.message.includes("IQ")) {
          try {
            await new Promise((res, rej) => {
                currentApi.sendMessage(finalPayloadText, targetId.split('@')[0], (err) => err ? rej(err) : res());
            });
            sendLog(`[SUCCESS RETRY] Message Sent to raw ID`);
          } catch (retryErr) {
            sendLog(`[RETRY FAILED]: ${retryErr.message}`);
          }
        }
      }

      index = (index + 1) % messagesList.length;
      sendLog(`Waiting ${delayTime} seconds...`);
      for (let i = 0; i < delayTime; i++) {
        if (stopRequested) break;
        await sleep(1);
      }
    }
}

// SSE Endpoint
app.get("/api/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const client = { res };
  logClients.push(client);
  req.on("close", () => {
    logClients = logClients.filter(c => c !== client);
  });
});

// Dashboard HTML
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <title>ST-FCA Auto E2EE Bot</title>
    <style>
        body { font-family: sans-serif; background: #121212; color: #fff; padding: 20px; }
        .container { max-width: 600px; margin: auto; background: #1e1e1e; padding: 20px; border-radius: 10px; }
        h2 { text-align: center; color: #0084ff; }
        label { margin-top: 10px; display: block; color: #aaa; }
        input, textarea { width: 100%; padding: 10px; margin-top: 5px; background: #2a2a2a; color: #fff; border: 1px solid #333; border-radius: 5px; box-sizing: border-box; }
        .btn-group { display: flex; gap: 10px; margin-top: 20px; }
        button { flex: 1; padding: 12px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        .btn-start { background: #0084ff; color: white; }
        .btn-stop { background: #d32f2f; color: white; }
        #logBox { margin-top: 20px; background: #000; padding: 10px; height: 200px; overflow-y: scroll; font-family: monospace; font-size: 12px; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>ST-FCA Auto E2EE Bot</h2>
        <label>AppState JSON ya Raw Cookies (Optional if saved):</label>
        <textarea id="appState" placeholder="c_user=...; xs=...; OR JSON"></textarea>
        <label>Target ID:</label>
        <input type="text" id="threadId" placeholder="FB ID">
        <label>Prefix (Optional):</label>
        <input type="text" id="prefix">
        <label>Messages (1 per line):</label>
        <textarea id="messages">Hello bhai!</textarea>
        <label>Delay (Seconds):</label>
        <input type="number" id="delay" value="30">
        <div class="btn-group">
            <button class="btn-start" onclick="startBot()">START</button>
            <button class="btn-stop" onclick="stopBot()">STOP</button>
        </div>
        <label>Live Logs:</label>
        <div id="logBox"></div>
    </div>
    <script>
        const logBox = document.getElementById('logBox');
        function log(msg) { logBox.innerHTML += '<div>[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>'; logBox.scrollTop = logBox.scrollHeight; }
        new EventSource('/api/logs').onmessage = (e) => { const d = JSON.parse(e.data); log(d.message); };
        
        async function startBot() {
            const body = {
                appState: document.getElementById('appState').value.trim(),
                threadId: document.getElementById('threadId').value.trim(),
                prefix: document.getElementById('prefix').value,
                messages: document.getElementById('messages').value.trim().split('\\n').filter(m => m),
                delay: parseInt(document.getElementById('delay').value)
            };
            const res = await fetch('/api/start', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
            const data = await res.json(); log(data.message);
        }
        async function stopBot() {
            const res = await fetch('/api/stop', { method: 'POST' });
            const data = await res.json(); log(data.message);
        }
    </script>
</body>
</html>`);
});

// Start Route
app.post("/api/start", async (req, res) => {
  if (isRunning) return res.json({ message: "Bot pehle se chal raha hai!" });

  let { appState, threadId, prefix, messages, delay } = req.body;

  try {
    // 1. AppState Handling (Save or Load)
    let finalAppState;
    if (appState && appState.length > 5) {
        try {
            JSON.parse(appState);
            finalAppState = JSON.parse(appState);
        } catch (e) {
            sendLog("Raw Cookie String detected. Converting...");
            finalAppState = convertRawToAppState(appState);
        }
        // Save for future auto-login
        fs.writeFileSync(APPSTATE_FILE, JSON.stringify(finalAppState, null, 2));
        sendLog("✅ AppState saved to " + APPSTATE_FILE);
    } else if (fs.existsSync(APPSTATE_FILE)) {
        finalAppState = JSON.parse(fs.readFileSync(APPSTATE_FILE, 'utf-8'));
        sendLog("✅ Loaded AppState from saved file.");
    } else {
        return res.json({ message: "❌ No AppState provided and no saved file found." });
    }

    // 2. Set Global Variables for Messaging Loop
    messagesList = messages;
    prefixText = prefix;
    targetId = threadId.includes("@") ? threadId : threadId + "@msgr";
    delayTime = delay;

    isRunning = true;
    stopRequested = false;
    res.json({ message: "Process started!" });

    // 3. Login
    sendLog("Logging in...");
    currentApi = await loginAsync({ appState: finalAppState, enableE2EE: true });
    sendLog("Login successful. Connecting E2EE...");
    await currentApi.connectE2EE();
    sendLog("E2EE Connected!");

    // 4. Start Messaging Loop
    runMessagingLoop();

    // 5. Attach Disconnect Listener for Auto-Reconnect
    // stfca/FCA often emits 'disconnect' or 'error' events
    if (currentApi && currentApi.listener) {
        currentApi.listener.on('disconnect', () => {
            sendLog("⚠️ Disconnected from Facebook!");
            if (isRunning && !stopRequested) attemptReconnect();
        });
    }

  } catch (err) {
    sendLog("❌ Error: " + err.message);
    isRunning = false;
  }
});

// Stop Route
app.post("/api/stop", (req, res) => {
  if (!isRunning) return res.json({ message: "Bot already stopped." });
  stopRequested = true;
  isRunning = false;
  if (currentApi) { currentApi.disconnect(); currentApi = null; }
  res.json({ message: "Stopped!" });
});

// 🔥 Auto-Start on Server Boot
function autoStartOnBoot() {
    if (fs.existsSync(APPSTATE_FILE)) {
        sendLog("🚀 Auto-starting bot from saved AppState...");
        // We need to simulate a start request or call the logic directly
        // For simplicity, we just log that it's ready and the user can hit start
        // (Fully auto-starting without target ID isn't possible because target/messages are required)
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server live on Port ${PORT}`);
  autoStartOnBoot();
});
