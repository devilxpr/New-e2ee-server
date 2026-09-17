import express from "express";
import http from "http";
import fs from "fs";
import { fork } from "child_process";
import { FBClient } from "fb-messenger-e2ee";

const isWorker = process.env.IS_WORKER === "true";

// Helper: Convert String Cookies with Dual Domain Support (FB + Messenger.com for Deactivated IDs)
function convertCookiesToAppState(cookieString) {
  if (!cookieString || typeof cookieString !== "string") return null;

  let rawPairs = [];
  if (cookieString.trim().startsWith("[")) {
    try {
      rawPairs = JSON.parse(cookieString);
    } catch (e) {
      return null;
    }
  } else {
    const pairs = cookieString.split(";");
    for (let pair of pairs) {
      const trimmed = pair.trim();
      if (!trimmed) continue;

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        if (key && value) {
          rawPairs.push({ key, value });
        }
      }
    }
  }

  const appState = [];
  const now = new Date().toISOString();

  // Inject entries for both facebook.com and messenger.com domains to bypass FCA deactivation blocks
  for (let item of rawPairs) {
    const k = item.key || item.name;
    const v = item.value;

    if (!k || !v) continue;

    // Facebook Domain Entry
    appState.push({
      key: k,
      value: v,
      domain: "facebook.com",
      path: "/",
      hostOnly: false,
      creation: now,
      lastAccessed: now
    });

    // Messenger Domain Entry (Required for Deactivated Profiles)
    appState.push({
      key: k,
      value: v,
      domain: "messenger.com",
      path: "/",
      hostOnly: false,
      creation: now,
      lastAccessed: now
    });
  }

  return appState.length > 0 ? appState : null;
}

if (isWorker) {
  // =========================================================
  // WORKER PROCESS (Isolated Task Engine)
  // =========================================================
  const taskData = JSON.parse(process.env.TASK_DATA || "{}");
  const { nickname, cookies, threadId, delay, prefix, messages } = taskData;
  const parsedMessages = (messages || "").split("\n").map(m => m.trim()).filter(m => m.length > 0);

  const sendLog = (text, type = "info") => {
    if (process.send) process.send({ type: "LOG", text, logType: type });
  };

  const sleep = (sec) => new Promise((res) => setTimeout(res, sec * 1000));

  async function startWorkerTask() {
    sendLog(`[ENGINE INITIALIZING] Converting Dual-Domain Cookies for ${nickname}...`, "info");

    const appStateArray = convertCookiesToAppState(cookies);
    if (!appStateArray) {
      sendLog(`[COOKIE ERROR] String Cookie format invalid or empty!`, "fail");
      process.exit(1);
    }

    const appStateFile = `./appstate_${nickname}.json`;
    const sessionFile = `./session_${nickname}.json`;
    
    fs.writeFileSync(appStateFile, JSON.stringify(appStateArray, null, 2));
    if (!fs.existsSync(sessionFile)) fs.writeFileSync(sessionFile, "{}");

    try {
      const client = new FBClient({
        appStatePath: appStateFile,
        sessionStorePath: sessionFile,
        platform: "messenger" // Optimized for Messenger.com session payloads
      });

      const { userId } = await client.connect();
      sendLog(`[AUTHENTICATED SUCCESS] Account User ID: ${userId}`, "success");

      await client.connectE2EE(`./device_${nickname}.json`, userId);
      sendLog("[E2EE SYNCED] Messenger Encryption Keys Established!", "success");

      let rawTarget = threadId.trim();
      let finalTargetId = rawTarget.includes("@") ? rawTarget : `${rawTarget}@msgr`;
      let index = taskData.currentIndex || 0;
      const delaySec = parseInt(delay) || 20;

      while (true) {
        if (parsedMessages.length === 0) {
          sendLog("[WARNING] Message list empty.", "fail");
          break;
        }

        const currentMsg = parsedMessages[index];
        const payloadText = (prefix ? prefix + " " : "") + currentMsg;

        try {
          await client.sendMessage({ threadId: finalTargetId, text: payloadText });
          sendLog(`[SUCCESS SENT] To ${finalTargetId} -> "${payloadText}"`, "success");
        } catch (err) {
          sendLog(`[SEND NOTICE] ${err.message}`, "fail");
        }

        index = (index + 1) % parsedMessages.length;
        if (process.send) process.send({ type: "UPDATE_INDEX", index });

        await sleep(delaySec);
      }
    } catch (fatalErr) {
      sendLog(`[RECOVERY HANDLER] Engine Glitch: ${fatalErr.message}`, "fail");
      process.exit(1);
    }
  }

  startWorkerTask();

  process.on("uncaughtException", (err) => {
    sendLog(`[SAFEGUARD EXCEPTION] ${err.message}`, "fail");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    sendLog(`[SAFEGUARD REJECTION] ${reason}`, "fail");
    process.exit(1);
  });

} else {

  // =========================================================
  // MASTER PROCESS (Web Server & Automatic Process Controller)
  // =========================================================
  const app = express();
  const server = http.createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  const DB_FILE = "./tasks_db.json";

  function loadDB() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
      return {};
    }
  }

  function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  }

  const workerProcesses = new Map();

  function getISTTime() {
    return new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  }

  function addLogToDB(nickname, text, type = "info") {
    const db = loadDB();
    if (!db[nickname]) return;
    
    if (!db[nickname].logs) db[nickname].logs = [];
    db[nickname].logs.push({ text: `[${getISTTime()}] ${text}`, type });
    if (db[nickname].logs.length > 60) db[nickname].logs.shift();
    saveDB(db);
  }

  function spawnWorkerTask(nickname) {
    const db = loadDB();
    if (!db[nickname] || !db[nickname].isRunning) return;

    if (workerProcesses.has(nickname)) {
      try { workerProcesses.get(nickname).kill(); } catch {}
    }

    addLogToDB(nickname, "Spawning Deactivated Session Worker...", "info");

    const child = fork("./index.js", [], {
      env: {
        ...process.env,
        IS_WORKER: "true",
        TASK_DATA: JSON.stringify(db[nickname])
      }
    });

    workerProcesses.set(nickname, child);

    child.on("message", (msg) => {
      if (msg.type === "LOG") {
        addLogToDB(nickname, msg.text, msg.logType);
      } else if (msg.type === "UPDATE_INDEX") {
        const currentDB = loadDB();
        if (currentDB[nickname]) {
          currentDB[nickname].currentIndex = msg.index;
          saveDB(currentDB);
        }
      }
    });

    child.on("exit", (code) => {
      workerProcesses.delete(nickname);
      const currentDB = loadDB();

      if (currentDB[nickname] && currentDB[nickname].isRunning) {
        addLogToDB(nickname, `Socket Reset Received. Resuming Engine in 3 Seconds...`, "fail");
        setTimeout(() => {
          spawnWorkerTask(nickname);
        }, 3000);
      }
    });
  }

  // Dashboard Interface
  app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>E2EE Cyber Engine - VIP Bulletproof</title>
    <script src="https://cdn.jsdelivr.net/particles.js/2.0.0/particles.min.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #030a16;
            color: #e0f2fe;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        #particles-js { position: fixed; width: 100%; height: 100%; top: 0; left: 0; z-index: 1; }

        .main-card {
            position: relative;
            z-index: 10;
            width: 100%;
            max-width: 750px;
            background: rgba(10, 25, 47, 0.85);
            backdrop-filter: blur(12px);
            border: 2px solid #0284c7;
            border-radius: 16px;
            padding: 25px;
            box-shadow: 0 0 30px rgba(2, 132, 199, 0.4);
        }

        h2 { text-align: center; color: #38bdf8; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px #0284c7; }

        .section-title { color: #7dd3fc; font-size: 13px; margin-top: 15px; margin-bottom: 5px; font-weight: 600; }

        input[type="text"], input[type="number"], textarea, input[type="file"] {
            width: 100%; padding: 12px; background: rgba(15, 23, 42, 0.9);
            border: 2px solid #ec4899; border-radius: 8px; color: #fff; font-size: 14px; outline: none; transition: all 0.4s ease;
        }

        input[type="text"]:focus, input[type="number"]:focus, textarea:focus {
            border-color: #38bdf8; box-shadow: 0 0 15px #38bdf8; background: rgba(30, 41, 59, 1);
        }

        textarea { height: 90px; resize: vertical; }

        .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 20px; }
        .btn-full { grid-column: span 2; }

        button { padding: 14px; border: none; border-radius: 8px; font-weight: bold; font-size: 15px; cursor: pointer; text-transform: uppercase; transition: transform 0.2s; }
        button:active { transform: scale(0.98); }

        .btn-start { background: linear-gradient(135deg, #0284c7, #2563eb); color: #fff; box-shadow: 0 0 15px rgba(2, 132, 199, 0.5); }
        .btn-view { background: linear-gradient(135deg, #0d9488, #16a34a); color: #fff; box-shadow: 0 0 15px rgba(22, 163, 74, 0.5); }
        .btn-stop { background: linear-gradient(135deg, #e11d48, #be123c); color: #fff; box-shadow: 0 0 15px rgba(225, 29, 72, 0.5); }

        .console-box { margin-top: 25px; background: #020617; border: 1px solid #0369a1; border-radius: 10px; padding: 15px; }

        .console-header { display: flex; justify-content: space-between; color: #38bdf8; font-size: 13px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; margin-bottom: 10px; }

        #terminalLogs { height: 180px; overflow-y: auto; font-family: 'Courier New', Courier, monospace; font-size: 12px; display: flex; flex-direction: column; gap: 5px; }

        .log-line { padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .log-success { color: #4ade80; }
        .log-fail { color: #f87171; }
        .log-info { color: #38bdf8; }

        .badge { background: #0369a1; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    </style>
</head>
<body>
    <div id="particles-js"></div>

    <div class="main-card">
        <h2>⚡ E2EE CYBER ENGINE VIP ⚡</h2>

        <form id="cyberForm">
            <div class="section-title">👤 STEP 1: SET UNIQUE NICKNAME</div>
            <input type="text" id="nickname" placeholder="Enter Nickname (e.g. DevilX_King)" required>

            <div class="section-title">🔑 STEP 2: STRING COOKIES (MESSENGER.COM / FB COOKIES)</div>
            <textarea id="cookies" placeholder="Paste your Cookie String here (datr=xxx; c_user=1000xx; xs=xx;)..." required></textarea>

            <div class="section-title">🎯 STEP 3: TARGET THREAD ID / GROUP ID</div>
            <input type="text" id="threadId" placeholder="e.g. 850260014837003" required>

            <div class="section-title">💬 STEP 4: MESSAGES (PASTE OR UPLOAD TEXT FILE)</div>
            <textarea id="messages" placeholder="Enter messages (one per line)..."></textarea>
            <div style="text-align: center; margin: 5px 0; color: #94a3b8; font-size: 12px;">OR FILE UPLOAD</div>
            <input type="file" id="msgFile" accept=".txt" onchange="loadFile(event)">

            <div class="btn-grid">
                <div>
                    <div class="section-title">⏱️ DELAY (SECONDS)</div>
                    <input type="number" id="delay" value="20" min="5" required>
                </div>
                <div>
                    <div class="section-title">🏷️ PREFIX (OPTIONAL)</div>
                    <input type="text" id="prefix" placeholder="[Bot]">
                </div>
            </div>

            <div class="btn-grid">
                <button type="button" class="btn-start btn-full" onclick="startEngine()">🚀 START CYBER ENGINE</button>
            </div>
        </form>

        <div class="btn-grid" style="margin-top: 15px;">
            <button type="button" class="btn-view" onclick="fetchLiveStatus()">📊 VIEW / RESTORE LIVE TASK</button>
            <button type="button" class="btn-stop" onclick="stopEngine()">🛑 STOP MY TASK</button>
        </div>

        <div class="console-box">
            <div class="console-header">
                <span>TERMINAL LOGS (IST INDIA TIME)</span>
                <span class="badge" id="taskStatusState">READY</span>
            </div>
            <div id="terminalLogs">
                <div class="log-line log-info">[SYSTEM] Engine Standing By. Enter Nickname & Start Task.</div>
            </div>
        </div>
    </div>

    <script>
        particlesJS("particles-js", {
            "particles": {
                "number": { "value": 70, "density": { "enable": true, "value_area": 800 } },
                "color": { "value": "#38bdf8" },
                "shape": { "type": "circle" },
                "opacity": { "value": 0.5 },
                "size": { "value": 3 },
                "line_linked": { "enable": true, "distance": 150, "color": "#0284c7", "opacity": 0.4, "width": 1 },
                "move": { "enable": true, "speed": 2.5 }
            },
            "interactivity": { "events": { "onhover": { "enable": true, "mode": "grab" } } }
        });

        document.addEventListener("DOMContentLoaded", () => {
            const savedNick = localStorage.getItem("user_nickname");
            if (savedNick) document.getElementById("nickname").value = savedNick;
        });

        async function loadFile(event) {
            const file = event.target.files[0];
            if (file) {
                const text = await file.text();
                document.getElementById("messages").value = text;
            }
        }

        function appendLog(msg, type = "info") {
            const container = document.getElementById("terminalLogs");
            const div = document.createElement("div");
            div.className = "log-line log-" + type;
            div.innerHTML = msg;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        async function startEngine() {
            const nick = document.getElementById("nickname").value.trim();
            const cookies = document.getElementById("cookies").value.trim();
            const threadId = document.getElementById("threadId").value.trim();
            const delay = document.getElementById("delay").value;
            const prefix = document.getElementById("prefix").value;
            const messages = document.getElementById("messages").value.trim();

            if (!nick) return alert("Nickname daalna zaroori hai!");
            if (!cookies || !threadId || !messages) return alert("String Cookies, Target ID aur Messages fill karein!");

            localStorage.setItem("user_nickname", nick);
            appendLog("[" + new Date().toLocaleTimeString('en-IN') + "] Request Sent To Engine...", "info");

            const res = await fetch("/api/start-task", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nickname: nick, cookies, threadId, delay, prefix, messages })
            });
            const data = await res.json();
            
            if (data.status === "error") {
                appendLog("[ERROR] " + data.message, "fail");
            } else {
                appendLog("[SUCCESS] " + data.message, "success");
                document.getElementById("taskStatusState").innerText = "RUNNING 🟢";
                autoRefreshLogs();
            }
        }

        let pollInterval = null;

        async function fetchLiveStatus() {
            const nick = document.getElementById("nickname").value.trim();
            if (!nick) return alert("View Details ke liye Nickname zaroori hai!");

            localStorage.setItem("user_nickname", nick);

            const res = await fetch("/api/task-status?nickname=" + encodeURIComponent(nick));
            const data = await res.json();

            const container = document.getElementById("terminalLogs");
            container.innerHTML = "";

            if (data.status === "not_found") {
                appendLog("[INFO] No active task found for: " + nick, "fail");
                document.getElementById("taskStatusState").innerText = "INACTIVE";
                if(pollInterval) clearInterval(pollInterval);
            } else {
                document.getElementById("taskStatusState").innerText = data.isRunning ? "RUNNING 🟢" : "STOPPED 🔴";
                data.logs.forEach(log => appendLog(log.text, log.type));
                if (!pollInterval) autoRefreshLogs();
            }
        }

        function autoRefreshLogs() {
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(fetchLiveStatus, 4000);
        }

        async function stopEngine() {
            const nick = document.getElementById("nickname").value.trim();
            if (!nick) return alert("Stop karne ke liye Nickname daalein!");

            const res = await fetch("/api/stop-task", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nickname: nick })
            });

            const data = await res.json();
            appendLog("[" + new Date().toLocaleTimeString('en-IN') + "] " + data.message, "fail");
            document.getElementById("taskStatusState").innerText = "STOPPED 🔴";
            if (pollInterval) clearInterval(pollInterval);
        }
    </script>
</body>
</html>
    `);
  });

  // REST API Endpoints
  app.post("/api/start-task", (req, res) => {
    const { nickname, cookies, threadId, delay, prefix, messages } = req.body;
    if (!nickname) return res.json({ status: "error", message: "Nickname missing!" });

    const db = loadDB();
    db[nickname] = { 
      nickname, 
      cookies, 
      threadId, 
      delay, 
      prefix, 
      messages, 
      isRunning: true, 
      currentIndex: 0, 
      logs: [] 
    };
    saveDB(db);

    spawnWorkerTask(nickname);
    res.json({ status: "success", message: `Dual-Domain Worker Launched for ${nickname}!` });
  });

  app.get("/api/task-status", (req, res) => {
    const nickname = req.query.nickname;
    const db = loadDB();
    if (!db[nickname]) return res.json({ status: "not_found" });

    res.json({ 
      status: "found", 
      isRunning: db[nickname].isRunning, 
      logs: db[nickname].logs || [] 
    });
  });

  app.post("/api/stop-task", (req, res) => {
    const { nickname } = req.body;
    const db = loadDB();
    if (db[nickname]) {
      db[nickname].isRunning = false;
      saveDB(db);
      if (workerProcesses.has(nickname)) {
        try { workerProcesses.get(nickname).kill(); } catch {}
        workerProcesses.delete(nickname);
      }
      return res.json({ status: "success", message: `Task stopped for ${nickname}` });
    }
    res.json({ status: "error", message: "Task not found" });
  });

  process.on("uncaughtException", (err) => {
    console.error("Master Process Error Handled:", err.message);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Master Process Rejection Handled:", reason);
  });

  const PORT = process.env.PORT || 10000;
  server.listen(PORT, () => {
    console.log(`Master Server live on Port ${PORT}`);
    const db = loadDB();
    Object.keys(db).forEach((nick) => {
      if (db[nick].isRunning) {
        spawnWorkerTask(nick);
      }
    });
  });
}
