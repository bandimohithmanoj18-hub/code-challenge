/* Digital Horizon Level 1 — Participant Quiz Client */
(function() {
  let sessionToken = sessionStorage.getItem('dh_session_token') || null;
  let teamId = sessionStorage.getItem('dh_team_id') || '';
  let teamName = sessionStorage.getItem('dh_team_name') || '';

  let currentQuestion = null;
  let selectedOptionText = null;
  let timerInterval = null;
  let remainingSeconds = 0;
  let totalTimeSeconds = 30;
  let quizActive = false;
  let isTerminated = false;
  let statePollInterval = null;
  let renderedQuestionIndex = null;
  let lastViolationTime = 0;

  // DOM Elements
  const loginScreen = document.getElementById('loginScreen');
  const lobbyScreen = document.getElementById('lobbyScreen');
  const quizScreen = document.getElementById('quizScreen');
  const resultScreen = document.getElementById('resultScreen');
  const lockdown = document.getElementById('lockdown');

  const teamIdInput = document.getElementById('teamId');
  const teamPassInput = document.getElementById('teamPassword');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  const lobbyTeamName = document.getElementById('lobbyTeamName');
  const lobbyStatusMsg = document.getElementById('lobbyStatusMsg');
  const startQuizBtn = document.getElementById('startQuizBtn');

  const qcount = document.getElementById('qcount');
  const strikeCount = document.getElementById('strikeCount');
  const diffbadge = document.getElementById('diffbadge');
  const progressFill = document.getElementById('progressFill');
  const timerFill = document.getElementById('timerFill');
  const timerNum = document.getElementById('timerNum');

  const qtitle = document.getElementById('qtitle');
  const qcode = document.getElementById('qcode');
  const optionsWrap = document.getElementById('options');
  const submitAnswerBtn = document.getElementById('submitAnswerBtn');

  const scoreBig = document.getElementById('scoreBig');
  const resultTitle = document.getElementById('resultTitle');
  const resultMsg = document.getElementById('resultMsg');
  const resumeBtn = document.getElementById('resumeBtn');

  function showScreen(el) {
    [loginScreen, lobbyScreen, quizScreen, resultScreen].forEach(s => s.classList.add('hidden'));
    el.classList.remove('hidden');
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken || ''
    };
  }

  // Fullscreen Helper
  function requestFS() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) return req.call(el);
    return Promise.resolve();
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }

  // LOGIN
  loginBtn.addEventListener('click', async () => {
    const id = teamIdInput.value.trim();
    const pass = teamPassInput.value.trim();
    loginError.classList.add('hidden');

    if (!id || !pass) {
      loginError.textContent = 'Please enter both Team ID and Password.';
      loginError.classList.remove('hidden');
      return;
    }

    try {
      loginBtn.disabled = true;
      loginBtn.textContent = 'Logging in...';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: id, password: pass })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed.');
      }

      sessionToken = data.token;
      teamId = data.teamId;
      teamName = data.teamName;

      sessionStorage.setItem('dh_session_token', sessionToken);
      sessionStorage.setItem('dh_team_id', teamId);
      sessionStorage.setItem('dh_team_name', teamName);

      initSession();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Team Login →';
    }
  });

  // Check state on load if session token exists
  if (sessionToken) {
    initSession();
  }

  async function initSession() {
    lobbyTeamName.textContent = `Welcome, ${teamName} (${teamId})`;
    showScreen(lobbyScreen);
    pollQuizState();
    if (!statePollInterval) {
      statePollInterval = setInterval(pollQuizState, 2000);
    }
  }

  async function pollQuizState() {
    if (isTerminated) return;

    try {
      const res = await fetch('/api/quiz/state', { headers: headers() });
      if (res.status === 401) {
        sessionStorage.clear();
        sessionToken = null;
        showScreen(loginScreen);
        clearInterval(statePollInterval);
        return;
      }

      const data = await res.json();

      if (data.completed) {
        clearInterval(statePollInterval);
        clearInterval(timerInterval);
        quizActive = false;
        renderResults(data);
        return;
      }

      if (data.quizState === 'IN_PROGRESS') {
        startQuizBtn.disabled = false;
        startQuizBtn.textContent = 'Enter Fullscreen & Begin Challenge →';
        lobbyStatusMsg.textContent = 'The organizer has started the quiz! Click below to begin.';

        if (quizActive && data.question) {
          strikeCount.textContent = `Strikes: ${data.violationsCount} / 3`;
          if (data.question.index !== renderedQuestionIndex) {
            renderedQuestionIndex = data.question.index;
            renderQuestion(data.question, data.remainingSeconds, data.violationsCount);
          }
        }
      } else if (data.quizState === 'PAUSED') {
        startQuizBtn.disabled = true;
        startQuizBtn.textContent = 'Quiz Paused by Organizer';
        lobbyStatusMsg.textContent = 'The organizer has paused the quiz temporarily.';
        if (quizActive) {
          pauseTimer();
        }
      } else {
        startQuizBtn.disabled = true;
        startQuizBtn.textContent = 'Waiting for Organizer...';
        lobbyStatusMsg.textContent = 'Waiting for the organizer to start the challenge...';
      }
    } catch (e) {
      console.error('State poll error:', e);
    }
  }

  startQuizBtn.addEventListener('click', async () => {
    await requestFS().catch(() => {});
    quizActive = true;
    showScreen(quizScreen);
    pollQuizState();
  });

  // RENDER QUESTION
  function renderQuestion(q, remainingSec, vCount) {
    currentQuestion = q;
    selectedOptionText = null;

    qcount.textContent = `Question ${q.index} / ${q.total}`;
    strikeCount.textContent = `Strikes: ${vCount} / 3`;

    diffbadge.textContent = `${q.difficulty.toUpperCase()} · ${q.marks} MARK${q.marks > 1 ? 'S' : ''}`;
    diffbadge.className = `diffbadge diff-${q.difficulty}`;

    progressFill.style.width = `${((q.index - 1) / q.total) * 100}%`;
    qtitle.textContent = `Q${q.index} — ${q.title}`;
    qcode.textContent = q.code;

    // Render options with sequential clean keys A, B, C, D
    optionsWrap.innerHTML = '';
    const keys = ['A', 'B', 'C', 'D'];

    q.options.forEach((optText, idx) => {
      const labelKey = keys[idx] || (idx + 1);
      const div = document.createElement('div');
      div.className = 'opt';
      div.innerHTML = `<span class="key">${labelKey}</span><span class="val"></span>`;
      div.querySelector('.val').textContent = optText;

      div.addEventListener('click', () => {
        selectedOptionText = optText;
        document.querySelectorAll('#options .opt').forEach(o => o.classList.remove('selected'));
        div.classList.add('selected');
      });

      optionsWrap.appendChild(div);
    });

    totalTimeSeconds = q.timeSeconds;
    remainingSeconds = remainingSec;
    if (lockdown.classList.contains('hidden')) {
      startTimer();
    }
  }

  // TIMER
  function startTimer() {
    clearInterval(timerInterval);
    updateTimerUI();
    timerInterval = setInterval(tick, 1000);
  }

  function pauseTimer() {
    clearInterval(timerInterval);
  }

  function tick() {
    remainingSeconds--;
    updateTimerUI();
    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      submitCurrentAnswer(true);
    }
  }

  function updateTimerUI() {
    const pct = Math.max(0, (remainingSeconds / totalTimeSeconds) * 100);
    timerFill.style.width = pct + '%';
    timerFill.style.background = pct < 30
      ? 'linear-gradient(90deg,var(--bad),var(--horizon-3))'
      : 'linear-gradient(90deg,var(--ok),var(--horizon-4))';
    timerNum.textContent = Math.max(0, remainingSeconds) + 's';
  }

  // SUBMIT ANSWER
  submitAnswerBtn.addEventListener('click', () => {
    submitCurrentAnswer(false);
  });

  async function submitCurrentAnswer(isAutoTimeout) {
    if (!currentQuestion || isTerminated) return;

    try {
      submitAnswerBtn.disabled = true;
      pauseTimer();

      const res = await fetch('/api/quiz/submit-answer', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ selectedOption: selectedOptionText })
      });

      const data = await res.json();
      submitAnswerBtn.disabled = false;

      if (data.completed) {
        quizActive = false;
        pollQuizState();
      } else {
        pollQuizState();
      }
    } catch (e) {
      console.error('Submit error:', e);
      submitAnswerBtn.disabled = false;
    }
  }

  // PROCTORING & VIOLATIONS
  document.addEventListener('fullscreenchange', handleFSChange);
  document.addEventListener('webkitfullscreenchange', handleFSChange);

  function handleFSChange() {
    if (!quizActive || isTerminated) return;
    if (!isFullscreen()) {
      logViolation('fullscreen_exit');
    } else {
      lockdown.classList.add('hidden');
      if (quizActive && !isTerminated) {
        startTimer();
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (quizActive && !isTerminated && document.hidden) {
      logViolation('tab_switch');
    }
  });

  window.addEventListener('blur', () => {
    if (!quizActive || isTerminated) return;
    if (!isFullscreen()) return;
    logViolation('window_blur');
  });

  // Block Copy/Paste & DevTools shortcuts
  ['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'dragstart'].forEach(evt => {
    document.addEventListener(evt, e => {
      if (quizActive) e.preventDefault();
    });
  });

  document.addEventListener('keydown', e => {
    if (!quizActive) return;
    const k = e.key.toLowerCase();
    const blocked = (
      (e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'u', 's', 'p'].includes(k)
    ) || k === 'f12' ||
    ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k));

    if (blocked) {
      e.preventDefault();
      logViolation('shortcut_blocked:' + k);
    }
  });

  async function logViolation(type) {
    if (isTerminated) return;

    const now = Date.now();
    if (now - lastViolationTime < 1500) {
      return;
    }
    lastViolationTime = now;

    try {
      const res = await fetch('/api/quiz/violation', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ type })
      });
      const data = await res.json();

      if (data.ignoredDuplicate) {
        return;
      }

      strikeCount.textContent = `Strikes: ${data.violationsCount} / 3`;

      if (data.disqualified) {
        isTerminated = true;
        quizActive = false;
        clearInterval(timerInterval);
        lockdown.classList.add('hidden');
        pollQuizState();
      } else {
        pauseTimer();
        document.getElementById('violationTag').textContent = `VIOLATION ${data.violationsCount} / 3`;
        document.getElementById('lockdownTitle').textContent = 'Security Warning Logged';
        document.getElementById('lockdownMsg').textContent = `You left fullscreen or switched tabs. Return to fullscreen immediately. ${3 - data.violationsCount} strike(s) remaining before automatic disqualification.`;
        lockdown.classList.remove('hidden');
      }
    } catch (e) {
      console.error('Violation logging error:', e);
    }
  }

  resumeBtn.addEventListener('click', () => {
    requestFS().then(() => {
      lockdown.classList.add('hidden');
      if (quizActive && !isTerminated) {
        startTimer();
      }
    }).catch(() => {});
  });

  // RESULTS
  function renderResults(data) {
    if (data.teamStatus === 'DISQUALIFIED') {
      resultTitle.textContent = 'Exam Disqualified';
      resultMsg.textContent = `Your session was terminated due to repeated anti-cheat violations (${data.violationsCount} strikes logged). Score achieved prior to disqualification:`;
    } else {
      resultTitle.textContent = 'Challenge Completed';
      resultMsg.textContent = 'Thank you for participating! Your final result has been recorded on the server.';
    }

    scoreBig.textContent = `${data.score} / ${data.maxPossibleScore}`;
    showScreen(resultScreen);
  }

})();
