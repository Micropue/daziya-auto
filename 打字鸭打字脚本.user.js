// ==UserScript==
// @name        打字鸭自动打字脚本
// @namespace   https://docs.scriptcat.org/
// @version     1.4.4
// @description 自动完成拼音、英文、单词、数字、双拼、五笔、中文练习和小游戏
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

        // 面板里的平均输入速度，单位：字/分钟
        defaultSpeed: 300,
        minSpeed: 30,
        maxSpeed: 1500,
        // 网站会丢弃 30ms 内同键的 keydown，留点余量
        minKeyInterval: 40,
        speedStorageKey: 'pinyin-typer-speed-v2',
        legacySpeedStorageKey: 'pinyin-typer-speed-v1',

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

    // waitForNextContent 用这个标记表示“下一页不是拼音练习”
    const NEXT_PAGE = '\u0000__NEXT_PAGE__'

    // 这些字符需要按住 Shift
    const shiftChars = new Set([
        '!', '@', '#', '$', '%', '^', '&', '*', '+',
        '?', ':', '"', '(', ')', '_', '<', '>', '{', '}',
        '|', '~', '…', '·'
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
    // 练习类型识别
    // ==============================

    function findNextButton() {
        const texts = [
            '下一步', '继续', '开始学习', '开始练习',
            '完成', '下一关', '下一课'
        ]

        return [...document.querySelectorAll(
            'button, [role="button"]'
        )].find(button => {
            if (
                !button ||
                button.disabled ||
                button.offsetParent === null ||
                button.closest('#pinyin-typer-panel')
            ) {
                return false
            }

            const text = (
                button.innerText ||
                button.textContent ||
                ''
            ).trim()

            return texts.some(item =>
                text === item || text.startsWith(item)
            )
        }) || null
    }

    function detectLessonMode() {
        if (isGamePage()) return 'game'

        if (document.querySelector(
            '.lesson-key-stage.pinyin-box-content'
        )) {
            return 'pinyin'
        }

        if (
            document.querySelector('.chinese-v2-input-source') ||
            document.querySelector('.chinese-box-input')
        ) {
            return 'chinese'
        }

        if (document.querySelector('.vocabulary-box-letter')) {
            return 'vocabulary'
        }

        if (document.querySelector(
            '.test-box-content .test-box-item'
        )) {
            return 'token'
        }

        if (document.querySelector('.shuangpin-box-content')) {
            return 'shuangpin'
        }

        if (document.querySelector('.wubi-stage')) {
            return 'wubi'
        }

        if (readActiveKey() || findNextButton()) {
            return 'instruction'
        }

        return 'unknown'
    }

    function lessonSignature() {
        return [
            location.href,
            document.title,
            detectLessonMode()
        ].join('|')
    }

    function readActiveKey() {
        const active = document.querySelector('.key--active')

        if (active) {
            const letter = active.querySelector(
                '.key__letter, .key__sp-letter'
            )
            const text = (
                letter ? letter.textContent : active.textContent
            ).trim()

            if (text) return text
        }

        const wubiKey = document.querySelector(
            '.wubi-keyboard__key--active'
        )

        if (wubiKey) {
            const label = wubiKey.getAttribute('aria-label') || ''
            const match = label.match(/^([A-Za-z0-9])\s*键/)

            if (match) return match[1]
        }

        const wubiCell = document.querySelector(
            '.wubi-breakdown__practice-cell.is-active'
        )

        if (wubiCell) {
            const text = wubiCell.textContent.trim()

            if (text) return text
        }

        const numpadKey = document.querySelector(
            '.numpad-key--active'
        )

        if (numpadKey) {
            const text = numpadKey.textContent.trim()

            if (text) return text
        }

        return ''
    }

    function readActiveTarget() {
        const token = document.querySelector(
            '.test-box-item__active'
        )

        if (token) {
            return {
                char: token.textContent === '\u00a0'
                    ? ' '
                    : token.textContent,
                kind: 'token'
            }
        }

        const letter = document.querySelector(
            '.vocabulary-box-letter__active'
        )

        if (letter) {
            return {
                char: letter.textContent,
                kind: 'vocabulary'
            }
        }

        return null
    }

    function activeTargetSignature() {
        const token = document.querySelector(
            '.test-box-item__active'
        )

        if (token) {
            const all = [...document.querySelectorAll(
                '.test-box-item'
            )]

            return `token:${all.indexOf(token)}:${token.textContent}`
        }

        const letter = document.querySelector(
            '.vocabulary-box-letter__active'
        )

        if (letter) {
            const all = [...document.querySelectorAll(
                '.vocabulary-box-letter'
            )]

            return `vocabulary:${all.indexOf(letter)}:${letter.textContent}`
        }

        return ''
    }

    function isNumpadLesson() {
        return !!document.querySelector('.numpad-keyboard')
    }

    const numpadKeyMap = {
        '0': ['Numpad0', 96],
        '1': ['Numpad1', 97],
        '2': ['Numpad2', 98],
        '3': ['Numpad3', 99],
        '4': ['Numpad4', 100],
        '5': ['Numpad5', 101],
        '6': ['Numpad6', 102],
        '7': ['Numpad7', 103],
        '8': ['Numpad8', 104],
        '9': ['Numpad9', 105],
        '.': ['NumpadDecimal', 110],
        '+': ['NumpadAdd', 107],
        '-': ['NumpadSubtract', 109],
        '*': ['NumpadMultiply', 106],
        '/': ['NumpadDivide', 111],
        'Enter': ['NumpadEnter', 13]
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
        '@': { keyCode: 50, code: 'Digit2' },
        '#': { keyCode: 51, code: 'Digit3' },
        '$': { keyCode: 52, code: 'Digit4' },
        '%': { keyCode: 53, code: 'Digit5' },
        '^': { keyCode: 54, code: 'Digit6' },
        '&': { keyCode: 55, code: 'Digit7' },
        '*': { keyCode: 56, code: 'Digit8' },
        '+': { keyCode: 187, code: 'Equal' },
        '|': { keyCode: 220, code: 'Backslash' },
        '\\': { keyCode: 220, code: 'Backslash' },
        '`': { keyCode: 192, code: 'Backquote' },
        '~': { keyCode: 192, code: 'Backquote' },
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
        const lower = char.toLowerCase()

        if (char === '\n' || lower === 'enter') {
            await dispatchEnter()
            return
        }

        if (char === '\t' || lower === 'tab') {
            const options = {
                key: 'Tab',
                code: 'Tab',
                keyCode: 9,
                which: 9,
                charCode: 9
            }

            target.dispatchEvent(
                createKeyboardEvent('keydown', options)
            )
            target.dispatchEvent(
                createKeyboardEvent('keyup', options)
            )
            return
        }

        if (lower === 'shift') {
            const options = {
                key: 'Shift',
                code: 'ShiftLeft',
                keyCode: 16,
                which: 16,
                charCode: 0
            }

            target.dispatchEvent(
                createKeyboardEvent('keydown', options)
            )
            target.dispatchEvent(
                createKeyboardEvent('keyup', options)
            )
            return
        }

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

    function dispatchNumpadKey(char) {
        const info = numpadKeyMap[char]

        if (!info) return dispatchKey(char)

        const options = {
            key: char,
            code: info[0],
            keyCode: info[1],
            which: info[1],
            location: 3
        }

        window.dispatchEvent(
            createKeyboardEvent('keydown', options)
        )

        window.dispatchEvent(
            createKeyboardEvent('keyup', options)
        )
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
                <label>输入速度</label>
                <span class="pt-speed-value">300 字/分钟</span>
            </div>

            <input
                class="pt-speed-range"
                type="range"
                min="30"
                max="1500"
                step="10"
                value="300"
                aria-label="输入速度"
            >

            <input
                class="pt-speed-input"
                type="number"
                min="30"
                max="1500"
                step="10"
                value="300"
                inputmode="numeric"
            >

            <div class="pt-speed-hint">
                平均速度，实际会轻微浮动；中文练习会自动放慢
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

        #pinyin-typer-panel .pt-speed-range {
            width: 100%;
            margin-top: 10px;
            accent-color: #35d99a;
            cursor: pointer;
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
    const speedRange = $('.pt-speed-range')
    const speedValueEl = $('.pt-speed-value')

    let running = false
    let destroyed = false
    let timerInterval = null

    // 五笔测验暂停后从当前题继续
    let wubiTestSignature = ''
    let wubiTestCursor = 0

    function loadSpeed() {
        try {
            const raw = localStorage.getItem(
                CONFIG.speedStorageKey
            )

            if (raw !== null) {
                const saved = Number(raw)

                if (
                    Number.isFinite(saved) &&
                    saved >= CONFIG.minSpeed
                ) {
                    return saved
                }
            }

            // 旧版本存的是毫秒间隔，迁移成字/分钟
            const legacy = Number(
                localStorage.getItem(CONFIG.legacySpeedStorageKey)
            )

            if (Number.isFinite(legacy) && legacy > 0) {
                const interval = Math.max(
                    CONFIG.minKeyInterval,
                    legacy
                )

                return Math.round(60000 / interval)
            }
        } catch {}

        return CONFIG.defaultSpeed
    }

    function applySpeed(value) {
        let speed = Math.round(Number(value))

        if (!Number.isFinite(speed)) {
            speed = CONFIG.defaultSpeed
        }

        speed = Math.max(
            CONFIG.minSpeed,
            Math.min(CONFIG.maxSpeed, speed)
        )

        const interval = Math.max(
            CONFIG.minKeyInterval,
            Math.min(60000, Math.round(60000 / speed))
        )

        const hold = Math.min(40, Math.floor(interval / 3))

        CONFIG.typingInterval = Math.max(0, interval - hold * 2)
        CONFIG.keyDownDelay = hold
        CONFIG.keyPressDelay = hold

        speedInput.value = speed
        speedRange.value = speed
        speedValueEl.textContent = `${speed} 字/分钟`

        try {
            localStorage.setItem(
                CONFIG.speedStorageKey,
                String(speed)
            )
            localStorage.removeItem(
                CONFIG.legacySpeedStorageKey
            )
        } catch {}
    }

    // 输入速度不是匀速：在平均值附近小幅浮动
    function jitterDelay(base, spread = 0.15) {
        const factor = 1 - spread + Math.random() * spread * 2

        return Math.max(0, Math.round(base * factor))
    }

    function nextKeyInterval(minTotal = 0) {
        const hold = CONFIG.keyDownDelay + CONFIG.keyPressDelay
        const base = CONFIG.typingInterval + hold
        const total = Math.max(minTotal, jitterDelay(base))

        return Math.max(0, total - hold)
    }

    // 中文是整字注入，比拼音慢一点，数据更稳
    function nextChineseInterval() {
        const hold = CONFIG.keyDownDelay + CONFIG.keyPressDelay
        const base = Math.max(
            100,
            Math.round((CONFIG.typingInterval + hold) * 1.3)
        )
        const total = jitterDelay(base, 0.1)

        return Math.max(0, total - hold)
    }

    speedInput.addEventListener('change', () => {
        applySpeed(speedInput.value)
    })

    speedRange.addEventListener('input', () => {
        applySpeed(speedRange.value)
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

            const mode = detectLessonMode()

            if (mode !== 'pinyin' && mode !== 'unknown') {
                return NEXT_PAGE
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
    // 其他练习类型
    // ==============================

    async function finishLesson(before, generation) {
        if (lessonSignature() !== before) {
            return true
        }

        const button = findNextButton()

        if (button) {
            button.click()
        } else {
            await dispatchEnter()
        }

        for (let i = 0; i < 50; i++) {
            await sleep(200)

            if (!running || generation !== runGeneration) {
                return false
            }

            if (lessonSignature() !== before) {
                return true
            }
        }

        // 有些反馈页只认 Enter
        await dispatchEnter()

        for (let i = 0; i < 30; i++) {
            await sleep(200)

            if (!running || generation !== runGeneration) {
                return false
            }

            if (lessonSignature() !== before) {
                return true
            }
        }

        return false
    }

    async function runActiveTargetLesson(generation) {
        const before = lessonSignature()
        let stalled = 0

        while (running && generation === runGeneration) {
            const target = readActiveTarget()

            if (!target) break

            const signature = activeTargetSignature()
            const char = target.char

            if (!char || char === '\n') {
                await dispatchEnter()
            } else if (isNumpadLesson()) {
                await dispatchNumpadKey(char)
            } else {
                await dispatchKey(char)
            }

            await sleep(nextKeyInterval(
                isNumpadLesson() ? 120 : 0
            ))

            let changed = false

            for (let i = 0; i < 12; i++) {
                await sleep(50)

                if (!running || generation !== runGeneration) {
                    return false
                }

                if (activeTargetSignature() !== signature) {
                    changed = true
                    break
                }
            }

            if (!changed) {
                stalled++

                if (stalled >= 3) {
                    console.warn(
                        '[PinyinTyper] 当前目标没有推进'
                    )
                    break
                }
            } else {
                stalled = 0
            }
        }

        return finishLesson(before, generation)
    }

    async function runGuidedKeyLesson(generation) {
        const before = lessonSignature()
        let lastKey = ''
        let sameCount = 0

        for (
            let steps = 0;
            steps < 3000 &&
            running &&
            generation === runGeneration;
            steps++
        ) {
            const key = readActiveKey()

            if (!key) break

            if (key === lastKey) {
                sameCount++
            } else {
                lastKey = key
                sameCount = 0
            }

            if (sameCount > 20) {
                console.warn(
                    '[PinyinTyper] 引导按键没有推进'
                )
                break
            }

            let char = key

            if (/^[A-Z]$/.test(char)) {
                char = char.toLowerCase()
            }

            if (char === 'Enter') {
                await dispatchEnter()
            } else if (isNumpadLesson()) {
                await dispatchNumpadKey(char)
            } else {
                await dispatchKey(char)
            }

            await sleep(nextKeyInterval())

            for (let i = 0; i < 10; i++) {
                await sleep(50)

                if (!running || generation !== runGeneration) {
                    return false
                }

                if (readActiveKey() !== key) break
            }
        }

        return finishLesson(before, generation)
    }

    async function runInstructionLesson(generation) {
        const before = lessonSignature()
        let idle = 0

        for (
            let steps = 0;
            steps < 3000 &&
            running &&
            generation === runGeneration;
            steps++
        ) {
            if (detectLessonMode() !== 'instruction') {
                return true
            }

            const key = readActiveKey()

            if (key) {
                let char = /^[A-Z]$/.test(key)
                    ? key.toLowerCase()
                    : key

                if (char === 'Enter') {
                    await dispatchEnter()
                } else if (isNumpadLesson()) {
                    await dispatchNumpadKey(char)
                } else {
                    await dispatchKey(char)
                }

                await sleep(150)
                idle = 0
            } else {
                const button = findNextButton()

                if (button) {
                    button.click()
                    await sleep(300)
                    idle = 0
                } else {
                    await sleep(150)
                    idle++

                    if (idle > 40) break
                }
            }

            if (lessonSignature() !== before) {
                return true
            }
        }

        return false
    }

    async function runChineseLesson(generation) {
        const before = lessonSignature()
        let stalled = 0

        while (running && generation === runGeneration) {
            const block = document.querySelector(
                '.chinese-v2-block.is-current'
            )

            if (!block) break

            const activeCell = block.querySelector(
                '.chinese-v2-target-row .chinese-v2-cell--target.is-active'
            )

            const char = activeCell?.querySelector(
                '.chinese-v2-char'
            )?.textContent ?? ''

            if (!char) {
                stalled++

                if (stalled >= 20) break

                await sleep(150)
                continue
            }

            const input =
                document.querySelector('.chinese-v2-input-source') ||
                document.querySelector('.chinese-box-input')

            if (!input) break

            input.focus()
            input.value = char

            input.dispatchEvent(new InputEvent('input', {
                inputType: 'insertText',
                data: char,
                bubbles: true,
                cancelable: true
            }))

            // 一次一个字，整行注入网站不计成绩
            await sleep(nextChineseInterval())

            const nextBlock = document.querySelector(
                '.chinese-v2-block.is-current'
            )

            const nextActiveCell = nextBlock?.querySelector(
                '.chinese-v2-target-row .chinese-v2-cell--target.is-active'
            )

            if (nextBlock === block && nextActiveCell === activeCell) {
                stalled++

                if (stalled >= 3) {
                    console.warn(
                        '[PinyinTyper] 中文输入没有推进'
                    )
                    break
                }

                await sleep(150)
            } else {
                stalled = 0
            }
        }

        return finishLesson(before, generation)
    }

    function isWubiTest() {
        return !!document.querySelector(
            '.wubi-breakdown__test-slots'
        )
    }

    function readWubiTestList() {
        const dataScript = document.querySelector('#__NUXT_DATA__')

        if (!dataScript) return []

        let data

        try {
            data = JSON.parse(dataScript.textContent)
        } catch {
            return []
        }

        if (!Array.isArray(data)) return []

        for (const item of data) {
            if (
                !item ||
                typeof item !== 'object' ||
                Array.isArray(item) ||
                !('contentType' in item)
            ) {
                continue
            }

            for (const field of ['pinyin', 'wubi', 'text']) {
                let text = item[field]

                if (text === undefined) continue

                if (typeof text === 'number') {
                    text = data[text]
                }

                if (Array.isArray(text)) {
                    text = text
                        .map(value =>
                            typeof value === 'number'
                                ? data[value]
                                : value
                        )
                        .join('')
                }

                if (typeof text !== 'string') continue

                try {
                    const list = JSON.parse(text)

                    if (
                        Array.isArray(list) &&
                        list.every(entry =>
                            entry &&
                            typeof entry.char === 'string' &&
                            typeof entry.code === 'string'
                        )
                    ) {
                        return list
                    }
                } catch {}
            }
        }

        return []
    }

    async function runWubiTestLesson(generation) {
        const before = lessonSignature()
        const list = readWubiTestList()

        if (!list.length) {
            return runGuidedKeyLesson(generation)
        }

        console.log(
            '[PinyinTyper] 五笔测验:',
            list.map(item => `${item.char}:${item.code}`).join(' ')
        )

        if (wubiTestSignature !== before) {
            wubiTestSignature = before
            wubiTestCursor = 0
        }

        for (let i = wubiTestCursor; i < list.length; i++) {
            if (!running || generation !== runGeneration) {
                return false
            }

            const item = list[i]
            const slotsLabel = document.querySelector(
                '.wubi-breakdown__test-slots'
            )?.getAttribute('aria-label') || ''
            const typedMatch = slotsLabel.match(
                /已输入\s*(\d+)\s*码/
            )
            const typed = typedMatch
                ? Number(typedMatch[1])
                : 0

            for (const char of item.code.slice(typed)) {
                const before = document.querySelector(
                    '.wubi-breakdown__test-slots'
                )?.getAttribute('aria-label') || ''

                await dispatchKey(char.toLowerCase())
                await sleep(220)

                const after = document.querySelector(
                    '.wubi-breakdown__test-slots'
                )?.getAttribute('aria-label') || ''

                if (after === before) {
                    await dispatchKey(char.toLowerCase())
                    await sleep(220)
                }
            }

            wubiTestCursor = i + 1
            await sleep(250)
        }

        return finishLesson(before, generation)
    }

    async function runLessonMode(mode, generation) {
        if (mode === 'token' || mode === 'vocabulary') {
            return runActiveTargetLesson(generation)
        }

        if (mode === 'shuangpin') {
            return runGuidedKeyLesson(generation)
        }

        if (mode === 'wubi') {
            // 五笔页面数据是异步出来的，稍等一下再判断
            for (let i = 0; i < 30; i++) {
                if (isWubiTest()) {
                    return runWubiTestLesson(generation)
                }

                if (readActiveKey()) break

                await sleep(100)
            }

            return isWubiTest()
                ? runWubiTestLesson(generation)
                : runGuidedKeyLesson(generation)
        }

        if (mode === 'instruction') {
            return runInstructionLesson(generation)
        }

        if (mode === 'chinese') {
            return runChineseLesson(generation)
        }

        return false
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

                if (!content) {
                    const mode = detectLessonMode()

                    if (mode === 'game') {
                        while (
                            running &&
                            generation === runGeneration
                        ) {
                            content = await handleGame(generation)

                            if (!running || generation !== runGeneration) {
                                break
                            }

                            if (!content || content !== NEXT_PAGE) {
                                break
                            }

                            if (!isGamePage()) break
                        }
                    } else if (
                        mode !== 'pinyin' &&
                        mode !== 'unknown'
                    ) {
                        console.log('[PinyinTyper] 模式:', mode)

                        const done = await runLessonMode(
                            mode,
                            generation
                        )

                        if (!running || generation !== runGeneration) {
                            break
                        }

                        if (!done) {
                            updateUI('未找到内容')
                            break
                        }

                        content = await waitForNextContent(
                            '',
                            generation
                        )
                    } else {
                        updateUI('未找到内容')
                        break
                    }

                    if (!running || generation !== runGeneration) {
                        break
                    }

                    if (content === NEXT_PAGE) {
                        continue
                    }

                    if (!content) {
                        updateUI('等待超时')
                        break
                    }
                }

                updateUI()
                contentEl.textContent = content

                console.log(
                    '[PinyinTyper] 当前内容:',
                    JSON.stringify(content)
                )

                // 暂停后继续时，从网站当前高亮的位置接着打
                const activeBox = document.querySelector(
                    '.pinyin-box__active'
                )
                const activeIndex = activeBox
                    ? Number(activeBox.dataset.targetIndex)
                    : 0
                const startIndex =
                    Number.isInteger(activeIndex) &&
                    activeIndex >= 0 &&
                    activeIndex < content.length
                        ? activeIndex
                        : 0

                console.log(
                    '[PinyinTyper] 从第',
                    startIndex + 1,
                    '个字符继续'
                )

                for (let i = startIndex; i < content.length; i++) {
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

                    await sleep(nextKeyInterval())
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

                // 下一页可能是小游戏或其他练习类型
                if (nextContent === NEXT_PAGE) {
                    continue
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