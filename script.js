const $ = id => document.getElementById(id);

const defaultRoles = ["Junior Tester", "Tester", "Senior Tester", "Moderator", "Admin"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const seed = {
  roles: defaultRoles,
  users: [
    { id: 1, login: "admin.mainadmin", displayName: "Main Admin", password: "admin123", role: "Admin", points: 0 },
    { id: 2, login: "niko", displayName: "Niko", password: "test123", role: "Junior Tester", points: 180 },
    { id: 3, login: "mira", displayName: "Mira", password: "bughunt", role: "Moderator", points: 420 },
    { id: 4, login: "rex", displayName: "Rex", password: "levelup", role: "Senior Tester", points: 760 }
  ],
  tests: [
    {
      id: 1,
      name: "Combat Balance Test",
      description: "Fight three arena rounds and report balance problems.",
      points: 75,
      date: todayISO(),
      time: "14:00",
      duration: 60,
      roles: ["Junior Tester", "Tester", "Senior Tester", "Moderator"],
      attendees: [],
      open: false,
      archived: false
    },
    {
      id: 2,
      name: "Bug Hunt Session",
      description: "Search Neon Drift for blockers, crashes and UI issues.",
      points: 120,
      date: addDaysISO(1),
      time: "18:00",
      duration: 90,
      roles: ["Tester", "Senior Tester", "Moderator"],
      attendees: [],
      open: false,
      archived: false
    }
  ],
  sessions: {}
};

let db = JSON.parse(localStorage.getItem("testerPortalData") || "null") || seed;
let currentId = Number(localStorage.getItem("testerPortalCurrentId")) || null;
let remoteRef = null;
let remoteReady = false;
let remoteRender = false;
let lastRemoteSave = "";

function migrate() {
  db.roles ||= defaultRoles;
  db.users ||= seed.users;
  db.tests ||= seed.tests;
  db.sessions ||= {};

  if (db.users.some(u => u.login === "admin")) {
    const admin = db.users.find(u => u.login === "admin");
    admin.login = "admin.mainadmin";
  }

  db.tests = db.tests.map(t => ({
    id: t.id || Date.now() + Math.random(),
    name: t.name || t.title || "Untitled Test",
    description: t.description || t.game || "",
    points: Number(t.points ?? t.reward ?? 0),
    date: t.date || todayISO(),
    time: t.time || "12:00",
    duration: Number(t.duration || 60),
    roles: Array.isArray(t.roles) ? t.roles : db.roles.filter(r => r !== "Admin"),
    attendees: Array.isArray(t.attendees) ? t.attendees.map(Number) : [],
    open: !!t.open,
    archived: !!t.archived
  }));
}

migrate();

function save() {
  if (!db) return;

  const payload = JSON.stringify(db);
  localStorage.setItem("testerPortalData", payload);

  if (remoteRef && remoteReady && !remoteRender && payload !== lastRemoteSave) {
    lastRemoteSave = payload;
    remoteRef.set(db).catch(error => {
      console.warn("Firebase save failed:", error);
    });
  }
}

function firebaseConfigured() {
  const config = window.firebaseConfig || {};
  return Boolean(
    window.firebase &&
    window.firebase.database &&
    config.apiKey &&
    !String(config.apiKey).includes("PASTE_") &&
    config.databaseURL &&
    !String(config.databaseURL).includes("PASTE_")
  );
}

function startSharedSync() {
  if (!firebaseConfigured()) {
    console.info("Shared mode is off. Fill firebase-config.js to sync between browsers.");
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.firebaseConfig);
    }

    remoteRef = firebase.database().ref("testerPortalData");

    remoteRef.on("value", snapshot => {
      remoteRender = true;

      if (snapshot.exists()) {
        db = snapshot.val();
        migrate();
        lastRemoteSave = JSON.stringify(db);
        localStorage.setItem("testerPortalData", lastRemoteSave);
      } else {
        db = JSON.parse(localStorage.getItem("testerPortalData") || "null") || seed;
        migrate();
        lastRemoteSave = JSON.stringify(db);
        remoteRef.set(db);
      }

      if (currentId && !user()) {
        currentId = null;
        localStorage.removeItem("testerPortalCurrentId");
        $("dashboardPage").classList.add("hidden");
        $("loginPage").classList.remove("hidden");
      }

      fillRoleControls();

      if (currentId && user()) {
        $("loginPage").classList.add("hidden");
        $("dashboardPage").classList.remove("hidden");
        render();
      }

      remoteRender = false;
      remoteReady = true;
    });
  } catch (error) {
    console.warn("Shared mode failed. Falling back to browser-only storage:", error);
    remoteRef = null;
    remoteReady = false;
  }
}

const user = () => db.users.find(u => u.id === currentId);
const isAdmin = () => user()?.role === "Admin";
const isMainAdmin = () => isAdmin() && String(user()?.login || "").endsWith(".mainadmin");
const testerUsers = () => db.users.filter(u => u.role !== "Admin");
const esc = text => String(text ?? "").replace(/[&<>'"]/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[c]));
const sortByDate = (a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);

function canAttend(u, t) {
  const roleOk = t.roles.includes(u.role) || u.role === "Admin";
  const testerOk = !t.attendees?.length || t.attendees.includes(u.id) || u.role === "Admin";
  return roleOk && testerOk;
}

function renderChoices(container, values, selected, name) {
  container.innerHTML = values.map(item => {
    const value = typeof item === "string" ? item : item.value;
    const label = typeof item === "string" ? item : item.label;
    const checked = selected.includes(value) ? "checked" : "";
    return `
      <label class="choice-pill">
        <input type="checkbox" name="${name}" value="${esc(value)}" ${checked} />
        <span>${esc(label)}</span>
      </label>`;
  }).join("");
}

function getChecked(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(input => input.value);
}

function fillRoleControls() {
  renderChoices($("testRoles"), db.roles.filter(r => r !== "Admin"), db.roles.filter(r => r !== "Admin"), "testRoles");
  renderChoices(
    $("testAttendees"),
    testerUsers().map(u => ({ value: String(u.id), label: `${u.displayName || u.login} · ${u.role}` })),
    [],
    "testAttendees"
  );

  const firstRole = db.roles.find(r => r !== "Admin") || "Tester";
  $("newRole").value = firstRole;
  $("newRoleChoices").innerHTML = db.roles.map(r => `
    <button type="button" class="role-choice ${r === firstRole ? "selected" : ""}" data-new-role="${esc(r)}">${esc(r)}</button>
  `).join("");

  document.querySelectorAll("[data-new-role]").forEach(btn => {
    btn.onclick = () => {
      $("newRole").value = btn.dataset.newRole;
      document.querySelectorAll("[data-new-role]").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
    };
  });
}

fillRoleControls();

$("loginForm").onsubmit = e => {
  e.preventDefault();
  const login = $("loginInput").value.trim();
  const password = $("passwordInput").value;
  const found = db.users.find(u => u.login === login && u.password === password);

  if (!found) {
    $("loginError").textContent = "Wrong username or password. Ask an admin for your account.";
    return;
  }

  currentId = found.id;
  localStorage.setItem("testerPortalCurrentId", currentId);
  $("loginError").textContent = "";
  $("loginPage").classList.add("hidden");
  $("dashboardPage").classList.remove("hidden");
  render();
};

$("logoutBtn").onclick = () => {
  currentId = null;
  localStorage.removeItem("testerPortalCurrentId");
  $("dashboardPage").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
};

$("themeBtn").onclick = () => {
  document.body.classList.toggle("light-theme");
  document.body.classList.toggle("dark-theme");
  $("themeBtn").textContent = document.body.classList.contains("light-theme") ? "🌙 Theme" : "☀ Theme";
};

document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => showPage(btn.dataset.page);
});

function showPage(page) {
  if (page === "admin" && !isAdmin()) page = "dashboard";
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.page === page));
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active-page"));
  $(`page-${page}`).classList.add("active-page");
}

function render() {
  const u = user();
  if (!u) return;

  const mine = db.sessions[u.id] || {};
  $("currentName").textContent = u.displayName || u.login;
  $("currentRole").textContent = u.role;
  $("currentPoints").textContent = `${u.points} pts`;
  $("statPoints").textContent = u.points;
  $("statTests").textContent = db.tests.filter(t => !t.archived && t.open && canAttend(u, t)).length;
  $("statStarted").textContent = Object.values(mine).filter(s => s === "active").length;
  $("statArchived").textContent = db.tests.filter(t => t.archived).length;

  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin()));
  document.querySelectorAll(".main-admin-only").forEach(el => el.classList.toggle("hidden", !isMainAdmin()));
  $("page-admin").classList.toggle("hidden", !isAdmin());

  renderTestsGrid();
  renderAllTests();
  renderSchedule();
  renderLeaderboard();

  if (isAdmin()) {
    renderUsers();
    renderAdminTests();
    renderRoles();
  } else if ($("page-admin").classList.contains("active-page")) {
    showPage("dashboard");
  }

  save();
}

function testCard(t) {
  const u = user();
  const status = db.sessions[u.id]?.[t.id];
  const locked = !t.open || !canAttend(u, t) || t.archived;
  const attendeeText = t.attendees?.length
    ? t.attendees.map(id => db.users.find(u => u.id === id)).filter(Boolean).map(u => u.displayName || u.login).join(", ")
    : "Any matching tester";
  const button = isAdmin()
    ? (t.open ? "★ Open - Close" : "☆ Closed - Open")
    : status === "active"
      ? "End Test"
      : status === "done"
        ? "Finished"
        : locked
          ? (t.archived ? "Archived" : !canAttend(u, t) ? "Wrong Role" : "Waiting for Admin")
          : `Start Test +${t.points}`;

  return `
    <article class="test-card panel ${locked ? "locked" : ""} ${t.archived ? "archived" : ""}" data-open-info="${t.id}">
      <div class="test-graphic">
        <strong>${esc(t.name)}</strong>
        <span>${esc(t.date)} · ${esc(t.time)} · ${t.duration} min</span>
      </div>
      <p class="muted test-desc">${esc(t.description || "No description added.")}</p>
      <div class="test-meta">
        <span>${t.points} pts</span>
        <span>${esc(t.roles.join(", "))}</span>
        <span class="tester-meta">${esc(attendeeText)}</span>
      </div>
      <button class="start-btn ${status || ""}" data-test="${t.id}" ${status === "done" || (t.archived && !isAdmin()) ? "disabled" : ""}>${button}</button>
    </article>`;
}

function renderTestsGrid() {
  const u = user();
  const visibleTests = db.tests.filter(t => !t.archived).slice().sort(sortByDate);
  const available = visibleTests.filter(t => t.open && canAttend(u, t)).slice(0, 4);
  const upcoming = visibleTests.filter(t => !available.some(a => a.id === t.id)).slice(0, 4);

  const buildColumn = (title, subtitle, list, emptyText) => `
    <section class="dashboard-test-column panel-soft">
      <div class="dashboard-column-head">
        <div>
          <h3>${title}</h3>
          <p class="muted">${subtitle}</p>
        </div>
        <span class="count-badge">${list.length}</span>
      </div>
      <div class="dashboard-card-stack">
        ${list.length ? list.map(testCard).join("") : `<p class="empty-state">${emptyText}</p>`}
      </div>
    </section>`;

  $("testsGrid").innerHTML = `
    ${buildColumn("Available now", "Open sessions you can join", available, "No open tests for your role yet.")}
    ${buildColumn("Upcoming", "Next planned sessions", upcoming, "No upcoming tests yet.")}`;

  bindTestUI();
}

function renderAllTests() {
  $("allTestsList").innerHTML = db.tests.slice().sort(sortByDate).map(t => `
    <div class="test-row panel ${t.archived ? "archived" : ""}" data-open-info="${t.id}">
      <div>
        <b>${esc(t.name)}</b><br />
        <small class="test-desc inline-desc">${esc(t.description || "No description added.")}</small>
      </div>
      <div>${esc(t.date)} ${esc(t.time)}</div>
      <div>${t.points} pts · ${t.open ? "Open" : "Closed"}${t.archived ? " · Archived" : ""}</div>
      <div>${testCard(t).match(/<button[\s\S]*<\/button>/)[0]}</div>
    </div>`).join("");
  bindTestUI();
}

function bindTestUI() {
  document.querySelectorAll("[data-test]").forEach(b => {
    b.onclick = event => {
      event.stopPropagation();
      handleTest(Number(b.dataset.test));
    };
  });

  document.querySelectorAll("[data-open-info]").forEach(card => {
    card.onclick = event => {
      if (event.target.closest("button, input, select, textarea")) return;
      openTestModal(Number(card.dataset.openInfo));
    };
  });
}

function handleTest(id) {
  const t = db.tests.find(x => x.id === id);
  const u = user();
  if (!t) return;

  if (isAdmin()) {
    t.open = !t.open;
    render();
    return;
  }

  db.sessions[u.id] ||= {};

  if (!t.open || t.archived || !canAttend(u, t) || db.sessions[u.id][id] === "done") return;

  if (db.sessions[u.id][id] === "active") {
    db.sessions[u.id][id] = "done";
  } else {
    db.sessions[u.id][id] = "active";
    u.points += t.points;
  }

  render();
}

function openTestModal(id) {
  const t = db.tests.find(x => x.id === id);
  if (!t) return;

  const attendees = t.attendees?.length
    ? t.attendees.map(id => db.users.find(u => u.id === id)).filter(Boolean).map(u => u.displayName || u.login).join(", ")
    : "Any matching tester";

  $("modalBody").innerHTML = `
    <p class="eyebrow">Test details</p>
    <h2>${esc(t.name)}</h2>
    <div class="modal-grid">
      <span><b>Date</b>${esc(t.date)}</span>
      <span><b>Time</b>${esc(t.time)}</span>
      <span><b>Duration</b>${t.duration} min</span>
      <span><b>Points</b>${t.points}</span>
      <span><b>Status</b>${t.open ? "Open" : "Closed"}${t.archived ? " / Archived" : ""}</span>
      <span><b>Roles</b>${esc(t.roles.join(", "))}</span>
      <span class="wide"><b>Allowed testers</b>${esc(attendees)}</span>
    </div>
    <h3>Description</h3>
    <p class="modal-description">${esc(t.description || "No description added.")}</p>`;

  $("testModal").classList.remove("hidden");
}

$("closeModal").onclick = () => $("testModal").classList.add("hidden");
$("testModal").onclick = e => {
  if (e.target.id === "testModal") $("testModal").classList.add("hidden");
};

function renderSchedule() {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(i));
  const head = `<tr><th>Time</th>${days.map(d => `<th>${d}</th>`).join("")}</tr>`;
  const rows = Array.from({ length: 24 }, (_, h) => {
    const from = `${String(h).padStart(2, "0")}:00`;
    const to = `${String((h + 1) % 24).padStart(2, "0")}:00`;
    return `
      <tr>
        <td>${from} - ${to}</td>
        ${days.map(day => `
          <td>
            ${db.tests
              .filter(t => !t.archived && t.date === day && Number(t.time.slice(0, 2)) === h)
              .map(t => `<span class="slot-test" data-open-info="${t.id}"><b>${esc(t.name)}</b><br>${t.time} · ${t.points} pts · ${t.open ? "Open" : "Closed"}</span>`)
              .join("")}
          </td>`).join("")}
      </tr>`;
  }).join("");

  $("scheduleTable").innerHTML = `<table class="schedule">${head}${rows}</table>`;
  bindTestUI();
}

function renderLeaderboard() {
  $("leaderboardList").innerHTML = testerUsers().sort((a, b) => b.points - a.points).map((u, i) => `
    <div class="leader-row">
      <div>
        <strong>#${i + 1} ${esc(u.displayName || u.login)}</strong><br />
        <small>@${esc(u.login)} · ${esc(u.role)}</small>
      </div>
      <b>${u.points}</b>
    </div>`).join("");
}

$("testForm").onsubmit = e => {
  e.preventDefault();

  const selectedRoles = getChecked("testRoles");
  const selectedAttendees = getChecked("testAttendees").map(Number);

  if (!selectedRoles.length) {
    alert("Choose at least one role that can attend.");
    return;
  }

  const id = Number($("testId").value);
  const data = {
    name: $("testName").value.trim(),
    date: $("testDate").value,
    time: $("testTime").value,
    duration: Number($("testDuration").value),
    points: Number($("testPoints").value),
    roles: selectedRoles,
    attendees: selectedAttendees,
    description: $("testDescription").value.trim(),
    open: false,
    archived: false
  };

  if (id) {
    Object.assign(db.tests.find(t => t.id === id), data);
  } else {
    db.tests.push({ id: Date.now(), ...data });
  }

  e.target.reset();
  $("testId").value = "";
  fillRoleControls();
  render();
};

$("clearTestForm").onclick = () => {
  $("testForm").reset();
  $("testId").value = "";
  fillRoleControls();
};

function renderAdminTests() {
  $("adminTestsTable").innerHTML = db.tests.slice().sort(sortByDate).map(t => `
    <div class="test-row panel ${t.archived ? "archived" : ""}" data-open-info="${t.id}">
      <div>
        <b>${esc(t.name)}</b><br />
        <small class="test-desc inline-desc">${esc(t.description || "No description added.")}</small><br />
        <small>${esc(t.roles.join(", "))}</small>
      </div>
      <div>${esc(t.date)} ${esc(t.time)}<br /><small>${t.duration} min</small></div>
      <div>${t.points} pts<br /><small>${t.open ? "Open" : "Closed"}${t.archived ? " · Archived" : ""}</small></div>
      <div class="actions">
        <button class="icon-btn" data-admin-open="${t.id}">${t.open ? "Close" : "Open"}</button>
        <button class="icon-btn ghost" data-edit-test="${t.id}">Edit</button>
        <button class="icon-btn ghost" data-copy-test="${t.id}">Duplicate</button>
        ${t.archived ? `<button class="icon-btn ok" data-restore-test="${t.id}">Restore</button>` : `<button class="icon-btn warn" data-archive-test="${t.id}">Delete</button>`}
        <button class="icon-btn danger" data-hard-delete-test="${t.id}">Remove</button>
      </div>
    </div>`).join("");

  document.querySelectorAll("[data-admin-open]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const t = db.tests.find(x => x.id === Number(b.dataset.adminOpen));
    t.open = !t.open;
    render();
  });

  document.querySelectorAll("[data-edit-test]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    loadTest(Number(b.dataset.editTest));
  });

  document.querySelectorAll("[data-copy-test]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    duplicateTest(Number(b.dataset.copyTest));
  });

  document.querySelectorAll("[data-archive-test]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    db.tests.find(x => x.id === Number(b.dataset.archiveTest)).archived = true;
    render();
  });

  document.querySelectorAll("[data-restore-test]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    db.tests.find(x => x.id === Number(b.dataset.restoreTest)).archived = false;
    render();
  });

  document.querySelectorAll("[data-hard-delete-test]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    hardDeleteTest(Number(b.dataset.hardDeleteTest));
  });

  bindTestUI();
}

function loadTest(id) {
  const t = db.tests.find(x => x.id === id);
  $("testId").value = t.id;
  $("testName").value = t.name;
  $("testDate").value = t.date;
  $("testTime").value = t.time;
  $("testDuration").value = t.duration;
  $("testPoints").value = t.points;
  $("testDescription").value = t.description;
  renderChoices($("testRoles"), db.roles.filter(r => r !== "Admin"), t.roles, "testRoles");
  renderChoices(
    $("testAttendees"),
    testerUsers().map(u => ({ value: String(u.id), label: `${u.displayName || u.login} · ${u.role}` })),
    (t.attendees || []).map(String),
    "testAttendees"
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function duplicateTest(id) {
  const t = db.tests.find(x => x.id === id);
  db.tests.push({
    ...t,
    id: Date.now(),
    name: `${t.name} Copy`,
    open: false,
    archived: false
  });
  render();
}

function hardDeleteTest(id) {
  if (confirm("Permanently remove this test? Use Delete if you want restore option.")) {
    db.tests = db.tests.filter(t => t.id !== id);
    Object.values(db.sessions).forEach(s => delete s[id]);
    render();
  }
}

$("createUserForm").onsubmit = e => {
  e.preventDefault();
  const login = $("newLogin").value.trim();
  const displayName = $("newDisplayName").value.trim();
  const password = $("newPassword").value.trim();
  const role = $("newRole").value;

  if (!login || !password || db.users.some(u => u.login === login)) {
    alert("Username must be unique and password is required.");
    return;
  }

  db.users.push({
    id: Date.now(),
    login,
    displayName: displayName || login,
    password,
    role,
    points: 0
  });

  e.target.reset();
  fillRoleControls();
  render();
};

function renderUsers() {
  $("usersTable").innerHTML = db.users.map(u => `
    <div class="user-row">
      <input value="${esc(u.login)}" data-edit="login" data-id="${u.id}">
      <input value="${esc(u.displayName || "")}" data-edit="displayName" data-id="${u.id}">
      <input value="${esc(u.password)}" data-edit="password" data-id="${u.id}">
      <div class="role-chip-group">
        ${db.roles.map(r => `
          <button
            type="button"
            class="role-choice compact ${r === u.role ? "selected" : ""}"
            data-role-chip="true"
            data-new-role="${esc(r)}"
            data-id="${u.id}"
          >${esc(r)}</button>
        `).join("")}
      </div>
      <div class="points-controls">
        <button data-points="-25" data-id="${u.id}">-</button>
        <b>${u.points}</b>
        <button data-points="25" data-id="${u.id}">+</button>
      </div>
      <button class="danger-btn" data-remove="${u.id}" ${u.id === currentId ? "disabled" : ""}>Remove</button>
    </div>`).join("");

  document.querySelectorAll("[data-edit]").forEach(el => {
    el.onchange = () => editUser(Number(el.dataset.id), el.dataset.edit, el.value);
  });
  document.querySelectorAll("[data-points]").forEach(b => {
    b.onclick = () => {
      const u = db.users.find(x => x.id === Number(b.dataset.id));
      u.points = Math.max(0, u.points + Number(b.dataset.points));
      render();
    };
  });
  document.querySelectorAll("[data-remove]").forEach(b => {
    b.onclick = () => removeUser(Number(b.dataset.remove));
  });
}

function editUser(id, key, value) {
  const u = db.users.find(x => x.id === id);

  if (key === "login" && db.users.some(x => x.id !== id && x.login === value.trim())) {
    alert("Username already exists.");
    render();
    return;
  }

  u[key] = value.trim() || (key === "displayName" ? u.login : u[key]);
  fillRoleControls();
  render();
}

function removeUser(id) {
  if (id === currentId) {
    alert("You cannot remove yourself.");
    return;
  }

  db.users = db.users.filter(u => u.id !== id);
  delete db.sessions[id];
  db.tests.forEach(t => {
    t.attendees = (t.attendees || []).filter(userId => userId !== id);
  });
  fillRoleControls();
  render();
}

$("createRoleForm").onsubmit = e => {
  e.preventDefault();
  if (!isMainAdmin()) return;

  const name = $("newRoleName").value.trim();
  if (!name || db.roles.includes(name)) {
    alert("Role name must be new.");
    return;
  }

  db.roles.splice(Math.max(0, db.roles.length - 1), 0, name);
  $("newRoleName").value = "";
  fillRoleControls();
  render();
};

function renderRoles() {
  if (!$("rolesTable")) return;

  $("rolesTable").innerHTML = db.roles.map(role => `
    <div class="role-row">
      <input value="${esc(role)}" data-role-name="${esc(role)}" ${role === "Admin" ? "disabled" : ""} />
      <button class="danger-btn" data-remove-role="${esc(role)}" ${role === "Admin" ? "disabled" : ""}>Remove</button>
    </div>`).join("");

  document.querySelectorAll("[data-role-name]").forEach(input => {
    input.onchange = () => renameRole(input.dataset.roleName, input.value.trim());
  });

  document.querySelectorAll("[data-remove-role]").forEach(btn => {
    btn.onclick = () => removeRole(btn.dataset.removeRole);
  });
}

function renameRole(oldName, newName) {
  if (!isMainAdmin() || oldName === "Admin") return;
  if (!newName || (db.roles.includes(newName) && newName !== oldName)) {
    alert("Role name must be unique.");
    render();
    return;
  }

  db.roles = db.roles.map(r => r === oldName ? newName : r);
  db.users.forEach(u => {
    if (u.role === oldName) u.role = newName;
  });
  db.tests.forEach(t => {
    t.roles = t.roles.map(r => r === oldName ? newName : r);
  });
  fillRoleControls();
  render();
}

function removeRole(role) {
  if (!isMainAdmin() || role === "Admin") return;
  if (!confirm(`Remove role "${role}"? Users with this role will become Tester.`)) return;

  const fallback = db.roles.includes("Tester") ? "Tester" : db.roles.find(r => r !== role && r !== "Admin") || "Tester";
  db.roles = db.roles.filter(r => r !== role);
  db.users.forEach(u => {
    if (u.role === role) u.role = fallback;
  });
  db.tests.forEach(t => {
    t.roles = t.roles.filter(r => r !== role);
    if (!t.roles.length) t.roles = [fallback];
  });
  fillRoleControls();
  render();
}

if (currentId && user()) {
  $("loginPage").classList.add("hidden");
  $("dashboardPage").classList.remove("hidden");
  render();
} else {
  save();
}

startSharedSync();

document.addEventListener("click", event => {
  const roleBtn = event.target.closest("[data-role-chip=\"true\"]");
  if (roleBtn) {
    const userId = Number(roleBtn.dataset.id);
    const role = roleBtn.dataset.newRole;
    const user = db.users.find(u => u.id === userId);
    if (user) {
      user.role = role;
      save();
      fillRoleControls();
      render();
    }
  }
});

const togglePasswordBtn = document.getElementById("togglePassword");
if (togglePasswordBtn) {
  togglePasswordBtn.addEventListener("click", () => {
    const input = document.getElementById("passwordInput");
    if (input.type === "password") {
      input.type = "text";
      togglePasswordBtn.textContent = "Hide Password";
    } else {
      input.type = "password";
      togglePasswordBtn.textContent = "Show Password";
    }
  });
}
