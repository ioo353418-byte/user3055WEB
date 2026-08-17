/**
 * 管理页逻辑
 *  - PAT 登录/校验/退出
 *  - 工程 / 游戏 / 日记 的 CRUD
 *  - 文件压缩包与 markdown 上传
 *  - 三个 Tab 切换
 */
(function () {
    'use strict';

    const cfg = window.SITE_CONFIG;
    const $ = id => document.getElementById(id);

    // ---------- 工具 ----------
    function esc(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function fmtDate(d) {
        if (!d) return '';
        const date = new Date(d);
        if (isNaN(date)) return d;
        return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function uuid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
    function toast(msg, type) {
        const box = $('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type || ''}`;
        el.textContent = msg;
        box.appendChild(el);
        setTimeout(() => {
            el.classList.add('removing');
            setTimeout(() => el.remove(), 300);
        }, 3500);
    }
    async function withLoading(btn, fn) {
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '处理中...';
        try {
            await fn();
        } catch (e) {
            console.error(e);
            toast(e.message || '操作失败', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
        }
    }

    // ---------- 登录/退出 ----------
    async function login() {
        const token = $('pat-input').value.trim();
        if (!token) return toast('请输入 PAT', 'warning');
        await withLoading($('login-btn'), async () => {
            await window.API.validateToken(token);
            window.API.setToken(token);
            toast('登录成功', 'success');
            showWorkspace();
        });
    }
    function logout() {
        window.API.setToken('');
        toast('已退出登录', 'success');
        $('workspace').style.display = 'none';
        $('login-card').style.display = 'block';
        $('pat-input').value = '';
    }
    async function showWorkspace() {
        $('login-card').style.display = 'none';
        $('workspace').style.display = 'block';
        $('repo-info').textContent = `${cfg.github.owner}/${cfg.github.repo} @ ${cfg.github.branch}`;
        await Promise.all([
            loadProjects(),
            loadGames(),
            loadDiaries()
        ]);
    }

    // ---------- Tab 切换 ----------
    function bindTabs() {
        document.querySelectorAll('.admin-nav .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.admin-nav .btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.getAttribute('data-tab');
                ['projects', 'games', 'diaries'].forEach(t => {
                    $(`tab-${t}`).style.display = (t === tab) ? 'block' : 'none';
                });
            });
        });
    }

    // ================================================================
    //  工程
    // ================================================================
    let projectsCache = [];

    async function loadProjects() {
        const root = $('admin-list-projects');
        root.innerHTML = '<div class="loading">加载中</div>';
        try {
            projectsCache = await window.API.listProjects();
            renderAdminProjects();
        } catch (e) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>${esc(e.message)}</div>`;
        }
    }
    function renderAdminProjects() {
        const root = $('admin-list-projects');
        if (!projectsCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">📦</span>暂无工程,使用上方表单添加</div>`;
            return;
        }
        root.innerHTML = projectsCache.map(p => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(p.name)}</div>
                    <div class="meta">
                        ${p.archivePath ? '📎 已上传压缩包 · ' : '📄 仅元数据 · '}
                        ${p.updatedAt ? '📅 ' + esc(fmtDate(p.updatedAt)) : ''}
                        ${p.tags && p.tags.length ? ' · #' + p.tags.map(esc).join(' #') : ''}
                    </div>
                    ${p.description ? `<div class="meta" style="margin-top:4px;color:var(--text-secondary);">${esc(p.description)}</div>` : ''}
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-edit="${esc(p.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-del="${esc(p.id)}">删除</button>
                </div>
            </div>
        `).join('');

        root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editProject(b.getAttribute('data-edit'))));
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteProject(b.getAttribute('data-del'))));
    }
    function editProject(id) {
        const p = projectsCache.find(x => x.id === id);
        if (!p) return;
        $('proj-id').value = p.id;
        $('proj-name').value = p.name || '';
        $('proj-tags').value = (p.tags || []).join(', ');
        $('proj-desc').value = p.description || '';
        $('proj-file').value = '';
        window.scrollTo({ top: $('form-project').offsetTop - 20, behavior: 'smooth' });
    }
    async function deleteProject(id) {
        const p = projectsCache.find(x => x.id === id);
        if (!p) return;
        if (!confirm(`确定删除工程「${p.name}」?${p.archivePath ? '关联的压缩包也会被删除。' : ''}`)) return;
        await withLoading(document.body, async () => {
            if (p.archivePath) {
                try {
                    const meta = await window.API.getFileMeta(p.archivePath);
                    if (meta) await window.API.deleteFile(p.archivePath, meta.sha, `delete: ${p.name} archive`);
                } catch (e) { console.warn('压缩包删除失败', e); }
            }
            projectsCache = projectsCache.filter(x => x.id !== id);
            await window.API.saveProjects(projectsCache);
            renderAdminProjects();
            toast('已删除', 'success');
        });
    }
    async function submitProject(e) {
        e.preventDefault();
        const btn = $('proj-submit');
        await withLoading(btn, async () => {
            const id = $('proj-id').value || uuid();
            const name = $('proj-name').value.trim();
            if (!name) throw new Error('请填写工程名称');
            const tags = $('proj-tags').value.split(',').map(s => s.trim()).filter(Boolean);
            const description = $('proj-desc').value.trim();
            const file = $('proj-file').files[0];

            const existing = projectsCache.find(x => x.id === id);
            let archivePath = existing ? existing.archivePath : null;

            if (file) {
                archivePath = await window.API.uploadProjectArchive(file);
            }

            const item = {
                id,
                name,
                description,
                tags,
                archivePath,
                updatedAt: new Date().toISOString()
            };
            if (!existing) item.createdAt = item.updatedAt;

            projectsCache = existing
                ? projectsCache.map(x => x.id === id ? item : x)
                : [item, ...projectsCache];

            await window.API.saveProjects(projectsCache);
            renderAdminProjects();
            resetProjectForm();
            toast(existing ? '已更新' : '已添加', 'success');
        });
    }
    function resetProjectForm() {
        $('form-project').reset();
        $('proj-id').value = '';
    }

    // ================================================================
    //  游戏
    // ================================================================
    let gamesCache = [];

    async function loadGames() {
        const root = $('admin-list-games');
        root.innerHTML = '<div class="loading">加载中</div>';
        try {
            gamesCache = await window.API.listGames();
            renderAdminGames();
        } catch (e) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>${esc(e.message)}</div>`;
        }
    }
    function renderAdminGames() {
        const root = $('admin-list-games');
        if (!gamesCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">🎮</span>暂无游戏项目,使用上方表单添加</div>`;
            return;
        }
        root.innerHTML = gamesCache.map(g => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(g.name)} <span style="color:var(--success);">(${g.progress}%)</span></div>
                    <div class="meta">
                        ${g.backupPath ? '📎 已上传备份 · ' : '📄 仅元数据 · '}
                        ${g.updatedAt ? '📅 ' + esc(fmtDate(g.updatedAt)) : ''}
                    </div>
                    ${g.description ? `<div class="meta" style="margin-top:4px;color:var(--text-secondary);">${esc(g.description)}</div>` : ''}
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-edit="${esc(g.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-del="${esc(g.id)}">删除</button>
                </div>
            </div>
        `).join('');

        root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editGame(b.getAttribute('data-edit'))));
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteGame(b.getAttribute('data-del'))));
    }
    function editGame(id) {
        const g = gamesCache.find(x => x.id === id);
        if (!g) return;
        $('game-id').value = g.id;
        $('game-name').value = g.name || '';
        $('game-progress').value = g.progress || 0;
        $('game-desc').value = g.description || '';
        $('game-file').value = '';
        window.scrollTo({ top: $('form-game').offsetTop - 20, behavior: 'smooth' });
    }
    async function deleteGame(id) {
        const g = gamesCache.find(x => x.id === id);
        if (!g) return;
        if (!confirm(`确定删除游戏「${g.name}」?${g.backupPath ? '关联的备份也会被删除。' : ''}`)) return;
        await withLoading(document.body, async () => {
            if (g.backupPath) {
                try {
                    const meta = await window.API.getFileMeta(g.backupPath);
                    if (meta) await window.API.deleteFile(g.backupPath, meta.sha, `delete: ${g.name} backup`);
                } catch (e) { console.warn('备份删除失败', e); }
            }
            gamesCache = gamesCache.filter(x => x.id !== id);
            await window.API.saveGames(gamesCache);
            renderAdminGames();
            toast('已删除', 'success');
        });
    }
    async function submitGame(e) {
        e.preventDefault();
        const btn = $('game-submit');
        await withLoading(btn, async () => {
            const id = $('game-id').value || uuid();
            const name = $('game-name').value.trim();
            if (!name) throw new Error('请填写游戏名称');
            const progress = Math.max(0, Math.min(100, parseInt($('game-progress').value, 10) || 0));
            const description = $('game-desc').value.trim();
            const file = $('game-file').files[0];

            const existing = gamesCache.find(x => x.id === id);
            let backupPath = existing ? existing.backupPath : null;
            if (file) backupPath = await window.API.uploadGameBackup(file);

            const item = {
                id, name, progress, description, backupPath,
                updatedAt: new Date().toISOString()
            };
            if (!existing) item.createdAt = item.updatedAt;

            gamesCache = existing
                ? gamesCache.map(x => x.id === id ? item : x)
                : [item, ...gamesCache];

            await window.API.saveGames(gamesCache);
            renderAdminGames();
            resetGameForm();
            toast(existing ? '已更新' : '已添加', 'success');
        });
    }
    function resetGameForm() {
        $('form-game').reset();
        $('game-id').value = '';
        $('game-progress').value = 0;
    }

    // ================================================================
    //  日记
    // ================================================================
    let diariesCache = [];

    async function loadDiaries() {
        const root = $('admin-list-diaries');
        root.innerHTML = '<div class="loading">加载中</div>';
        try {
            diariesCache = await window.API.listDiaries();
            renderAdminDiaries();
        } catch (e) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>${esc(e.message)}</div>`;
        }
    }
    function renderAdminDiaries() {
        const root = $('admin-list-diaries');
        if (!diariesCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">📝</span>暂无日记,使用上方表单添加</div>`;
            return;
        }
        const sorted = diariesCache.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        root.innerHTML = sorted.map(d => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(d.title)}</div>
                    <div class="meta">
                        📅 ${esc(fmtDate(d.date))} ·
                        📄 ${esc(d.markdownPath || '(无文件)')}
                    </div>
                    ${d.summary ? `<div class="meta" style="margin-top:4px;color:var(--text-secondary);">${esc(d.summary)}</div>` : ''}
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-edit="${esc(d.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-del="${esc(d.id)}">删除</button>
                </div>
            </div>
        `).join('');

        root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editDiary(b.getAttribute('data-edit'))));
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteDiary(b.getAttribute('data-del'))));
    }
    async function editDiary(id) {
        const d = diariesCache.find(x => x.id === id);
        if (!d) return;
        $('diary-id').value = d.id;
        $('diary-old-path').value = d.markdownPath || '';
        $('diary-title').value = d.title || '';
        $('diary-date').value = d.date || '';
        $('diary-summary').value = d.summary || '';
        $('diary-content').value = '';
        $('diary-file').value = '';

        // 尝试拉取已有内容填充到编辑框
        if (d.markdownPath) {
            try {
                const md = await window.API.getDiaryMarkdown(d.markdownPath);
                $('diary-content').value = md;
            } catch (e) { /* ignore */ }
        }
        window.scrollTo({ top: $('form-diary').offsetTop - 20, behavior: 'smooth' });
    }
    async function deleteDiary(id) {
        const d = diariesCache.find(x => x.id === id);
        if (!d) return;
        if (!confirm(`确定删除日记「${d.title}」?`)) return;
        await withLoading(document.body, async () => {
            if (d.markdownPath) {
                try {
                    const meta = await window.API.getFileMeta(d.markdownPath);
                    if (meta) await window.API.deleteFile(d.markdownPath, meta.sha, `delete: ${d.title}`);
                } catch (e) { console.warn('md 删除失败', e); }
            }
            diariesCache = diariesCache.filter(x => x.id !== id);
            await window.API.saveDiaries(diariesCache);
            renderAdminDiaries();
            toast('已删除', 'success');
        });
    }
    async function submitDiary(e) {
        e.preventDefault();
        const btn = $('diary-submit');
        await withLoading(btn, async () => {
            const id = $('diary-id').value || uuid();
            const title = $('diary-title').value.trim();
            const date = $('diary-date').value;
            if (!title) throw new Error('请填写日记标题');
            if (!date) throw new Error('请选择日期');

            const summary = $('diary-summary').value.trim();
            const file = $('diary-file').files[0];
            const contentText = $('diary-content').value;

            if (!file && !contentText) {
                throw new Error('请上传 .md 文件或在文本框中编写内容');
            }

            const existing = diariesCache.find(x => x.id === id);
            const oldPath = $('diary-old-path').value || (existing ? existing.markdownPath : '');

            // 文件名:YYYY-MM-DD-标题 slug.md
            const slug = title.replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'diary';
            const filename = `${date}-${slug}.md`;

            // 决定内容
            let mdContent = contentText;
            if (file) {
                mdContent = await file.text();
            }

            // 保存 markdown 文件
            const newPath = `${cfg.github.paths.diariesDir}/${filename}`;
            // 如果旧路径与新路径不同,且旧文件存在,先删除旧文件
            if (oldPath && oldPath !== newPath) {
                try {
                    const oldMeta = await window.API.getFileMeta(oldPath);
                    if (oldMeta) await window.API.deleteFile(oldPath, oldMeta.sha, `delete old: ${oldPath}`);
                } catch (e) { console.warn('旧文件清理失败', e); }
            }
            await window.API.saveDiaryMarkdown(filename, mdContent);

            const item = {
                id, title, date, summary,
                markdownPath: newPath,
                updatedAt: new Date().toISOString()
            };
            if (!existing) item.createdAt = item.updatedAt;

            diariesCache = existing
                ? diariesCache.map(x => x.id === id ? item : x)
                : [item, ...diariesCache];

            await window.API.saveDiaries(diariesCache);
            renderAdminDiaries();
            resetDiaryForm();
            toast(existing ? '已更新' : '已添加', 'success');
        });
    }
    function resetDiaryForm() {
        $('form-diary').reset();
        $('diary-id').value = '';
        $('diary-old-path').value = '';
    }

    // ================================================================
    //  初始化
    // ================================================================
    function bindEvents() {
        $('login-btn').addEventListener('click', login);
        $('logout-btn').addEventListener('click', logout);
        $('pat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') login();
        });

        $('form-project').addEventListener('submit', submitProject);
        $('proj-reset').addEventListener('click', resetProjectForm);

        $('form-game').addEventListener('submit', submitGame);
        $('game-reset').addEventListener('click', resetGameForm);

        $('form-diary').addEventListener('submit', submitDiary);
        $('diary-reset').addEventListener('click', resetDiaryForm);

        // 默认日期为今天
        const today = new Date().toISOString().slice(0, 10);
        $('diary-date').value = today;

        bindTabs();
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        // 已有 token 则自动进入工作区
        if (window.API.getToken()) {
            (async () => {
                try {
                    await window.API.validateToken(window.API.getToken());
                    showWorkspace();
                } catch (e) {
                    window.API.setToken('');
                    toast('已保存的 PAT 失效,请重新登录', 'warning');
                }
            })();
        }
    });
})();
