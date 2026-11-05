// ==UserScript==
// @name        打字鸭自动打字脚本
// @namespace   https://docs.scriptcat.org/
// @version     1.3.1
// @description 你的作业也忘记提交了吗？快试试这个脚本叭！
// @author      Micropue
// @match       https://www.daziya.com/*
// @icon        https://www.daziya.com/favicon.svg
// @grant       none
// @run-at      document-end
// @noframes
// @license     MIT
// ==/UserScript==

(function () {
    'use strict'

    if (window.PinyinTyper) {
        window.PinyinTyper.destroy()
    }

    // 提前挂住小游戏实例，SPA 切到游戏页时才能直接拿到单词
    function installGameHook() {
        if (window.__pinyinTyperGameHook) return

        window.__pinyinTyperGameHook = true

        const wrap = factory => options => {
            const game = factory(options)

            window.__pinyinTyperDuckGame = game

            return game
        }

        if (typeof window.mountDuckJumpRiverGame === 'function') {
            window.mountDuckJumpRiverGame = wrap(
                window.mountDuckJumpRiverGame
            )
            return
        }

        Object.defineProperty(window, 'mountDuckJumpRiverGame', {
            configurable: true,
            set(factory) {
                Object.defineProperty(
                    window,
                    'mountDuckJumpRiverGame',
                    {
                        configurable: true,
                        writable: true,
                        value: wrap(factory)
                    }
                )
            }
        })
    }

    installGameHook()

    const CONFIG = {
        selector: '.lesson-key-pinyin-code.pinyin-box',
        container: '.lesson-key-stage.pinyin-box-content',

        // 严格匹配换行 SVG
        newlineSelector: 'svg[data-v-d8177754][viewBox="0 0 13 27"]',

        // 空格元素
        spaceSelector: 'span[data-v-d8177754]',

        typingInterval: 100,
        nextInterval: 800,
        changeTimeout: 5000,
        startDelay: 500,

        // 每键总耗时（毫秒）
        defaultKeyInterval: 180,
        // 网站会丢弃 30ms 内同键的 keydown，留点余量
        minKeyInterval: 40,
        speedStorageKey: 'pinyin-typer-speed-v1',

        // 普通按键间隔
        keyDownDelay: 40,
        keyPressDelay: 40,

        // Enter 按键后等待网页响应的时间
        enterWait: 350,

        timerStorageKey: 'pinyin-typer-timer-v2'
    }

    // ==============================
    // 拼音映射
    // ==============================

    const pinyinMap = {
        'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
        'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
        'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
        'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
        'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
        'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v',
        'ü': 'v'
    }

    const punctuationMap = {
        '，': ',',
        '。': '.',
        '！': '!',
        '？': '?',
        '；': ';',
        '：': ':',
        '“': '"',
        '”': '"',
        '‘': "'",
        '’': "'",
        '（': '(',
        '）': ')',
        '【': '[',
        '】': ']',
        '《': '<',
        '》': '>',
        '—': '-'
    }

    const allowedChars =
        /^[a-zA-Z0-9,.!?;:'"()[\]{}<>_、…·\-]$/

    // waitForNextContent 用这个标记表示“下一页是小游戏”
    const GAME_CONTENT = '\u0000__GAME__'

    // 这些字符需要按住 Shift
    const shiftChars = new Set([
        '!', '?', ':', '"', '(', ')', '_', '<', '>', '{', '}',
        '…', '·'
    ])

    function convert(text) {
        return [...text]
            .map(char => {
                const lower = char.toLowerCase()
                const base = pinyinMap[lower]

                // 保留大写：Ǒ -> O，Ü -> V
                if (base) {
                    return char === lower
                        ? base
                        : base.toUpperCase()
                }

                return punctuationMap[char] ?? char
            })
            .filter(char => allowedChars.test(char))
            .join('')
    }

    // ==============================
    // 内容提取
    // ==============================

    function getContent() {
        const container = document.querySelector(CONFIG.container)

        if (!container) {
            console.warn('[PinyinTyper] 找不到练习容器')
            return ''
        }

        const result = []

        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode(node) {
                    // 拼音元素
                    if (node.matches(CONFIG.selector)) {
                        return NodeFilter.FILTER_ACCEPT
                    }

                    // 换行 SVG
                    if (node.matches(CONFIG.newlineSelector)) {
                        return NodeFilter.FILTER_ACCEPT
                    }

                    // 空格元素
                    if (
                        node.matches(CONFIG.spaceSelector) &&
                        node.textContent === ' '
                    ) {
                        return NodeFilter.FILTER_ACCEPT
                    }

                    // 不能使用 FILTER_REJECT
                    // 否则会连同子元素一起跳过
                    return NodeFilter.FILTER_SKIP
                }
            }
        )

        let node

        while ((node = walker.nextNode())) {
            if (node.matches(CONFIG.newlineSelector)) {
                result.push('\n')
                continue
            }

            // 先判断拼音框，避免空格框被下面的空格分支
            // 和它内部的空格 span 各算一次
            if (node.matches(CONFIG.selector)) {
                const converted = convert(node.textContent)

                if (converted) {
                    result.push(converted)
                }

                continue
            }

            if (
                node.matches(CONFIG.spaceSelector) &&
                node.textContent === ' '
            ) {
                result.push(' ')
            }
        }

        return result.join('')
    }

    // 从 Nuxt 数据里读小游戏的单词表
    function readGameWords() {
        const dataScript = document.querySelector('#__NUXT_DATA__')

        if (!dataScript) return []

        let data

        try {
            data = JSON.parse(dataScript.textContent)
        } catch {
            return []
        }

        if (!Array.isArray(data)) return []

        const resolveText = (value, depth = 0) => {
            if (depth > 4) return ''
            if (typeof value === 'string') return value
            if (typeof value === 'number') {
                return resolveText(data[value], depth + 1)
            }
            if (Array.isArray(value)) {
                return value
                    .map(item => resolveText(item, depth + 1))
                    .filter(Boolean)
                    .join(' ')
            }
            return ''
        }

        const isGameText = text =>
            text &&
            !/[\u4e00-\u9fff]/.test(text) &&
            /^[\x20-\x7E]+$/.test(text)

        for (const item of data) {
            if (
                !item ||
                typeof item !== 'object' ||
                Array.isArray(item) ||
                !('contentType' in item) ||
                !('text' in item)
            ) {
                continue
            }

            const text = resolveText(item.text).trim()

            if (isGameText(text)) {
                return text.split(/\s+/).filter(Boolean)
            }
        }

        // 兜底：找最长的一串纯英文单词
        const candidates = data
            .filter(item =>
                typeof item === 'string' &&
                item.includes(' ') &&
                /^[\x20-\x7E]+$/.test(item)
            )
            .sort((a, b) => b.length - a.length)

        return candidates.length
            ? candidates[0].trim().split(/\s+/).filter(Boolean)
            : []
    }

    function isGamePage() {
        return !!document.querySelector(
            '.duck-jump-runtime canvas'
        )
    }

    // ==============================
    // 键盘事件
    // ==============================

    const keyCodeMap = {
        ' ': { keyCode: 32, code: 'Space' },
        ',': { keyCode: 188, code: 'Comma' },
        '.': { keyCode: 190, code: 'Period' },
        '/': { keyCode: 191, code: 'Slash' },
        ';': { keyCode: 186, code: 'Semicolon' },
        "'": { keyCode: 222, code: 'Quote' },
        '[': { keyCode: 219, code: 'BracketLeft' },
        ']': { keyCode: 221, code: 'BracketRight' },
        '{': { keyCode: 219, code: 'BracketLeft' },
        '}': { keyCode: 221, code: 'BracketRight' },
        '、': { keyCode: 220, code: 'Backslash' },
        '·': { keyCode: 192, code: 'Backquote' },
        '…': { keyCode: 54, code: 'Digit6' },
        '-': { keyCode: 189, code: 'Minus' },
        '_': { keyCode: 189, code: 'Minus' },
        '=': { keyCode: 187, code: 'Equal' },
        '<': { keyCode: 188, code: 'Comma' },
        '>': { keyCode: 190, code: 'Period' },
        '(': { keyCode: 57, code: 'Digit9' },
        ')': { keyCode: 48, code: 'Digit0' },
        '!': { keyCode: 49, code: 'Digit1' },
        '?': { keyCode: 191, code: 'Slash' },
        ':': { keyCode: 186, code: 'Semicolon' },
        '"': { keyCode: 222, code: 'Quote' }
    }

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms))

    function createKeyboardEvent(type, options) {
        return new KeyboardEvent(type, {
            ...options,
            bubbles: true,
            cancelable: true,
            composed: true
        })
    }

    function getKeyTarget() {
        // 不要用 activeElement：点过“开始运行”后它是 button，
        // 网站会忽略落在 button 上的 Enter/空格
        return document.querySelector(CONFIG.container) || document.body
    }

    // 普通按键：按下 -> 按住 -> 松开
    async function dispatchKey(char) {
        const target = getKeyTarget()
        const upper = char.toUpperCase()

        const info = keyCodeMap[char] || {
            keyCode: char.length === 1
                ? char.toUpperCase().charCodeAt(0)
                : 0,
            code: /^[a-z]$/i.test(char)
                ? `Key${upper}`
                : ''
        }

        const options = {
            key: char,
            code: info.code,
            keyCode: info.keyCode,
            which: info.keyCode,
            charCode: char.charCodeAt(0),
            shiftKey: shiftChars.has(char) || /^[A-Z]$/.test(char)
        }

        target.dispatchEvent(
            createKeyboardEvent('keydown', options)
        )

        await sleep(CONFIG.keyDownDelay)

        target.dispatchEvent(
            createKeyboardEvent('keypress', options)
        )

        await sleep(CONFIG.keyPressDelay)

        target.dispatchEvent(
            createKeyboardEvent('keyup', options)
        )
    }

    // Enter：只发送 keydown 和 keyup
    // 不发送 keypress，避免部分网页重复处理
    async function dispatchEnter() {
        const target = getKeyTarget()

        const options = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            charCode: 0
        }

        target.dispatchEvent(
            createKeyboardEvent('keydown', options)
        )

        await sleep(CONFIG.keyDownDelay)

        target.dispatchEvent(
            createKeyboardEvent('keyup', options)
        )

        // 等待网页完成换行处理
        await sleep(CONFIG.enterWait)
    }

    // 小游戏只要 keydown，不需要键程
    function dispatchGameKey(char) {
        const upper = char.toUpperCase()
        const info = keyCodeMap[char] || {
            keyCode: char.length === 1
                ? upper.charCodeAt(0)
                : 0,
            code: /^[a-z]$/i.test(char)
                ? `Key${upper}`
                : ''
        }

        const options = {
            key: char,
            code: info.code,
            keyCode: info.keyCode,
            which: info.keyCode,
            charCode: char.charCodeAt(0),
            shiftKey: shiftChars.has(char) || /^[A-Z]$/.test(char)
        }

        window.dispatchEvent(
            createKeyboardEvent('keydown', options)
        )

        window.dispatchEvent(
            createKeyboardEvent('keyup', options)
        )
    }

    // ==============================
    // 全局计时器
    // ==============================

    function loadTimer() {
        try {
            const saved = JSON.parse(
                localStorage.getItem(CONFIG.timerStorageKey)
            )

            return {
                elapsed: Math.max(0, Number(saved?.elapsed) || 0),
                startedAt: Number(saved?.startedAt) || null,
                running: Boolean(saved?.running && saved?.startedAt)
            }
        } catch {
            return {
                elapsed: 0,
                startedAt: null,
                running: false
            }
        }
    }

    const timer = loadTimer()

    function getElapsed() {
        if (!timer.running || !timer.startedAt) {
            return timer.elapsed
        }

        return timer.elapsed + (
            Date.now() - timer.startedAt
        )
    }

    function saveTimer() {
        try {
            localStorage.setItem(
                CONFIG.timerStorageKey,
                JSON.stringify({
                    elapsed: getElapsed(),
                    startedAt: timer.running ? Date.now() : null,
                    running: timer.running
                })
            )
        } catch (error) {
            console.warn('[PinyinTyper] 计时器保存失败', error)
        }
    }

    function startTimer() {
        if (timer.running) return

        timer.running = true
        timer.startedAt = Date.now()

        saveTimer()
        updateTimerUI()
    }

    function pauseTimer() {
        if (!timer.running) return

        timer.elapsed = getElapsed()
        timer.running = false
        timer.startedAt = null

        saveTimer()
        updateTimerUI()
    }

    function resetTimer() {
        timer.elapsed = 0
        timer.running = false
        timer.startedAt = null

        saveTimer()
        updateTimerUI()
    }

    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000)

        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60

        return [
            String(hours).padStart(2, '0'),
            String(minutes).padStart(2, '0'),
            String(seconds).padStart(2, '0')
        ].join(':')
    }

    // ==============================
    // 创建悬浮面板
    // ==============================

    const panel = document.createElement('div')

    panel.id = 'pinyin-typer-panel'

    panel.innerHTML = `
        <div class="pt-header">
            <div class="pt-title">
                <span class="pt-dot"></span>
                Pinyin Typer
            </div>
            <button class="pt-close" title="隐藏面板">×</button>
        </div>

        <div class="pt-status">
            <span>运行状态</span>
            <strong class="pt-state">已停止</strong>
        </div>

        <div class="pt-speed">
            <div class="pt-speed-heading">
                <label>每键间隔</label>
                <span class="pt-speed-value">180 ms</span>
            </div>

            <input
                class="pt-speed-input"
                type="number"
                min="0"
                max="60000"
                step="10"
                value="180"
                inputmode="numeric"
            >

            <div class="pt-speed-hint">
                最小 40 ms（再快网站会漏键），数值越大越慢
            </div>
        </div>

        <div class="pt-timer">
            <div class="pt-timer-heading">
                <label>累计练习时间</label>
                <span class="pt-timer-status">已暂停</span>
            </div>

            <div class="pt-timer-value">00:00:00</div>

            <div class="pt-timer-actions">
                <button class="pt-timer-reset">重置计时</button>
            </div>
        </div>

        <div class="pt-progress">
            <div class="pt-progress-bar"></div>
        </div>

        <div class="pt-info">
            <div>
                <label>当前字符</label>
                <strong class="pt-current">-</strong>
            </div>
            <div>
                <label>剩余字符</label>
                <strong class="pt-remaining">0</strong>
            </div>
        </div>

        <div class="pt-preview">
            <label>当前输入内容</label>
            <div class="pt-content">等待开始...</div>
        </div>

        <div class="pt-actions">
            <button class="pt-start">开始运行</button>
            <button class="pt-reset">重置</button>
        </div>

        <div class="pt-footer">
            Pinyin Typer · Browser Script
        </div>
    `

    const style = document.createElement('style')

    style.textContent = `
        #pinyin-typer-panel {
            position: fixed;
            right: 24px;
            bottom: 24px;
            width: 310px;
            padding: 18px;
            z-index: 999999;
            background: rgba(20, 24, 32, .97);
            color: #fff;
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 16px;
            box-shadow: 0 12px 50px rgba(0,0,0,.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 13px;
            backdrop-filter: blur(20px);
        }

        #pinyin-typer-panel * {
            box-sizing: border-box;
        }

        #pinyin-typer-panel button {
            border: 0;
            cursor: pointer;
            font: inherit;
        }

        #pinyin-typer-panel .pt-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 18px;
        }

        #pinyin-typer-panel .pt-title {
            font-size: 15px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 9px;
        }

        #pinyin-typer-panel .pt-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #777;
        }

        #pinyin-typer-panel.active .pt-dot {
            background: #35d99a;
            box-shadow: 0 0 12px #35d99a;
        }

        #pinyin-typer-panel .pt-close {
            background: transparent;
            color: #888;
            font-size: 23px;
        }

        #pinyin-typer-panel .pt-status {
            display: flex;
            justify-content: space-between;
            color: #999;
            margin-bottom: 12px;
        }

        #pinyin-typer-panel .pt-state {
            color: #aaa;
        }

        #pinyin-typer-panel.active .pt-state {
            color: #35d99a;
        }

        #pinyin-typer-panel .pt-speed {
            padding: 12px;
            margin-bottom: 18px;
            background: rgba(255,255,255,.055);
            border: 1px solid rgba(255,255,255,.07);
            border-radius: 12px;
        }

        #pinyin-typer-panel .pt-speed-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        #pinyin-typer-panel .pt-speed-heading label {
            margin: 0;
        }

        #pinyin-typer-panel .pt-speed-value {
            color: #35d99a;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
        }

        #pinyin-typer-panel .pt-speed-input {
            width: 100%;
            margin-top: 8px;
            padding: 8px 10px;
            background: #242a35;
            color: #fff;
            border: 1px solid rgba(255,255,255,.1);
            border-radius: 8px;
            font: inherit;
            font-variant-numeric: tabular-nums;
        }

        #pinyin-typer-panel .pt-speed-hint {
            margin-top: 6px;
            color: #656d7c;
            font-size: 10px;
        }

        #pinyin-typer-panel .pt-timer {
            padding: 15px;
            margin-bottom: 18px;
            background: rgba(255,255,255,.055);
            border: 1px solid rgba(255,255,255,.07);
            border-radius: 12px;
        }

        #pinyin-typer-panel .pt-timer-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        #pinyin-typer-panel .pt-timer-heading label {
            margin: 0;
        }

        #pinyin-typer-panel .pt-timer-status {
            font-size: 11px;
            color: #9299a8;
        }

        #pinyin-typer-panel .pt-timer.running .pt-timer-status {
            color: #35d99a;
        }

        #pinyin-typer-panel .pt-timer-value {
            font-size: 30px;
            font-weight: 700;
            letter-spacing: 2px;
            font-variant-numeric: tabular-nums;
            margin: 10px 0;
            color: #fff;
        }

        #pinyin-typer-panel .pt-timer-actions {
            display: flex;
            justify-content: flex-end;
        }

        #pinyin-typer-panel .pt-timer-reset {
            background: transparent;
            color: #9299a8;
            font-size: 11px;
            padding: 4px 0;
        }

        #pinyin-typer-panel .pt-progress {
            height: 5px;
            background: #343945;
            border-radius: 10px;
            overflow: hidden;
            margin-bottom: 18px;
        }

        #pinyin-typer-panel .pt-progress-bar {
            width: 0;
            height: 100%;
            background: #35d99a;
            transition: width .15s;
        }

        #pinyin-typer-panel .pt-info {
            display: flex;
            gap: 12px;
            margin-bottom: 18px;
        }

        #pinyin-typer-panel .pt-info > div {
            flex: 1;
            padding: 12px;
            background: rgba(255,255,255,.06);
            border-radius: 10px;
        }

        #pinyin-typer-panel label {
            display: block;
            color: #9299a8;
            font-size: 11px;
            margin-bottom: 8px;
        }

        #pinyin-typer-panel .pt-info strong {
            font-size: 22px;
        }

        #pinyin-typer-panel .pt-current {
            color: #35d99a;
        }

        #pinyin-typer-panel .pt-preview {
            padding: 12px;
            background: rgba(255,255,255,.045);
            border-radius: 10px;
            margin-bottom: 16px;
        }

        #pinyin-typer-panel .pt-content {
            color: #d9deea;
            line-height: 1.7;
            word-break: break-all;
            max-height: 100px;
            overflow: auto;
            white-space: pre-wrap;
        }

        #pinyin-typer-panel .pt-actions {
            display: flex;
            gap: 10px;
        }

        #pinyin-typer-panel .pt-actions button {
            flex: 1;
            padding: 11px;
            border-radius: 9px;
            font-weight: 600;
        }

        #pinyin-typer-panel .pt-start {
            background: #35d99a;
            color: #10251e;
        }

        #pinyin-typer-panel .pt-reset {
            background: #343945;
            color: #fff;
        }

        #pinyin-typer-panel .pt-footer {
            text-align: center;
            color: #656d7c;
            font-size: 10px;
            margin-top: 14px;
        }

        #pinyin-typer-panel.pt-hidden {
            display: none;
        }

        #pinyin-typer-reopen {
            position: fixed;
            right: 24px;
            bottom: 24px;
            z-index: 999998;
            display: none;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
            padding: 0;
            border: 1px solid rgba(255,255,255,.18);
            border-radius: 50%;
            background: rgba(20,24,32,.72);
            color: #35d99a;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            opacity: .55;
            box-shadow: 0 6px 24px rgba(0,0,0,.25);
            backdrop-filter: blur(12px);
            transition: opacity .15s, transform .15s;
        }

        #pinyin-typer-reopen.show {
            display: flex;
        }

        #pinyin-typer-reopen:hover {
            opacity: 1;
            transform: scale(1.05);
        }
    `

    document.head.appendChild(style)
    document.body.appendChild(panel)

    const reopenBtn = document.createElement('button')

    reopenBtn.id = 'pinyin-typer-reopen'
    reopenBtn.type = 'button'
    reopenBtn.title = '打开 Pinyin Typer'
    reopenBtn.setAttribute('aria-label', '打开 Pinyin Typer 面板')
    reopenBtn.textContent = '鸭'

    document.body.appendChild(reopenBtn)

    function hidePanel() {
        panel.classList.add('pt-hidden')
        reopenBtn.classList.add('show')
    }

    function showPanel() {
        panel.classList.remove('pt-hidden')
        reopenBtn.classList.remove('show')
    }

    reopenBtn.addEventListener('click', showPanel)

    // ==============================
    // 面板元素
    // ==============================

    const $ = selector => panel.querySelector(selector)

    const stateEl = $('.pt-state')
    const currentEl = $('.pt-current')
    const remainingEl = $('.pt-remaining')
    const contentEl = $('.pt-content')
    const progressEl = $('.pt-progress-bar')
    const startBtn = $('.pt-start')

    const timerEl = $('.pt-timer')
    const timerValueEl = $('.pt-timer-value')
    const timerStatusEl = $('.pt-timer-status')

    const speedInput = $('.pt-speed-input')
    const speedValueEl = $('.pt-speed-value')

    let running = false
    let destroyed = false
    let timerInterval = null

    function loadSpeed() {
        try {
            const raw = localStorage.getItem(
                CONFIG.speedStorageKey
            )

            if (raw === null) {
                return CONFIG.defaultKeyInterval
            }

            const saved = Number(raw)

            return Number.isFinite(saved) && saved >= 0
                ? saved
                : CONFIG.defaultKeyInterval
        } catch {
            return CONFIG.defaultKeyInterval
        }
    }

    function applySpeed(value) {
        let interval = Math.round(Number(value))

        if (!Number.isFinite(interval) || interval < 0) {
            interval = 0
        }

        interval = Math.max(
            CONFIG.minKeyInterval,
            Math.min(interval, 60000)
        )

        const hold = Math.min(40, Math.floor(interval / 3))

        CONFIG.typingInterval = Math.max(0, interval - hold * 2)
        CONFIG.keyDownDelay = hold
        CONFIG.keyPressDelay = hold

        speedInput.value = interval
        speedValueEl.textContent = `${interval} ms`

        try {
            localStorage.setItem(
                CONFIG.speedStorageKey,
                String(interval)
            )
        } catch {}
    }

    speedInput.addEventListener('change', () => {
        applySpeed(speedInput.value)
    })

    applySpeed(loadSpeed())

    // 用于防止旧任务干扰新任务
    let runGeneration = 0

    // ==============================
    // UI 更新
    // ==============================

    function updateUI(status) {
        panel.classList.toggle('active', running)

        stateEl.textContent = status ||
            (running ? '运行中' : '已停止')

        startBtn.textContent = running
            ? '暂停运行'
            : '开始运行'
    }

    function updateProgress(index, total, char) {
        currentEl.textContent = char === '\n'
            ? '换行 ↵'
            : char === ' '
                ? '空格'
                : char || '-'

        remainingEl.textContent = Math.max(
            0,
            total - index - 1
        )

        const progress = total
            ? ((index + 1) / total) * 100
            : 0

        progressEl.style.width = `${progress}%`
    }

    function updateTimerUI() {
        timerValueEl.textContent = formatTime(getElapsed())

        timerEl.classList.toggle('running', timer.running)

        timerStatusEl.textContent = timer.running
            ? '● 计时中'
            : '已暂停'
    }

    timerInterval = setInterval(() => {
        if (destroyed) return
        updateTimerUI()
    }, 250)

    // ==============================
    // 等待下一段内容
    // ==============================

    async function waitForNextContent(previous, generation) {
        const startTime = Date.now()

        while (
            running &&
            generation === runGeneration &&
            Date.now() - startTime < CONFIG.changeTimeout
        ) {
            await sleep(200)

            if (!running || generation !== runGeneration) {
                return ''
            }

            const next = getContent()

            if (next && next !== previous) {
                return next
            }

            if (isGamePage()) {
                return GAME_CONTENT
            }
        }

        return ''
    }

    // ==============================
    // 小游戏
    // ==============================

    async function completeDuckGameInstance(game, generation) {
        console.log('[PinyinTyper] 小游戏实例单词:', game.words)

        if (game.gameState === 'START') {
            game.startGame()
        }

        await sleep(500)

        const words = [...game.words]

        for (let i = 0; i < words.length; i++) {
            const word = words[i]

            while (
                game.currentWordIndex === i &&
                game.currentCharIndex < word.length &&
                running &&
                generation === runGeneration
            ) {
                game.checkCharacter(
                    word[game.currentCharIndex]
                )
                await sleep(10)
            }

            if (!running || generation !== runGeneration) {
                return false
            }

            await sleep(250)
        }

        // 等游戏自己完成最后一跳，别抢在它前面 endGame
        for (let i = 0; i < 40; i++) {
            if (game.gameState === 'END') break
            await sleep(200)
        }

        if (game.gameState !== 'END') {
            game.endGame()
            await sleep(300)
        }

        game.postMessageToHost(
            'onComplete',
            game.lastGameResult || {}
        )

        for (let i = 0; i < 30; i++) {
            await sleep(200)

            if (!running || generation !== runGeneration) {
                return false
            }

            if (!isGamePage()) {
                return true
            }
        }

        return false
    }

    async function completeDuckGame(generation) {
        const game = window.__pinyinTyperDuckGame

        if (
            game &&
            !game.destroyed &&
            Array.isArray(game.words) &&
            game.words.length
        ) {
            return completeDuckGameInstance(game, generation)
        }

        const canvas = document.querySelector(
            '.duck-jump-runtime canvas'
        )

        if (!canvas) return false

        const words = readGameWords()

        if (!words.length) {
            console.warn('[PinyinTyper] 小游戏单词读取失败')
            return false
        }

        console.log('[PinyinTyper] 小游戏单词:', words)

        // 等游戏挂好键盘监听
        await sleep(500)

        // 开始游戏（空格）
        dispatchGameKey(' ')
        await sleep(1500)

        for (const word of words) {
            if (!running || generation !== runGeneration) {
                return false
            }

            for (const char of word) {
                dispatchGameKey(char)
                await sleep(15)
            }

            // 游戏内部换词有 200ms 延迟
            await sleep(300)
        }

        // 等结算弹窗
        await sleep(3000)

        const rect = canvas.getBoundingClientRect()

        if (!rect.width || !rect.height) return false

        const clickX = rect.left +
            (canvas.width / 2 + 126) /
            canvas.width * rect.width

        const clickY = rect.top +
            (canvas.height / 2 + 142) /
            canvas.height * rect.height

        // 点“继续学习”
        for (let i = 0; i < 10; i++) {
            if (!running || generation !== runGeneration) {
                return false
            }

            canvas.dispatchEvent(new PointerEvent(
                'pointerdown',
                {
                    clientX: clickX,
                    clientY: clickY,
                    bubbles: true,
                    cancelable: true,
                    pointerType: 'mouse',
                    button: 0
                }
            ))

            await sleep(400)

            if (!isGamePage()) {
                return true
            }
        }

        return false
    }

    async function handleGame(generation) {
        if (!isGamePage()) return ''

        updateUI('自动完成小游戏')

        const done = await completeDuckGame(generation)

        if (!running || generation !== runGeneration) {
            return ''
        }

        if (!done) {
            console.warn('[PinyinTyper] 小游戏没有完成')
            return ''
        }

        console.log('[PinyinTyper] 小游戏完成，等待下一课')

        return waitForNextContent('', generation)
    }

    // ==============================
    // 主运行逻辑
    // ==============================

    async function run() {
        if (running || destroyed) return

        // 开始前再同步一次输入框，防止只改数字没触发 change
        applySpeed(speedInput.value)

        running = true

        const generation = ++runGeneration

        startTimer()
        updateUI()

        try {
            await sleep(CONFIG.startDelay)

            while (running && generation === runGeneration) {
                let content = getContent()

                // 小游戏页没有拼音内容，先自动完成
                while (
                    (!content || content === GAME_CONTENT) &&
                    isGamePage() &&
                    running &&
                    generation === runGeneration
                ) {
                    content = await handleGame(generation)
                }

                if (!running || generation !== runGeneration) {
                    break
                }

                if (!content) {
                    updateUI('未找到内容')
                    break
                }

                updateUI()
                contentEl.textContent = content

                console.log(
                    '[PinyinTyper] 当前内容:',
                    JSON.stringify(content)
                )

                for (let i = 0; i < content.length; i++) {
                    if (!running || generation !== runGeneration) {
                        break
                    }

                    const char = content[i]

                    updateProgress(i, content.length, char)

                    if (char === '\n') {
                        console.log(
                            `[PinyinTyper] 第 ${i + 1} 个字符：换行`
                        )

                        await dispatchEnter()

                    } else {
                        await dispatchKey(char)
                    }

                    if (!running || generation !== runGeneration) {
                        break
                    }

                    await sleep(CONFIG.typingInterval)
                }

                if (!running || generation !== runGeneration) {
                    break
                }

                currentEl.textContent = 'Enter'
                remainingEl.textContent = '0'

                await sleep(200)

                if (!running || generation !== runGeneration) {
                    break
                }

                // 如果最后一个字符已经是换行标记，
                // 就不再重复发送 Enter
                if (!content.endsWith('\n')) {
                    console.log('[PinyinTyper] 整段结束，发送 Enter')

                    await dispatchEnter()
                } else {
                    console.log('[PinyinTyper] 内容已包含末尾换行，跳过额外 Enter')
                }

                await sleep(CONFIG.nextInterval)

                if (!running || generation !== runGeneration) {
                    break
                }

                let nextContent = await waitForNextContent(
                    content,
                    generation
                )

                // 下一页可能是小游戏，完成后再等真正的下一课
                while (
                    nextContent === GAME_CONTENT &&
                    running &&
                    generation === runGeneration
                ) {
                    nextContent = await handleGame(generation)
                }

                if (!running || generation !== runGeneration) {
                    break
                }

                if (!nextContent) {
                    updateUI('等待超时')

                    console.warn(
                        '[PinyinTyper] 页面内容没有更新，已停止。',
                        {
                            previousContent: content,
                            currentContent: getContent()
                        }
                    )

                    break
                }

                console.log(
                    '[PinyinTyper] 下一段:',
                    nextContent
                )
            }
        } catch (error) {
            console.error('[PinyinTyper] 运行错误:', error)
            updateUI('发生错误')
        } finally {
            // 只有当前任务可以修改运行状态
            if (generation === runGeneration) {
                running = false
                pauseTimer()
                updateUI()
            }
        }
    }

    // ==============================
    // 停止与重置
    // ==============================

    function stop() {
        runGeneration++
        running = false

        pauseTimer()
        updateUI()
    }

    function reset() {
        stop()

        currentEl.textContent = '-'
        remainingEl.textContent = '0'
        contentEl.textContent = '等待开始...'
        progressEl.style.width = '0'

        resetTimer()
    }

    function destroy() {
        stop()

        destroyed = true

        clearInterval(timerInterval)

        panel.remove()
        style.remove()
        reopenBtn.remove()

        delete window.PinyinTyper
    }

    // ==============================
    // 事件绑定
    // ==============================

    startBtn.addEventListener('click', () => {
        if (running) {
            stop()
        } else {
            run()
        }
    })

    $('.pt-reset').addEventListener('click', reset)

    $('.pt-close').addEventListener('click', hidePanel)

    $('.pt-timer-reset').addEventListener('click', () => {
        resetTimer()
    })

    // ==============================
    // 暴露 API
    // ==============================

    window.PinyinTyper = {
        start: run,
        stop,
        reset,
        destroy,

        getContent,
        convert,

        getElapsed,

        startTimer,
        pauseTimer,
        resetTimer,

        get running() {
            return running
        },

        get timerRunning() {
            return timer.running
        }
    }

    console.log('[PinyinTyper] 已安装')
    console.log('开始：PinyinTyper.start()')
    console.log('停止：PinyinTyper.stop()')
    console.log('读取内容：PinyinTyper.getContent()')
    console.log('累计时间：PinyinTyper.getElapsed()')
    console.log('重置计时：PinyinTyper.resetTimer()')
    console.log('卸载：PinyinTyper.destroy()')

    updateUI()
    updateTimerUI()
})()