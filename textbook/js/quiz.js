/**
 * Quiz Engine — 知识测验引擎
 * 每道题即时反馈，支持单选和多选
 */
const QuizEngine = {
  render(container, questions, onComplete) {
    const wrap = document.createElement('div');
    wrap.className = 'quiz-wrap';
    wrap.innerHTML = '<h2>📝 知识测验</h2>';

    const results = []; // track per-question results: null=unanswered, true=correct, false=wrong

    questions.forEach((q, qi) => {
      const qg = document.createElement('div');
      qg.className = 'qg';
      qg.innerHTML = `<div class="qq">Q${qi + 1}: ${q.question}</div>`;

      q.options.forEach((opt, oi) => {
        const btn = document.createElement('button');
        btn.className = 'qo';
        btn.textContent = `${String.fromCharCode(65 + oi)}. ${opt}`;
        btn.addEventListener('click', () => {
          if (results[qi] !== undefined) return; // already answered
          results[qi] = oi === q.answer;

          // Mark all options
          qg.querySelectorAll('.qo').forEach((b, i) => {
            b.disabled = true;
            if (i === q.answer) b.classList.add('correct');
            if (i === oi && i !== q.answer) b.classList.add('wrong');
            if (i === oi) b.classList.add('sel');
          });

          // Show feedback
          const fb = qg.querySelector('.qf');
          if (results[qi]) {
            fb.className = 'qf show ok';
            fb.textContent = '✅ 正确！' + (q.explanation ? ' ' + q.explanation : '');
          } else {
            fb.className = 'qf show no';
            fb.textContent = '❌ 不正确。' + (q.explanation ? ' ' + q.explanation : '');
          }

          // Check if all answered
          if (results.filter(r => r !== undefined).length === questions.length) {
            const score = results.filter(r => r === true).length;
            if (onComplete) onComplete(score, questions.length);
          }
        });
        qg.appendChild(btn);
      });

      const fb = document.createElement('div');
      fb.className = 'qf';
      qg.appendChild(fb);

      wrap.appendChild(qg);
    });

    container.appendChild(wrap);
  }
};
