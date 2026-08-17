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
            loadSections(),
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
                ['sections', 'projects', 'games', 'diaries'].forEach(t => {
                    $(`tab-${t}`).style.display = (t === tab) ? 'block' : 'none';
                });
            });
        });
    }

    // ================================================================
    //  自定义板块(含板块内条目 CRUD)
    // ================================================================
    let sectionsCache = [];

    async function loadSections() {
        const root = $('admin-list-sections');
        root.innerHTML = '<div class="loading">加载中</div>';
        try {
            sectionsCache = await window.API.listSections();
            renderAdminSections();
        } catch (e) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>${esc(e.message)}</div>`;
        }
    }

    function renderAdminSections() {
        const root = $('admin-list-sections');
        if (!sectionsCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">🗂️</span>暂无自定义板块,使用上方表单添加</div>`;
            return;
        }
        root.innerHTML = sectionsCache.map(s => `
            <div class="admin-item" style="flex-direction:column;align-items:stretch;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <div class="info" style="flex:1;">
                        <div class="title">${esc(s.emoji || '🗂️')} ${esc(s.name)} <span style="color:var(--text-muted);font-size:12px;font-weight:normal;">(${(s.items||[]).length} 个条目)</span></div>
                        ${s.description ? `<div class="meta" style="margin-top:4px;color:var(--text-secondary);">${esc(s.description)}</div>` : ''}
                        <div class="meta" style="margin-top:4px;">📅 ${esc(fmtDate(s.updatedAt))}</div>
                    </div>
                    <div class="actions-bar">
                        <button class="btn btn-sm" data-sec-edit="${esc(s.id)}">编辑</button>
                        <button class="btn btn-sm" data-sec-items="${esc(s.id)}">管理条目</button>
                        <button class="btn btn-sm btn-danger" data-sec-del="${esc(s.id)}">删除板块</button>
                    </div>
                </div>
            </div>
        `).join('');

        root.querySelectorAll('[data-sec-edit]').forEach(b => b.addEventListener('click', () => editSection(b.getAttribute('data-sec-edit'))));
        root.querySelectorAll('[data-sec-items]').forEach(b => b.addEventListener('click', () => openSectionItemsModal(b.getAttribute('data-sec-edit'))));
        root.querySelectorAll('[data-sec-del]').forEach(b => b.addEventListener('click', () => deleteSection(b.getAttribute('data-sec-edit'))));
    }

    function editSection(id) {
        const s = sectionsCache.find(x => x.id === id);
        if (!s) return;
        $('sec-id').value = s.id;
        $('sec-name').value = s.name || '';
        $('sec-emoji').value = s.emoji || '';
        $('sec-desc').value = s.description || '';
        window.scrollTo({ top: $('form-section').offsetTop - 20, behavior: 'smooth' });
    }

    async function deleteSection(id) {
        const s = sectionsCache.find(x => x.id === id);
        if (!s) return;
        const itemCount = (s.items || []).length;
        if (!confirm(`确定删除板块「${s.name}」?\n该板块下 ${itemCount} 个条目将一并删除${s.items && s.items.some(i => i.filePath) ? '(关联文件也会清理)' : ''}。`)) return;
        await withLoading(document.body, async () => {
            // 删除该板块下所有关联文件
            if (s.items) {
                for (const it of s.items) {
                    if (it.filePath) {
                        try {
                            const meta = await window.API.getFileMeta(it.filePath);
                            if (meta) await window.API.deleteFile(it.filePath, meta.sha, `delete: ${it.name}`);
                        } catch (e) { console.warn('文件删除失败', e); }
                    }
                }
            }
            sectionsCache = sectionsCache.filter(x => x.id !== id);
            await window.API.saveSections(sectionsCache);
            renderAdminSections();
            toast('板块已删除', 'success');
        });
    }

    async function submitSection(e) {
        e.preventDefault();
        const btn = $('sec-submit');
        await withLoading(btn, async () => {
            const id = $('sec-id').value || ('section_' + uuid());
            const name = $('sec-name').value.trim();
            if (!name) throw new Error('请填写板块名称');
            const emoji = $('sec-emoji').value.trim() || '📋';
            const description = $('sec-desc').value.trim();

            const existing = sectionsCache.find(x => x.id === id);
            const item = {
                id, name, emoji, description,
                items: existing ? (existing.items || []) : [],
                updatedAt: new Date().toISOString()
            };
            if (!existing) item.createdAt = item.updatedAt;

            sectionsCache = existing
                ? sectionsCache.map(x => x.id === id ? item : x)
                : [...sectionsCache, item];

            await window.API.saveSections(sectionsCache);
            renderAdminSections();
            resetSectionForm();
            toast(existing ? '板块已更新' : '板块已添加', 'success');
        });
    }

    function resetSectionForm() {
        $('form-section').reset();
        $('sec-id').value = '';
    }

    // ---------- 板块内条目管理(弹窗) ----------
    function openSectionItemsModal(sectionId) {
        const s = sectionsCache.find(x => x.id === sectionId);
        if (!s) return;

        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal" style="max-width:640px;">
                <div class="modal-header">
                    <h3>${esc(s.emoji || '🗂️')} ${esc(s.name)} · 条目管理</h3>
                    <button class="modal-close" aria-label="关闭">&times;</button>
                </div>

                <form id="form-sec-item" style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border-color);">
                    <input type="hidden" id="item-id" />
                    <div class="form-group">
                        <label>条目名称 <span class="required">*</span></label>
                        <input type="text" id="item-name" required maxlength="80" placeholder="例:抓取算法 v2" />
                    </div>
                    <div class="form-group">
                        <label>简介</label>
                        <textarea id="item-desc" maxlength="300" placeholder="一句话说明..."></textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>标签(逗号分隔)</label>
                            <input type="text" id="item-tags" placeholder="例:算法, 机械臂" />
                        </div>
                        <div class="form-group">
                            <label>关联文件(可选)</label>
                            <input type="file" id="item-file" />
                        </div>
                    </div>
                    <div class="actions-bar">
                        <button type="submit" class="btn btn-primary btn-sm" id="item-submit">添加/更新</button>
                        <button type="button" class="btn btn-sm" id="item-reset">清空</button>
                    </div>
                </form>

                <div id="modal-item-list"></div>
            </div>`;
        document.body.appendChild(mask);

        const closeModal = () => mask.remove();
        mask.querySelector('.modal-close').addEventListener('click', closeModal);
        mask.addEventListener('click', e => { if (e.target === mask) closeModal(); });

        // 渲染条目列表
        const renderItems = () => {
            const list = mask.querySelector('#modal-item-list');
            const items = s.items || [];
            if (!items.length) {
                list.innerHTML = `<div class="empty-state"><span class="emoji">📋</span>暂无条目</div>`;
                return;
            }
            list.innerHTML = items.map(it => `
                <div class="admin-item">
                    <div class="info">
                        <div class="title">${esc(it.name)}</div>
                        ${it.description ? `<div class="meta" style="color:var(--text-secondary);margin-top:4px;">${esc(it.description)}</div>` : ''}
                        <div class="meta" style="margin-top:4px;">
                            ${it.tags && it.tags.length ? '#' + it.tags.map(esc).join(' #') : ''}
                            ${it.filePath ? ' · 📎 已上传文件' : ''}
                        </div>
                    </div>
                    <div class="actions-bar">
                        <button class="btn btn-sm" data-item-edit="${esc(it.id)}">编辑</button>
                        <button class="btn btn-sm btn-danger" data-item-del="${esc(it.id)}">删除</button>
                    </div>
                </div>
            `).join('');

            list.querySelectorAll('[data-item-edit]').forEach(b => b.addEventListener('click', () => editSecItem(s, b.getAttribute('data-item-edit'), mask)));
            list.querySelectorAll('[data-item-del]').forEach(b => b.addEventListener('click', () => deleteSecItem(s, b.getAttribute('data-item-del'), mask)));
        };

        const editSecItem = (section, itemId, maskEl) => {
            const it = (section.items || []).find(x => x.id === itemId);
            if (!it) return;
            maskEl.querySelector('#item-id').value = it.id;
            maskEl.querySelector('#item-name').value = it.name || '';
            maskEl.querySelector('#item-desc').value = it.description || '';
            maskEl.querySelector('#item-tags').value = (it.tags || []).join(', ');
            maskEl.querySelector('#item-file').value = '';
        };

        const deleteSecItem = async (section, itemId, maskEl) => {
            const it = (section.items || []).find(x => x.id === itemId);
            if (!it) return;
            if (!confirm(`删除条目「${it.name}」?`)) return;
            await withLoading(document.body, async () => {
                if (it.filePath) {
                    try {
                        const meta = await window.API.getFileMeta(it.filePath);
                        if (meta) await window.API.deleteFile(it.filePath, meta.sha, `delete: ${it.name}`);
                    } catch (e) { console.warn('文件删除失败', e); }
                }
                section.items = (section.items || []).filter(x => x.id !== itemId);
                // 同步到 sectionsCache
                sectionsCache = sectionsCache.map(x => x.id === section.id ? section : x);
                await window.API.saveSections(sectionsCache);
                renderItems();
                toast('条目已删除', 'success');
            });
        };

        // 表单提交
        mask.querySelector('#form-sec-item').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const submitBtn = mask.querySelector('#item-submit');
            await withLoading(submitBtn, async () => {
                const itemId = mask.querySelector('#item-id').value || ('item_' + uuid());
                const name = mask.querySelector('#item-name').value.trim();
                if (!name) throw new Error('请填写条目名称');
                const description = mask.querySelector('#item-desc').value.trim();
                const tags = mask.querySelector('#item-tags').value.split(',').map(t => t.trim()).filter(Boolean);
                const file = mask.querySelector('#item-file').files[0];

                const existing = (s.items || []).find(x => x.id === itemId);
                let filePath = existing ? existing.filePath : null;
                if (file) {
                    filePath = await window.API.uploadSectionFile(file);
                }

                const item = {
                    id: itemId, name, description, tags, filePath,
                    updatedAt: new Date().toISOString()
                };
                if (!existing) item.createdAt = item.updatedAt;

                s.items = existing
                    ? (s.items || []).map(x => x.id === itemId ? item : x)
                    : [...(s.items || []), item];

                // 同步 sectionsCache 并保存
                sectionsCache = sectionsCache.map(x => x.id === s.id ? s : x);
                await window.API.saveSections(sectionsCache);
                renderItems();
                // 清空表单
                mask.querySelector('#form-sec-item').reset();
                mask.querySelector('#item-id').value = '';
                toast(existing ? '条目已更新' : '条目已添加', 'success');
            });
        });

        mask.querySelector('#item-reset').addEventListener('click', () => {
            mask.querySelector('#form-sec-item').reset();
            mask.querySelector('#item-id').value = '';
        });

        renderItems();
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

        // 板块管理
        $('form-section').addEventListener('submit', submitSection);
        $('sec-reset').addEventListener('click', resetSectionForm);

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
