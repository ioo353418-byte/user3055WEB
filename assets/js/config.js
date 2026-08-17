/**
 * 全局配置文件
 * 修改此文件即可调整展示页与管理页的公共信息
 */
window.SITE_CONFIG = {
    // 开发者名称 / 页面名称(展示页头部展示)
    developerName: 'user3055WEB',
    siteTitle: 'user3055WEB · 个人空间',
    siteSubtitle: '工程 · 游戏 · 日记',

    // 底部联系方式(展示页页脚展示)
    contact: {
        github: {
            label: 'GitHub',
            url: 'https://github.com/ioo353418-byte/user3055WEB',
            text: '@ioo353418-byte'
        },
        email: {
            label: '邮箱',
            address: '2253353993@qq.com'
        },
        wechat: {
            label: 'QQ',
            text: '3055767827'
        }
    },

    // GitHub 仓库配置(管理页通过此配置 + PAT 访问 Contents API)
    // 默认从当前域名推断,也可手动覆盖
    github: {
        owner: 'ioo353418-byte',       // 仓库所有者用户名
        repo: 'user3055WEB',           // 仓库名
        branch: 'main',                // 默认分支
        // 数据文件路径(相对于仓库根)
        paths: {
            projects: 'data/projects.json',
            games: 'data/games.json',
            diaries: 'data/diaries.json',
            diariesDir: 'data/diaries',
            uploadsDir: 'data/uploads'
        }
    },

    // 后端 API 基址(预留:未来部署真后端时填写)
    // 留空则使用 GitHub Contents API 作为伪后端
    backendApiBase: '',

    // 管理页 token 在 sessionStorage 中的存储键
    tokenStorageKey: 'github_pat_session',

    // 管理页加密保险库在 localStorage 中的存储键(用于"密码解锁"功能)
    adminVaultKey: 'user3055web_admin_vault'
};
