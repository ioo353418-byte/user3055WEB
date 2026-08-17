/**
 * 管理页逻辑(重构版)
 *  - PAT 登录/密码解锁(保留原加密逻辑)
 *  - 左侧导航 + 右侧动态内容区
 *  - 美化界面(全局背景 + 透明度 + 背景色)
 *  - 板块顺序管理(拖拽排序)
 *  - 板块类型:笔记类(markdown 在线编辑) / 工程类(上传压缩包)
 *  - 每个板块可设小背景图
 */
(function () {
    'use strict';

    const cfg = window.SITE_CONFIG;
    const $ = id => document.getElementById(id);
    const $$ = sel => document.querySelectorAll(sel);

    // ---------- 加密保险库(保留原逻辑) ----------
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
        localStorage.setItem(cfg.adminVaultKey, JSON.stringify({
            enc: encryptedPat,
            updatedAt: new Date().toISOString()
        }));
    }
    function loadVault() {
        try {
            const raw = localStorage.getItem(cfg.adminVaultKey);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }
    function clearVault() { localStorage.removeItem(cfg.adminVaultKey); }

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
        $('vault-info').textContent = `加密凭据上次设置:${fmtDate(vault.updatedAt)}`;
        $('unlock-pwd').value = '';
        $('unlock-pwd').focus();
    }
    async function setupAndLogin() {
        const pat = $('pat-input').value.trim();
        const pwd = $('pwd-input').value;
        if (!pat) return toast('请输入 PAT', 'warning');
        if (pwd.length < 4) return toast('管理密码至少 4 位', 'warning');
        await withLoading($('setup-btn'), async () => {
            let valid = true;
            try {
                await window.API.validateToken(pat);
            } catch (e) {
                if (e.message && e.message.includes('PAT 无效')) throw e;
                const ok = confirm(`⚠️ PAT 验证失败,可能是网络问题。\n\n错误:${e.message}\n\n点击"确定"仍然保存。`);
                if (!ok) return;
                valid = false;
            }
            const enc = await encryptPat(pat, pwd);
            saveVault(enc);
            window.API.setToken(pat);
            toast(valid ? '登录成功' : '已保存(PAT 未验证)', valid ? 'success' : 'warning');
            await showWorkspace();
        });
    }
    async function unlock() {
        const pwd = $('unlock-pwd').value;
        if (!pwd) return toast('请输入管理密码', 'warning');
        const vault = loadVault();
        if (!vault) { toast('未找到加密凭据', 'warning'); showSetupMode(); return; }
        await withLoading($('unlock-btn'), async () => {
            let pat;
            try { pat = await decryptPat(vault.enc, pwd); }
            catch (_) { throw new Error('密码错误,解密失败'); }
            window.API.setToken(pat);
            toast('解锁成功', 'success');
            await showWorkspace();
        });
    }
    function resetVault() {
        if (!confirm('确定重置凭据?')) return;
        clearVault();
        window.API.setToken('');
        toast('已重置', 'success');
        showSetupMode();
    }
    async function replacePat() {
        const newPat = prompt('粘贴新的 PAT:');
        if (!newPat) return;
        const vault = loadVault();
        if (!vault) { toast('未找到加密凭据', 'warning'); return; }
        const pwd = prompt('请输入当前管理密码以确认:');
        if (!pwd) return;
        await withLoading(document.body, async () => {
            try { await decryptPat(vault.enc, pwd); }
            catch (_) { throw new Error('密码错误'); }
            const enc = await encryptPat(newPat.trim(), pwd);
            saveVault(enc);
            window.API.setToken(newPat.trim());
            toast('PAT 已更新', 'success');
            await showWorkspace();
        });
    }
    function logout() {
        window.API.setToken('');
        toast('已退出登录', 'success');
        $('workspace').style.display = 'none';
        $('login-card').style.display = 'block';
        if (loadVault()) showUnlockMode(); else showSetupMode();
    }

    // ================================================================
    //  数据缓存
    // ================================================================
    let sectionsCache = [];
    let projectsCache = [];
    let gamesCache = [];
    let diariesCache = [];
    let appearanceCache = null;

    // ================================================================
    //  进入工作区 + 数据加载
    // ================================================================
    async function showWorkspace() {
        $('login-card').style.display = 'none';
        $('workspace').style.display = 'block';
        $('repo-info').textContent = `${cfg.github.owner}/${cfg.github.repo} @ ${cfg.github.branch}`;
        // 并行加载所有数据
        await Promise.all([
            loadSections(),
            loadProjects(),
            loadGames(),
            loadDiaries(),
            loadAppearance()
        ]);
        // 默认进入美化界面
        renderSidebar();
        switchView('appearance');
    }

    // ================================================================
    //  数据加载方法
    // ================================================================
    async function loadSections() {
        try { sectionsCache = await window.API.listSections(); }
        catch (e) { console.error('板块加载失败', e); sectionsCache = []; }
    }
    async function loadProjects() {
        try { projectsCache = await window.API.listProjects(); }
        catch (e) { console.error('工程加载失败', e); projectsCache = []; }
    }
    async function loadGames() {
        try { gamesCache = await window.API.listGames(); }
        catch (e) { console.error('游戏加载失败', e); gamesCache = []; }
    }
    async function loadDiaries() {
        try { diariesCache = await window.API.listDiaries(); }
        catch (e) { console.error('日记加载失败', e); diariesCache = []; }
    }
    async function loadAppearance() {
        try { appearanceCache = await window.API.getAppearance(); }
        catch (e) {
            console.error('美化配置加载失败', e);
            appearanceCache = {
                globalBackground: { imageUrl: '', color: '#0d1117', opacity: 1 },
                sectionOrder: ['projects', 'games', 'diaries'],
                sectionBackgrounds: {}
            };
        }
        // 把 sections 自动加入 order(如果还没在里面)
        const sectionIds = sectionsCache.map(s => s.id);
        sectionIds.forEach(id => {
            if (!appearanceCache.sectionOrder.includes(id)) {
                appearanceCache.sectionOrder.push(id);
            }
        });
        // 清理已删除的 section id
        appearanceCache.sectionOrder = appearanceCache.sectionOrder.filter(id =>
            id === 'projects' || id === 'games' || id === 'diaries' || sectionIds.includes(id)
        );
    }

    // ================================================================
    //  左侧导航渲染
    // ================================================================
    function renderSidebar() {
        const list = $('sidebar-list');
        const items = [];
        // 第一行:新增板块
        items.push(`
            <li class="sidebar-item ${currentView === 'new-section' ? 'active' : ''}" data-view="new-section">
                <span class="sidebar-icon">➕</span>
                <span class="sidebar-label">新增板块</span>
            </li>
        `);
        // 后续:工程、游戏、日记、各自定义板块(按 sectionOrder 排序)
        const order = appearanceCache ? appearanceCache.sectionOrder : ['projects', 'games', 'diaries'];
        order.forEach(id => {
            let icon, label, view;
            if (id === 'projects') { icon = '📦'; label = '工程资源'; view = 'projects'; }
            else if (id === 'games') { icon = '🎮'; label = '游戏进度'; view = 'games'; }
            else if (id === 'diaries') { icon = '📝'; label = '个人日记'; view = 'diaries'; }
            else {
                const s = sectionsCache.find(x => x.id === id);
                if (!s) return;
                icon = s.emoji || '🗂️';
                label = s.name;
                view = 'section:' + s.id;
            }
            items.push(`
                <li class="sidebar-item ${currentView === view ? 'active' : ''}" data-view="${esc(view)}">
                    <span class="sidebar-icon">${icon}</span>
                    <span class="sidebar-label">${esc(label)}</span>
                </li>
            `);
        });
        list.innerHTML = items.join('');
        // 绑定点击
        list.querySelectorAll('.sidebar-item').forEach(li => {
            li.addEventListener('click', () => switchView(li.getAttribute('data-view')));
        });
    }

    // ================================================================
    //  视图切换
    // ================================================================
    let currentView = 'appearance';

    function switchView(view) {
        currentView = view;
        renderSidebar();  // 更新高亮
        const main = $('admin-main');
        main.innerHTML = '';  // 清空

        if (view === 'appearance') {
            renderAppearancePage(main);
        } else if (view === 'order') {
            renderOrderPage(main);
        } else if (view === 'new-section') {
            renderNewSectionPage(main);
        } else if (view === 'projects') {
            renderProjectsPage(main);
        } else if (view === 'games') {
            renderGamesPage(main);
        } else if (view === 'diaries') {
            renderDiariesPage(main);
        } else if (view.startsWith('section:')) {
            const secId = view.split(':')[1];
            renderSectionItemsPage(main, secId);
        }
    }

    // ================================================================
    //  美化界面页
    // ================================================================
    function renderAppearancePage(root) {
        const ap = appearanceCache;
        const bg = ap.globalBackground;
        root.innerHTML = `
            <div class="page-card">
                <h2>🎨 美化界面</h2>
                <p class="hint">设置展示页的全局背景。背景图上传后保存在仓库 assets/backgrounds/ 目录。</p>

                <h3 style="margin-top:20px;">全局背景图</h3>
                <div class="form-group">
                    <label>上传背景图(本地上传,< 1MB 推荐)</label>
                    <input type="file" id="bg-file" accept="image/*" />
                </div>
                <div class="form-group">
                    <label>或输入图片 URL(留空则用上传的图)</label>
                    <input type="text" id="bg-url" value="${esc(bg.imageUrl || '')}" placeholder="https://..." />
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>背景色(图片下方填充色)</label>
                        <input type="color" id="bg-color" value="${esc(bg.color || '#0d1117')}" />
                    </div>
                    <div class="form-group">
                        <label>背景图透明度:${(bg.opacity * 100).toFixed(0)}%</label>
                        <input type="range" id="bg-opacity" min="0" max="100" value="${(bg.opacity * 100).toFixed(0)}" oninput="this.previousElementSibling.textContent='背景图透明度:'+this.value+'%'" />
                    </div>
                </div>

                <div class="form-group">
                    <label>预览</label>
                    <div id="bg-preview" style="width:100%;height:160px;border:1px solid var(--border-color);border-radius:8px;background-size:cover;background-position:center;"></div>
                </div>

                <div class="actions-bar">
                    <button class="btn btn-primary" id="save-bg-btn">保存美化设置</button>
                </div>
            </div>
        `;

        const updatePreview = () => {
            const url = $('bg-url').value.trim();
            const color = $('bg-color').value;
            const opacity = $('bg-opacity').value / 100;
            const preview = $('bg-preview');
            preview.style.backgroundColor = color;
            preview.style.backgroundImage = url ? `url('${url}')` : 'none';
            preview.style.opacity = opacity;
        };
        updatePreview();
        $('bg-url').addEventListener('input', updatePreview);
        $('bg-color').addEventListener('input', updatePreview);
        $('bg-opacity').addEventListener('input', updatePreview);

        $('bg-file').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                toast('图片过大(>2MB),GitHub Pages 加载会慢,建议压缩后再传', 'warning');
            }
            await withLoading(document.body, async () => {
                const path = await window.API.uploadBackground(file);
                const rawUrl = window.API.rawUrl(path);
                $('bg-url').value = rawUrl;
                updatePreview();
                toast('背景图已上传', 'success');
            });
        });

        $('save-bg-btn').addEventListener('click', async () => {
            await withLoading($('save-bg-btn'), async () => {
                appearanceCache.globalBackground = {
                    imageUrl: $('bg-url').value.trim(),
                    color: $('bg-color').value,
                    opacity: $('bg-opacity').value / 100
                };
                await window.API.saveAppearance(appearanceCache);
                toast('美化设置已保存', 'success');
            });
        });
    }

    // ================================================================
    //  板块顺序管理页(拖拽)
    // ================================================================
    function renderOrderPage(root) {
        const order = appearanceCache.sectionOrder;
        root.innerHTML = `
            <div class="page-card">
                <h2>↕ 板块顺序管理</h2>
                <p class="hint">拖拽调整展示页板块的显示顺序。置顶的板块会出现在展示页最前面。</p>
                <ul class="order-list" id="order-list">
                    ${order.map((id, i) => {
                        let icon, label;
                        if (id === 'projects') { icon = '📦'; label = '工程资源'; }
                        else if (id === 'games') { icon = '🎮'; label = '游戏进度'; }
                        else if (id === 'diaries') { icon = '📝'; label = '个人日记'; }
                        else {
                            const s = sectionsCache.find(x => x.id === id);
                            icon = s ? (s.emoji || '🗂️') : '❓';
                            label = s ? s.name : '(已删除)';
                        }
                        return `
                            <li class="order-item" draggable="true" data-id="${esc(id)}">
                                <span class="drag-handle">⋮⋮</span>
                                <span class="sidebar-icon">${icon}</span>
                                <span class="sidebar-label">${esc(label)}</span>
                                <span class="order-num">#${i + 1}</span>
                            </li>
                        `;
                    }).join('')}
                </ul>
                <div class="actions-bar" style="margin-top:16px;">
                    <button class="btn btn-primary" id="save-order-btn">保存顺序</button>
                </div>
            </div>
        `;

        // 拖拽逻辑
        const list = $('order-list');
        let dragSrc = null;
        list.querySelectorAll('.order-item').forEach(item => {
            item.addEventListener('dragstart', e => {
                dragSrc = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                list.querySelectorAll('.order-item').forEach(i => i.classList.remove('drag-over'));
            });
            item.addEventListener('dragover', e => {
                e.preventDefault();
                if (item !== dragSrc) item.classList.add('drag-over');
            });
            item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
            item.addEventListener('drop', e => {
                e.preventDefault();
                if (!dragSrc || dragSrc === item) return;
                // 交换位置
                const rect = item.getBoundingClientRect();
                const after = e.clientY > rect.top + rect.height / 2;
                if (after) item.parentNode.insertBefore(dragSrc, item.nextSibling);
                else item.parentNode.insertBefore(dragSrc, item);
                // 更新编号显示
                list.querySelectorAll('.order-item').forEach((it, idx) => {
                    it.querySelector('.order-num').textContent = '#' + (idx + 1);
                });
            });
        });

        $('save-order-btn').addEventListener('click', async () => {
            await withLoading($('save-order-btn'), async () => {
                const newOrder = Array.from(list.querySelectorAll('.order-item')).map(it => it.getAttribute('data-id'));
                appearanceCache.sectionOrder = newOrder;
                await window.API.saveAppearance(appearanceCache);
                renderSidebar();
                toast('顺序已保存', 'success');
            });
        });
    }

    // ================================================================
    //  新增板块页
    // ================================================================
    function renderNewSectionPage(root) {
        root.innerHTML = `
            <div class="page-card">
                <h2>➕ 新增板块</h2>
                <p class="hint">创建一个新板块。板块类型决定能添加什么内容。</p>
                <form id="form-new-section">
                    <input type="hidden" id="ns-id" />
                    <div class="form-row">
                        <div class="form-group">
                            <label>板块名称 <span class="required">*</span></label>
                            <input type="text" id="ns-name" required maxlength="40" placeholder="例:机械臂开发专题" />
                        </div>
                        <div class="form-group">
                            <label>图标(emoji)</label>
                            <input type="text" id="ns-emoji" maxlength="4" placeholder="🤖" />
                        </div>
                    </div>
                    <div class="form-group">
                        <label>板块类型 <span class="required">*</span></label>
                        <div class="radio-group">
                            <label class="radio-label">
                                <input type="radio" name="ns-type" value="project" checked />
                                <span>📦 工程类(上传压缩包等文件)</span>
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="ns-type" value="note" />
                                <span>📝 笔记类(markdown 在线编辑或上传 .md)</span>
                            </label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>板块描述(可选)</label>
                        <input type="text" id="ns-desc" maxlength="100" placeholder="一句话说明..." />
                    </div>
                    <div class="form-group">
                        <label>板块小背景图(可选,展示页该板块的背景)</label>
                        <input type="file" id="ns-bg-file" accept="image/*" />
                        <input type="hidden" id="ns-bg-path" />
                        <div class="form-row" style="margin-top:8px;">
                            <input type="range" id="ns-bg-opacity" min="0" max="100" value="100" oninput="this.previousElementSibling.querySelector('#ns-bg-opacity-label').textContent='透明度:'+this.value+'%'" />
                            <span id="ns-bg-opacity-label">透明度:100%</span>
                        </div>
                    </div>
                    <div class="actions-bar">
                        <button type="submit" class="btn btn-primary" id="ns-submit">创建板块</button>
                    </div>
                </form>

                <h3 style="margin-top:24px;">已有板块</h3>
                <div id="ns-list"></div>
            </div>
        `;

        renderNewSectionList();

        $('ns-bg-file').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            await withLoading(document.body, async () => {
                const path = await window.API.uploadBackground(file);
                $('ns-bg-path').value = path;
                toast('小背景图已上传', 'success');
            });
        });

        $('form-new-section').addEventListener('submit', async (e) => {
            e.preventDefault();
            await withLoading($('ns-submit'), async () => {
                const id = 'section_' + uuid();
                const name = $('ns-name').value.trim();
                if (!name) throw new Error('请填写板块名称');
                const emoji = $('ns-emoji').value.trim() || '🗂️';
                const type = document.querySelector('input[name="ns-type"]:checked').value;
                const description = $('ns-desc').value.trim();
                const bgPath = $('ns-bg-path').value.trim();
                const bgOpacity = $('ns-bg-opacity').value / 100;

                const section = {
                    id, name, emoji, type, description,
                    items: [],
                    background: bgPath ? { path: bgPath, opacity: bgOpacity } : null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                sectionsCache.push(section);
                // 同步到 appearance
                appearanceCache.sectionOrder.push(id);
                if (bgPath) {
                    appearanceCache.sectionBackgrounds = appearanceCache.sectionBackgrounds || {};
                    appearanceCache.sectionBackgrounds[id] = { path: bgPath, opacity: bgOpacity };
                }

                await window.API.saveSections(sectionsCache);
                await window.API.saveAppearance(appearanceCache);

                toast('板块已创建', 'success');
                renderSidebar();
                renderNewSectionList();
                $('form-new-section').reset();
                $('ns-bg-path').value = '';
            });
        });
    }

    function renderNewSectionList() {
        const root = $('ns-list');
        if (!root) return;
        if (!sectionsCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">🗂️</span>暂无板块</div>`;
            return;
        }
        root.innerHTML = sectionsCache.map(s => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(s.emoji || '🗂️')} ${esc(s.name)} <span class="tag">${s.type === 'note' ? '📝 笔记' : '📦 工程'}</span></div>
                    ${s.description ? `<div class="meta">${esc(s.description)}</div>` : ''}
                    <div class="meta">📅 ${esc(fmtDate(s.updatedAt))} · ${(s.items || []).length} 个条目</div>
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-sec-edit="${esc(s.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-sec-del="${esc(s.id)}">删除</button>
                </div>
            </div>
        `).join('');
        root.querySelectorAll('[data-sec-edit]').forEach(b => b.addEventListener('click', () => editSectionMeta(b.getAttribute('data-sec-edit'))));
        root.querySelectorAll('[data-sec-del]').forEach(b => b.addEventListener('click', () => deleteSection(b.getAttribute('data-sec-del'))));
    }

    function editSectionMeta(id) {
        const s = sectionsCache.find(x => x.id === id);
        if (!s) return;
        $('ns-id').value = s.id;
        $('ns-name').value = s.name || '';
        $('ns-emoji').value = s.emoji || '';
        document.querySelector(`input[name="ns-type"][value="${s.type}"]`).checked = true;
        $('ns-desc').value = s.description || '';
        if (s.background) {
            $('ns-bg-path').value = s.background.path;
            $('ns-bg-opacity').value = (s.background.opacity * 100).toFixed(0);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function deleteSection(id) {
        const s = sectionsCache.find(x => x.id === id);
        if (!s) return;
        if (!confirm(`确定删除板块「${s.name}」?\n板块内 ${(s.items || []).length} 个条目将一并删除。`)) return;
        await withLoading(document.body, async () => {
            // 删除关联文件
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
            appearanceCache.sectionOrder = appearanceCache.sectionOrder.filter(x => x !== id);
            if (appearanceCache.sectionBackgrounds) delete appearanceCache.sectionBackgrounds[id];
            await window.API.saveSections(sectionsCache);
            await window.API.saveAppearance(appearanceCache);
            renderSidebar();
            renderNewSectionList();
            toast('板块已删除', 'success');
        });
    }

    // ================================================================
    //  板块内条目管理页(根据板块类型渲染不同 UI)
    // ================================================================
    function renderSectionItemsPage(root, secId) {
        const s = sectionsCache.find(x => x.id === secId);
        if (!s) {
            root.innerHTML = `<div class="empty-state">板块不存在</div>`;
            return;
        }
        const isNote = s.type === 'note';
        root.innerHTML = `
            <div class="page-card">
                <h2>${esc(s.emoji || '🗂️')} ${esc(s.name)} · 条目管理</h2>
                <p class="hint">类型:${isNote ? '📝 笔记类(支持 markdown 在线编辑或上传 .md)' : '📦 工程类(支持上传压缩包)'} · 当前 ${(s.items || []).length} 个条目</p>

                ${isNote ? renderNoteForm(s) : renderProjectItemForm(s)}

                <h3 style="margin-top:24px;border-top:1px solid var(--border-color);padding-top:16px;">已有条目</h3>
                <div id="sec-items-list"></div>
            </div>
        `;

        renderSecItemsList(s);

        if (isNote) bindNoteForm(s);
        else bindProjectItemForm(s);
    }

    // ---------- 笔记类表单 ----------
    function renderNoteForm(s) {
        return `
            <form id="form-note-item">
                <input type="hidden" id="ni-id" />
                <div class="form-row">
                    <div class="form-group">
                        <label>笔记标题 <span class="required">*</span></label>
                        <input type="text" id="ni-title" required maxlength="80" placeholder="例:机械臂学习笔记" />
                    </div>
                    <div class="form-group">
                        <label>日期</label>
                        <input type="date" id="ni-date" value="${new Date().toISOString().slice(0, 10)}" />
                    </div>
                </div>
                <div class="form-group">
                    <label>内容(分屏编辑 + 预览)</label>
                    <div class="md-editor">
                        <textarea id="ni-content" placeholder="在此输入 markdown..." rows="14"></textarea>
                        <div id="ni-preview" class="md-preview"></div>
                    </div>
                </div>
                <div class="form-group">
                    <label>或上传 .md 文件(优先于文本框内容)</label>
                    <input type="file" id="ni-file" accept=".md,.markdown,.txt" />
                </div>
                <div class="actions-bar">
                    <button type="submit" class="btn btn-primary" id="ni-submit">保存笔记</button>
                    <button type="button" class="btn" id="ni-reset">清空</button>
                </div>
            </form>
        `;
    }
    function bindNoteForm(s) {
        const ta = $('ni-content');
        const preview = $('ni-preview');
        const updatePreview = () => {
            if (window.marked) preview.innerHTML = window.marked.parse(ta.value);
            else preview.textContent = ta.value;
        };
        ta.addEventListener('input', updatePreview);
        updatePreview();

        $('ni-file').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            ta.value = await file.text();
            updatePreview();
        });

        $('ni-reset').addEventListener('click', () => {
            $('form-note-item').reset();
            $('ni-id').value = '';
            updatePreview();
        });

        $('form-note-item').addEventListener('submit', async (e) => {
            e.preventDefault();
            await withLoading($('ni-submit'), async () => {
                const id = $('ni-id').value || ('item_' + uuid());
                const title = $('ni-title').value.trim();
                if (!title) throw new Error('请填写标题');
                const date = $('ni-date').value;
                const content = $('ni-content').value;
                const file = $('ni-file').files[0];

                let mdContent = content;
                if (file) mdContent = await file.text();
                if (!mdContent) throw new Error('请输入内容或上传文件');

                // 保存为 .md 文件
                const slug = title.replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'note';
                const filename = `${date || new Date().toISOString().slice(0, 10)}-${slug}.md`;
                const filePath = `${cfg.github.paths.diariesDir}/${filename}`;

                const existing = (s.items || []).find(x => x.id === id);
                const oldPath = existing ? existing.filePath : null;
                if (oldPath && oldPath !== filePath) {
                    try {
                        const meta = await window.API.getFileMeta(oldPath);
                        if (meta) await window.API.deleteFile(oldPath, meta.sha, `delete old: ${oldPath}`);
                    } catch (e) { console.warn('旧文件清理失败', e); }
                }
                await window.API.saveDiaryMarkdown(filename, mdContent);

                const item = {
                    id, name: title, description: mdContent.slice(0, 100),
                    tags: [date || '笔记'],
                    filePath,
                    updatedAt: new Date().toISOString()
                };
                if (!existing) item.createdAt = item.updatedAt;

                s.items = existing
                    ? (s.items || []).map(x => x.id === id ? item : x)
                    : [...(s.items || []), item];
                sectionsCache = sectionsCache.map(x => x.id === s.id ? s : x);
                await window.API.saveSections(sectionsCache);

                renderSecItemsList(s);
                $('form-note-item').reset();
                $('ni-id').value = '';
                updatePreview();
                toast(existing ? '笔记已更新' : '笔记已添加', 'success');
            });
        });
    }

    // ---------- 工程类条目表单 ----------
    function renderProjectItemForm(s) {
        return `
            <form id="form-proj-item">
                <input type="hidden" id="pi-id" />
                <div class="form-group">
                    <label>条目名称 <span class="required">*</span></label>
                    <input type="text" id="pi-name" required maxlength="80" placeholder="例:抓取算法 v2" />
                </div>
                <div class="form-group">
                    <label>简介</label>
                    <textarea id="pi-desc" maxlength="300" rows="2" placeholder="一句话说明..."></textarea>
                </div>
                <div class="form-group">
                    <label>标签(逗号分隔)</label>
                    <input type="text" id="pi-tags" placeholder="例:算法, 机械臂" />
                </div>
                <div class="form-group">
                    <label>上传压缩包(可选)</label>
                    <input type="file" id="pi-file" />
                </div>
                <div class="actions-bar">
                    <button type="submit" class="btn btn-primary" id="pi-submit">添加/更新</button>
                    <button type="button" class="btn" id="pi-reset">清空</button>
                </div>
            </form>
        `;
    }
    function bindProjectItemForm(s) {
        $('pi-reset').addEventListener('click', () => {
            $('form-proj-item').reset();
            $('pi-id').value = '';
        });

        $('form-proj-item').addEventListener('submit', async (e) => {
            e.preventDefault();
            await withLoading($('pi-submit'), async () => {
                const id = $('pi-id').value || ('item_' + uuid());
                const name = $('pi-name').value.trim();
                if (!name) throw new Error('请填写名称');
                const description = $('pi-desc').value.trim();
                const tags = $('pi-tags').value.split(',').map(t => t.trim()).filter(Boolean);
                const file = $('pi-file').files[0];

                const existing = (s.items || []).find(x => x.id === id);
                let filePath = existing ? existing.filePath : null;
                if (file) filePath = await window.API.uploadSectionFile(file);

                const item = {
                    id, name, description, tags, filePath,
                    updatedAt: new Date().toISOString()
                };
                if (!existing) item.createdAt = item.updatedAt;

                s.items = existing
                    ? (s.items || []).map(x => x.id === id ? item : x)
                    : [...(s.items || []), item];
                sectionsCache = sectionsCache.map(x => x.id === s.id ? s : x);
                await window.API.saveSections(sectionsCache);

                renderSecItemsList(s);
                $('form-proj-item').reset();
                $('pi-id').value = '';
                toast(existing ? '条目已更新' : '条目已添加', 'success');
            });
        });
    }

    function renderSecItemsList(s) {
        const root = $('sec-items-list');
        if (!root) return;
        const items = s.items || [];
        if (!items.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">📋</span>暂无条目</div>`;
            return;
        }
        root.innerHTML = items.map(it => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(it.name)}</div>
                    <div class="meta">
                        ${it.filePath ? '📎 已上传文件 · ' : ''}
                        📅 ${esc(fmtDate(it.updatedAt))}
                        ${it.tags && it.tags.length ? ' · #' + it.tags.map(esc).join(' #') : ''}
                    </div>
                    ${it.description ? `<div class="meta" style="color:var(--text-secondary);margin-top:4px;">${esc(it.description)}</div>` : ''}
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-item-edit="${esc(it.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-item-del="${esc(it.id)}">删除</button>
                </div>
            </div>
        `).join('');

        root.querySelectorAll('[data-item-edit]').forEach(b => b.addEventListener('click', () => editSecItem(s, b.getAttribute('data-item-edit'))));
        root.querySelectorAll('[data-item-del]').forEach(b => b.addEventListener('click', () => deleteSecItem(s, b.getAttribute('data-item-del'))));
    }

    function editSecItem(s, itemId) {
        const it = (s.items || []).find(x => x.id === itemId);
        if (!it) return;
        if (s.type === 'note') {
            $('ni-id').value = it.id;
            $('ni-title').value = it.name || '';
            $('ni-date').value = (it.tags && it.tags[0]) || '';
            $('ni-file').value = '';
            // 拉取 md 内容
            if (it.filePath) {
                window.API.getDiaryMarkdown(it.filePath).then(md => {
                    $('ni-content').value = md;
                    $('ni-content').dispatchEvent(new Event('input'));
                }).catch(() => {});
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            $('pi-id').value = it.id;
            $('pi-name').value = it.name || '';
            $('pi-desc').value = it.description || '';
            $('pi-tags').value = (it.tags || []).join(', ');
            $('pi-file').value = '';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    async function deleteSecItem(s, itemId) {
        const it = (s.items || []).find(x => x.id === itemId);
        if (!it) return;
        if (!confirm(`删除条目「${it.name}」?`)) return;
        await withLoading(document.body, async () => {
            if (it.filePath) {
                try {
                    const meta = await window.API.getFileMeta(it.filePath);
                    if (meta) await window.API.deleteFile(it.filePath, meta.sha, `delete: ${it.name}`);
                } catch (e) { console.warn('文件删除失败', e); }
            }
            s.items = (s.items || []).filter(x => x.id !== itemId);
            sectionsCache = sectionsCache.map(x => x.id === s.id ? s : x);
            await window.API.saveSections(sectionsCache);
            renderSecItemsList(s);
            toast('条目已删除', 'success');
        });
    }

    // ================================================================
    //  工程资源页(系统板块)
    // ================================================================
    function renderProjectsPage(root) {
        root.innerHTML = `
            <div class="page-card">
                <h2>📦 工程资源管理</h2>
                <p class="hint">管理展示页"工程与资源"板块的内容。</p>
                <form id="form-project">
                    <input type="hidden" id="proj-id" />
                    <div class="form-row">
                        <div class="form-group">
                            <label>工程名称 <span class="required">*</span></label>
                            <input type="text" id="proj-name" required maxlength="80" placeholder="例:机械臂控制程序" />
                        </div>
                        <div class="form-group">
                            <label>标签(逗号分隔)</label>
                            <input type="text" id="proj-tags" placeholder="Python, MuJoCo" />
                        </div>
                    </div>
                    <div class="form-group">
                        <label>简介</label>
                        <textarea id="proj-desc" maxlength="500" rows="3" placeholder="项目说明..."></textarea>
                    </div>
                    <div class="form-group">
                        <label>压缩包(可选)</label>
                        <input type="file" id="proj-file" />
                    </div>
                    <div class="actions-bar">
                        <button type="submit" class="btn btn-primary" id="proj-submit">保存</button>
                        <button type="button" class="btn" id="proj-reset">清空</button>
                    </div>
                </form>
                <h3 style="margin-top:24px;">已有工程</h3>
                <div id="admin-list-projects"></div>
            </div>
        `;
        renderAdminProjects();
        $('proj-reset').addEventListener('click', () => {
            $('form-project').reset();
            $('proj-id').value = '';
        });
        $('form-project').addEventListener('submit', async (e) => {
            e.preventDefault();
            await withLoading($('proj-submit'), async () => {
                const id = $('proj-id').value || uuid();
                const name = $('proj-name').value.trim();
                if (!name) throw new Error('请填写工程名称');
                const tags = $('proj-tags').value.split(',').map(s => s.trim()).filter(Boolean);
                const description = $('proj-desc').value.trim();
                const file = $('proj-file').files[0];
                const existing = projectsCache.find(x => x.id === id);
                let archivePath = existing ? existing.archivePath : null;
                if (file) archivePath = await window.API.uploadProjectArchive(file);
                const item = { id, name, description, tags, archivePath, updatedAt: new Date().toISOString() };
                if (!existing) item.createdAt = item.updatedAt;
                projectsCache = existing
                    ? projectsCache.map(x => x.id === id ? item : x)
                    : [item, ...projectsCache];
                await window.API.saveProjects(projectsCache);
                renderAdminProjects();
                $('form-project').reset();
                $('proj-id').value = '';
                toast(existing ? '已更新' : '已添加', 'success');
            });
        });
    }
    function renderAdminProjects() {
        const root = $('admin-list-projects');
        if (!root) return;
        if (!projectsCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">📦</span>暂无工程</div>`;
            return;
        }
        root.innerHTML = projectsCache.map(p => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(p.name)}</div>
                    <div class="meta">
                        ${p.archivePath ? '📎 已上传压缩包 · ' : '📄 仅元数据 · '}
                        📅 ${esc(fmtDate(p.updatedAt))}
                        ${p.tags && p.tags.length ? ' · #' + p.tags.map(esc).join(' #') : ''}
                    </div>
                    ${p.description ? `<div class="meta" style="color:var(--text-secondary);margin-top:4px;">${esc(p.description)}</div>` : ''}
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-edit="${esc(p.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-del="${esc(p.id)}">删除</button>
                </div>
            </div>
        `).join('');
        root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
            const p = projectsCache.find(x => x.id === b.getAttribute('data-edit'));
            if (!p) return;
            $('proj-id').value = p.id;
            $('proj-name').value = p.name || '';
            $('proj-tags').value = (p.tags || []).join(', ');
            $('proj-desc').value = p.description || '';
            $('proj-file').value = '';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }));
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            const p = projectsCache.find(x => x.id === b.getAttribute('data-del'));
            if (!p) return;
            if (!confirm(`删除工程「${p.name}」?`)) return;
            await withLoading(document.body, async () => {
                if (p.archivePath) {
                    try {
                        const meta = await window.API.getFileMeta(p.archivePath);
                        if (meta) await window.API.deleteFile(p.archivePath, meta.sha, `delete: ${p.name}`);
                    } catch (e) { console.warn(e); }
                }
                projectsCache = projectsCache.filter(x => x.id !== p.id);
                await window.API.saveProjects(projectsCache);
                renderAdminProjects();
                toast('已删除', 'success');
            });
        }));
    }

    // ================================================================
    //  游戏进度页(系统板块)
    // ================================================================
    function renderGamesPage(root) {
        root.innerHTML = `
            <div class="page-card">
                <h2>🎮 游戏进度管理</h2>
                <form id="form-game">
                    <input type="hidden" id="game-id" />
                    <div class="form-row">
                        <div class="form-group">
                            <label>游戏名称 <span class="required">*</span></label>
                            <input type="text" id="game-name" required maxlength="80" placeholder="例:像素冒险" />
                        </div>
                        <div class="form-group">
                            <label>开发进度 <span class="required">*</span></label>
                            <input type="number" id="game-progress" min="0" max="100" value="0" />
                        </div>
                    </div>
                    <div class="form-group">
                        <label>进度说明</label>
                        <textarea id="game-desc" maxlength="500" rows="3" placeholder="完成了什么..."></textarea>
                    </div>
                    <div class="form-group">
                        <label>备份压缩包(可选)</label>
                        <input type="file" id="game-file" />
                    </div>
                    <div class="actions-bar">
                        <button type="submit" class="btn btn-primary" id="game-submit">保存</button>
                        <button type="button" class="btn" id="game-reset">清空</button>
                    </div>
                </form>
                <h3 style="margin-top:24px;">已有游戏</h3>
                <div id="admin-list-games"></div>
            </div>
        `;
        renderAdminGames();
        $('game-reset').addEventListener('click', () => {
            $('form-game').reset();
            $('game-id').value = '';
            $('game-progress').value = 0;
        });
        $('form-game').addEventListener('submit', async (e) => {
            e.preventDefault();
            await withLoading($('game-submit'), async () => {
                const id = $('game-id').value || uuid();
                const name = $('game-name').value.trim();
                if (!name) throw new Error('请填写游戏名称');
                const progress = Math.max(0, Math.min(100, parseInt($('game-progress').value, 10) || 0));
                const description = $('game-desc').value.trim();
                const file = $('game-file').files[0];
                const existing = gamesCache.find(x => x.id === id);
                let backupPath = existing ? existing.backupPath : null;
                if (file) backupPath = await window.API.uploadGameBackup(file);
                const item = { id, name, progress, description, backupPath, updatedAt: new Date().toISOString() };
                if (!existing) item.createdAt = item.updatedAt;
                gamesCache = existing
                    ? gamesCache.map(x => x.id === id ? item : x)
                    : [item, ...gamesCache];
                await window.API.saveGames(gamesCache);
                renderAdminGames();
                $('form-game').reset();
                $('game-id').value = '';
                $('game-progress').value = 0;
                toast(existing ? '已更新' : '已添加', 'success');
            });
        });
    }
    function renderAdminGames() {
        const root = $('admin-list-games');
        if (!root) return;
        if (!gamesCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">🎮</span>暂无游戏</div>`;
            return;
        }
        root.innerHTML = gamesCache.map(g => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(g.name)} <span style="color:var(--success);">(${g.progress}%)</span></div>
                    <div class="meta">
                        ${g.backupPath ? '📎 已上传备份 · ' : ''}
                        📅 ${esc(fmtDate(g.updatedAt))}
                    </div>
                    ${g.description ? `<div class="meta" style="color:var(--text-secondary);margin-top:4px;">${esc(g.description)}</div>` : ''}
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-edit="${esc(g.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-del="${esc(g.id)}">删除</button>
                </div>
            </div>
        `).join('');
        root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
            const g = gamesCache.find(x => x.id === b.getAttribute('data-edit'));
            if (!g) return;
            $('game-id').value = g.id;
            $('game-name').value = g.name || '';
            $('game-progress').value = g.progress || 0;
            $('game-desc').value = g.description || '';
            $('game-file').value = '';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }));
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            const g = gamesCache.find(x => x.id === b.getAttribute('data-del'));
            if (!g) return;
            if (!confirm(`删除游戏「${g.name}」?`)) return;
            await withLoading(document.body, async () => {
                if (g.backupPath) {
                    try {
                        const meta = await window.API.getFileMeta(g.backupPath);
                        if (meta) await window.API.deleteFile(g.backupPath, meta.sha, `delete: ${g.name}`);
                    } catch (e) { console.warn(e); }
                }
                gamesCache = gamesCache.filter(x => x.id !== g.id);
                await window.API.saveGames(gamesCache);
                renderAdminGames();
                toast('已删除', 'success');
            });
        }));
    }

    // ================================================================
    //  日记页(系统板块)
    // ================================================================
    function renderDiariesPage(root) {
        root.innerHTML = `
            <div class="page-card">
                <h2>📝 个人日记管理</h2>
                <form id="form-diary">
                    <input type="hidden" id="diary-id" />
                    <input type="hidden" id="diary-old-path" />
                    <div class="form-row">
                        <div class="form-group">
                            <label>标题 <span class="required">*</span></label>
                            <input type="text" id="diary-title" required maxlength="80" />
                        </div>
                        <div class="form-group">
                            <label>日期</label>
                            <input type="date" id="diary-date" value="${new Date().toISOString().slice(0, 10)}" />
                        </div>
                    </div>
                    <div class="form-group">
                        <label>摘要</label>
                        <input type="text" id="diary-summary" maxlength="200" />
                    </div>
                    <div class="form-group">
                        <label>内容(markdown 在线编辑)</label>
                        <div class="md-editor">
                            <textarea id="diary-content" rows="12" placeholder="输入 markdown..."></textarea>
                            <div id="diary-preview" class="md-preview"></div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>或上传 .md 文件</label>
                        <input type="file" id="diary-file" accept=".md,.markdown,.txt" />
                    </div>
                    <div class="actions-bar">
                        <button type="submit" class="btn btn-primary" id="diary-submit">保存</button>
                        <button type="button" class="btn" id="diary-reset">清空</button>
                    </div>
                </form>
                <h3 style="margin-top:24px;">已有日记</h3>
                <div id="admin-list-diaries"></div>
            </div>
        `;
        renderAdminDiaries();
        const ta = $('diary-content');
        const preview = $('diary-preview');
        const updatePreview = () => {
            if (window.marked) preview.innerHTML = window.marked.parse(ta.value);
            else preview.textContent = ta.value;
        };
        ta.addEventListener('input', updatePreview);
        $('diary-file').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            ta.value = await file.text();
            updatePreview();
        });
        $('diary-reset').addEventListener('click', () => {
            $('form-diary').reset();
            $('diary-id').value = '';
            $('diary-old-path').value = '';
            updatePreview();
        });
        $('form-diary').addEventListener('submit', async (e) => {
            e.preventDefault();
            await withLoading($('diary-submit'), async () => {
                const id = $('diary-id').value || uuid();
                const title = $('diary-title').value.trim();
                if (!title) throw new Error('请填写标题');
                const date = $('diary-date').value;
                if (!date) throw new Error('请选择日期');
                const summary = $('diary-summary').value.trim();
                const file = $('diary-file').files[0];
                const contentText = $('diary-content').value;
                if (!file && !contentText) throw new Error('请输入内容或上传文件');
                const existing = diariesCache.find(x => x.id === id);
                const oldPath = $('diary-old-path').value || (existing ? existing.markdownPath : '');
                const slug = title.replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'diary';
                const filename = `${date}-${slug}.md`;
                let mdContent = contentText;
                if (file) mdContent = await file.text();
                const newPath = `${cfg.github.paths.diariesDir}/${filename}`;
                if (oldPath && oldPath !== newPath) {
                    try {
                        const oldMeta = await window.API.getFileMeta(oldPath);
                        if (oldMeta) await window.API.deleteFile(oldPath, oldMeta.sha, `delete old: ${oldPath}`);
                    } catch (e) { console.warn(e); }
                }
                await window.API.saveDiaryMarkdown(filename, mdContent);
                const item = { id, title, date, summary, markdownPath: newPath, updatedAt: new Date().toISOString() };
                if (!existing) item.createdAt = item.updatedAt;
                diariesCache = existing
                    ? diariesCache.map(x => x.id === id ? item : x)
                    : [item, ...diariesCache];
                await window.API.saveDiaries(diariesCache);
                renderAdminDiaries();
                $('form-diary').reset();
                $('diary-id').value = '';
                $('diary-old-path').value = '';
                updatePreview();
                toast(existing ? '已更新' : '已添加', 'success');
            });
        });
    }
    function renderAdminDiaries() {
        const root = $('admin-list-diaries');
        if (!root) return;
        if (!diariesCache.length) {
            root.innerHTML = `<div class="empty-state"><span class="emoji">📝</span>暂无日记</div>`;
            return;
        }
        const sorted = diariesCache.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        root.innerHTML = sorted.map(d => `
            <div class="admin-item">
                <div class="info">
                    <div class="title">${esc(d.title)}</div>
                    <div class="meta">📅 ${esc(fmtDate(d.date))}</div>
                    ${d.summary ? `<div class="meta" style="color:var(--text-secondary);margin-top:4px;">${esc(d.summary)}</div>` : ''}
                </div>
                <div class="actions-bar">
                    <button class="btn btn-sm" data-edit="${esc(d.id)}">编辑</button>
                    <button class="btn btn-sm btn-danger" data-del="${esc(d.id)}">删除</button>
                </div>
            </div>
        `).join('');
        root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
            const d = diariesCache.find(x => x.id === b.getAttribute('data-edit'));
            if (!d) return;
            $('diary-id').value = d.id;
            $('diary-old-path').value = d.markdownPath || '';
            $('diary-title').value = d.title || '';
            $('diary-date').value = d.date || '';
            $('diary-summary').value = d.summary || '';
            $('diary-content').value = '';
            $('diary-file').value = '';
            if (d.markdownPath) {
                try {
                    const md = await window.API.getDiaryMarkdown(d.markdownPath);
                    $('diary-content').value = md;
                    $('diary-content').dispatchEvent(new Event('input'));
                } catch (e) {}
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }));
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            const d = diariesCache.find(x => x.id === b.getAttribute('data-del'));
            if (!d) return;
            if (!confirm(`删除日记「${d.title}」?`)) return;
            await withLoading(document.body, async () => {
                if (d.markdownPath) {
                    try {
                        const meta = await window.API.getFileMeta(d.markdownPath);
                        if (meta) await window.API.deleteFile(d.markdownPath, meta.sha, `delete: ${d.title}`);
                    } catch (e) { console.warn(e); }
                }
                diariesCache = diariesCache.filter(x => x.id !== d.id);
                await window.API.saveDiaries(diariesCache);
                renderAdminDiaries();
                toast('已删除', 'success');
            });
        }));
    }

    // ================================================================
    //  初始化
    // ================================================================
    function bindEvents() {
        $('setup-btn').addEventListener('click', setupAndLogin);
        $('pat-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('pwd-input').focus(); });
        $('pwd-input').addEventListener('keydown', e => { if (e.key === 'Enter') setupAndLogin(); });
        $('unlock-btn').addEventListener('click', unlock);
        $('unlock-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
        $('reset-vault').addEventListener('click', e => { e.preventDefault(); resetVault(); });
        $('re-pat').addEventListener('click', e => { e.preventDefault(); replacePat(); });
        $('logout-btn').addEventListener('click', logout);
        $('go-appearance-btn').addEventListener('click', () => switchView('appearance'));
        $('go-order-btn').addEventListener('click', () => switchView('order'));
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        const existingToken = window.API.getToken();
        const vault = loadVault();
        if (existingToken) {
            showWorkspace();
        } else if (vault) {
            showUnlockMode();
        } else {
            showSetupMode();
        }
    });
})();
