
const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");

const envFile = path.join(__dirname, ".env");
try {
  const envText = fs.readFileSync(envFile, "utf8");
  envText.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  });
} catch (_) {}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "intern_ops.db");
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS interns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  intern_id INTEGER NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')),
  due_date TEXT,
  status TEXT NOT NULL CHECK(status IN ('todo','progress','done')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(intern_id) REFERENCES interns(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intern_id INTEGER NOT NULL,
  work_done TEXT NOT NULL,
  what_learned TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('todo','progress','done')),
  priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(intern_id) REFERENCES interns(id) ON DELETE CASCADE
);
`);

function seed() {
  // Start with an empty workspace. Interns and tasks are created by the administrator.
}
seed();

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(":");
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
function ensureAdminUser() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count) return;
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  db.prepare("INSERT INTO users (username,password_hash,role) VALUES (?,?,?)").run(username, hashPassword(password), "admin");
}
ensureAdminUser();

function getSessionUser(req) {
  const cookies = String(req.headers.cookie || "").split(";").map(x=>x.trim());
  const sid = cookies.find(x=>x.startsWith("sid="))?.slice(4);
  if (!sid) return null;
  const row = db.prepare(`SELECT u.id,u.username,u.role,s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(sid);
  if (!row || row.expiresAt < Date.now()) {
    if (row) db.prepare("DELETE FROM sessions WHERE token=?").run(sid);
    return null;
  }
  return row;
}
function requireAuth(req,res,next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({error:"Authentication required."});
  req.user = user;
  next();
}

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname, "public"), {index:false}));

app.post("/api/auth/login", (req,res) => {
  const {username,password} = req.body || {};
  if (!username?.trim() || !password) return res.status(400).json({error:"Username and password are required."});
  const user = db.prepare("SELECT * FROM users WHERE lower(username)=lower(?)").get(username.trim());
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({error:"Invalid username or password."});
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7;
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(token,user.id,expiresAt);
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; Path=/; SameSite=Lax${secureCookie}; Max-Age=${60*60*24*7}`);
  res.json({user:{id:user.id,username:user.username,role:user.role}});
});

app.post("/api/auth/logout", (req,res) => {
  const cookies = String(req.headers.cookie || "").split(";").map(x=>x.trim());
  const sid = cookies.find(x=>x.startsWith("sid="))?.slice(4);
  if (sid) db.prepare("DELETE FROM sessions WHERE token=?").run(sid);
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=; HttpOnly; Path=/; SameSite=Lax${secureCookie}; Max-Age=0`);
  res.json({ok:true});
});

app.get("/api/auth/me", (req,res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({error:"Not signed in."});
  res.json({user:{id:user.id,username:user.username,role:user.role}});
});

app.use("/api/interns", requireAuth);
app.use("/api/tasks", requireAuth);
app.use("/api/updates", requireAuth);
app.use("/api/ai", requireAuth);

function validateInternId(id) {
  return db.prepare("SELECT id FROM interns WHERE id=?").get(id);
}

app.get("/api/interns", (req,res) => {
  res.json(db.prepare("SELECT id,name,role,created_at AS createdAt FROM interns ORDER BY name").all());
});

app.post("/api/interns", (req,res) => {
  const {name, role} = req.body || {};
  if (!name?.trim() || !role?.trim()) return res.status(400).json({error:"Name and role are required."});
  const result = db.prepare("INSERT INTO interns (name,role) VALUES (?,?)").run(name.trim(), role.trim());
  res.status(201).json(db.prepare("SELECT id,name,role,created_at AS createdAt FROM interns WHERE id=?").get(result.lastInsertRowid));
});

app.delete("/api/interns/:id", (req,res) => {
  if (!validateInternId(req.params.id)) return res.status(404).json({error:"Intern not found."});
  db.prepare("DELETE FROM interns WHERE id=?").run(req.params.id);
  res.status(204).end();
});

app.get("/api/tasks", (req,res) => {
  res.json(db.prepare(`
    SELECT id,title,description,intern_id AS internId,priority,due_date AS dueDate,
           status,created_at AS createdAt,completed_at AS completedAt
    FROM tasks ORDER BY CASE status WHEN 'todo' THEN 1 WHEN 'progress' THEN 2 ELSE 3 END, due_date
  `).all());
});

app.post("/api/tasks", (req,res) => {
  const {title,description="",internId,priority="medium",dueDate,status="todo"} = req.body || {};
  if (!title?.trim() || !internId || !dueDate) return res.status(400).json({error:"Title, intern and due date are required."});
  if (!validateInternId(internId)) return res.status(400).json({error:"Intern does not exist."});
  if (!["high","medium","low"].includes(priority) || !["todo","progress","done"].includes(status))
    return res.status(400).json({error:"Invalid priority or status."});
  const completedAt = status === "done" ? new Date().toISOString() : null;
  const result = db.prepare(`INSERT INTO tasks
    (title,description,intern_id,priority,due_date,status,completed_at) VALUES (?,?,?,?,?,?,?)`)
    .run(title.trim(), description.trim(), internId, priority, dueDate, status, completedAt);
  res.status(201).json(db.prepare("SELECT * FROM tasks WHERE id=?").get(result.lastInsertRowid));
});

app.patch("/api/tasks/:id", (req,res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  if (!task) return res.status(404).json({error:"Task not found."});
  const fields = ["title","description","internId","priority","dueDate","status"];
  const b = req.body || {};
  const next = {
    title: b.title ?? task.title, description: b.description ?? task.description,
    internId: b.internId ?? task.intern_id, priority: b.priority ?? task.priority,
    dueDate: b.dueDate ?? task.due_date, status: b.status ?? task.status
  };
  if (!validateInternId(next.internId)) return res.status(400).json({error:"Intern does not exist."});
  if (!["high","medium","low"].includes(next.priority) || !["todo","progress","done"].includes(next.status))
    return res.status(400).json({error:"Invalid priority or status."});
  const completedAt = next.status === "done" ? (task.completed_at || new Date().toISOString()) : null;
  db.prepare(`UPDATE tasks SET title=?,description=?,intern_id=?,priority=?,due_date=?,status=?,completed_at=? WHERE id=?`)
    .run(next.title,next.description,next.internId,next.priority,next.dueDate,next.status,completedAt,req.params.id);
  res.json(db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id));
});

app.delete("/api/tasks/:id", (req,res) => {
  const result = db.prepare("DELETE FROM tasks WHERE id=?").run(req.params.id);
  if (!result.changes) return res.status(404).json({error:"Task not found."});
  res.status(204).end();
});

app.get("/api/updates", (req,res) => {
  res.json(db.prepare(`
    SELECT u.id,u.intern_id AS internId,i.name AS internName,u.work_done AS workDone,
           u.what_learned AS whatLearned,u.status,u.priority,u.created_at AS createdAt
    FROM updates u JOIN interns i ON i.id=u.intern_id ORDER BY u.created_at DESC
  `).all());
});

app.post("/api/updates", (req,res) => {
  const {internId,workDone,whatLearned,status="progress",priority="medium"} = req.body || {};
  if (!internId || !workDone?.trim() || !whatLearned?.trim()) return res.status(400).json({error:"Intern, work done and learning are required."});
  if (!validateInternId(internId)) return res.status(400).json({error:"Intern does not exist."});
  if (!["todo","progress","done"].includes(status) || !["high","medium","low"].includes(priority))
    return res.status(400).json({error:"Invalid status or priority."});
  const result = db.prepare(`INSERT INTO updates
    (intern_id,work_done,what_learned,status,priority) VALUES (?,?,?,?,?)`)
    .run(internId,workDone.trim(),whatLearned.trim(),status,priority);
  res.status(201).json(db.prepare("SELECT * FROM updates WHERE id=?").get(result.lastInsertRowid));
});

function scoreIntern(intern, tasks, updates) {
  const mine = tasks.filter(t => t.intern_id === intern.id);
  const myUpdates = updates.filter(u => u.intern_id === intern.id);
  if (!mine.length) return {
    id:intern.id,name:intern.name,role:intern.role,score:0,totalTasks:0,completedTasks:0,onTimeRate:0,updateCount:myUpdates.length,
    components:{completion:0,onTime:0,priority:0,updates:Math.min(100,myUpdates.length*20)}
  };
  const completed = mine.filter(t => t.status === "done");
  const today = new Date();
  const onTime = completed.filter(t => t.completed_at && (!t.due_date || new Date(t.completed_at) <= new Date(t.due_date+"T23:59:59")));
  const onTimeRate = completed.length ? Math.round(onTime.length/completed.length*100) : 0;
  const completion = completed.length/mine.length*100;
  const activeHigh = mine.filter(t => t.priority==="high" && t.status!=="done").length;
  const highTotal = mine.filter(t => t.priority==="high").length || 1;
  const priority = Math.max(0, 100 - activeHigh/highTotal*100);
  const updatesScore = Math.min(100, myUpdates.length * 20);
  const overdue = mine.filter(t => t.status!=="done" && t.due_date && new Date(t.due_date+"T23:59:59") < today).length;
  const workload = Math.max(0, 100 - Math.min(100, overdue*20));
  const score = Math.round(completion*0.40 + onTimeRate*0.25 + priority*0.15 + updatesScore*0.10 + workload*0.10);
  return {id:intern.id,name:intern.name,role:intern.role,score,totalTasks:mine.length,completedTasks:completed.length,onTimeRate,updateCount:myUpdates.length,overdue,
    components:{completion:Math.round(completion),onTime:onTimeRate,priority:Math.round(priority),updates:updatesScore,workload}};
}

function fallbackInsights(rows, tasks) {
  const out=[];
  rows.forEach(r=>{
    if(r.overdue) out.push({severity:"urgent",message:`${r.name} has ${r.overdue} overdue task${r.overdue>1?"s":""}. Prioritize a check-in.`});
    if(r.score >= 80) out.push({severity:"positive",message:`${r.name} is performing strongly at ${r.score}/100.`});
    else if(r.score < 60 && r.totalTasks) out.push({severity:"warning",message:`${r.name}'s score is ${r.score}/100. Review blockers, deadlines and workload.`});
    if(r.totalTasks >= 3 && r.completedTasks === 0) out.push({severity:"warning",message:`${r.name} has ${r.totalTasks} assigned tasks with none completed yet.`});
  });
  if (!out.length && tasks.length) out.push({severity:"positive",message:"No major performance risks detected from the current task and update data."});
  return out.slice(0,8);
}

async function generateAIInsights(payload) {
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = `You are an intern operations analyst. Analyze the supplied performance metrics. Return ONLY valid JSON with this shape:
{"health":"Healthy|Needs Attention|Critical","insights":[{"severity":"positive|warning|urgent","message":"short actionable insight"}]}
Do not make claims not supported by the data. Keep insights under 25 words each and return at most 6.
DATA:
${JSON.stringify(payload)}`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({model:process.env.OPENAI_MODEL || "gpt-5", input:prompt})
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data.output_text || data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("") || "";
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g,"").trim());
  } catch { return null; }
}

app.get("/api/ai/performance", async (req,res) => {
  const interns = db.prepare("SELECT id,name,role FROM interns ORDER BY name").all();
  const tasks = db.prepare("SELECT * FROM tasks").all();
  const updates = db.prepare("SELECT * FROM updates").all();
  const rows = interns.map(i => scoreIntern(i,tasks,updates));
  const teamScore = rows.length ? Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length) : 0;
  const payload = {teamScore, interns:rows, taskSummary:{
    total:tasks.length, completed:tasks.filter(t=>t.status==="done").length,
    inProgress:tasks.filter(t=>t.status==="progress").length, todo:tasks.filter(t=>t.status==="todo").length,
    overdue:tasks.filter(t=>t.status!=="done" && t.due_date && new Date(t.due_date+"T23:59:59")<new Date()).length
  }};
  const ai = await generateAIInsights(payload);
  const insights = ai?.insights || fallbackInsights(rows,tasks);
  const health = ai?.health || (insights.some(i=>i.severity==="urgent") ? "Critical" : insights.some(i=>i.severity==="warning") ? "Needs Attention" : "Healthy");
  res.json({teamScore,health,interns:rows,insights,aiPowered:Boolean(ai),generatedAt:new Date().toISOString()});
});

function buildPerformancePayload() {
  const interns = db.prepare("SELECT id,name,role FROM interns ORDER BY name").all();
  const tasks = db.prepare("SELECT * FROM tasks").all();
  const updates = db.prepare("SELECT * FROM updates").all();
  const rows = interns.map(i => scoreIntern(i,tasks,updates));
  const teamScore = rows.length ? Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length) : 0;
  const taskSummary = { total:tasks.length, completed:tasks.filter(t=>t.status==="done").length, inProgress:tasks.filter(t=>t.status==="progress").length, todo:tasks.filter(t=>t.status==="todo").length, overdue:tasks.filter(t=>t.status!=="done" && t.due_date && new Date(t.due_date+"T23:59:59")<new Date()).length };
  return {teamScore,interns:rows,tasks,updates,taskSummary};
}

async function generateAIReport(payload) {
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = `You are an intern operations manager. Create a concise management report from the supplied data. Return ONLY valid JSON with this exact shape: {"title":"Intern Operations Performance Report","executiveSummary":"3-5 sentence summary","recommendations":["actionable recommendation"],"risks":["risk or blocker"],"highlights":["positive highlight"]}. Use only evidence in the data. Keep each list item under 30 words. Return at most 5 items in each list. DATA:\n${JSON.stringify(payload)}`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL || "gpt-5",input:prompt})});
    if (!response.ok) return null;
    const data = await response.json();
    const text = data.output_text || data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("") || "";
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g,"").trim());
  } catch { return null; }
}

function fallbackReport(payload, insights) {
  const completedRate = payload.taskSummary.total ? Math.round(payload.taskSummary.completed / payload.taskSummary.total * 100) : 0;
  const sorted = [...payload.interns].sort((a,b)=>b.score-a.score);
  return {title:"Intern Operations Performance Report", executiveSummary:`The team has an average performance score of ${payload.teamScore}/100. ${payload.taskSummary.completed} of ${payload.taskSummary.total} tasks are completed (${completedRate}%). ${payload.taskSummary.overdue} task(s) are overdue. There are ${payload.taskSummary.inProgress} task(s) in progress and ${payload.taskSummary.todo} task(s) still to do.`, recommendations:payload.taskSummary.overdue?["Review overdue tasks and confirm blockers with owners.","Prioritize high-priority work before assigning additional workload."]:["Continue monitoring deadlines and progress updates weekly."], risks:insights.filter(i=>i.severity!=="positive").map(i=>i.message).slice(0,5), highlights:sorted.slice(0,3).map(i=>`${i.name} is currently scoring ${i.score}/100.`)};
}

app.get("/api/ai/report", async (req,res) => {
  const payload = buildPerformancePayload();
  const existingInsights = fallbackInsights(payload.interns,payload.tasks);
  const aiReport = await generateAIReport(payload);
  const report = aiReport || fallbackReport(payload,existingInsights);
  const doc = new PDFDocument({margin:50,size:"A4"});
  const filename = `intern-ops-performance-report-${new Date().toISOString().slice(0,10)}.pdf`;
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.fontSize(20).text(report.title || "Intern Operations Performance Report");
  doc.moveDown(.35).fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleString()}`);
  doc.fillColor("#000").moveDown();
  doc.fontSize(12).text(`Team performance score: ${payload.teamScore}/100`);
  doc.fontSize(10).text(`Tasks: ${payload.taskSummary.total} total | ${payload.taskSummary.completed} completed | ${payload.taskSummary.inProgress} in progress | ${payload.taskSummary.todo} to do | ${payload.taskSummary.overdue} overdue`);
  doc.moveDown().fontSize(14).text("Executive Summary").fontSize(10).text(report.executiveSummary || "No summary available.");
  doc.moveDown().fontSize(14).text("Intern Performance");
  payload.interns.forEach(i => { doc.moveDown(.2).fontSize(10).text(`${i.name} — ${i.role} — Score ${i.score}/100`); doc.fontSize(9).text(`Tasks: ${i.completedTasks}/${i.totalTasks} completed | On time: ${i.onTimeRate}% | Updates: ${i.updateCount} | Overdue: ${i.overdue}`); });
  [["Highlights",report.highlights],["Risks",report.risks],["Recommendations",report.recommendations]].forEach(([title,items])=>{doc.moveDown().fontSize(14).text(title); (items||[]).forEach(item=>doc.fontSize(10).text(`• ${item}`));});
  doc.moveDown().fontSize(8).fillColor("#666").text(aiReport ? "AI-generated analysis based on the current Mini Trello data." : "Rule-based report generated because AI analysis was unavailable.");
  doc.end();
});

app.get("/api/health", (req,res)=>res.json({ok:true,service:"intern-ops-backend",aiEnabled:Boolean(process.env.OPENAI_API_KEY)}));

app.get("/", (req,res) => {
  if (!getSessionUser(req)) return res.redirect("/login.html");
  res.sendFile(path.join(__dirname,"public","index.html"));
});
app.use((req,res,next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"Not found."});
  if (!getSessionUser(req)) return res.redirect("/login.html");
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT, ()=>console.log(`Intern Ops Hub running at http://localhost:${PORT}`));
