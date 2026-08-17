/**
 * API 抽象层
 * ----------------------------------------------------------------
 * 当前实现: GitHub Contents API + Personal Access Token (PAT)
 *           作为"伪后端",直接把数据 commit 到仓库,展示页读取渲染
 *
 * 未来部署真后端时:
 *   只需把 SITE_CONFIG.backendApiBase 填上后端地址,
 *   并在 BACKEND.md 描述的接口规范下实现对应 RESTful 端点。
 *   本文件内的 fetch 调用会优先走 backendApiBase,否则回退到 GitHub API。
 *
 * 所有方法均返回 Promise,出错抛出 Error(包含 message 与 status)。
 * ----------------------------------------------------------------
 */
(function () {
    'use strict';

    const cfg = window.SITE_CONFIG;
    const GH_API = 'https://api.github.com';

    // ---------- 工具:读取/保存 PAT ----------
    function getToken() {
        return sessionStorage.getItem(cfg.tokenStorageKey) || '';
    }
    function setToken(token) {
        if (token) {
            sessionStorage.setItem(cfg.tokenStorageKey, token);
        } else {
            sessionStorage.removeItem(cfg.tokenStorageKey);
        }
    }

    // ---------- 工具:Base64 编解码(UTF-8 安全) ----------
    function utf8ToBase64(str) {
        // 处理多字节字符
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        return btoa(binary);
    }
    function base64ToUtf8(b64) {
        const binary = atob(b64.replace(/\n/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    // ---------- 工具:文件转 Base64(用于二进制压缩包上传) ----------
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // result 形如 "data:application/zip;base64,xxxx"
                const b64 = reader.result.split(',')[1];
                resolve(b64);
            };
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(file);
        });
    }

    // ---------- 工具:统一错误处理 ----------
    async function parseError(resp) {
        let msg = `HTTP ${resp.status} ${resp.statusText}`;
        try {
            const data = await resp.json();
            if (data && data.message) msg = `${msg} — ${data.message}`;
        } catch (_) { /* ignore */ }
        const err = new Error(msg);
        err.status = resp.status;
        return err;
    }

    // ================================================================
    //  GitHub Contents API 实现
    // ================================================================

    /**
     * 带超时的 fetch(避免请求挂起导致 UI 永远加载中)
     * @param {string} url
     * @param {object} options
     * @param {number} timeoutMs 超时毫秒,默认 8000
     */
    async function fetchWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * 读取 raw.githubusercontent.com 上的 JSON(只读,无需鉴权,CDN 稳定)
     */
    async function ghGetJsonRaw(path, fallback) {
        const rawUrl = `https://raw.githubusercontent.com/${cfg.github.owner}/${cfg.github.repo}/${cfg.github.branch}/${path}`;
        const resp = await fetchWithTimeout(rawUrl, {}, 10000);
        if (!resp.ok) return fallback;
        return await resp.json();
    }

    /**
     * 读取仓库中某个 JSON 文件,返回解析后的对象
     * 文件不存在时返回 fallback(默认空数组)
     * 策略:先试 api.github.com(带 token 可读最新),超时/失败则回退 raw(CDN 稳定)
     */
    async function ghGetJson(path, fallback) {
        const url = `${GH_API}/repos/${cfg.github.owner}/${cfg.github.repo}/contents/${path}?ref=${cfg.github.branch}`;
        const headers = { Accept: 'application/vnd.github+json' };
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        let resp;
        try {
            resp = await fetchWithTimeout(url, { headers }, 8000);
        } catch (e) {
            // 网络错误或超时 → 回退 raw
            console.warn(`[ghGetJson] api.github.com 失败,回退 raw: ${path}`, e.message);
            return await ghGetJsonRaw(path, fallback);
        }

        if (resp.status === 404) return fallback;
        if (!resp.ok) throw await parseError(resp);

        const data = await resp.json();
        return JSON.parse(base64ToUtf8(data.content));
    }

    /**
     * 读取仓库中某个文本/markdown 文件内容(字符串)
     */
    async function ghGetText(path) {
        const rawUrl = `https://raw.githubusercontent.com/${cfg.github.owner}/${cfg.github.repo}/${cfg.github.branch}/${path}`;
        const resp = await fetchWithTimeout(rawUrl, {}, 10000);
        if (!resp.ok) throw await parseError(resp);
        return await resp.text();
    }

    /**
     * 创建或更新仓库文件(需 token)
     * @param {string} path 仓库内路径
     * @param {string} content 文本内容(UTF-8)
     * @param {string} message commit 信息
     * @param {string|null} sha 已存在文件的 sha(更新时必填),为 null 表示新建
     */
    async function ghPutText(path, content, message, sha) {
        const token = getToken();
        if (!token) throw new Error('未检测到 PAT,请先在管理页登录');

        const url = `${GH_API}/repos/${cfg.github.owner}/${cfg.github.repo}/contents/${path}`;
        const body = {
            message: message,
            content: utf8ToBase64(content),
            branch: cfg.github.branch
        };
        if (sha) body.sha = sha;

        const resp = await fetch(url, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) throw await parseError(resp);
        return await resp.json();
    }

    /**
     * 上传二进制文件(Base64)
     */
    async function ghPutBinary(path, base64Content, message) {
        const token = getToken();
        if (!token) throw new Error('未检测到 PAT,请先在管理页登录');

        const url = `${GH_API}/repos/${cfg.github.owner}/${cfg.github.repo}/contents/${path}`;
        const resp = await fetch(url, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                content: base64Content,
                branch: cfg.github.branch
            })
        });

        if (!resp.ok) throw await parseError(resp);
        return await resp.json();
    }

    /**
     * 删除文件
     */
    async function ghDelete(path, sha, message) {
        const token = getToken();
        if (!token) throw new Error('未检测到 PAT,请先在管理页登录');

        const url = `${GH_API}/repos/${cfg.github.owner}/${cfg.github.repo}/contents/${path}`;
        const resp = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                sha: sha,
                branch: cfg.github.branch
            })
        });

        if (!resp.ok) throw await parseError(resp);
        return await resp.json();
    }

    /**
     * 获取文件元信息(含 sha,用于更新/删除)
     */
    async function ghGetMeta(path) {
        const token = getToken();
        const url = `${GH_API}/repos/${cfg.github.owner}/${cfg.github.repo}/contents/${path}?ref=${cfg.github.branch}`;
        const headers = { Accept: 'application/vnd.github+json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const resp = await fetch(url, { headers });
        if (resp.status === 404) return null;
        if (!resp.ok) throw await parseError(resp);
        return await resp.json();
    }

    // ================================================================
    //  业务接口(对上层暴露)
    //  未来切换真后端:将以下方法内的实现替换为
    //  fetch(`${cfg.backendApiBase}/...`) 即可,
    //  方法签名保持不变,上层无需修改。
    // ================================================================

    const API = {
        // ---- 鉴权 ----
        getToken,
        setToken,
        /**
         * 校验 PAT 是否有效(通过获取仓库信息测试)
         */
        async validateToken(token) {
            const url = `${GH_API}/repos/${cfg.github.owner}/${cfg.github.repo}`;
            let resp;
            try {
                resp = await fetch(url, {
                    headers: {
                        'Accept': 'application/vnd.github+json',
                        'Authorization': `Bearer ${token}`
                    }
                });
            } catch (e) {
                // fetch 本身抛异常 = 网络层错误(被 reset / 代理拦截 / CORS 失败)
                throw new Error('网络错误:无法访问 api.github.com(可能需要配置浏览器代理)' + (e.message ? ' — ' + e.message : ''));
            }
            if (resp.status === 401) throw new Error('PAT 无效或已过期');
            if (resp.status === 404) throw new Error('仓库不存在或 PAT 无仓库读取权限(检查 config.js 中 owner/repo)');
            if (resp.status === 403) throw new Error('PAT 权限不足或触发限流(403)');
            if (!resp.ok) throw await parseError(resp);
            return true;
        },

        // ---- 工程 ----
        listProjects() {
            return ghGetJson(cfg.github.paths.projects, []);
        },
        /**
         * 保存整个 projects.json(覆盖)
         * @param {Array} list 完整列表
         */
        async saveProjects(list) {
            const meta = await ghGetMeta(cfg.github.paths.projects);
            await ghPutText(
                cfg.github.paths.projects,
                JSON.stringify(list, null, 2),
                meta ? 'chore: update projects.json' : 'chore: init projects.json',
                meta ? meta.sha : null
            );
        },
        /**
         * 上传工程压缩包
         * @param {File} file
         * @returns {Promise<string>} 下载路径(相对仓库根)
         */
        async uploadProjectArchive(file) {
            const path = `${cfg.github.paths.uploadsDir}/${Date.now()}-${file.name}`;
            const b64 = await fileToBase64(file);
            await ghPutBinary(path, b64, `upload: ${file.name}`);
            return path;
        },

        // ---- 游戏 ----
        listGames() {
            return ghGetJson(cfg.github.paths.games, []);
        },
        async saveGames(list) {
            const meta = await ghGetMeta(cfg.github.paths.games);
            await ghPutText(
                cfg.github.paths.games,
                JSON.stringify(list, null, 2),
                meta ? 'chore: update games.json' : 'chore: init games.json',
                meta ? meta.sha : null
            );
        },
        async uploadGameBackup(file) {
            const path = `${cfg.github.paths.uploadsDir}/${Date.now()}-${file.name}`;
            const b64 = await fileToBase64(file);
            await ghPutBinary(path, b64, `upload: ${file.name}`);
            return path;
        },

        // ---- 日记 ----
        listDiaries() {
            return ghGetJson(cfg.github.paths.diaries, []);
        },
        async saveDiaries(list) {
            const meta = await ghGetMeta(cfg.github.paths.diaries);
            await ghPutText(
                cfg.github.paths.diaries,
                JSON.stringify(list, null, 2),
                meta ? 'chore: update diaries.json' : 'chore: init diaries.json',
                meta ? meta.sha : null
            );
        },
        /**
         * 上传/保存一篇日记 markdown 文件
         * @param {string} filename 文件名(建议 2026-08-17-xxx.md)
         * @param {string} markdownContent
         */
        async saveDiaryMarkdown(filename, markdownContent) {
            const path = `${cfg.github.paths.diariesDir}/${filename}`;
            const meta = await ghGetMeta(path);
            await ghPutText(
                path,
                markdownContent,
                meta ? `docs: update ${filename}` : `docs: add ${filename}`,
                meta ? meta.sha : null
            );
            return path;
        },
        /**
         * 读取某篇日记 markdown 原文
         */
        getDiaryMarkdown(relativePath) {
            return ghGetText(relativePath);
        },

        // ---- 自定义板块 ----
        listSections() {
            return ghGetJson(cfg.github.paths.sections, []);
        },
        async saveSections(list) {
            const meta = await ghGetMeta(cfg.github.paths.sections);
            await ghPutText(
                cfg.github.paths.sections,
                JSON.stringify(list, null, 2),
                meta ? 'chore: update sections.json' : 'chore: init sections.json',
                meta ? meta.sha : null
            );
        },
        /**
         * 上传板块条目关联文件
         */
        async uploadSectionFile(file) {
            const path = `${cfg.github.paths.uploadsDir}/${Date.now()}-${file.name}`;
            const b64 = await fileToBase64(file);
            await ghPutBinary(path, b64, `upload: ${file.name}`);
            return path;
        },

        // ---- 美化配置 ----
        async getAppearance() {
            try {
                return await ghGetJson(cfg.github.paths.appearance, {
                    globalBackground: { imageUrl: '', color: '#0d1117', opacity: 1 },
                    sectionOrder: ['projects', 'games', 'diaries'],
                    sectionBackgrounds: {}
                });
            } catch (_) {
                return {
                    globalBackground: { imageUrl: '', color: '#0d1117', opacity: 1 },
                    sectionOrder: ['projects', 'games', 'diaries'],
                    sectionBackgrounds: {}
                };
            }
        },
        async saveAppearance(appearance) {
            const meta = await ghGetMeta(cfg.github.paths.appearance);
            await ghPutText(
                cfg.github.paths.appearance,
                JSON.stringify(appearance, null, 2),
                meta ? 'chore: update appearance.json' : 'chore: init appearance.json',
                meta ? meta.sha : null
            );
        },
        /**
         * 上传背景图到 assets/backgrounds/,返回仓库内相对路径
         */
        async uploadBackground(file) {
            const ext = (file.name.split('.').pop() || 'png').toLowerCase();
            const path = `${cfg.github.paths.backgroundsDir}/bg-${Date.now()}.${ext}`;
            const b64 = await fileToBase64(file);
            await ghPutBinary(path, b64, `upload: background ${file.name}`);
            return path;
        },
        /**
         * 获取文件元信息(用于删除)
         */
        async getFileMeta(path) {
            return await ghGetMeta(path);
        },
        /**
         * 删除文件
         */
        async deleteFile(path, sha, message) {
            const url = `${GH_API}/repos/${cfg.github.owner}/${cfg.github.repo}/contents/${path}`;
            const headers = { Accept: 'application/vnd.github+json' };
            const token = getToken();
            if (token) headers.Authorization = `Bearer ${token}`;
            const resp = await fetchWithTimeout(url, {
                method: 'DELETE',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message || `delete: ${path}`, sha })
            }, 15000);
            if (!resp.ok) throw await parseError(resp);
            return true;
        },

        // ---- 工具 ----
        fileToBase64,
        /**
         * 构造文件在 GitHub Pages 上的可访问 raw URL(用于下载)
         */
        rawUrl(relativePath) {
            return `https://raw.githubusercontent.com/${cfg.github.owner}/${cfg.github.repo}/${cfg.github.branch}/${relativePath}`;
        }
    };

    window.API = API;
})();
