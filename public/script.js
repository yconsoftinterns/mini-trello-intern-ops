
const state = { interns: [], tasks: [], updates: [], performance: null };

const $ = (id) => document.getElementById(id);

const todoList = $("todoList");
const progressList = $("progressList");
const doneList = $("doneList");
const internCount = $("internCount");
const taskCount = $("taskCount");
const completedCount = $("completedCount");
const teamScore = $("teamScore");
const internFilter = $("internFilter");
const priorityFilter = $("priorityFilter");
const searchInput = $("searchInput");
const insightsList = $("insightsList");
const performanceGrid = $("performanceGrid");
const addTaskBtn = $("addTaskBtn");
const addInternBtn = $("addInternBtn");
const aiInsightsBtn = $("aiInsightsBtn");
const aiReportBtn = $("aiReportBtn");
const aiStatus = $("aiStatus");
const logoutBtn = $("logoutBtn");

async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location.href = "/login.html"; throw new Error("Authentication required."); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

async function loadData() {
    const [interns, tasks, updates, performance] = await Promise.all([
        api("/interns"),
        api("/tasks"),
        api("/updates"),
        api("/ai/performance")
    ]);
    state.interns = interns;
    state.tasks = tasks;
    state.updates = updates;
    state.performance = performance;
    updateInternFilter();
    displayTasks();
    renderPerformance();
    renderInsights();
    if (aiStatus) {
        aiStatus.textContent = performance?.aiPowered ? "AI powered" : "Rule-based";
        aiStatus.className = `ai-status ${performance?.aiPowered ? "ai-on" : "ai-off"}`;
    }
}

function getIntern(id) {
    return state.interns.find(i => Number(i.id) === Number(id));
}

function esc(value = "") {
    return String(value).replace(/[&<>"']/g, c => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
    }[c]));
}

function createTaskCard(task) {
    const intern = getIntern(task.internId);
    const card = document.createElement("div");
    card.className = "task-card";
    card.draggable = true;
    card.dataset.taskId = task.id;
    card.innerHTML = `
        <span class="priority ${esc(task.priority)}">${esc(task.priority)}</span>
        <h3 class="task-title">${esc(task.title)}</h3>
        <p class="task-description">${esc(task.description)}</p>
        <div class="task-meta">
            <span>${esc(intern ? intern.name : "Unassigned")}</span>
            <span>Due: ${esc(task.dueDate || "—")}</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
            <button class="move-task-btn" data-task-id="${task.id}">Move</button>
            <button class="delete-task-btn" data-task-id="${task.id}">Delete</button>
        </div>`;
    card.addEventListener("dragstart", e => e.dataTransfer.setData("text/plain", task.id));
    return card;
}

function displayTasks() {
    todoList.innerHTML = progressList.innerHTML = doneList.innerHTML = "";
    let counts = { todo: 0, progress: 0, done: 0 };
    const selectedIntern = internFilter?.value || "all";
    const selectedPriority = priorityFilter?.value || "all";
    const search = (searchInput?.value || "").toLowerCase().trim();

    state.tasks.forEach(task => {
        const intern = getIntern(task.internId);
        if (selectedIntern !== "all" && String(task.internId) !== selectedIntern) return;
        if (selectedPriority !== "all" && task.priority !== selectedPriority) return;
        const text = `${task.title} ${task.description} ${intern?.name || ""}`.toLowerCase();
        if (search && !text.includes(search)) return;
        const card = createTaskCard(task);
        if (task.status === "todo") todoList.appendChild(card);
        if (task.status === "progress") progressList.appendChild(card);
        if (task.status === "done") doneList.appendChild(card);
        if (counts[task.status] !== undefined) counts[task.status]++;
    });

    document.querySelector('[data-count="todo"]').textContent = counts.todo;
    document.querySelector('[data-count="progress"]').textContent = counts.progress;
    document.querySelector('[data-count="done"]').textContent = counts.done;
    internCount.textContent = state.interns.length;
    taskCount.textContent = state.tasks.length;
    completedCount.textContent = state.tasks.filter(t => t.status === "done").length;
    teamScore.textContent = `${state.performance?.teamScore ?? 0}/100`;
}

function updateInternFilter() {
    const current = internFilter.value || "all";
    internFilter.innerHTML = `<option value="all">Everyone</option>`;
    state.interns.forEach(i => {
        const o = document.createElement("option");
        o.value = i.id; o.textContent = i.name;
        internFilter.appendChild(o);
    });
    internFilter.value = [...internFilter.options].some(o => o.value === current) ? current : "all";
}

function renderPerformance() {
    performanceGrid.innerHTML = "";
    const rows = state.performance?.interns || [];
    rows.forEach(row => {
        const card = document.createElement("div");
        card.className = "person-score";
        card.innerHTML = `
            <h3>${esc(row.name)}</h3>
            <small>${esc(row.role)}</small>
            <p style="margin-top:10px;">Tasks: ${row.totalTasks}</p>
            <p>Completed: ${row.completedTasks}</p>
            <p>On time: ${row.onTimeRate}%</p>
            <p>Updates: ${row.updateCount}</p>
            <span class="score">${row.score}/100</span>`;
        performanceGrid.appendChild(card);
    });
}

function renderInsights() {
    const insights = state.performance?.insights || [];
    insightsList.innerHTML = "";
    const health = $("hubHealth");
    if (!insights.length) {
        insightsList.innerHTML = `<p class="empty">No attention items yet. Everyone is on track.</p>`;
        health.textContent = "Healthy";
        return;
    }
    health.textContent = state.performance?.health || "Needs Attention";
    insights.forEach(item => {
        const div = document.createElement("div");
        div.style.cssText = "padding:12px;margin-bottom:8px;border-radius:8px;";
        div.style.background = item.severity === "urgent" ? "#fee2e2" : item.severity === "positive" ? "#dcfce7" : "#fef3c7";
        div.textContent = `${item.severity === "urgent" ? "⚠" : item.severity === "positive" ? "✓" : "•"} ${item.message}`;
        insightsList.appendChild(div);
    });
}

function modal(inner) {
    const m = document.createElement("div");
    m.className = "modal show";
    m.innerHTML = `<div class="modal-content">${inner}</div>`;
    document.body.appendChild(m);
    return m;
}

function createTaskModal(defaultStatus = "todo") {
    const m = modal(`
        <div class="modal-header">
            <div>
                <p class="small-title">TASK MANAGEMENT</p>
                <h2>Add New Task</h2>
                <p class="modal-subtitle">Assign a clear task with an owner, priority and deadline.</p>
            </div>
            <button type="button" class="modal-x close" aria-label="Close">×</button>
        </div>
        <form id="taskFormDynamic" class="task-form">
            <div class="form-section">
                <h3>Task details</h3>
                <div class="form-field full">
                    <label for="newTaskTitle">Task title <span>*</span></label>
                    <input id="newTaskTitle" placeholder="e.g. Build the landing page" required>
                </div>
                <div class="form-field full">
                    <label for="newTaskDescription">Description</label>
                    <textarea id="newTaskDescription" placeholder="Describe what needs to be done, expected output and useful context."></textarea>
                </div>
            </div>
            <div class="form-section">
                <h3>Assignment</h3>
                <div class="form-row">
                    <div class="form-field">
                        <label for="newTaskIntern">Assign to intern <span>*</span></label>
                        <select id="newTaskIntern" required><option value="">Select an intern</option></select>
                    </div>
                    <div class="form-field">
                        <label for="newTaskPriority">Priority</label>
                        <select id="newTaskPriority"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-field">
                        <label for="newTaskDueDate">Due date <span>*</span></label>
                        <input id="newTaskDueDate" type="date" required>
                    </div>
                    <div class="form-field">
                        <label for="newTaskStatus">Starting status</label>
                        <select id="newTaskStatus"><option value="todo">To Do</option><option value="progress">In Progress</option><option value="done">Done</option></select>
                    </div>
                </div>
            </div>
            <div class="form-buttons">
                <button type="button" class="btn secondary close">Cancel</button>
                <button class="btn primary" type="submit">Create Task</button>
            </div>
        </form>`);
    const select = m.querySelector("#newTaskIntern");
    state.interns.forEach(i => select.insertAdjacentHTML("beforeend", `<option value="${i.id}">${esc(i.name)}</option>`));
    m.querySelector("#newTaskStatus").value = defaultStatus;
    m.querySelector(".close").onclick = () => m.remove();
    m.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        const submit = m.querySelector('button[type="submit"]');
        submit.disabled = true; submit.textContent = "Creating...";
        try {
            await api("/tasks", {method:"POST", body:JSON.stringify({
                title:$("newTaskTitle").value.trim(), description:$("newTaskDescription").value.trim(),
                internId:Number($("newTaskIntern").value), priority:$("newTaskPriority").value,
                dueDate:$("newTaskDueDate").value, status:$("newTaskStatus").value
            })});
            m.remove(); await loadData();
        } catch(err) { submit.disabled=false; submit.textContent="Create Task"; alert(err.message); }
    };
}

function createInternModal() {
    const m = modal(`
        <div class="modal-header">
            <div>
                <p class="small-title">TEAM MANAGEMENT</p>
                <h2>Add New Intern</h2>
                <p class="modal-subtitle">Create an intern profile so tasks and performance can be assigned correctly.</p>
            </div>
            <button type="button" class="modal-x close" aria-label="Close">×</button>
        </div>
        <form id="internFormDynamic" class="clean-form">
            <div class="form-section">
                <h3>Intern information</h3>
                <div class="form-field">
                    <label for="newInternName">Full name <span>*</span></label>
                    <input id="newInternName" placeholder="e.g. Adebayo Johnson" autocomplete="name" required>
                    <small class="field-help">Use the intern's full name for easy identification.</small>
                </div>
                <div class="form-field">
                    <label for="newInternRole">Role / Department <span>*</span></label>
                    <input id="newInternRole" placeholder="e.g. Frontend Developer" autocomplete="organization-title" required>
                </div>
            </div>
            <div class="form-buttons">
                <button type="button" class="btn secondary close">Cancel</button>
                <button class="btn primary" type="submit">Add Intern</button>
            </div>
        </form>`);
    m.querySelector(".close").onclick = () => m.remove();
    m.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        try {
            await api("/interns", {method:"POST", body:JSON.stringify({
                name:$("newInternName").value.trim(), role:$("newInternRole").value.trim()
            })});
            m.remove(); await loadData();
        } catch(err) { alert(err.message); }
    };
}

async function moveTask(id) {
    const task = state.tasks.find(t => Number(t.id) === Number(id));
    if (!task) return;
    const next = prompt("Enter status: todo, progress, or done", task.status);
    if (!["todo","progress","done"].includes(next)) return alert("Use todo, progress, or done.");
    try {
        await api(`/tasks/${id}`, {method:"PATCH", body:JSON.stringify({status:next})});
        await loadData();
    } catch(err) { alert(err.message); }
}

async function deleteTask(id) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try { await api(`/tasks/${id}`, {method:"DELETE"}); await loadData(); }
    catch(err) { alert(err.message); }
}

function createProgressUpdateModal(defaultStatus="progress") {
    const m = modal(`
        <div class="modal-header">
            <div>
                <p class="small-title">PROGRESS TRACKING</p>
                <h2>Add a Card</h2>
                <p class="modal-subtitle">Record what an intern worked on and keep their progress up to date.</p>
            </div>
            <button type="button" class="modal-x close" aria-label="Close">×</button>
        </div>
        <form id="progressUpdateForm" class="clean-form">
            <div class="form-section">
                <h3>Who is this update for?</h3>
                <div class="form-field">
                    <label for="updateIntern">Intern <span>*</span></label>
                    <select id="updateIntern" required><option value="">Select an intern</option></select>
                </div>
            </div>
            <div class="form-section">
                <h3>Progress details</h3>
                <div class="form-field">
                    <label for="workDone">Work completed <span>*</span></label>
                    <textarea id="workDone" placeholder="Describe the work completed, progress made, or blockers." required></textarea>
                </div>
                <div class="form-field">
                    <label for="whatLearned">Learning / takeaway <span>*</span></label>
                    <textarea id="whatLearned" placeholder="What did the intern learn or improve while working on this?" required></textarea>
                </div>
            </div>
            <div class="form-section">
                <h3>Update status</h3>
                <div class="form-row">
                    <div class="form-field">
                        <label for="updateStatus">Status</label>
                        <select id="updateStatus"><option value="todo">To Do</option><option value="progress">In Progress</option><option value="done">Done</option></select>
                    </div>
                    <div class="form-field">
                        <label for="updatePriority">Priority</label>
                        <select id="updatePriority"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>
                    </div>
                </div>
            </div>
            <div class="form-buttons">
                <button type="button" class="btn secondary close">Cancel</button>
                <button class="btn primary" type="submit">Add Update</button>
            </div>
        </form>`);
    const select = m.querySelector("#updateIntern");
    state.interns.forEach(i => select.insertAdjacentHTML("beforeend", `<option value="${i.id}">${esc(i.name)}</option>`));
    m.querySelector("#updateStatus").value = defaultStatus;
    m.querySelector(".close").onclick = () => m.remove();
    m.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        try {
            await api("/updates", {method:"POST", body:JSON.stringify({
                internId:Number($("updateIntern").value),
                workDone:$("workDone").value.trim(),
                whatLearned:$("whatLearned").value.trim(),
                status:$("updateStatus").value,
                priority:$("updatePriority").value
            })});
            m.remove(); await loadData();
            alert("Your progress update has been added.");
        } catch(err) { alert(err.message); }
    };
}

async function runAIInsights() {
    if (!aiInsightsBtn) return;
    aiInsightsBtn.disabled = true;
    aiInsightsBtn.textContent = "⏳ Analyzing performance...";
    if (aiStatus) { aiStatus.textContent = "Analyzing"; aiStatus.className = "ai-status ai-loading"; }
    try {
        const performance = await api("/ai/performance?refresh=1");
        state.performance = performance;
        renderPerformance(); renderInsights(); displayTasks();
        if (aiStatus) {
            aiStatus.textContent = performance.aiPowered ? "AI powered" : "Rule-based";
            aiStatus.className = `ai-status ${performance.aiPowered ? "ai-on" : "ai-off"}`;
        }
        aiInsightsBtn.textContent = performance.aiPowered ? "✓ AI Insights Updated" : "✓ Performance Insights Updated";
    } catch (err) {
        console.error(err);
        if (aiStatus) { aiStatus.textContent = "AI unavailable"; aiStatus.className = "ai-status ai-error"; }
        insightsList.innerHTML = `<div class="ai-error-box"><strong>AI analysis failed.</strong><br>${esc(err.message)}<br><small>Check your .env API key and restart the server.</small></div>`;
        aiInsightsBtn.textContent = "⚠ Try AI Insights Again";
    } finally {
        aiInsightsBtn.disabled = false;
        setTimeout(() => { if (aiInsightsBtn) aiInsightsBtn.textContent = "✨ AI Performance Insights"; }, 3500);
    }
}

addTaskBtn?.addEventListener("click", () => createTaskModal());
aiInsightsBtn?.addEventListener("click", runAIInsights);
async function downloadAIReport() {
    if (!aiReportBtn) return;
    aiReportBtn.disabled = true;
    aiReportBtn.textContent = "⏳ Generating report...";
    try {
        const response = await fetch("/api/ai/report", {credentials:"same-origin"});
        if (!response.ok) { let message = "Could not generate the report."; try { const data = await response.json(); message = data.error || message; } catch (_) {} throw new Error(message); }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href=url; a.download=`intern-ops-performance-report-${new Date().toISOString().slice(0,10)}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        aiReportBtn.textContent = "✓ Report Downloaded";
    } catch (err) { alert(`Report generation failed: ${err.message}`); aiReportBtn.textContent = "⚠ Try Report Again"; }
    finally { aiReportBtn.disabled=false; setTimeout(()=>{if(aiReportBtn) aiReportBtn.textContent="⬇ Download AI Report";},3000); }
}

aiReportBtn?.addEventListener("click", downloadAIReport);
addInternBtn?.addEventListener("click", () => createInternModal());
internFilter?.addEventListener("change", displayTasks);
priorityFilter?.addEventListener("change", displayTasks);
searchInput?.addEventListener("input", displayTasks);

document.addEventListener("click", e => {
    if (e.target.classList.contains("delete-task-btn")) deleteTask(e.target.dataset.taskId);
    if (e.target.classList.contains("move-task-btn")) moveTask(e.target.dataset.taskId);
    if (e.target.classList.contains("add-card")) createProgressUpdateModal(e.target.dataset.addStatus);
});

document.querySelectorAll(".task-list").forEach(list => {
    list.addEventListener("dragover", e => e.preventDefault());
    list.addEventListener("drop", async e => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        const status = list.closest(".column").dataset.status;
        if (id) {
            try { await api(`/tasks/${id}`, {method:"PATCH", body:JSON.stringify({status})}); await loadData(); }
            catch(err) { alert(err.message); }
        }
    });
});

loadData().catch(err => {
    console.error(err);
    insightsList.innerHTML = `<p class="empty">Backend unavailable. Start the server with <code>npm install</code> then <code>npm start</code>.</p>`;
});
// LOGOUT
logoutBtn?.addEventListener("click", async () => {
    try {
        logoutBtn.disabled = true;
        logoutBtn.textContent = "Logging out...";

        await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include"
        });

    } catch (error) {
        console.error("Logout error:", error);
    } finally {
        // Always return to the login page
        window.location.href = "/login.html";
    }
});
