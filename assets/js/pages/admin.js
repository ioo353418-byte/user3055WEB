/**
 * 管理页逻辑
 *  - PAT 登录/校验/退出(支持密码解锁,免每次输 PAT)
 *  - 工程 / 游戏 / 日记 的 CRUD
 *  - 文件压缩包与 markdown 上传
 *  - 三个 Tab 切换
 */
(function () {
    'use strict';

    const cfg = window.SITE_CONFIG;
    const $ = id => document.getElementById(id);

    // ---------- 加密保险库(Web Crypto API:AES-GCM 256 + PBKDF2) ----------
    const VAULT_SALT = 'user3055WEB-admin-vault-v1';

    async function deriveKey(password) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        return await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: enc.encode(VAULT_SALT), iterations: 100000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptPat(pat, password) {
        const key = await deriveKey(password);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(pat));
        const combined = new Uint8Array(iv.length + ct.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ct), iv.length);
        // 转 base64(分段避免大数组爆栈,PAT 加密后很短,直接用即可)
        let binary = '';
        for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
        return btoa(binary);
    }

    async function decryptPat(vaultB64, password) {
        const binary = atob(vaultB64);
        const combined = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
        const iv = combined.slice(0, 12);
        const ct = combined.slice(12);
        const key = await deriveKey(password);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new TextDecoder().decode(pt);
    }

    function saveVault(encryptedPat) {
        const data = {
            enc: encryptedPat,
            updatedAt: new Date().toISOString()
        };
        localStorage.setItem(cfg.adminVaultKey, JSON.stringify(data));
    }
    function loadVault() {
        try {
            const raw = localStorage.getItem(cfg.adminVaultKey);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }
    function clearVault() {
        localStorage.removeItem(cfg.adminVaultKey);
    }

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

    // ---------- 登录模式切换 ----------
    function showSetupMode() {
        $('setup-mode').style.display = 'block';
        $('unlock-mode').style.display = 'none';
        $('pat-input').value = '';
        $('pwd-input').value = '';
        $('pat-input').focus();
    }
    function showUnlockMode() {
        const vault = loadVault();
        if (!vault) { showSetupMode(); return; }
        $('setup-mode').style.display = 'none';
        $('unlock-mode').style.display = 'block';
        const updated = fmtDate(vault.updatedAt);
        $('vault-info').textContent = `加密凭据上次设置:${updated}`;
        $('unlock-pwd').value = '';
        $('unlock-pwd').focus();
    }

    // ---------- 首次设置:输入 PAT + 设置密码 ----------
    async function setupAndLogin() {
        const pat = $('pat-input').value.trim();
        const pwd = $('pwd-input').value;
        if (!pat) return toast('请输入 PAT', 'warning');
        if (pwd.length < 4) return toast('管理密码至少 4 位', 'warning');

        await withLoading($('setup-btn'), async () => {
            // 尝试验证 PAT(网络问题时允许跳过)
            let valid = true;
            let netError = null;
            try {
                await window.API.validateToken(pat);
            } catch (e) {
                netError = e;
                // 区分错误类型
                if (e.message && e.message.includes('PAT 无效')) {
                    throw e;  // 确定是 PAT 错,直接抛
                }
                // 可能是网络/404/403,问用户是否继续
                const ok = confirm(
                    `⚠️ PAT 验证失败,可能是网络问题(浏览器无法访问 api.github.com)。\n\n` +
                    `错误:${e.message}\n\n` +
                    `点击"确定"仍然保存(后续操作若失败需检查网络),\n` +
                    `点击"取消"返回修正。`
                );
                if (!ok) return;
                valid = false;
            }

            // 加密保存 PAT
            const enc = await encryptPat(pat, pwd);
            saveVault(enc);
            window.API.setToken(pat);
            toast(valid ? '登录成功' : '已保存(PAT 未验证,后续操作可能失败)', valid ? 'success' : 'warning');
            showWorkspace();
        });
    }

    // ---------- 解锁:输入密码 ----------
    async function unlock() {
        const pwd = $('unlock-pwd').value;
        if (!pwd) return toast('请输入管理密码', 'warning');
        const vault = loadVault();
        if (!vault) { toast('未找到加密凭据,请重新设置', 'warning'); showSetupMode(); return; }

        await withLoading($('unlock-btn'), async () => {
            let pat;
            try {
                pat = await decryptPat(vault.enc, pwd);
            } catch (_) {
                throw new Error('密码错误,解密失败');
            }
            window.API.setToken(pat);
            toast('解锁成功', 'success');
            showWorkspace();
        });
    }

    // ---------- 重置保险库(忘记密码) ----------
    function resetVault() {
        if (!confirm('确定重置凭据?将清除本地加密的 PAT,下次需要重新输入 PAT 设置密码。')) return;
        clearVault();
        window.API.setToken('');
        toast('已重置,请重新设置', 'success');
        showSetupMode();
    }

    // ---------- 更换 PAT(保留密码) ----------
    async function replacePat() {
        const newPat = prompt('粘贴新的 PAT(将用原密码加密保存):');
        if (!newPat) return;
        const vault = loadVault();
        if (!vault) { toast('未找到加密凭据,请先完成首次设置', 'warning'); return; }
        // 需要原密码来重新加密
        const pwd = prompt('请输入当前管理密码以确认:');
        if (!pwd) return;
        await withLoading(document.body, async () => {
            // 先验证原密码能解密
            try {
                await decryptPat(vault.enc, pwd);
            } catch (_) {
                throw new Error('密码错误');
            }
            // 用新 PAT + 原密码加密
            const enc = await encryptPat(newPat.trim(), pwd);
            saveVault(enc);
            window.API.setToken(newPat.trim());
            toast('PAT 已更新', 'success');
            showWorkspace();
        });
    }

    // ---------- 退出登录 ----------
    function logout() {
        window.API.setToken('');
        toast('已退出登录(加密凭据保留,下次只需密码)', 'success');
        $('workspace').style.display = 'none';
        $('login-card').style.display = 'block';
        // 如果有 vault,显示解锁模式;否则显示设置模式
        if (loadVault()) {
            showUnlockMode();
        } else {
            showSetupMode();
        }
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
        // 首次设置
        $('setup-btn').addEventListener('click', setupAndLogin);
        $('pat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') $('pwd-input').focus();
        });
        $('pwd-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') setupAndLogin();
        });

        // 解锁
        $('unlock-btn').addEventListener('click', unlock);
        $('unlock-pwd').addEventListener('keydown', e => {
            if (e.key === 'Enter') unlock();
        });

        // 重置 / 换 PAT
        $('reset-vault').addEventListener('click', e => { e.preventDefault(); resetVault(); });
        $('re-pat').addEventListener('click', e => { e.preventDefault(); replacePat(); });

        // 退出
        $('logout-btn').addEventListener('click', logout);

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
        // 启动时根据状态决定显示模式
        const existingToken = window.API.getToken();
        const vault = loadVault();

        if (existingToken) {
            // 当前标签已有 token(刷新场景),直接进工作区
            showWorkspace();
        } else if (vault) {
            // 有加密凭据,显示解锁模式
            showUnlockMode();
        } else {
            // 首次使用,显示设置模式
            showSetupMode();
        }
    });
})();
