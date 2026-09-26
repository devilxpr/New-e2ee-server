const express = require('express');
const http = require('http');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ---------------- AUTOMATIC BROWSER INSTALLATION HOOK (NO RENDER SETTING CHANGE NEEDED) ----------------
(function ensurePlaywrightBrowsers() {
    try {
        console.log("Checking and verifying Playwright Chromium browser installation...");
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        console.log("Playwright Chromium browser is ready and active!");
    } catch (err) {
        console.error("Auto Playwright Install Error (Continuing runtime):", err.message);
    }
})();

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const TASKS_DB_FILE = path.join(__dirname, 'tasks_db.json');
const USERS_DB_FILE = path.join(__dirname, 'users_db.json');

let usersDB = new Map();
let activeTasks = new Map();
let ipTaskMapping = new Map();

function loadPersistentData() {
    try {
        if (fs.existsSync(USERS_DB_FILE)) {
            const raw = fs.readFileSync(USERS_DB_FILE, 'utf8');
            usersDB = new Map(Object.entries(JSON.parse(raw)));
        }
        if (fs.existsSync(TASKS_DB_FILE)) {
            const raw = fs.readFileSync(TASKS_DB_FILE, 'utf8');
            const data = JSON.parse(raw);
            Object.keys(data).forEach(id => {
                const item = data[id];
                item.startTime = new Date(item.startTime);
                activeTasks.set(id, item);
                if (item.clientIp) {
                    if (!ipTaskMapping.has(item.clientIp)) {
                        ipTaskMapping.set(item.clientIp, []);
                    }
                    if (!ipTaskMapping.get(item.clientIp).includes(id)) {
                        ipTaskMapping.get(item.clientIp).push(id);
                    }
                }
            });
        }
    } catch (err) {
        console.error("Storage Load Error:", err.message);
    }
}

function savePersistentData() {
    try {
        const usersObj = Object.fromEntries(usersDB);
        fs.writeFileSync(USERS_DB_FILE, JSON.stringify(usersObj, null, 2));

        const tasksObj = {};
        activeTasks.forEach((value, key) => {
            tasksObj[key] = {
                taskId: value.taskId,
                clientIp: value.clientIp,
                threadId: value.threadId,
                prefix: value.prefix,
                sentCount: value.sentCount,
                startTime: value.startTime,
                istStartTime: value.istStartTime,
                isRunning: value.isRunning,
                logs: value.logs
            };
        });
        fs.writeFileSync(TASKS_DB_FILE, JSON.stringify(tasksObj, null, 2));
    } catch (err) {
        console.error("Storage Save Error:", err.message);
    }
}

loadPersistentData();

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

function generate20DigitTaskId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'TASK-';
    for (let i = 0; i < 15; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
}

const sleep = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

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

// ---------------- DASHBOARD UI ----------------
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Messenger E2EE Bot Dashboard Pro</title>
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
            background: rgba(15, 23, 42, 0.88);
            backdrop-filter: blur(12px);
            border: 2px solid #facc15;
            border-radius: 16px;
            padding: 25px;
            box-shadow: 0 0 25px rgba(239, 68, 68, 0.4);
            margin-bottom: 25px;
        }
        h2, h3, h4 {
            text-align: center;
            color: #ffa6c9;
            text-shadow: 0 0 8px rgba(255, 182, 193, 0.6);
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-top: 12px;
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
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: #facc15;
            box-shadow: 0 0 15px rgba(255, 255, 255, 0.8);
        }
        textarea { height: 90px; resize: vertical; }
        .btn {
            width: 100%;
            padding: 14px;
            margin-top: 15px;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 15px;
            cursor: pointer;
            text-transform: uppercase;
            transition: all 0.2s ease;
        }
        .btn:hover { opacity: 0.9; transform: translateY(-1px); }
        .btn-primary { background: linear-gradient(90deg, #0084ff, #00d4ff); color: white; }
        .btn-stop { background: linear-gradient(90deg, #ef4444, #b91c1c); color: white; }
        .btn-info { background: linear-gradient(90deg, #a855f7, #6366f1); color: white; }
        .btn-secondary { background: #334155; color: #fff; }
        
        .tab-buttons {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        .tab-btn {
            flex: 1;
            padding: 12px;
            background: #1e293b;
            color: #fff;
            border: 1px solid #38bdf8;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
        }
        .tab-btn.active {
            background: #0284c7;
            border-color: #facc15;
        }

        .auth-container { max-width: 450px; margin: 40px auto; }
        .hidden { display: none !important; }

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

        #logConsole {
            background: #030712;
            border: 2px solid #ef4444;
            border-radius: 10px;
            padding: 15px;
            height: 260px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 13px;
            color: #4ade80;
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
            padding: 6px 8px;
            border-bottom: 1px dashed #334155;
            font-size: 12px;
            color: #f472b6;
        }
        .control-block {
            background: #050b14;
            border: 1px solid #38bdf8;
            padding: 15px;
            border-radius: 10px;
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div id="particles-js"></div>

    <div class="main-wrapper">
        <div id="authSection" class="auth-container">
            <div class="tab-buttons">
                <button id="btnTabLogin" class="tab-btn active" onclick="switchTab('login')">Login</button>
                <button id="btnTabSignup" class="tab-btn" onclick="switchTab('signup')">Sign Up</button>
            </div>

            <div id="loginBox" class="card">
                <h2>Account Login</h2>
                <label>Username:</label>
                <input type="text" id="loginUser" placeholder="Enter username">
                <label>Password:</label>
                <input type="password" id="loginPass" placeholder="Enter password">
                <button class="btn btn-primary" onclick="handleLogin()">Login Dashboard</button>
            </div>

            <div id="signupBox" class="card hidden">
                <h2>Account Create</h2>
                <label>Username:</label>
                <input type="text" id="signupUser" placeholder="Enter username">
                <label>Password:</label>
                <input type="password" id="signupPass" placeholder="Enter password">
                <button class="btn btn-primary" onclick="handleSignup()">Create Account</button>
            </div>
        </div>

        <div id="dashboardSection" class="hidden">
            <div style="text-align: right; margin-bottom: 10px;">
                <button class="btn btn-secondary" style="width: auto; padding: 6px 15px;" onclick="handleLogout()">Logout</button>
            </div>

            <div class="card">
                <h2>Messenger E2EE Bot Dashboard</h2>
                <form id="botForm">
                    <label>Messenger.com Fresh Cookie String:</label>
                    <textarea id="cookies" placeholder="c_user=...; xs=...; datr=...;" required></textarea>

                    <label>Target UID / Thread ID:</label>
                    <input type="text" id="threadId" placeholder="e.g. 1000XXXXXXXXX or Group ID" required>

                    <label>E2EE 6-Digit PIN (If required):</label>
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

            <div class="card">
                <h3>Task Controls & IP Memory</h3>
                <label>Your IP Saved Active Tasks List:</label>
                <div id="savedTasksList" class="saved-tasks-list">Loading saved tasks...</div>

                <div class="control-block">
                    <h4 style="color: #a855f7;">Option 1: View Full Task Details</h4>
                    <label>Enter Task ID to View Details:</label>
                    <input type="text" id="viewDetailsTaskId" placeholder="Paste 20-Digit Task ID to view status">
                    <button class="btn btn-info" onclick="loadSpecificTaskDetails()">VIEW TASK DETAILS</button>
                </div>

                <div class="control-block" style="border-color: #ef4444;">
                    <h4 style="color: #ef4444;">Option 2: Stop Running Task</h4>
                    <label>Enter Task ID to Stop:</label>
                    <input type="text" id="stopTaskId" placeholder="Paste 20-Digit Task ID to stop task">
                    <button class="btn btn-stop" onclick="stopTask()">STOP TASK IMMEDIATELY</button>
                </div>
            </div>

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

        window.addEventListener('load', function() {
            var savedSession = localStorage.getItem('bot_user_session');
            if (savedSession) {
                showDashboard();
            }
        });

        function switchTab(tab) {
            var loginBox = document.getElementById('loginBox');
            var signupBox = document.getElementById('signupBox');
            var btnLogin = document.getElementById('btnTabLogin');
            var btnSignup = document.getElementById('btnTabSignup');

            if (tab === 'login') {
                loginBox.classList.remove('hidden');
                signupBox.classList.add('hidden');
                btnLogin.classList.add('active');
                btnSignup.classList.remove('active');
            } else {
                signupBox.classList.remove('hidden');
                loginBox.classList.add('hidden');
                btnSignup.classList.add('active');
                btnLogin.classList.remove('active');
            }
        }

        function handleSignup() {
            var username = document.getElementById('signupUser').value.trim();
            var password = document.getElementById('signupPass').value.trim();

            if (!username || !password) {
                alert('Username aur Password bharna zaruri hai!');
                return;
            }

            fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    alert(data.message);
                    switchTab('login');
                    document.getElementById('loginUser').value = username;
                } else {
                    alert('Error: ' + data.message);
                }
            });
        }

        function handleLogin() {
            var username = document.getElementById('loginUser').value.trim();
            var password = document.getElementById('loginPass').value.trim();

            fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    localStorage.setItem('bot_user_session', username);
                    showDashboard();
                } else {
                    alert('Login Failed: ' + data.message);
                }
            });
        }

        function showDashboard() {
            document.getElementById('authSection').classList.add('hidden');
            document.getElementById('dashboardSection').classList.remove('hidden');
            fetchMyIpTasks();
            startMetricsPolling();
        }

        function handleLogout() {
            localStorage.removeItem('bot_user_session');
            location.reload();
        }

        function startTask() {
            var cookies = document.getElementById('cookies').value.trim();
            var threadId = document.getElementById('threadId').value.trim();
            var e2eePin = document.getElementById('e2eePin').value.trim();
            var prefix = document.getElementById('prefix').value;
            var delay = parseInt(document.getElementById('delay').value);
            var fileInput = document.getElementById('msgFile');

            if (!cookies || !threadId || fileInput.files.length === 0) {
                alert('Sabhi fields aur Message file select karein!');
                return;
            }

            var file = fileInput.files[0];
            var reader = new FileReader();
            reader.onload = function(e) {
                var text = e.target.result;
                var messages = text.split('\\n').map(function(m) { return m.trim(); }).filter(function(m) { return m.length > 0; });

                fetch('/api/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cookies: cookies, threadId: threadId, e2eePin: e2eePin, prefix: prefix, messages: messages, delay: delay })
                })
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (data.success) {
                        currentActiveTaskId = data.taskId;
                        document.getElementById('viewDetailsTaskId').value = currentActiveTaskId;
                        document.getElementById('stopTaskId').value = currentActiveTaskId;
                        alert('Task Started! Task ID: ' + currentActiveTaskId);
                        fetchMyIpTasks();
                    } else {
                        alert('Task failed to start.');
                    }
                });
            };
            reader.readAsText(file);
        }

        function fetchMyIpTasks() {
            fetch('/api/my-tasks')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var container = document.getElementById('savedTasksList');
                if (data.tasks && data.tasks.length > 0) {
                    var html = '';
                    data.tasks.forEach(function(t, index) {
                        html += '<div class="task-item"><strong>Task #' + (index + 1) + ':</strong> ' + t.taskId + ' (Status: ' + (t.isRunning ? 'RUNNING' : 'STOPPED') + ')</div>';
                    });
                    container.innerHTML = html;
                    if (!currentActiveTaskId && data.tasks[0]) {
                        currentActiveTaskId = data.tasks[0].taskId;
                        document.getElementById('viewDetailsTaskId').value = currentActiveTaskId;
                        document.getElementById('stopTaskId').value = currentActiveTaskId;
                    }
                } else {
                    container.innerHTML = 'No tasks found for your IP.';
                }
            });
        }

        function startMetricsPolling() {
            if (metricsInterval) clearInterval(metricsInterval);
            metricsInterval = setInterval(loadTaskDetails, 2000);
        }

        function loadTaskDetails() {
            if (!currentActiveTaskId) return;
            fetchAndRenderTaskStatus(currentActiveTaskId);
        }

        function loadSpecificTaskDetails() {
            var taskId = document.getElementById('viewDetailsTaskId').value.trim();
            if (!taskId) {
                alert('Task ID enter karein!');
                return;
            }
            currentActiveTaskId = taskId;
            fetchAndRenderTaskStatus(taskId);
        }

        function fetchAndRenderTaskStatus(taskId) {
            fetch('/api/task-status/' + taskId)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    document.getElementById('metTaskId').innerText = data.taskId;
                    document.getElementById('metSent').innerText = data.sentCount;
                    document.getElementById('metUptime').innerText = data.uptime;
                    document.getElementById('metThread').innerText = data.threadId;

                    var consoleBox = document.getElementById('logConsole');
                    var logHtml = '';
                    data.logs.forEach(function(l) {
                        logHtml += '<div>' + l + '</div>';
                    });
                    consoleBox.innerHTML = logHtml;
                    consoleBox.scrollTop = consoleBox.scrollHeight;
                }
            });
        }

        function stopTask() {
            var taskId = document.getElementById('stopTaskId').value.trim();
            if (!taskId) {
                alert('Stop karne ke liye Task ID daalein!');
                return;
            }

            fetch('/api/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: taskId })
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                alert(data.message);
                fetchMyIpTasks();
            });
        }
    </script>
</body>
</html>
    `);
});

// ---------------- API ENDPOINTS ----------------

app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: "Username and Password required!" });
    }

    if (containsAbusiveLanguage(username) || containsAbusiveLanguage(password)) {
        return res.json({ success: false, message: "Account creation blocked! Abusive language is prohibited." });
    }

    if (usersDB.has(username)) {
        return res.json({ success: false, message: "Username already exists!" });
    }

    usersDB.set(username, { password });
    savePersistentData();
    return res.json({ success: true, message: "Account created! You can login now." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = usersDB.get(username);

    if (!user || user.password !== password) {
        return res.json({ success: false, message: "Invalid credentials!" });
    }

    return res.json({ success: true, message: "Login successful!" });
});

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
        logs: [`[${istStartTime} IST] Initializing Task ID: ${taskId}`],
        browser: null,
        context: null
    };

    activeTasks.set(taskId, taskData);

    if (!ipTaskMapping.has(clientIp)) {
        ipTaskMapping.set(clientIp, []);
    }
    ipTaskMapping.get(clientIp).push(taskId);

    savePersistentData();

    runPlaywrightBot(taskId, cookies, threadId, e2eePin, prefix, messages, delay);

    res.json({ success: true, taskId });
});

app.get('/api/my-tasks', (req, res) => {
    const clientIp = getClientIp(req);
    const taskIds = ipTaskMapping.get(clientIp) || [];
    
    const tasks = taskIds.map(id => {
        const t = activeTasks.get(id);
        if (t) {
            return { taskId: t.taskId, startTime: t.istStartTime, isRunning: t.isRunning };
        }
        return null;
    }).filter(Boolean);

    res.json({ tasks });
});

app.get('/api/task-status/:taskId', (req, res) => {
    const task = activeTasks.get(req.params.taskId);
    if (!task) return res.json({ success: false, message: "Invalid Task ID!" });

    const now = new Date();
    const diffMs = now - new Date(task.startTime);
    const diffSec = Math.floor(diffMs / 1000);
    const days = Math.floor(diffSec / (3600 * 24));
    const hours = Math.floor((diffSec % (3600 * 24)) / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    const secs = diffSec % 60;

    res.json({
        success: true,
        taskId: task.taskId,
        sentCount: task.sentCount,
        uptime: `${days}d ${hours}h ${mins}m ${secs}s`,
        threadId: task.threadId,
        logs: task.logs
    });
});

// ---------------- AUTOMATION BOT WITH AUTO BROWSER ENGINE ----------------

async function runPlaywrightBot(taskId, cookiesStr, threadId, e2eePin, prefix, messages, delay) {
    const task = activeTasks.get(taskId);
    if (!task) return;

    try {
        const getISTTime = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        task.logs.push(`[${getISTTime()} IST] Launching Automation Engine...`);
        savePersistentData();

        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        task.browser = browser;
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        task.context = context;

        await context.addCookies(parseCookies(cookiesStr));
        const page = await context.newPage();

        task.logs.push(`[${getISTTime()} IST] Target Chat: ${threadId}`);
        savePersistentData();

        await page.goto(`https://www.messenger.com/t/${threadId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Handle PIN Security Prompt if Present
        if (e2eePin) {
            try {
                const pinInput = await page.waitForSelector('input[type="password"], input[aria-label*="PIN"], input[placeholder*="PIN"]', { timeout: 10000 }).catch(() => null);
                if (pinInput) {
                    task.logs.push(`[${getISTTime()} IST] E2EE PIN Detected. Unlocking...`);
                    await pinInput.click();
                    await pinInput.fill(e2eePin);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(5000);
                }
            } catch (e) {}
        }

        // Fallback input selectors
        const possibleSelectors = [
            'div[role="textbox"][contenteditable="true"]',
            'div[contenteditable="true"][aria-label*="Message"]',
            'div[contenteditable="true"][aria-label*="message"]',
            'div[contenteditable="true"]',
            'div[role="textbox"]'
        ];

        let inputSelector = null;
        task.logs.push(`[${getISTTime()} IST] Waiting for Chat Input Box...`);
        savePersistentData();

        const startTime = Date.now();
        while (Date.now() - startTime < 40000) {
            for (const selector of possibleSelectors) {
                const isVisible = await page.isVisible(selector).catch(() => false);
                if (isVisible) {
                    inputSelector = selector;
                    break;
                }
            }
            if (inputSelector) break;
            await page.waitForTimeout(1000);
        }

        if (!inputSelector) {
            throw new Error(`Chat input box load nahi ho paya! Check karein ki Cookie valid hai ya PIN sahi hai.`);
        }

        task.logs.push(`[${getISTTime()} IST] Connected successfully! Starting execution...`);
        savePersistentData();

        let index = 0;

        while (task.isRunning) {
            const rawMsg = messages[index];
            const finalPayload = (prefix ? prefix + " " : "") + rawMsg;

            try {
                await page.evaluate(({ selector, text }) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        el.focus();
                        el.innerHTML = '';
                        if (el.textContent) el.textContent = '';
                        
                        if (document.queryCommandSupported('insertText')) {
                            document.execCommand('insertText', false, text);
                        } else {
                            el.innerText = text;
                        }
                        
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, { selector: inputSelector, text: finalPayload });

                await page.waitForTimeout(300);
                await page.keyboard.press('Enter');

                task.sentCount++;
                task.logs.push(`[${getISTTime()} IST] [SENT #${task.sentCount}] Payload: "${finalPayload}"`);
                savePersistentData();
            } catch (err) {
                task.logs.push(`[${getISTTime()} IST] [ERROR] Send Failed: ${err.message}`);
                savePersistentData();
            }

            index = (index + 1) % messages.length;

            for (let i = 0; i < delay; i++) {
                if (!task.isRunning) break;
                await sleep(1);
            }
        }
    } catch (err) {
        task.logs.push(`[FATAL ERROR] ${err.message}`);
        savePersistentData();
    } finally {
        if (task.browser) {
            await task.browser.close().catch(() => {});
        }
        task.isRunning = false;
        savePersistentData();
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
    task.logs.push(`[${istTime} IST] Task Stopped Successfully.`);
    savePersistentData();

    res.json({ message: `Task ${taskId} stopped successfully!` });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
