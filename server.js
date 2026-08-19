const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load static databases & persistence
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? '/tmp/quiz_data' : path.join(__dirname, 'data');
const ORIGINAL_DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ARCHIVES_DIR = path.join(DATA_DIR, 'archives');

if (!fs.existsSync(ARCHIVES_DIR)) {
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
}

if (!fs.existsSync(TEAMS_FILE)) {
  const origTeams = path.join(ORIGINAL_DATA_DIR, 'teams.json');
  if (fs.existsSync(origTeams)) {
    fs.copyFileSync(origTeams, TEAMS_FILE);
  }
}

let teamsData = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
const questionsFile = fs.existsSync(path.join(DATA_DIR, 'questions.json')) ? path.join(DATA_DIR, 'questions.json') : path.join(ORIGINAL_DATA_DIR, 'questions.json');
const questionsData = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));

function saveTeamsData() {
  try {
    fs.writeFileSync(TEAMS_FILE, JSON.stringify(teamsData, null, 2));
  } catch (e) {
    console.error('Error saving teams file:', e.message);
  }
}

function archiveCurrentSession() {
  const sessionsList = Object.values(teamSessions);
  const hasData = sessionsList.some(s => s.status !== 'NOT_STARTED' || (s.answers && s.answers.length > 0) || (s.violations && s.violations.length > 0));
  if (!hasData && quizState === 'NOT_STARTED') {
    return null;
  }

  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `session_${timestampStr}.json`;
  const archivePath = path.join(ARCHIVES_DIR, filename);

  const archiveData = {
    archivedAt: new Date().toISOString(),
    quizState,
    totalTeams: sessionsList.length,
    activeCount: sessionsList.filter(t => t.status === 'ACTIVE' || t.status === 'WARNING').length,
    submittedCount: sessionsList.filter(t => t.status === 'SUBMITTED').length,
    disqualifiedCount: sessionsList.filter(t => t.status === 'DISQUALIFIED').length,
    teamSessions
  };

  fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
  return filename;
}

// Helper: Shuffle array
function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Global In-Memory State
let quizState = 'NOT_STARTED'; // 'NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'ENDED'
let teamSessions = {}; // key: teamId -> team session object
let tokenToTeamMap = {}; // key: token -> teamId
let adminTokens = new Set();

// Restore state if file exists
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      quizState = data.quizState || 'NOT_STARTED';
      teamSessions = data.teamSessions || {};
      tokenToTeamMap = data.tokenToTeamMap || {};
    } catch (e) {
      console.error('Error reading state file, initializing fresh:', e.message);
    }
  }
}

function saveState() {
  try {
    const payload = { quizState, teamSessions, tokenToTeamMap };
    fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('Error saving state:', e.message);
  }
}

loadState();

// Initialize session state for a team if not exists
function getOrCreateTeamSession(team) {
  if (teamSessions[team.id]) {
    return teamSessions[team.id];
  }

  // Generate randomized questions within difficulty tiers
  const easyQ = shuffle(questionsData.filter(q => q.difficulty === 'easy'));
  const mediumQ = shuffle(questionsData.filter(q => q.difficulty === 'medium'));
  const hardQ = shuffle(questionsData.filter(q => q.difficulty === 'hard'));

  const orderedQ = [...easyQ, ...mediumQ, ...hardQ];

  const preparedQuestions = orderedQ.map(q => {
    const shuffledOpts = shuffle(q.options);
    return {
      id: q.id,
      difficulty: q.difficulty,
      title: q.title,
      code: q.code,
      options: shuffledOpts, // Array of strings
      correct: q.correct,    // Server hidden correct string
      timeSeconds: q.timeSeconds,
      marks: q.marks
    };
  });

  const session = {
    teamId: team.id,
    teamName: team.name,
    token: null,
    status: 'NOT_STARTED', // 'NOT_STARTED', 'ACTIVE', 'WARNING', 'SUBMITTED', 'DISQUALIFIED'
    currentQuestionIndex: 0,
    questions: preparedQuestions,
    questionStartTime: null,
    answers: [],
    violations: [],
    startedAt: null,
    finishedAt: null,
    score: 0,
    maxPossibleScore: 45
  };

  teamSessions[team.id] = session;
  saveState();
  return session;
}

// Middleware: Authenticate Team Session Token
function authTeam(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !tokenToTeamMap[token]) {
    return res.status(401).json({ error: 'Unauthorized or invalid session token.' });
  }
  const teamId = tokenToTeamMap[token];
  const session = teamSessions[teamId];
  if (!session) {
    return res.status(401).json({ error: 'Session not found.' });
  }
  req.teamSession = session;
  next();
}

// Middleware: Authenticate Admin Token
function authAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized admin access.' });
  }
  next();
}

/* ==================== TEAM AUTH & CLIENT ENDPOINTS ==================== */

// Team Login
app.post('/api/auth/login', (req, res) => {
  const { teamId, password } = req.body;
  if (!teamId || !password) {
    return res.status(400).json({ error: 'Team ID and password are required.' });
  }

  const team = teamsData.find(t => t.id.toUpperCase() === teamId.trim().toUpperCase());
  if (!team || team.password !== password.trim()) {
    return res.status(401).json({ error: 'Invalid Team ID or password.' });
  }

  const session = getOrCreateTeamSession(team);

  // Enforce Single Active Session per team
  if (session.token && session.token !== req.headers['x-session-token']) {
    // If active and quiz in progress, prevent concurrent login unless force-reconnected
    if (session.status === 'ACTIVE' || session.status === 'WARNING') {
      return res.status(403).json({ error: 'This team is already logged in on another device/session.' });
    }
  }

  // Issue new token
  const token = crypto.randomBytes(16).toString('hex');
  if (session.token) {
    delete tokenToTeamMap[session.token];
  }
  session.token = token;
  tokenToTeamMap[token] = team.id;

  saveState();

  res.json({
    message: 'Login successful.',
    token,
    teamId: team.id,
    teamName: team.name,
    status: session.status,
    quizState
  });
});

// Logout
app.post('/api/auth/logout', authTeam, (req, res) => {
  const session = req.teamSession;
  if (session.token) {
    delete tokenToTeamMap[session.token];
    session.token = null;
    saveState();
  }
  res.json({ message: 'Logged out successfully.' });
});

// Get Current Quiz State & Active Question
app.get('/api/quiz/state', authTeam, (req, res) => {
  const session = req.teamSession;

  // Check if team is already completed or disqualified
  if (session.status === 'SUBMITTED' || session.status === 'DISQUALIFIED') {
    return res.json({
      quizState,
      teamStatus: session.status,
      completed: true,
      score: session.score,
      maxPossibleScore: session.maxPossibleScore,
      violationsCount: session.violations.length,
      answersCount: session.answers.length
    });
  }

  if (quizState !== 'IN_PROGRESS') {
    return res.json({
      quizState,
      teamStatus: session.status,
      completed: false,
      message: quizState === 'PAUSED' ? 'Quiz is currently paused by organizer.' : 'Quiz has not been started by organizer yet.'
    });
  }

  // Quiz is IN_PROGRESS and team is playing
  if (session.status === 'NOT_STARTED') {
    session.status = 'ACTIVE';
    session.startedAt = new Date().toISOString();
  }

  // Check if all 20 questions are completed
  if (session.currentQuestionIndex >= session.questions.length) {
    session.status = 'SUBMITTED';
    session.finishedAt = new Date().toISOString();
    saveState();
    return res.json({
      quizState,
      teamStatus: session.status,
      completed: true,
      score: session.score,
      maxPossibleScore: session.maxPossibleScore,
      violationsCount: session.violations.length
    });
  }

  const currentQ = session.questions[session.currentQuestionIndex];

  // Set question start time if not set
  if (!session.questionStartTime) {
    session.questionStartTime = Date.now();
    saveState();
  }

  // Calculate server-side remaining seconds
  const elapsedSeconds = Math.floor((Date.now() - session.questionStartTime) / 1000);
  const remainingSeconds = Math.max(0, currentQ.timeSeconds - elapsedSeconds);

  // If timer expired server-side before client submit, auto-advance
  if (remainingSeconds <= 0) {
    // Record unanswered
    const isCorrect = false;
    session.answers.push({
      questionIndex: session.currentQuestionIndex + 1,
      id: currentQ.id,
      difficulty: currentQ.difficulty,
      selected: null,
      isCorrect: false,
      unanswered: true,
      marksAwarded: 0,
      maxMarks: currentQ.marks,
      timestamp: new Date().toISOString()
    });

    session.currentQuestionIndex++;
    session.questionStartTime = null;

    if (session.currentQuestionIndex >= session.questions.length) {
      session.status = 'SUBMITTED';
      session.finishedAt = new Date().toISOString();
    }

    saveState();

    return res.json({
      autoAdvanced: true,
      quizState,
      teamStatus: session.status,
      completed: session.status === 'SUBMITTED',
      score: session.score,
      maxPossibleScore: session.maxPossibleScore
    });
  }

  // Clean public question representation (NO correct answer!)
  const publicQuestion = {
    index: session.currentQuestionIndex + 1,
    total: session.questions.length,
    id: currentQ.id,
    difficulty: currentQ.difficulty,
    title: currentQ.title,
    code: currentQ.code,
    options: currentQ.options, // array of option text strings
    timeSeconds: currentQ.timeSeconds,
    marks: currentQ.marks
  };

  res.json({
    quizState,
    teamStatus: session.status,
    completed: false,
    question: publicQuestion,
    remainingSeconds,
    violationsCount: session.violations.length
  });
});

// Submit Answer for Current Question
app.post('/api/quiz/submit-answer', authTeam, (req, res) => {
  const session = req.teamSession;

  if (session.status === 'SUBMITTED' || session.status === 'DISQUALIFIED') {
    return res.status(400).json({ error: 'Quiz is already finished or team disqualified.' });
  }

  if (quizState !== 'IN_PROGRESS') {
    return res.status(400).json({ error: 'Quiz is not in progress.' });
  }

  if (session.currentQuestionIndex >= session.questions.length) {
    return res.status(400).json({ error: 'No active question.' });
  }

  const currentQ = session.questions[session.currentQuestionIndex];
  const { selectedOption } = req.body; // text string of selected option, or null

  // Verify server-side timer (allow 3 second grace window for network latency)
  const elapsedSeconds = session.questionStartTime ? Math.floor((Date.now() - session.questionStartTime) / 1000) : 0;
  const isTimeout = elapsedSeconds > (currentQ.timeSeconds + 3);

  const finalSelected = isTimeout ? null : (selectedOption || null);
  const isCorrect = finalSelected !== null && finalSelected === currentQ.correct;
  const marksAwarded = isCorrect ? currentQ.marks : 0;

  session.score += marksAwarded;

  session.answers.push({
    questionIndex: session.currentQuestionIndex + 1,
    id: currentQ.id,
    difficulty: currentQ.difficulty,
    selected: finalSelected,
    isCorrect,
    unanswered: finalSelected === null,
    marksAwarded,
    maxMarks: currentQ.marks,
    timestamp: new Date().toISOString()
  });

  session.currentQuestionIndex++;
  session.questionStartTime = null;

  if (session.currentQuestionIndex >= session.questions.length) {
    session.status = 'SUBMITTED';
    session.finishedAt = new Date().toISOString();
  }

  saveState();

  res.json({
    message: 'Answer submitted.',
    completed: session.status === 'SUBMITTED',
    currentQuestionIndex: session.currentQuestionIndex + 1,
    score: session.score
  });
});

// Record Anti-Cheat Violation
app.post('/api/quiz/violation', authTeam, (req, res) => {
  const session = req.teamSession;

  if (session.status === 'SUBMITTED' || session.status === 'DISQUALIFIED') {
    return res.json({ status: session.status, violationsCount: session.violations.length });
  }

  const { type } = req.body; // 'tab_switch', 'fullscreen_exit', 'window_blur', 'shortcut_blocked'
  const violationRecord = {
    type: type || 'unknown',
    questionIndex: session.currentQuestionIndex + 1,
    timestamp: new Date().toISOString()
  };

  // Debounce: ignore duplicate events triggered simultaneously (e.g. fullscreen_exit + tab_switch + blur within 1500ms)
  const now = Date.now();
  const lastViolation = session.violations[session.violations.length - 1];
  if (lastViolation) {
    const lastTime = new Date(lastViolation.timestamp).getTime();
    if (now - lastTime < 1500) {
      return res.json({
        violationsCount: session.violations.length,
        status: session.status,
        disqualified: session.status === 'DISQUALIFIED',
        ignoredDuplicate: true
      });
    }
  }

  session.violations.push(violationRecord);

  if (session.violations.length >= 3) {
    // 3rd strike -> Disqualify & Auto-submit
    session.status = 'DISQUALIFIED';
    session.finishedAt = new Date().toISOString();

    // Fill remaining questions as unanswered
    while (session.currentQuestionIndex < session.questions.length) {
      const q = session.questions[session.currentQuestionIndex];
      session.answers.push({
        questionIndex: session.currentQuestionIndex + 1,
        id: q.id,
        difficulty: q.difficulty,
        selected: null,
        isCorrect: false,
        unanswered: true,
        marksAwarded: 0,
        maxMarks: q.marks,
        timestamp: new Date().toISOString()
      });
      session.currentQuestionIndex++;
    }
  } else {
    session.status = 'WARNING';
  }

  saveState();

  res.json({
    violationsCount: session.violations.length,
    status: session.status,
    disqualified: session.status === 'DISQUALIFIED'
  });
});

/* ==================== ORGANIZER / ADMIN ENDPOINTS ==================== */

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '190807@1987Mm';

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password.' });
  }

  const adminToken = crypto.randomBytes(16).toString('hex');
  adminTokens.add(adminToken);

  res.json({ message: 'Admin authenticated successfully.', token: adminToken });
});

// Admin Live Overview
app.get('/api/admin/overview', authAdmin, (req, res) => {
  // Ensure all registered teams exist in teamSessions
  teamsData.forEach(t => getOrCreateTeamSession(t));

  const teamsSummary = Object.values(teamSessions).map(s => ({
    teamId: s.teamId,
    teamName: s.teamName,
    status: s.status,
    currentQuestionIndex: s.currentQuestionIndex,
    totalQuestions: s.questions.length,
    score: s.score,
    maxPossibleScore: s.maxPossibleScore,
    violationsCount: s.violations.length,
    violations: s.violations,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt
  }));

  // Sort by Score descending, then violations ascending
  teamsSummary.sort((a, b) => b.score - a.score || a.violationsCount - b.violationsCount);

  res.json({
    quizState,
    totalTeams: teamsSummary.length,
    activeCount: teamsSummary.filter(t => t.status === 'ACTIVE' || t.status === 'WARNING').length,
    submittedCount: teamsSummary.filter(t => t.status === 'SUBMITTED').length,
    disqualifiedCount: teamsSummary.filter(t => t.status === 'DISQUALIFIED').length,
    teams: teamsSummary
  });
});

// Admin Quiz Controls (Start, Pause, Resume, End, Reset-All)
app.post('/api/admin/control', authAdmin, (req, res) => {
  const { action } = req.body; // 'start', 'pause', 'resume', 'end', 'reset-all'

  if (action === 'start' || action === 'resume') {
    quizState = 'IN_PROGRESS';
  } else if (action === 'pause') {
    quizState = 'PAUSED';
  } else if (action === 'end') {
    quizState = 'ENDED';
  } else if (action === 'reset-all') {
    quizState = 'NOT_STARTED';
    teamSessions = {};
    tokenToTeamMap = {};
    teamsData.forEach(t => getOrCreateTeamSession(t));
  } else {
    return res.status(400).json({ error: 'Invalid action.' });
  }

  saveState();
  res.json({ message: `Quiz state updated to ${quizState}`, quizState });
});

// Admin Team Actions (Force Submit, Disqualify, Reset)
app.post('/api/admin/team-action', authAdmin, (req, res) => {
  const { teamId, action } = req.body; // 'force-submit', 'disqualify', 'reset'

  const session = teamSessions[teamId];
  if (!session) {
    return res.status(404).json({ error: 'Team session not found.' });
  }

  if (action === 'force-submit') {
    session.status = 'SUBMITTED';
    session.finishedAt = new Date().toISOString();
  } else if (action === 'disqualify') {
    session.status = 'DISQUALIFIED';
    session.finishedAt = new Date().toISOString();
  } else if (action === 'reset') {
    delete teamSessions[teamId];
    const team = teamsData.find(t => t.id === teamId);
    if (team) getOrCreateTeamSession(team);
  } else {
    return res.status(400).json({ error: 'Invalid action.' });
  }

  saveState();
  res.json({ message: `Action ${action} executed for ${teamId}` });
});

// CSV Export
app.get('/api/admin/export', authAdmin, (req, res) => {
  const teamsArray = Object.values(teamSessions);
  teamsArray.sort((a, b) => b.score - a.score || a.violations.length - b.violations.length);

  let csv = 'Rank,Team ID,Team Name,Status,Score,Max Marks,Violations Count,Started At,Finished At\n';

  teamsArray.forEach((t, i) => {
    csv += `${i + 1},"${t.teamId}","${t.teamName}","${t.status}",${t.score},${t.maxPossibleScore},${t.violations.length},"${t.startedAt || ''}","${t.finishedAt || ''}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=digital_horizon_level1_results.csv');
  res.send(csv);
});

// Admin Clear Previous Data & Auto-Archive
app.post('/api/admin/clear-data', authAdmin, (req, res) => {
  const archivedFilename = archiveCurrentSession();

  quizState = 'NOT_STARTED';
  teamSessions = {};
  tokenToTeamMap = {};
  teamsData.forEach(t => getOrCreateTeamSession(t));
  saveState();

  res.json({
    message: 'Previous session data cleared successfully.',
    archived: !!archivedFilename,
    archivedFilename
  });
});

// Admin Team/Participant Credential Management (Get list, Create, Edit, Delete)
app.get('/api/admin/teams-list', authAdmin, (req, res) => {
  res.json({ teams: teamsData });
});

app.post('/api/admin/teams', authAdmin, (req, res) => {
  const { id, name, password } = req.body;
  if (!id || !name || !password) {
    return res.status(400).json({ error: 'Team ID, Name, and Password are required.' });
  }

  const normalizedId = id.trim().toUpperCase();
  if (teamsData.some(t => t.id.toUpperCase() === normalizedId)) {
    return res.status(400).json({ error: `Team ID '${normalizedId}' already exists.` });
  }

  const newTeam = {
    id: normalizedId,
    password: password.trim(),
    name: name.trim()
  };

  teamsData.push(newTeam);
  saveTeamsData();

  getOrCreateTeamSession(newTeam);
  saveState();

  res.json({ message: 'Participant team created successfully.', team: newTeam });
});

app.put('/api/admin/teams/:id', authAdmin, (req, res) => {
  const teamId = req.params.id.trim().toUpperCase();
  const { name, password } = req.body;

  const team = teamsData.find(t => t.id.toUpperCase() === teamId);
  if (!team) {
    return res.status(404).json({ error: 'Team not found.' });
  }

  if (name && name.trim()) team.name = name.trim();
  if (password && password.trim()) team.password = password.trim();

  saveTeamsData();

  if (teamSessions[team.id]) {
    if (name) teamSessions[team.id].teamName = team.name;
    saveState();
  }

  res.json({ message: 'Team details updated successfully.', team });
});

// Helper: Generate random mixed password (uppercase, lowercase, number, symbol)
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

// Randomize mixed passwords for all teams
app.post('/api/admin/teams/randomize-passwords', authAdmin, (req, res) => {
  teamsData.forEach(t => {
    t.password = generateMixedPassword(8);
  });
  saveTeamsData();
  res.json({ message: 'All participant passwords updated with mixed passwords.', teams: teamsData });
});

// Export Credentials CSV for printing/distributing
app.get('/api/admin/teams/export-credentials', authAdmin, (req, res) => {
  let csv = 'Team ID,Team Name,Password\n';
  teamsData.forEach(t => {
    csv += `"${t.id}","${t.name}","${t.password}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=participant_credentials.csv');
  res.send(csv);
});

app.delete('/api/admin/teams/:id', authAdmin, (req, res) => {
  const teamId = req.params.id.trim().toUpperCase();
  const index = teamsData.findIndex(t => t.id.toUpperCase() === teamId);

  if (index === -1) {
    return res.status(404).json({ error: 'Team not found.' });
  }

  const deletedTeam = teamsData.splice(index, 1)[0];
  saveTeamsData();

  if (teamSessions[deletedTeam.id]) {
    const token = teamSessions[deletedTeam.id].token;
    if (token) delete tokenToTeamMap[token];
    delete teamSessions[deletedTeam.id];
    saveState();
  }

  res.json({ message: `Team ${deletedTeam.id} deleted successfully.` });
});

// Admin Session Archives (List, View, Export CSV)
app.get('/api/admin/archives', authAdmin, (req, res) => {
  if (!fs.existsSync(ARCHIVES_DIR)) {
    return res.json({ archives: [] });
  }

  const files = fs.readdirSync(ARCHIVES_DIR).filter(f => f.endsWith('.json'));
  const archives = files.map(file => {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(ARCHIVES_DIR, file), 'utf8'));
      const teamsArr = Object.values(content.teamSessions || {});
      const topScorer = teamsArr.length ? teamsArr.slice().sort((a, b) => b.score - a.score)[0] : null;
      return {
        filename: file,
        archivedAt: content.archivedAt || file.replace('session_', '').replace('.json', ''),
        quizState: content.quizState,
        totalTeams: content.totalTeams || teamsArr.length,
        submittedCount: content.submittedCount || teamsArr.filter(t => t.status === 'SUBMITTED').length,
        disqualifiedCount: content.disqualifiedCount || teamsArr.filter(t => t.status === 'DISQUALIFIED').length,
        topTeam: topScorer ? `${topScorer.teamName} (${topScorer.score} pts)` : 'N/A'
      };
    } catch (e) {
      return { filename: file, error: 'Could not read archive file' };
    }
  });

  archives.sort((a, b) => b.filename.localeCompare(a.filename));
  res.json({ archives });
});

app.get('/api/admin/archives/:filename', authAdmin, (req, res) => {
  const filepath = path.join(ARCHIVES_DIR, req.params.filename);
  if (!fs.existsSync(filepath) || !req.params.filename.endsWith('.json')) {
    return res.status(404).json({ error: 'Archive file not found.' });
  }

  const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  res.json(data);
});

app.get('/api/admin/archives/:filename/export', authAdmin, (req, res) => {
  const filepath = path.join(ARCHIVES_DIR, req.params.filename);
  if (!fs.existsSync(filepath) || !req.params.filename.endsWith('.json')) {
    return res.status(404).json({ error: 'Archive file not found.' });
  }

  const archiveData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  const teamsArray = Object.values(archiveData.teamSessions || {});
  teamsArray.sort((a, b) => b.score - a.score || (a.violations ? a.violations.length : 0) - (b.violations ? b.violations.length : 0));

  let csv = 'Rank,Team ID,Team Name,Status,Score,Max Marks,Violations Count,Started At,Finished At\n';

  teamsArray.forEach((t, i) => {
    const vCount = t.violations ? t.violations.length : 0;
    csv += `${i + 1},"${t.teamId}","${t.teamName}","${t.status}",${t.score},${t.maxPossibleScore || 45},${vCount},"${t.startedAt || ''}","${t.finishedAt || ''}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${req.params.filename.replace('.json', '_results.csv')}`);
  res.send(csv);
});

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Digital Horizon Level 1 Quiz Server active on port ${PORT}`);
    console.log(`Participant Portal: http://localhost:${PORT}`);
    console.log(`Admin Dashboard:    http://localhost:${PORT}/admin.html`);
    console.log(`==================================================`);
  });
}
