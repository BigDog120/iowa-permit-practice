const quiz = document.querySelector('#quiz');
const sidebar = document.querySelector('#sidebar');
const manualLink = document.querySelector('#manual-link').href;
const permitLink = 'https://iowadot.gov/drivers-licenses-ids/get-or-renew-drivers-licenses-ids-permits/under-18-permit-license-or-id/instruction-permit-under-age-18';
const total = Object.values(topics).reduce((sum, topic) => sum + topic.count, 0);
const target = Math.ceil(total * 0.8);
const storageKey = 'iowa-permit-last-questions-v1';
const letters = 'ABCD';
const submissions = 'https://iowa-permit-submissions.dapper-disney-dad.chatgpt.site';
const visuals = {
  stop: 'STOP',
  yield: 'YIELD',
  pennant: 'NO<br>PASSING<br>ZONE',
  school: 'SCHOOL',
  rail: 'R × R',
  slow: ''
};
let attempt = [];
let answers = new Map();
let position = 0;
let submission;

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function createAttempt(previousIds) {
  const previous = new Set(previousIds);
  const selection = Object.entries(topics).flatMap(([topic, {count}]) => {
    const candidates = questionBank.filter(question => question.topic === topic);
    const fresh = shuffle(candidates.filter(question => !previous.has(question.id)));
    const repeated = shuffle(candidates.filter(question => previous.has(question.id)));
    return [...fresh, ...repeated].slice(0, count);
  });
  return shuffle(selection).map(question => ({...question, choices: shuffle(question.choices)}));
}

function startAttempt(focus = false) {
  let previousIds = attempt.map(question => question.id);
  if (previousIds.length === 0) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved)) previousIds = saved;
    } catch {
      // The quiz also runs when storage is unavailable.
    }
  }
  attempt = createAttempt(previousIds);
  try {
    localStorage.setItem(storageKey, JSON.stringify(attempt.map(question => question.id)));
  } catch {
    // In-page restarts can still use the previous selection.
  }
  answers = new Map();
  submission = {
    id: crypto.randomUUID(),
    ids: attempt.map(question => question.id),
    started: null
  };
  showQuestion(0, focus);
}

function showQuestion(index, focus = true) {
  position = index;
  const question = attempt[index];
  const visual = question.visual
    ? '<div class="sign ' + question.visual + '" aria-hidden="true">' + visuals[question.visual] + '</div>'
    : '';
  quiz.innerHTML = `
    <div class="cardhead">
      <span class="label pill">${topics[question.topic].label}</span>
      <span class="counter">Question ${index + 1} of ${total}</span>
    </div>
    <h2 id="prompt" tabindex="-1">${question.prompt}</h2>
    ${visual}
    <div class="options" role="group" aria-labelledby="prompt">
      ${question.choices.map((choice, choiceIndex) => `
        <button class="option" type="button" data-choice="${choiceIndex}" aria-pressed="${answers.get(question.id) === choice}">
          <span class="letter" aria-hidden="true">${letters[choiceIndex]}</span><span>${choice}</span>
        </button>`).join('')}
    </div>
    <div class="actions">
      <button class="button secondary" id="previous" ${index === 0 ? 'disabled' : ''}>Previous</button>
      ${index === total - 1 ? '' : '<button class="button" id="next">Next question</button>'}
      ${index === total - 1 ? '<button class="button" id="finish">Finish test</button>' : ''}
    </div>`;
  const options = quiz.querySelectorAll('[data-choice]');
  options.forEach(button => {
    button.onclick = () => {
      answers.set(question.id, question.choices[Number(button.dataset.choice)]);
      recordStart(submission);
      options.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
      updateProgress();
    };
  });
  quiz.querySelector('#previous').onclick = () => showQuestion(index - 1);
  const next = quiz.querySelector('#next');
  const finish = quiz.querySelector('#finish');
  if (next) next.onclick = () => showQuestion(index + 1);
  if (finish) finish.onclick = finishAttempt;
  renderProgress();
  if (focus) focusHeading('#prompt');
}

function focusHeading(selector) {
  const heading = quiz.querySelector(selector);
  heading.focus({preventScroll: true});
  const bounds = heading.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
    quiz.scrollIntoView({block: 'start'});
  }
}

function renderProgress() {
  sidebar.innerHTML = `
    <h2>Your progress</h2>
    <div class="barline"><span class="muted" id="tally" aria-live="polite"></span></div>
    <progress max="${total}" value="${answers.size}" aria-label="Questions answered"></progress>
    <nav class="grid" aria-label="Jump to a question">
      ${attempt.map((question, index) => `<button type="button" data-index="${index}">${index + 1}</button>`).join('')}
    </nav>
    <div class="target"><strong>Passing target</strong><span class="muted">${target} out of ${total} correct (80%)</span></div>
    <button type="button" class="button link" id="sidebar-finish">Finish test</button>`;
  sidebar.querySelectorAll('[data-index]').forEach(button => {
    button.onclick = () => showQuestion(Number(button.dataset.index));
  });
  sidebar.querySelector('#sidebar-finish').onclick = finishAttempt;
  updateProgress();
}

function updateProgress() {
  sidebar.querySelector('#tally').textContent = `${answers.size} of ${total} answered`;
  sidebar.querySelector('progress').value = answers.size;
  sidebar.querySelectorAll('[data-index]').forEach((button, index) => {
    const done = answers.has(attempt[index].id);
    button.classList.toggle('done', done);
    button.setAttribute('aria-label', `Question ${index + 1}, ${done ? 'answered' : 'unanswered'}`);
    if (index === position) button.setAttribute('aria-current', 'step');
  });
}

function finishAttempt() {
  const remaining = total - answers.size;
  if (remaining && !window.confirm(
    `You have ${remaining} unanswered ${remaining === 1 ? 'question' : 'questions'}. Finish and count them as incorrect?`
  )) return;
  recordFinish(submission, attempt.map(question => answers.get(question.id) ?? null));
  showResults();
}

async function postAttempt(path, payload) {
  try {
    const result = await fetch(submissions + '/attempts/' + path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
      signal: AbortSignal.timeout(10000)
    });
    return result.ok;
  } catch {
    return false;
  }
}

function recordStart(current) {
  if (!current.started) {
    const {id, ids} = current;
    current.started = postAttempt('start', {id, ids}).then(saved => {
      if (!saved) current.started = null;
      return saved;
    });
  }
  return current.started;
}

async function recordFinish(current, choices) {
  const saved = await recordStart(current) || await recordStart(current);
  if (!saved) return;
  const payload = {id: current.id, choices};
  if (!await postAttempt('finish', payload)) await postAttempt('finish', payload);
}

function showResults() {
  const isCorrect = question => answers.get(question.id) === question.correct;
  const score = attempt.filter(isCorrect).length;
  const metTarget = score >= target;
  quiz.innerHTML = `
    <div class="cardhead"><span class="label pill">Practice results</span></div>
    <h2 id="results" tabindex="-1">${metTarget ? 'You met the passing target' : 'Keep practicing'}</h2>
    <p class="score">${score}/${total} <span>${Math.round(score / total * 100)}%</span></p>
    <p class="muted">${answers.size} answered · ${target} correct needed to pass</p>
    <div class="result-actions">
      <button class="button" id="retry">Start a new test</button>
      <button class="button secondary" id="expand" aria-expanded="false" aria-controls="review">Expand all answers</button>
    </div>
    <div class="review" id="review">
      <h3>Answer review</h3>
      ${attempt.map((question, index) => `
        <details>
          <summary><span class="${isCorrect(question) ? 'correct' : 'incorrect'}">${index + 1}. ${isCorrect(question) ? 'Correct' : answers.has(question.id) ? 'Incorrect' : 'Skipped'}</span> · ${question.prompt}</summary>
          <p><strong>Your answer</strong> · ${answers.get(question.id) ?? 'No answer'}</p>
          <p><strong>Correct answer</strong> · ${question.correct}</p>
          <p>${question.explanation}</p>
          <small>${question.section === 'permit'
            ? `<a href="${permitLink}" target="_blank" rel="noopener">Iowa DOT instruction permit rules</a>`
            : `<a href="${manualLink}" target="_blank" rel="noopener">Iowa Driver’s Manual</a> · § ${question.section}`}</small>
        </details>`).join('')}
    </div>`;
  sidebar.innerHTML = `<h2>Score by topic</h2>
    <ul class="breakdown">${Object.entries(topics).map(([key, {label, count}]) => {
      const correct = attempt.filter(question => question.topic === key && isCorrect(question)).length;
      return `<li><span class="muted">${label}</span><strong>${correct}/${count}</strong></li>`;
    }).join('')}</ul>
    <div class="target"><strong>Passing target</strong><span class="muted">${target} out of ${total} correct (80%)</span></div>`;
  quiz.querySelector('#retry').onclick = () => startAttempt(true);
  const expand = quiz.querySelector('#expand');
  const details = [...quiz.querySelectorAll('details')];
  function updateExpand() {
    const allOpen = details.every(item => item.open);
    expand.textContent = allOpen ? 'Collapse all answers' : 'Expand all answers';
    expand.setAttribute('aria-expanded', String(allOpen));
  }
  expand.onclick = () => {
    const open = !details.every(item => item.open);
    details.forEach(item => { item.open = open; });
    updateExpand();
  };
  details.forEach(item => { item.ontoggle = updateExpand; });
  focusHeading('#results');
}

startAttempt();
