/* Digital Horizon Level 1 — Organizer Admin Dashboard Logic */
(function() {
  let adminToken = sessionStorage.getItem('dh_admin_token') || null;
  let pollInterval = null;
  let currentTeamsData = [];

  const authModal = document.getElementById('authModal');
  const dashboardContent = document.getElementById('dashboardContent');
  const adminPassInput = document.getElementById('adminPassInput');
  const adminLoginBtn = document.getElementById('adminLoginBtn');
  const authError = document.getElementById('authError');

  const quizStateBadge = document.getElementById('quizStateBadge');
  const startQuizBtn = document.getElementById('startQuizBtn');
  const pauseQuizBtn = document.getElementById('pauseQuizBtn');
  const endQuizBtn = document.getElementById('endQuizBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const manageTeamsBtn = document.getElementById('manageTeamsBtn');
  const viewArchivesBtn = document.getElementById('viewArchivesBtn');
  const clearDataBtn = document.getElementById('clearDataBtn');

  const statTotal = document.getElementById('statTotal');
  const statActive = document.getElementById('statActive');
  const statSubmitted = document.getElementById('statSubmitted');
  const statDisqualified = document.getElementById('statDisqualified');
  const teamsTableBody = document.getElementById('teamsTableBody');

  const auditModal = document.getElementById('auditModal');
  const auditTeamTitle = document.getElementById('auditTeamTitle');
  const auditLogsContent = document.getElementById('auditLogsContent');
  const closeAuditBtn = document.getElementById('closeAuditBtn');

  const teamsModal = document.getElementById('teamsModal');
  const closeTeamsBtn = document.getElementById('closeTeamsBtn');
  const createTeamForm = document.getElementById('createTeamForm');
  const newTeamId = document.getElementById('newTeamId');
  const newTeamName = document.getElementById('newTeamName');
  const newTeamPassword = document.getElementById('newTeamPassword');
  const createTeamMsg = document.getElementById('createTeamMsg');
  const manageTeamsTableBody = document.getElementById('manageTeamsTableBody');

  const archivesModal = document.getElementById('archivesModal');
  const closeArchivesBtn = document.getElementById('closeArchivesBtn');
  const archivesTableBody = document.getElementById('archivesTableBody');

  function adminHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken || ''
    };
  }

  // LOGIN
  adminLoginBtn.addEventListener('click', async () => {
    const password = adminPassInput.value.trim();
    authError.classList.add('hidden');

    try {
      adminLoginBtn.disabled = true;
      adminLoginBtn.textContent = 'Authenticating...';

      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Authentication failed.');

      adminToken = data.token;
      sessionStorage.setItem('dh_admin_token', adminToken);
      authModal.classList.add('hidden');
      dashboardContent.classList.remove('hidden');
      startPolling();

    } catch (err) {
      authError.textContent = err.message;
      authError.classList.remove('hidden');
    } finally {
      adminLoginBtn.disabled = false;
      adminLoginBtn.textContent = 'Authenticate & Access Dashboard →';
    }
  });

  if (adminToken) {
    authModal.classList.add('hidden');
    dashboardContent.classList.remove('hidden');
    startPolling();
  }

  function startPolling() {
    fetchOverview();
    if (!pollInterval) {
      pollInterval = setInterval(fetchOverview, 2000);
    }
  }

  async function fetchOverview() {
    try {
      const res = await fetch('/api/admin/overview', { headers: adminHeaders() });
      if (res.status === 401) {
        sessionStorage.removeItem('dh_admin_token');
        adminToken = null;
        authModal.classList.remove('hidden');
        dashboardContent.classList.add('hidden');
        clearInterval(pollInterval);
        return;
      }
      const data = await res.json();
      renderDashboard(data);
    } catch (e) {
      console.error('Fetch overview error:', e);
    }
  }

  function renderDashboard(data) {
    quizStateBadge.textContent = data.quizState;
    quizStateBadge.className = `badge state-${data.quizState}`;

    statTotal.textContent = data.totalTeams;
    statActive.textContent = data.activeCount;
    statSubmitted.textContent = data.submittedCount;
    statDisqualified.textContent = data.disqualifiedCount;

    currentTeamsData = data.teams;
    teamsTableBody.innerHTML = '';

    data.teams.forEach((t, index) => {
      const tr = document.createElement('tr');
      const qProgress = t.status === 'SUBMITTED' ? '20 / 20' : `${t.currentQuestionIndex} / ${t.totalQuestions}`;

      tr.innerHTML = `
        <td style="font-family:var(--mono); font-weight:700;">#${index + 1}</td>
        <td style="font-family:var(--mono); font-weight:700; color:#fff;">${t.teamId}</td>
        <td>${t.teamName}</td>
        <td><span class="status-tag status-${t.status}">${t.status}</span></td>
        <td style="font-family:var(--mono);">${qProgress}</td>
        <td style="font-family:var(--mono); font-weight:700; color:var(--horizon-4);">${t.score} / ${t.maxPossibleScore}</td>
        <td style="font-family:var(--mono); color: ${t.violationsCount > 0 ? 'var(--bad)' : 'var(--text-dim)'};">${t.violationsCount} / 3</td>
        <td>
          <button class="btn" onclick="window.viewAuditLogs('${t.teamId}')" style="padding:4px 8px; font-size:11px;">Logs</button>
          <button class="btn btn-danger" onclick="window.forceSubmitTeam('${t.teamId}')" style="padding:4px 8px; font-size:11px;">Submit</button>
          <button class="btn btn-danger" onclick="window.disqualifyTeam('${t.teamId}')" style="padding:4px 8px; font-size:11px;">DQ</button>
        </td>
      `;
      teamsTableBody.appendChild(tr);
    });
  }

  // GLOBAL CONTROLS
  startQuizBtn.addEventListener('click', () => sendControl('start'));
  pauseQuizBtn.addEventListener('click', () => sendControl('pause'));
  endQuizBtn.addEventListener('click', () => sendControl('end'));

  async function sendControl(action) {
    if (action === 'end' && !confirm('Are you sure you want to end the quiz for all teams?')) return;
    try {
      await fetch('/api/admin/control', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ action })
      });
      fetchOverview();
    } catch (e) {
      console.error('Control error:', e);
    }
  }

  // CLEAR & ARCHIVE DATA
  clearDataBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear previous quiz session data?\n\nThis will automatically archive current team scores, answers, and audit logs before starting fresh.')) {
      return;
    }

    try {
      const res = await fetch('/api/admin/clear-data', {
        method: 'POST',
        headers: adminHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear data.');

      alert(data.archived ? `Session data cleared!\nArchived to: ${data.archivedFilename}` : 'Session data cleared!');
      fetchOverview();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });

  const genPasswordBtn = document.getElementById('genPasswordBtn');
  const randomizeAllPassBtn = document.getElementById('randomizeAllPassBtn');
  const exportCredentialsBtn = document.getElementById('exportCredentialsBtn');

  // Client-side mixed password generator helper
  function generateMixedPassword(length = 8) {
    const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowers = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%&*';
    const all = uppers + lowers + digits + symbols;

    let pass = [
      uppers[Math.floor(Math.random() * uppers.length)],
      lowers[Math.floor(Math.random() * lowers.length)],
      digits[Math.floor(Math.random() * digits.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];

    for (let i = pass.length; i < length; i++) {
      pass.push(all[Math.floor(Math.random() * all.length)]);
    }

    return pass.sort(() => 0.5 - Math.random()).join('');
  }

  if (genPasswordBtn) {
    genPasswordBtn.addEventListener('click', () => {
      newTeamPassword.value = generateMixedPassword(8);
    });
  }

  if (randomizeAllPassBtn) {
    randomizeAllPassBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to generate NEW mixed passwords for ALL participant teams?')) {
        return;
      }
      try {
        const res = await fetch('/api/admin/teams/randomize-passwords', {
          method: 'POST',
          headers: adminHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to randomize passwords.');

        alert('All participant passwords updated with mixed passwords!');
        fetchTeamsList();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    });
  }

  if (exportCredentialsBtn) {
    exportCredentialsBtn.addEventListener('click', () => {
      window.location.href = `/api/admin/teams/export-credentials?token=${adminToken}`;
    });
  }

  const bulkGenerateBtn = document.getElementById('bulkGenerateBtn');
  const printSlipsBtn = document.getElementById('printSlipsBtn');
  const slipsModal = document.getElementById('slipsModal');
  const closeSlipsBtn = document.getElementById('closeSlipsBtn');
  const slipsContainer = document.getElementById('slipsContainer');

  if (bulkGenerateBtn) {
    bulkGenerateBtn.addEventListener('click', async () => {
      const input = prompt('How many new participant teams would you like to generate?', '10');
      if (!input) return;
      const count = parseInt(input, 10);
      if (isNaN(count) || count <= 0) {
        alert('Please enter a valid positive number.');
        return;
      }

      try {
        const res = await fetch('/api/admin/teams/bulk-generate', {
          method: 'POST',
          headers: adminHeaders(),
          body: JSON.stringify({ count })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to bulk generate teams.');

        alert(`✓ Generated ${data.createdCount} new participant teams with mixed passwords!`);
        fetchTeamsList();
        fetchOverview();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    });
  }

  if (printSlipsBtn) {
    printSlipsBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/admin/teams-list', { headers: adminHeaders() });
        const data = await res.json();
        renderSlipsCards(data.teams || []);
        slipsModal.classList.remove('hidden');
      } catch (e) {
        alert('Error fetching teams: ' + e.message);
      }
    });
  }

  if (closeSlipsBtn) {
    closeSlipsBtn.addEventListener('click', () => {
      slipsModal.classList.add('hidden');
    });
  }

  function renderSlipsCards(teams) {
    slipsContainer.innerHTML = '';
    const loginUrl = window.location.origin;
    teams.forEach(t => {
      const card = document.createElement('div');
      card.style.background = 'var(--dusk)';
      card.style.border = '1px dashed var(--horizon-4)';
      card.style.borderRadius = '10px';
      card.style.padding = '14px';
      card.style.fontFamily = 'var(--sans)';
      card.innerHTML = `
        <div style="font-size:11px; font-weight:700; color:var(--horizon-4); text-transform:uppercase; letter-spacing:.08em;">Digital Horizon · Participant Login</div>
        <div style="font-size:16px; font-weight:800; color:#fff; margin:6px 0;">${t.name}</div>
        <div style="font-family:var(--mono); font-size:13px; margin-bottom:4px;"><b>Team ID:</b> <span style="color:var(--ok); font-weight:700;">${t.id}</span></div>
        <div style="font-family:var(--mono); font-size:13px; margin-bottom:8px;"><b>Password:</b> <span style="color:#c9b7ff; font-weight:700;">${t.password}</span></div>
        <div style="font-size:11px; color:var(--text-dim); font-family:var(--mono);">URL: ${loginUrl}</div>
      `;
      slipsContainer.appendChild(card);
    });
  }

  // PARTICIPANT CREDENTIALS MANAGER MODAL
  manageTeamsBtn.addEventListener('click', () => {
    teamsModal.classList.remove('hidden');
    fetchTeamsList();
  });

  closeTeamsBtn.addEventListener('click', () => {
    teamsModal.classList.add('hidden');
  });

  async function fetchTeamsList() {
    try {
      const res = await fetch('/api/admin/teams-list', { headers: adminHeaders() });
      const data = await res.json();
      renderManageTeamsTable(data.teams || []);
    } catch (e) {
      console.error('Fetch teams list error:', e);
    }
  }

  function renderManageTeamsTable(teams) {
    manageTeamsTableBody.innerHTML = '';
    teams.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:var(--mono); font-weight:700; color:#fff;">${t.id}</td>
        <td><input type="text" value="${t.name}" id="name_${t.id}" class="form-input" style="padding:4px 8px; font-size:12.5px;"></td>
        <td>
          <div style="display:flex; gap:4px;">
            <input type="text" value="${t.password}" id="pass_${t.id}" class="form-input mono" style="padding:4px 8px; font-size:12.5px;">
            <button class="btn" onclick="window.mixRowPassword('${t.id}')" style="padding:4px 6px; font-size:11px;" title="Generate new mixed password">⚡</button>
          </div>
        </td>
        <td>
          <button class="btn btn-success" onclick="window.saveTeamDetails('${t.id}')" style="padding:4px 8px; font-size:11px;">Save</button>
          <button class="btn btn-danger" onclick="window.deleteTeam('${t.id}')" style="padding:4px 8px; font-size:11px;">Delete</button>
        </td>
      `;
      manageTeamsTableBody.appendChild(tr);
    });
  }

  window.mixRowPassword = function(teamId) {
    const passInput = document.getElementById(`pass_${teamId}`);
    if (passInput) {
      passInput.value = generateMixedPassword(8);
    }
  };

  createTeamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createTeamMsg.classList.add('hidden');
    const id = newTeamId.value.trim();
    const name = newTeamName.value.trim();
    const password = newTeamPassword.value.trim();

    try {
      const res = await fetch('/api/admin/teams', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ id, name, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add team.');

      createTeamMsg.textContent = `✓ Participant ${data.team.id} created successfully!`;
      createTeamMsg.style.color = 'var(--ok)';
      createTeamMsg.classList.remove('hidden');

      newTeamId.value = '';
      newTeamName.value = '';
      newTeamPassword.value = '';

      fetchTeamsList();
      fetchOverview();
    } catch (err) {
      createTeamMsg.textContent = `✕ ${err.message}`;
      createTeamMsg.style.color = 'var(--bad)';
      createTeamMsg.classList.remove('hidden');
    }
  });

  window.saveTeamDetails = async function(teamId) {
    const nameInput = document.getElementById(`name_${teamId}`);
    const passInput = document.getElementById(`pass_${teamId}`);
    const name = nameInput.value.trim();
    const password = passInput.value.trim();

    try {
      const res = await fetch(`/api/admin/teams/${teamId}`, {
        method: 'PUT',
        headers: adminHeaders(),
        body: JSON.stringify({ name, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update team.');

      alert(`Team ${teamId} updated!`);
      fetchTeamsList();
      fetchOverview();
    } catch (e) {
      alert('Error updating team: ' + e.message);
    }
  };

  window.deleteTeam = async function(teamId) {
    if (!confirm(`Delete team ${teamId}? This action cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/admin/teams/${teamId}`, {
        method: 'DELETE',
        headers: adminHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete team.');

      fetchTeamsList();
      fetchOverview();
    } catch (e) {
      alert('Error deleting team: ' + e.message);
    }
  };

  // PAST SESSION ARCHIVES MODAL
  viewArchivesBtn.addEventListener('click', () => {
    archivesModal.classList.remove('hidden');
    fetchArchives();
  });

  closeArchivesBtn.addEventListener('click', () => {
    archivesModal.classList.add('hidden');
  });

  async function fetchArchives() {
    try {
      const res = await fetch('/api/admin/archives', { headers: adminHeaders() });
      const data = await res.json();
      renderArchivesTable(data.archives || []);
    } catch (e) {
      console.error('Fetch archives error:', e);
    }
  }

  function renderArchivesTable(archives) {
    archivesTableBody.innerHTML = '';
    if (archives.length === 0) {
      archivesTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-dim);">No past session archives found.</td></tr>';
      return;
    }

    archives.forEach(a => {
      const tr = document.createElement('tr');
      const formattedDate = new Date(a.archivedAt).toLocaleString();
      tr.innerHTML = `
        <td style="font-family:var(--mono); font-weight:700; color:#fff;">${a.filename}</td>
        <td style="font-size:12.5px;">${formattedDate}</td>
        <td style="font-family:var(--mono);">${a.totalTeams}</td>
        <td style="font-family:var(--mono);">${a.submittedCount} / ${a.disqualifiedCount}</td>
        <td style="color:var(--horizon-4); font-weight:600;">${a.topTeam}</td>
        <td>
          <button class="btn btn-primary" onclick="window.exportArchiveCsv('${a.filename}')" style="padding:4px 8px; font-size:11px;">📥 CSV</button>
        </td>
      `;
      archivesTableBody.appendChild(tr);
    });
  }

  window.exportArchiveCsv = function(filename) {
    window.location.href = `/api/admin/archives/${filename}/export?token=${adminToken}`;
  };

  // TEAM ACTIONS
  window.viewAuditLogs = function(teamId) {
    const team = currentTeamsData.find(t => t.teamId === teamId);
    if (!team) return;

    auditTeamTitle.textContent = `Audit Log — ${team.teamName} (${team.teamId})`;
    auditLogsContent.innerHTML = '';

    if (!team.violations || team.violations.length === 0) {
      auditLogsContent.innerHTML = '<div style="color: var(--ok);">No violations recorded for this team.</div>';
    } else {
      team.violations.forEach((v, i) => {
        const div = document.createElement('div');
        div.style.marginBottom = '8px';
        div.style.borderBottom = '1px solid var(--line)';
        div.style.paddingBottom = '6px';
        const formattedTime = new Date(v.timestamp).toLocaleTimeString();
        div.innerHTML = `
          <span style="color: var(--bad); font-weight: 700;">Strike ${i + 1}:</span>
          <span style="color: var(--horizon-4);">${v.type}</span>
          <span style="color: var(--text-dim);">at Q${v.questionIndex} (${formattedTime})</span>
        `;
        auditLogsContent.appendChild(div);
      });
    }

    auditModal.classList.remove('hidden');
  };

  closeAuditBtn.addEventListener('click', () => {
    auditModal.classList.add('hidden');
  });

  window.forceSubmitTeam = async function(teamId) {
    if (!confirm(`Force submit remaining exam for ${teamId}?`)) return;
    await fetch('/api/admin/team-action', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ teamId, action: 'force-submit' })
    });
    fetchOverview();
  };

  window.disqualifyTeam = async function(teamId) {
    if (!confirm(`Disqualify ${teamId}? This will terminate their session.`)) return;
    await fetch('/api/admin/team-action', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ teamId, action: 'disqualify' })
    });
    fetchOverview();
  };

  // EXPORT CSV
  exportCsvBtn.addEventListener('click', () => {
    window.location.href = `/api/admin/export?token=${adminToken}`;
  });

})();
