const express = require('express');
const http = require('http');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// In-Memory Database Stores
const usersDB = new Map(); // username -> { password }
const activeTasks = new Map(); // taskId -> taskObject
const ipTaskMapping = new Map(); // ipAddress -> array of taskIds

// Abusive Words Filter Engine
const ABUSIVE_WORDS = [
    "fuck", "shit", "bitch", "bastard", "asshole", "dick", "pussy", 
    "cunt", "slut", "whore", "gand", "chutiya", "bhenchod", "madarchod", 
    "gaand", "lund", "lauda", "harami", "randi", "bhosdike", "mc", "bc"
];

function containsAbusiveLanguage(text) {
    if (!text) return false;
    const cleanText = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ABUSIVE_WORDS.some(word => cleanText.includes(word));
}

// 20-Digit Unique Task ID Generator
function generate20DigitTaskId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'TASK-';
    for (let i = 0; i < 15; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Helper: Get Client IP
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
}

// Delay Helper
const sleep = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

// Cookie Parser Helper
function parseCookies(cookieStr) {
    return cookieStr.split(';').map(pair => {
        const [name, ...rest] = pair.trim().split('=');
        if (!name || rest.length === 0) return null;
        return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: '.messenger.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        };
    }).filter(Boolean);
}

// ---------------- HTML / DASHBOARD / AUTH UI ----------------
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>E2EE Messenger Automation Pro</title>
    <!-- Particles.js Library -->
    <script src="https://cdn.jsdelivr.net/particles.js/2.0.0/particles.min.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #021526, #03254c, #114084);
            color: #ffb6c1;
            min-height: 100vh;
            overflow-x: hidden;
            position: relative;
        }
        #particles-js {
            position: fixed;
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
            z-index: 1;
        }
        .main-wrapper {
            position: relative;
            z-index: 2;
            padding: 30px 15px;
            max-width: 900px;
            margin: 0 auto;
        }
        .card {
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(12px);
            border: 2px solid #facc15;
            border-radius: 16px;
            padding: 28px;
            box-shadow: 0 0 25px rgba(239, 68, 68, 0.4), inset 0 0 15px rgba(250, 204, 21, 0.2);
            margin-bottom: 25px;
        }
        h1, h2, h3 {
            text-align: center;
            color: #ffa6c9;
            text-shadow: 0 0 8px rgba(255, 182, 193, 0.6);
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-top: 14px;
            font-weight: 600;
            color: #fbcfe8;
            font-size: 14px;
        }
        input, textarea {
            width: 100%;
            padding: 12px;
            margin-top: 6px;
            border-radius: 8px;
            border: 1px solid #ef4444;
            background: #090d16;
            color: #fff;
            font-size: 14px;
            transition: all 0.3s ease;
        }
        /* Rainbow Star & Moon Glowup on Input Focus */
        input:focus, textarea:focus {
            outline: none;
            border-color: #facc15;
            animation: rainbowGlow 2s infinite linear;
            box-shadow: 0 0 15px rgba(255, 255, 255, 0.8), 0 0 25px rgba(250, 204, 21, 0.6);
        }
        @keyframes rainbowGlow {
            0% { border-color: #ff007f; box-shadow: 0 0 12px #ff007f; }
            25% { border-color: #00f0ff; box-shadow: 0 0 12px #00f0ff; }
            50% { border-color: #39ff14; box-shadow: 0 0 12px #39ff14; }
            75% { border-color: #fffc00; box-shadow: 0 0 12px #fffc00; }
            100% { border-color: #ff007f; box-shadow: 0 0 12px #ff007f; }
        }
        textarea { height: 90px; resize: vertical; }
        .btn {
            width: 100%;
            padding: 14px;
            margin-top: 20px;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 16px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover { transform: translateY(-2px); }
        .btn-primary { background: linear-gradient(90deg, #0084ff, #00d4ff); color: white; box-shadow: 0 0 15px rgba(0, 132, 255, 0.6); }
        .btn-stop { background: linear-gradient(90deg, #ef4444, #b91c1c); color: white; box-shadow: 0 0 15px rgba(239, 68, 68, 0.6); }
        .btn-info { background: linear-gradient(90deg, #a855f7, #6366f1); color: white; box-shadow: 0 0 15px rgba(168, 85, 247, 0.6); }
        
        /* Auth Screens */
        .auth-container { max-width: 450px; margin: 60px auto; }
        .hidden { display: none !important; }

        /* Metrics & Analytics Box */
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-top: 15px;
        }
        .metric-card {
            background: #050b14;
            border: 1px solid #facc15;
            padding: 12px;
            border-radius: 8px;
            text-align: center;
        }
        .metric-title { font-size: 12px; color: #a1a1aa; }
        .metric-val { font-size: 16px; font-weight: bold; color: #38bdf8; margin-top: 4px; }

        /* Terminal Console */
        #logConsole {
            background: #030712;
            border: 2px solid #ef4444;
            border-radius: 10px;
            padding: 15px;
            height: 280px;
            overflow-y: auto;
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
            color: #4ade80;
            box-shadow: inset 0 0 10px rgba(0,0,0,0.8);
            margin-top: 10px;
        }
        .saved-tasks-list {
            margin-top: 10px;
            background: #090d16;
            border: 1px solid #38bdf8;
            padding: 10px;
            border-radius: 8px;
            max-height: 120px;
            overflow-y: auto;
        }
        .task-item {
            padding: 4px 8px;
            border-bottom: 1px dashed #334155;
            font-size: 12px;
            color: #f472b6;
        }
    </style>
</head>
<body>
    <div id="particles-js"></div>

    <div class="main-wrapper">
        <!-- AUTH SECTION -->
        <div id="authSection" class="auth-container">
            <!-- SIGNUP FORM -->
            <div id="signupBox" class="card">
                <h2>Account Create (Sign Up)</h2>
                <label>Username:</label>
                <input type="text" id="signupUser" placeholder="Enter valid username">
                <label>Password:</label>
                <input type="password" id="signupPass" placeholder="Enter valid password">
                <button class="btn btn-primary" onclick="handleSignup()">Create Account</button>
            </div>

            <!-- LOGIN FORM -->
            <div id="loginBox" class="card hidden">
                <h2>Account Login</h2>
                <label>Username:</label>
                <input type="text" id="loginUser" readonly>
                <label>Password:</label>
                <input type="password" id="loginPass" placeholder="Enter password">
                <button class="btn btn-primary" onclick="handleLogin()">Login Dashboard</button>
            </div>
        </div>

        <!-- MAIN DASHBOARD -->
        <div id="dashboardSection" class="hidden">
            <div class="card">
                <h2>Messenger E2EE Bot Dashboard</h2>
                <form id="botForm">
                    <label>Messenger.com Cookie String:</label>
                    <textarea id="cookies" placeholder="c_user=...; xs=...; datr=...;" required></textarea>

                    <label>Target UID / Thread ID:</label>
                    <input type="text" id="threadId" placeholder="e.g. 1000XXXXXXXXX or Group ID" required>

                    <label>E2EE 6-Digit PIN (Optional):</label>
                    <input type="password" id="e2eePin" placeholder="e.g. 123456">

                    <label>Message Prefix (Optional):</label>
                    <input type="text" id="prefix" placeholder="e.g. [DevilX]">

                    <label>Messages (.txt File Select):</label>
                    <input type="file" id="msgFile" accept=".txt" required>

                    <label>Delay (Seconds):</label>
                    <input type="number" id="delay" value="30" min="5" required>

                    <button type="button" class="btn btn-primary" onclick="startTask()">START NON-STOP TASK</button>
                </form>
            </div>

            <!-- TASK ID IP RECOVERY & STOP SYSTEM -->
            <div class="card">
                <h3>Task Controls & IP Memory</h3>
                
                <label>Your IP Saved Active Tasks List:</label>
                <div id="savedTasksList" class="saved-tasks-list">Loading your IP tasks...</div>

                <div style="margin-top: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div>
                        <input type="text" id="targetTaskId" placeholder="Enter 20-Digit Task ID">
                    </div>
                    <div>
                        <button class="btn btn-info" style="margin-top:6px;" onclick="loadTaskDetails()">View Full Status</button>
                    </div>
                </div>
                <button class="btn btn-stop" style="margin-top:10px;" onclick="stopTask()">STOP SELECTED TASK</button>
            </div>

            <!-- METRICS AND ANALYTICS -->
            <div class="card">
                <h3>Live Task Metrics & Analytics</h3>
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-title">Active Task ID</div>
                        <div class="metric-val" id="metTaskId">None</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-title">Messages Sent</div>
                        <div class="metric-val" id="metSent">0</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-title">Live Uptime</div>
                        <div class="metric-val" id="metUptime">0d 0h 0m 0s</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-title">Target Thread</div>
                        <div class="metric-val" id="metThread">-</div>
                    </div>
                </div>

                <label style="margin-top:20px;">Live Terminal Console Logs (India IST Time):</label>
                <div id="logConsole">System Initialized. Awaiting Task...</div>
            </div>
        </div>
    </div>

    <script>
        // Particle.js Configuration (Sky-Blue Dot Line Mixing)
        particlesJS("particles-js", {
            "particles": {
                "number": { "value": 70, "density": { "enable": true, "value_area": 800 } },
                "color": { "value": "#38bdf8" },
                "shape": { "type": "circle" },
                "opacity": { "value": 0.7 },
                "size": { "value": 3.5, "random": true },
                "line_linked": { "enable": true, "distance": 140, "color": "#0284c7", "opacity": 0.5, "width": 1.2 },
                "move": { "enable": true, "speed": 2.5, "direction": "none", "out_mode": "out" }
            },
            "interactivity": {
                "events": { "onhover": { "enable": true, "mode": "grab" } }
            }
        });

        let currentActiveTaskId = null;
        let metricsInterval = null;

        // AUTH HANDLERS
        async function handleSignup() {
            const username = document.getElementById('signupUser').value.trim();
            const password = document.getElementById('signupPass').value.trim();

            if (!username || !password) {
                alert('Username aur Password bharna zaruri hai!');
                return;
            }

            const res = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            if (data.success) {
                alert(data.message);
                document.getElementById('signupBox').classList.add('hidden');
                document.getElementById('loginBox').classList.remove('hidden');
                document.getElementById('loginUser').value = username;
            } else {
                alert('Error: ' + data.message);
            }
        }

        async function handleLogin() {
            const username = document.getElementById('loginUser').value.trim();
            const password = document.getElementById('loginPass').value.trim();

            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            if (data.success) {
                document.getElementById('authSection').classList.add('hidden');
                document.getElementById('dashboardSection').classList.remove('hidden');
                fetchMyIpTasks();
            } else {
                alert('Login Failed: ' + data.message);
            }
        }

        // TASK HANDLERS
        async function startTask() {
            const cookies = document.getElementById('cookies').value.trim();
            const threadId = document.getElementById('threadId').value.trim();
            const e2eePin = document.getElementById('e2eePin').value.trim();
            const prefix = document.getElementById('prefix').value;
            const delay = parseInt(document.getElementById('delay').value);
            const fileInput = document.getElementById('msgFile');

            if (!cookies || !threadId || fileInput.files.length === 0) {
                alert('Sabhi fields aur Message file select karein!');
                return;
            }

            const file = fileInput.files[0];
            const text = await file.text();
            const messages = text.split('\\n').map(m => m.trim()).filter(m => m.length > 0);

            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cookies, threadId, e2eePin, prefix, messages, delay })
            });

            const data = await response.json();
            if (data.success) {
                currentActiveTaskId = data.taskId;
                document.getElementById('targetTaskId').value = currentActiveTaskId;
                alert('Task Started! Unique Task ID: ' + currentActiveTaskId);
                fetchMyIpTasks();
                startMetricsPolling();
            } else {
                alert('Task failed to start.');
            }
        }

        async function fetchMyIpTasks() {
            const res = await fetch('/api/my-tasks');
            const data = await res.json();
            const container = document.getElementById('savedTasksList');
            
            if (data.tasks && data.tasks.length > 0) {
                container.innerHTML = data.tasks.map((t, index) => 
                    \`<div class="task-item"><strong>Task #\${index + 1}:</strong> \${t.taskId} (Started: \${t.startTime})</div>\`
                ).join('');
            } else {
                container.innerHTML = 'No active tasks found for your IP.';
            }
        }

        function startMetricsPolling() {
            if (metricsInterval) clearInterval(metricsInterval);
            metricsInterval = setInterval(loadTaskDetails, 2000);
        }

        async function loadTaskDetails() {
            const taskId = document.getElementById('targetTaskId').value.trim() || currentActiveTaskId;
            if (!taskId) return;

            const res = await fetch('/api/task-status/' + taskId);
            const data = await res.json();

            if (data.success) {
                document.getElementById('metTaskId').innerText = data.taskId;
                document.getElementById('metSent').innerText = data.sentCount;
                document.getElementById('metUptime').innerText = data.uptime;
                document.getElementById('metThread').innerText = data.threadId;

                const consoleBox = document.getElementById('logConsole');
                consoleBox.innerHTML = data.logs.map(l => '<div>' + l + '</div>').join('');
                consoleBox.scrollTop = consoleBox.scrollHeight;
            }
        }

        async function stopTask() {
            const taskId = document.getElementById('targetTaskId').value.trim();
            if (!taskId) {
                alert('Task ID daalein!');
                return;
            }

            const res = await fetch('/api/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId })
            });

            const data = await res.json();
            alert(data.message);
            fetchMyIpTasks();
        }
    </script>
</body>
</html>
    `);
});

// ---------------- AUTH API ROUTES ----------------

app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: "Username and Password required!" });
    }

    if (containsAbusiveLanguage(username) || containsAbusiveLanguage(password)) {
        return res.json({ 
            success: false, 
            message: "Account creation blocked! Abusive/Hate speech words are strictly prohibited." 
        });
    }

    if (usersDB.has(username)) {
        return res.json({ success: false, message: "Username already exists! Choose another." });
    }

    usersDB.set(username, { password });
    return res.json({ success: true, message: "Account created successfully! Proceeding to Login..." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    const user = usersDB.get(username);
    if (!user || user.password !== password) {
        return res.json({ success: false, message: "Invalid Username or Password!" });
    }

    return res.json({ success: true, message: "Login successful!" });
});

// ---------------- BACKEND AUTOMATION ENGINE ----------------

app.post('/api/start', async (req, res) => {
    const { cookies, threadId, e2eePin, prefix, messages, delay } = req.body;
    const clientIp = getClientIp(req);
    
    const taskId = generate20DigitTaskId();
    const startTimeDate = new Date();
    const istStartTime = startTimeDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const taskData = {
        taskId,
        clientIp,
        threadId,
        prefix,
        sentCount: 0,
        startTime: startTimeDate,
        istStartTime,
        isRunning: true,
        logs: [`[${istStartTime} IST] Initializing Non-Stop Task ID: ${taskId}`],
        browser: null,
        context: null
    };

    activeTasks.set(taskId, taskData);

    // Save Task Mapping to Client IP
    if (!ipTaskMapping.has(clientIp)) {
        ipTaskMapping.set(clientIp, []);
    }
    ipTaskMapping.get(clientIp).push(taskId);

    runPlaywrightBot(taskId, cookies, threadId, e2eePin, prefix, messages, delay);

    res.json({ success: true, taskId });
});

app.get('/api/my-tasks', (req, res) => {
    const clientIp = getClientIp(req);
    const taskIds = ipTaskMapping.get(clientIp) || [];
    
    const tasks = taskIds.map(id => {
        const t = activeTasks.get(id);
        if (t && t.isRunning) {
            return { taskId: t.taskId, startTime: t.istStartTime };
        }
        return null;
    }).filter(Boolean);

    res.json({ tasks });
});

app.get('/api/task-status/:taskId', (req, res) => {
    const task = activeTasks.get(req.params.taskId);
    if (!task) return res.json({ success: false, message: "Task expired or invalid." });

    const now = new Date();
    const diffMs = now - task.startTime;
    const diffSec = Math.floor(diffMs / 1000);
    const days = Math.floor(diffSec / (3600 * 24));
    const hours = Math.floor((diffSec % (3600 * 24)) / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    const secs = diffSec % 60;

    const uptimeStr = `${days}d ${hours}h ${mins}m ${secs}s`;

    res.json({
        success: true,
        taskId: task.taskId,
        sentCount: task.sentCount,
        uptime: uptimeStr,
        threadId: task.threadId,
        logs: task.logs
    });
});

async function runPlaywrightBot(taskId, cookiesStr, threadId, e2eePin, prefix, messages, delay) {
    const task = activeTasks.get(taskId);
    if (!task) return;

    try {
        const getISTTime = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        task.logs.push(`[${getISTTime()} IST] Launching Playwright Engine...`);
        
        const browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        task.browser = browser;

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });

        task.context = context;

        const parsedCookies = parseCookies(cookiesStr);
        await context.addCookies(parsedCookies);

        const page = await context.newPage();

        task.logs.push(`[${getISTTime()} IST] Connecting to Target Thread: ${threadId}`);
        await page.goto(`https://www.messenger.com/t/${threadId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // E2EE PIN Handling
        if (e2eePin) {
            try {
                const pinSelector = 'input[type="password"], input[aria-label*="PIN"], input[placeholder*="PIN"]';
                const pinInput = await page.waitForSelector(pinSelector, { timeout: 8000 }).catch(() => null);
                
                if (pinInput) {
                    task.logs.push(`[${getISTTime()} IST] E2EE PIN Prompt detected. Unlocking...`);
                    await pinInput.click();
                    await pinInput.fill(e2eePin);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(5000);
                }
            } catch (pErr) {
                task.logs.push(`[DEBUG ERROR] PIN Handling Issue: ${pErr.message}`);
            }
        }

        const possibleSelectors = [
            'div[role="textbox"][contenteditable="true"]',
            'div[contenteditable="true"][aria-label*="Message"]',
            'div[contenteditable="true"]',
            'div[role="textbox"]'
        ];

        let inputSelector = null;
        for (const selector of possibleSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 6000 });
                inputSelector = selector;
                break;
            } catch (e) {}
        }

        if (!inputSelector) {
            throw new Error(`Chat input box not found. Check cookies or PIN.`);
        }

        task.logs.push(`[${getISTTime()} IST] Connected successfully! Starting non-stop loop...`);

        let index = 0;

        while (task.isRunning) {
            const rawMsg = messages[index];
            const finalPayload = (prefix ? prefix + " " : "") + rawMsg;

            try {
                // INSTANT TEXT INJECTION (No Typing Indicator Triggered)
                await page.evaluate(({ selector, text }) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        el.focus();
                        document.execCommand('insertText', false, text);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, { selector: inputSelector, text: finalPayload });

                await page.keyboard.press('Enter');

                task.sentCount++;
                task.logs.push(`[${getISTTime()} IST] [SENT #${task.sentCount}] Payload: "${finalPayload}"`);
            } catch (err) {
                task.logs.push(`[${getISTTime()} IST] [ERROR] Send Failed: ${err.message}`);
            }

            index = (index + 1) % messages.length;

            for (let i = 0; i < delay; i++) {
                if (!task.isRunning) break;
                await sleep(1);
            }
        }

    } catch (err) {
        task.logs.push(`[FATAL ERROR] ${err.message}`);
    } finally {
        if (task.browser) {
            await task.browser.close().catch(() => {});
        }
        task.isRunning = false;
    }
}

app.post('/api/stop', async (req, res) => {
    const { taskId } = req.body;
    const task = activeTasks.get(taskId);

    if (!task) {
        return res.json({ message: "Invalid Task ID!" });
    }

    task.isRunning = false;
    if (task.browser) {
        await task.browser.close().catch(() => {});
    }

    const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    task.logs.push(`[${istTime} IST] Task Stopped and Terminated successfully.`);
    res.json({ message: `Task ${taskId} stopped!` });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running 24/7 on port ${PORT}`);
});
