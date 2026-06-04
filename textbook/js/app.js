const app = {
  currentChapter: 0,
  chapters: [],
  darkMode: false,

  init() {
    this.chapters = (window.__chapters || []).sort((a, b) => a.id - b.id);
    this._buildNav();
    this._loadTheme();
    this._updateProgress();

    const hash = window.location.hash;
    if (hash.startsWith('#ch')) {
      const id = parseInt(hash.replace('#ch', ''));
      if (id) this.navigateTo(id);
    }

    // Back to top visibility
    window.addEventListener('scroll', () => {
      document.getElementById('btt').classList.toggle('visible', window.scrollY > 400);
    });
  },

  navigateTo(id) {
    const chapter = this.chapters.find(c => c.id === id);
    if (!chapter) return;
    this.currentChapter = id;
    window.location.hash = 'ch' + id;
    this._renderChapter(chapter);
    this._highlightNav(id);
    this._saveProgress();
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  },

  toggleTheme() {
    this.darkMode = !this.darkMode;
    document.documentElement.setAttribute('data-theme', this.darkMode ? 'dark' : '');
    document.getElementById('tb').textContent = this.darkMode ? '☀️ 亮色' : '🌙 暗色';
    localStorage.setItem('textbook-theme', this.darkMode ? 'dark' : 'light');
  },

  // === Private ===
  _buildNav() {
    const nav = document.getElementById('sn');
    nav.innerHTML = this.chapters.map(c =>
      `<a href="#ch${c.id}" data-ch="${c.id}" class="${this._isDone(c.id) ? 'done' : ''}"><b>${c.id}.</b> ${c.title}</a>`
    ).join('');
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-ch]');
      if (a) { e.preventDefault(); this.navigateTo(parseInt(a.dataset.ch)); }
    });
  },

  _renderChapter(chapter) {
    const mc = document.getElementById('mc');
    mc.innerHTML = '';

    // Header
    const h = document.createElement('div');
    h.innerHTML = `
      <div class="chapter-label">第 ${chapter.id} 章</div>
      <h1>${chapter.title}</h1>
      <p style="color:var(--text2);font-size:1rem;margin-bottom:20px;">${chapter.desc}</p>
    `;
    mc.appendChild(h);

    // Objectives
    if (chapter.objectives?.length) {
      const obj = document.createElement('div');
      obj.className = 'ch-intro';
      obj.innerHTML = '<h3>🎯 学习目标</h3><ul>' +
        chapter.objectives.map(o => `<li>${o}</li>`).join('') + '</ul>';
      mc.appendChild(obj);
    }

    // Content
    const content = document.createElement('div');
    chapter.render(content);
    mc.appendChild(content);

    // Quiz
    if (chapter.quiz?.length) {
      QuizEngine.render(mc, chapter.quiz, (score, total) => {
        if (score === total) {
          this._markDone(chapter.id);
          this._buildNav();
        }
      });
    }

    // Coding
    if (chapter.coding?.length) {
      const cs = document.createElement('div');
      cs.className = 'quiz-wrap';
      cs.innerHTML = '<h2>💻 编程练习</h2>';
      chapter.coding.forEach((ex, i) => {
        const div = document.createElement('div');
        div.style.cssText = 'margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--border);';
        div.innerHTML = `
          <h4>练习 ${i + 1}：${ex.title}</h4>
          <p style="color:var(--text2);white-space:pre-wrap;margin-bottom:10px;">${ex.prompt}</p>
          ${ex.hint ? `<details><summary>💡 提示</summary><div class="ct">${ex.hint}</div></details>` : ''}
          ${ex.answer ? `<details><summary>📖 参考答案</summary><div class="ct"><pre><code class="language-typescript">${ex.answer.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre><p style="margin-top:8px;color:var(--text2);font-size:.88rem;">${ex.explanation || ''}</p></div></details>` : ''}
        `;
        cs.appendChild(div);
      });
      mc.appendChild(cs);
      hljs.highlightAll();
    }

    // Challenges (Ch10)
    if (chapter.challenges?.length) {
      const cs = document.createElement('div');
      cs.className = 'quiz-wrap';
      cs.innerHTML = '<h2>💪 动手挑战</h2>';
      chapter.challenges.forEach((c, i) => {
        const div = document.createElement('div');
        div.style.marginBottom = '16px';
        div.innerHTML = `<h4>${i + 1}. ${c.title}</h4><ul>${c.tasks.map(t => `<li>${t}</li>`).join('')}</ul>`;
        cs.appendChild(div);
      });
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = this._isDone(chapter.id) ? '✅ 已完成' : '📝 标记为已完成';
      btn.disabled = this._isDone(chapter.id);
      btn.addEventListener('click', () => {
        this._markDone(chapter.id);
        this._buildNav();
        btn.textContent = '✅ 已完成';
        btn.disabled = true;
      });
      cs.appendChild(btn);
      mc.appendChild(cs);
    }

    // Summary
    if (chapter.summary?.length) {
      const sum = document.createElement('div');
      sum.className = 'ch-summary';
      sum.innerHTML = '<h2>📌 本章小结</h2><ul>' +
        chapter.summary.map(s => `<li>${s}</li>`).join('') + '</ul>';
      mc.appendChild(sum);
    }

    // Chapter nav
    const nav = document.createElement('div');
    nav.className = 'cn';
    const prev = this.chapters.find(c => c.id === chapter.id - 1);
    const next = this.chapters.find(c => c.id === chapter.id + 1);
    nav.innerHTML = `
      <button ${prev ? '' : 'disabled'} id="btn-prev">← 上一章</button>
      <a href="#ch${chapter.id}" style="font-size:.8rem;color:var(--text2);">第 ${chapter.id} / ${this.chapters.length} 章</a>
      <button ${next ? '' : 'disabled'} id="btn-next">下一章 →</button>
    `;
    mc.appendChild(nav);
    if (prev) nav.querySelector('#btn-prev').addEventListener('click', () => this.navigateTo(prev.id));
    if (next) nav.querySelector('#btn-next').addEventListener('click', () => this.navigateTo(next.id));

    // Copy buttons
    mc.querySelectorAll('pre').forEach(pre => {
      const btn = document.createElement('button');
      btn.className = 'cp';
      btn.textContent = '复制';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(pre.textContent || '').then(() => {
          btn.textContent = '已复制!';
          setTimeout(() => btn.textContent = '复制', 1500);
        });
      });
      pre.appendChild(btn);
    });

    // Highlight code
    hljs.highlightAll();

    mc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  _highlightNav(id) {
    document.querySelectorAll('#sn a').forEach(a => {
      a.classList.toggle('active', parseInt(a.dataset.ch) === id);
    });
  },

  // === Progress ===
  _getP() {
    try { return JSON.parse(localStorage.getItem('textbook-progress') || '{}'); }
    catch { return {}; }
  },
  _isDone(id) { return !!this._getP()['ch' + id]; },
  _markDone(id) {
    const p = this._getP();
    p['ch' + id] = true;
    localStorage.setItem('textbook-progress', JSON.stringify(p));
    this._updateProgress();
  },
  _saveProgress() {
    const p = this._getP();
    p.last = this.currentChapter;
    localStorage.setItem('textbook-progress', JSON.stringify(p));
  },
  _updateProgress() {
    const all = this.chapters.length;
    const done = this.chapters.filter(c => this._isDone(c.id)).length;
    const pct = all > 0 ? Math.round((done / all) * 100) : 0;
    const pb = document.getElementById('pb');
    const pt = document.getElementById('pt');
    if (pb) pb.style.width = pct + '%';
    if (pt) pt.textContent = pct + '% (' + done + '/' + all + ')';
  },

  // === Theme ===
  _loadTheme() {
    this.darkMode = localStorage.getItem('textbook-theme') === 'dark';
    if (this.darkMode) document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('tb').textContent = this.darkMode ? '☀️ 亮色' : '🌙 暗色';
  },
};
