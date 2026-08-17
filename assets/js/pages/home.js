/**
 * 展示页逻辑
 * 读取 data/*.json 并渲染三个板块 + 联系方式
 */
(function () {
    'use strict';

    const cfg = window.SITE_CONFIG;

    // ---------- 工具:HTML 转义防注入 ----------
    function esc(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---------- 工具:Toast ----------
    function toast(msg, type) {
        const box = document.getElementById('toast-container');
        if (!box) return alert(msg);
        const el = document.createElement('div');
        el.className = `toast ${type || ''}`;
        el.textContent = msg;
        box.appendChild(el);
        setTimeout(() => {
            el.classList.add('removing');
            setTimeout(() => el.remove(), 300);
        }, 3500);
    }

    // ---------- 工具:格式化日期 ----------
    function fmtDate(d) {
        if (!d) return '';
        const date = new Date(d);
        if (isNaN(date)) return d;
        return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    // ---------- 渲染:头部 ----------
    function renderHeader() {
        document.title = `${cfg.developerName} · 个人空间`;
        document.getElementById('brand-name').textContent = cfg.developerName;
        document.getElementById('brand-subtitle').textContent = cfg.siteSubtitle;
    }

    // ---------- 渲染:工程列表 ----------
    function renderProjects(list) {
        const root = document.getElementById('list-projects');
        document.getElementById('count-projects').textContent = list.length;

        if (!list.length) {
            root.innerHTML = `
                <div class="empty-state">
                    <span class="emoji">📦</span>
                    暂无工程资源
                </div>`;
            return;
        }

        root.innerHTML = list.map(p => `
            <div class="item-card">
                <div class="item-title">${esc(p.name)}</div>
                ${p.description ? `<div class="item-desc">${esc(p.description)}</div>` : ''}
                <div class="item-meta">
                    ${p.updatedAt ? `<span class="tag">📅 ${esc(fmtDate(p.updatedAt))}</span>` : ''}
                    ${p.tags && p.tags.length ? p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : ''}
                    ${p.archivePath ? `<a class="btn btn-sm btn-primary" href="${esc(window.API.rawUrl(p.archivePath))}" target="_blank" rel="noopener">⬇ 下载</a>` : ''}
                </div>
            </div>
        `).join('');
    }

    // ---------- 渲染:游戏进度 ----------
    function renderGames(list) {
        const root = document.getElementById('list-games');
        document.getElementById('count-games').textContent = list.length;

        if (!list.length) {
            root.innerHTML = `
                <div class="empty-state">
                    <span class="emoji">🎮</span>
                    暂无游戏项目
                </div>`;
            return;
        }

        root.innerHTML = list.map(g => {
            const progress = Math.max(0, Math.min(100, Number(g.progress) || 0));
            return `
            <div class="item-card">
                <div class="item-title">${esc(g.name)}</div>
                ${g.description ? `<div class="item-desc">${esc(g.description)}</div>` : ''}
                <div class="progress">
                    <div class="progress-bar" style="width:${progress}%"></div>
                </div>
                <div class="progress-text">
                    <span>开发进度</span>
                    <span>${progress}%</span>
                </div>
                <div class="item-meta" style="margin-top:10px;">
                    ${g.updatedAt ? `<span class="tag">📅 ${esc(fmtDate(g.updatedAt))}</span>` : ''}
                    ${g.backupPath ? `<a class="btn btn-sm btn-primary" href="${esc(window.API.rawUrl(g.backupPath))}" target="_blank" rel="noopener">⬇ 备份</a>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    // ---------- 渲染:日记列表 ----------
    function renderDiaries(list) {
        const root = document.getElementById('list-diaries');
        document.getElementById('count-diaries').textContent = list.length;

        if (!list.length) {
            root.innerHTML = `
                <div class="empty-state">
                    <span class="emoji">📝</span>
                    暂无日记
                </div>`;
            return;
        }

        // 按日期降序
        const sorted = list.slice().sort((a, b) => {
            const da = new Date(a.date || 0).getTime();
            const db = new Date(b.date || 0).getTime();
            return db - da;
        });

        root.innerHTML = sorted.map(d => `
            <div class="item-card" style="cursor:pointer;" data-path="${esc(d.markdownPath || '')}">
                <div class="item-title">${esc(d.title)}</div>
                ${d.summary ? `<div class="item-desc">${esc(d.summary)}</div>` : ''}
                <div class="item-meta">
                    <span class="tag">📅 ${esc(fmtDate(d.date))}</span>
                </div>
            </div>
        `).join('');

        // 绑定点击事件:打开日记详情弹窗
        root.querySelectorAll('.item-card[data-path]').forEach(card => {
            card.addEventListener('click', async () => {
                const path = card.getAttribute('data-path');
                if (!path) return;
                await openDiaryModal(path, card.querySelector('.item-title').textContent);
            });
        });
    }

    // ---------- 渲染:日记详情弹窗 ----------
    async function openDiaryModal(path, title) {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>${esc(title)}</h3>
                    <button class="modal-close" aria-label="关闭">&times;</button>
                </div>
                <div class="markdown-body"><div class="loading">加载中</div></div>
            </div>`;
        document.body.appendChild(mask);
        mask.querySelector('.modal-close').addEventListener('click', () => mask.remove());
        mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });

        const body = mask.querySelector('.markdown-body');
        try {
            const md = await window.API.getDiaryMarkdown(path);
            if (window.marked) {
                body.innerHTML = window.marked.parse(md);
            } else {
                body.textContent = md;
            }
        } catch (e) {
            body.innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>加载失败: ${esc(e.message)}</div>`;
        }
    }

    // ---------- 渲染:联系方式 ----------
    function renderContact() {
        const list = document.getElementById('contact-list');
        const c = cfg.contact;
        const items = [];

        if (c.github && c.github.url) {
            items.push(`
                <div class="contact-item">
                    <span class="label">GitHub</span>
                    <a href="${esc(c.github.url)}" target="_blank" rel="noopener">${esc(c.github.text || c.github.url)}</a>
                </div>`);
        }
        if (c.email && c.email.address) {
            items.push(`
                <div class="contact-item">
                    <span class="label">邮箱</span>
                    <a href="mailto:${esc(c.email.address)}">${esc(c.email.address)}</a>
                </div>`);
        }
        if (c.wechat && c.wechat.text) {
            items.push(`
                <div class="contact-item">
                    <span class="label">微信</span>
                    <span>${esc(c.wechat.text)}</span>
                    <button class="copy-btn" data-copy="${esc(c.wechat.text)}">复制</button>
                </div>`);
        }

        list.innerHTML = items.join('');

        // 复制按钮
        list.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
                    toast('已复制到剪贴板', 'success');
                } catch (_) {
                    toast('复制失败,请手动选择', 'error');
                }
            });
        });
    }

    // ---------- 渲染:自定义板块 ----------
    function renderSections(sections) {
        const grid = document.querySelector('.main-grid');
        // 移除已渲染的自定义板块(避免重复)
        grid.querySelectorAll('.panel-custom').forEach(el => el.remove());

        if (!sections.length) return;

        sections.forEach(sec => {
            const panel = document.createElement('section');
            panel.className = 'panel panel-custom';
            panel.dataset.id = sec.id;

            const items = sec.items || [];
            const itemsHtml = items.length ? items.map(it => `
                <div class="item-card">
                    <div class="item-title">${esc(it.name)}</div>
                    ${it.description ? `<div class="item-desc">${esc(it.description)}</div>` : ''}
                    <div class="item-meta">
                        ${it.updatedAt ? `<span class="tag">📅 ${esc(fmtDate(it.updatedAt))}</span>` : ''}
                        ${it.tags && it.tags.length ? it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : ''}
                        ${it.filePath ? `<a class="btn btn-sm btn-primary" href="${esc(window.API.rawUrl(it.filePath))}" target="_blank" rel="noopener">⬇ 下载</a>` : ''}
                    </div>
                </div>
            `).join('') : `
                <div class="empty-state">
                    <span class="emoji">${esc(sec.emoji || '📋')}</span>
                    暂无内容
                </div>`;

            panel.innerHTML = `
                <div class="panel-header">
                    <h2 class="panel-title">
                        <span class="emoji">${esc(sec.emoji || '📋')}</span> ${esc(sec.name)}
                    </h2>
                    <span class="panel-count">${items.length}</span>
                </div>
                <div class="panel-body">${itemsHtml}</div>
            `;
            grid.appendChild(panel);
        });
    }

    // ---------- 主入口 ----------
    async function init() {
        renderHeader();
        renderContact();
        document.getElementById('year').textContent = new Date().getFullYear();

        // 并行加载五个数据源(含自定义板块 + 美化配置)
        const results = await Promise.allSettled([
            window.API.listProjects(),
            window.API.listGames(),
            window.API.listDiaries(),
            window.API.listSections(),
            window.API.getAppearance()
        ]);

        const [proj, games, diaries, sections, appearance] = results.map(r => {
            if (r.status === 'fulfilled') return r.value;
            console.error('[加载失败]', r.reason);
            return null;
        });

        if (results[0].status === 'rejected') toast('工程数据加载失败', 'error');
        if (results[1].status === 'rejected') toast('游戏数据加载失败', 'error');
        if (results[2].status === 'rejected') toast('日记数据加载失败', 'error');
        if (results[3].status === 'rejected') toast('自定义板块加载失败', 'error');

        // 应用美化配置(全局背景 + 板块排序)
        applyAppearance(appearance || {
            globalBackground: { imageUrl: '', color: '', opacity: 1 },
            sectionOrder: ['projects', 'games', 'diaries'],
            sectionBackgrounds: {}
        }, sections || []);

        renderProjects(proj || []);
        renderGames(games || []);
        renderDiaries(diaries || []);
        renderSections(sections || []);

        // 按 sectionOrder 重排 DOM
        reorderPanels(appearance || { sectionOrder: ['projects', 'games', 'diaries'] });
    }

    // ---------- 应用美化配置 ----------
    function applyAppearance(ap, sections) {
        const bg = ap.globalBackground || {};
        if (bg.color) {
            document.body.style.backgroundColor = bg.color;
        } else {
            // 撤销:恢复默认
            document.body.style.backgroundColor = '';
        }

        // 背景图:有则添加/更新,无则移除
        let bgLayer = document.getElementById('bg-layer');
        if (bg.imageUrl) {
            if (!bgLayer) {
                bgLayer = document.createElement('div');
                bgLayer.id = 'bg-layer';
                bgLayer.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;background-size:cover;background-position:center;';
                document.body.insertBefore(bgLayer, document.body.firstChild);
            }
            bgLayer.style.backgroundImage = `url('${bg.imageUrl}')`;
            bgLayer.style.opacity = bg.opacity != null ? bg.opacity : 1;
            bgLayer.style.display = 'block';
        } else if (bgLayer) {
            // 撤销背景图:隐藏背景层
            bgLayer.style.display = 'none';
            bgLayer.style.backgroundImage = 'none';
        }
    }

    // ---------- 按排序重排面板 ----------
    function reorderPanels(ap) {
        const grid = document.querySelector('.main-grid');
        if (!grid) return;
        const order = ap.sectionOrder || ['projects', 'games', 'diaries'];
        const panels = {};
        // 系统板块
        const sysMap = { projects: '.panel-projects', games: '.panel-games', diaries: '.panel-diaries' };
        Object.keys(sysMap).forEach(k => {
            panels[k] = grid.querySelector(sysMap[k]);
        });
        // 自定义板块
        grid.querySelectorAll('.panel-custom').forEach(p => {
            panels[p.dataset.id] = p;
        });
        // 按 order 顺序重新插入
        order.forEach(id => {
            const panel = panels[id];
            if (panel) {
                // 应用小背景图
                const secBg = (ap.sectionBackgrounds || {})[id];
                if (secBg && secBg.path) {
                    panel.style.backgroundImage = `url('${window.API.rawUrl(secBg.path)}')`;
                    panel.style.backgroundSize = 'cover';
                    panel.style.backgroundPosition = 'center';
                    panel.style.position = 'relative';
                    // 加半透明遮罩保证文字可读
                    let mask = panel.querySelector('.panel-bg-mask');
                    if (!mask) {
                        mask = document.createElement('div');
                        mask.className = 'panel-bg-mask';
                        mask.style.cssText = 'position:absolute;inset:0;background:rgba(13,17,23,0.55);z-index:0;';
                        panel.insertBefore(mask, panel.firstChild);
                    }
                    mask.style.opacity = 1 - (secBg.opacity != null ? secBg.opacity : 1);
                    // 内容提到上层
                    panel.querySelectorAll('.panel-header, .panel-body').forEach(el => {
                        el.style.position = 'relative';
                        el.style.zIndex = '1';
                    });
                }
                grid.appendChild(panel);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
