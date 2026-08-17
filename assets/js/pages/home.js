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

    // ---------- 主入口 ----------
    async function init() {
        renderHeader();
        renderContact();
        document.getElementById('year').textContent = new Date().getFullYear();

        // 并行加载三个数据源
        const results = await Promise.allSettled([
            window.API.listProjects(),
            window.API.listGames(),
            window.API.listDiaries()
        ]);

        const [proj, games, diaries] = results.map(r => {
            if (r.status === 'fulfilled') return r.value;
            console.error('[加载失败]', r.reason);
            return [];
        });

        if (results[0].status === 'rejected') toast('工程数据加载失败', 'error');
        if (results[1].status === 'rejected') toast('游戏数据加载失败', 'error');
        if (results[2].status === 'rejected') toast('日记数据加载失败', 'error');

        renderProjects(proj);
        renderGames(games);
        renderDiaries(diaries);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
