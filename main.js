const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { chromium } = require('playwright')
const fs = require('fs')

let mainWindow
let isRunning = false
let visitedUrls = new Set()  // 记录已访问的URL
let initialUrls = []  // 存储初始URL列表
let scrollInterval = 1000  // 默认滚动间隔时间（毫秒）
let collectedLinks = []  // 存储所有收集到的链接
let maxOpenPages = 5  // 默认最大同时打开页面数

// 全局变量
let allLinks = []      // 总的链接列表 (a数组)
let visitedLinks = []  // 已访问的链接列表 (b数组)
let openPages = []     // 当前打开的页面列表

async function collectPageLinks (page) {
    try {
        const links = await page.$$eval('a', (elements) => {
            return elements
                .filter(el => {
                    return el.href &&
                        el.href.startsWith('http') &&
                        !el.href.includes('#') &&  // 排除页内锚点
                        !el.href.includes('javascript:') &&  // 排除 JavaScript 链接
                        !el.href.includes('mailto:') &&  // 排除邮件链接
                        !el.href.includes('tel:')  // 排除电话链接
                })
                .map(el => ({
                    href: el.href,
                    text: el.textContent.trim() || el.href,
                    title: el.getAttribute('title') || ''  // 添加标题属性
                }))
        })
        // 只过滤掉已访问的链接
        return links.filter(link => !visitedUrls.has(link.href))
    } catch (e) {
        console.log('Error collecting links:', e.message)
        return []
    }
}

// 打乱数组的辅助函数
function shuffleArray (array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]
    }
    return array
}

async function processPage (page, duration) {
    // 检查是否是单屏页面
    const isSingleScreen = await page.evaluate(() => {
        return document.documentElement.scrollHeight <= window.innerHeight
    })

    let pageLinks = []
    if (isSingleScreen) {
        // 单屏页面：立即收集所有链接
        console.log('Single screen page detected, collecting links...')
        pageLinks = await collectPageLinks(page)
    } else {
        // 需要滚动的页面：边滚动边收集
        console.log('Scrolling page detected, collecting links while scrolling...')
        let reachedBottom = false
        while (!reachedBottom && isRunning) {
            // 收集当前视图中的链接
            const newLinks = await collectPageLinks(page)
            pageLinks.push(...newLinks)

            // 检查是否到达底部
            reachedBottom = await page.evaluate(() => {
                const scrollPosition = window.scrollY + window.innerHeight
                const totalHeight = document.documentElement.scrollHeight
                return scrollPosition >= totalHeight - 100
            })

            if (!reachedBottom) {
                // 向下滚动
                await page.evaluate(() => window.scrollBy(0, 300))
                await page.waitForTimeout(scrollInterval)
            }
        }
    }

    // 去重链接
    const linkMap = new Map()
    pageLinks.forEach(link => {
        if (!linkMap.has(link.href) ||
            (link.text.length > linkMap.get(link.href).text.length) ||
            (link.title && !linkMap.get(link.href).title)) {
            linkMap.set(link.href, link)
        }
    })

    // 将新收集的链接添加到全局数组
    const uniqueLinks = Array.from(linkMap.values())
        .filter(link => !visitedUrls.has(link.href))
    collectedLinks.push(...uniqueLinks)

    // 等待指定时间
    console.log(`Waiting ${duration} seconds...`)
    await page.waitForTimeout(duration * 1000)

    return uniqueLinks
}

async function processPageAndLinks (context, pages, page, duration) {
    let currentPage = page

    while (isRunning) {
        try {
            // 处理当前页面
            const links = await processPage(currentPage, duration)
            if (!Array.isArray(links) || links.length === 0) {
                console.log('No more links to process in current page')
                break
            }

            // 过滤出未处理的链接
            const unprocessedLinks = links.filter(link => !visitedUrls.has(link.href))

            if (unprocessedLinks.length === 0) {
                console.log('All links in current page have been processed')
                break
            }

            // 随机等待一段时间（5-15秒）模拟用户浏览行为
            const randomWait = Math.floor(Math.random() * 10000) + 5000
            console.log(`Randomly waiting ${randomWait / 1000} seconds before next action...`)
            await currentPage.waitForTimeout(randomWait)

            // 随机决定是否执行一些额外的用户行为
            if (Math.random() < 0.7) {  // 70%的概率执行随机行为
                await simulateUserBehavior(currentPage)
            }

            // 打开所有未处理的链接
            console.log(`Opening ${unprocessedLinks.length} links in new tabs...`)
            for (const link of unprocessedLinks) {
                try {
                    console.log('Opening new tab for:', link.text)
                    const newPage = await context.newPage()
                    pages.push(newPage)
                    await newPage.goto(link.href, { timeout: 30000 })
                    visitedUrls.add(link.href)

                    // 等待一小段随机时间，避免同时打开太多标签
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000))
                } catch (e) {
                    console.log('Failed to open link:', link.href, e.message)
                }
            }

            // 处理完当前页面的所有链接后退出循环
            break

        } catch (e) {
            console.log('Error processing page:', e.message)
            break
        }
    }
}

// 选择"有趣"的链接
function selectInterestingLink (links) {
    // 根据链接文本长度、关键词等给链接评分
    const scoredLinks = links.map(link => {
        let score = 0
        const text = link.text.toLowerCase()

        // 文本长度适中的链接更可能是有意义的
        if (text.length > 10 && text.length < 100) score += 2

        // 包含特定关键词的链接可能更有趣
        const interestingKeywords = ['detail', 'view', 'read', 'more', 'article', '详情', '查看', '阅读', '更多']
        if (interestingKeywords.some(keyword => text.includes(keyword))) score += 3

        // 避免一些常见的无关链接
        const boringKeywords = ['login', 'register', 'copyright', '登录', '注册', '版权']
        if (boringKeywords.some(keyword => text.includes(keyword))) score -= 3

        return { link, score }
    })

    // 按分数排序并添加随机因素
    scoredLinks.sort((a, b) => b.score - a.score + (Math.random() - 0.5))

    // 从前50%的链接中随机选择一个
    const topLinks = scoredLinks.slice(0, Math.max(1, Math.floor(scoredLinks.length / 2)))
    return topLinks[Math.floor(Math.random() * topLinks.length)].link
}

// 模拟用户行为
async function simulateUserBehavior (page) {
    const behaviors = [
        // 随机滚动
        async () => {
            const scrollAmount = Math.floor(Math.random() * 500) + 100
            await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount)
            console.log(`Randomly scrolled ${scrollAmount}px`)
        },

        // 随机移动鼠标
        async () => {
            try {
                // 使用 JavaScript 获取可见元素的位置
                const position = await page.evaluate(() => {
                    const elements = document.querySelectorAll('a, button, img')
                    const visibleElements = Array.from(elements).filter(el => {
                        const rect = el.getBoundingClientRect()
                        return rect.top >= 0 &&
                            rect.left >= 0 &&
                            rect.bottom <= window.innerHeight &&
                            rect.right <= window.innerWidth
                    })

                    if (visibleElements.length === 0) return null

                    const element = visibleElements[Math.floor(Math.random() * visibleElements.length)]
                    const rect = element.getBoundingClientRect()
                    return {
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2
                    }
                })

                if (position) {
                    // 使用 mouse.move 代替 hover
                    await page.mouse.move(position.x, position.y, { steps: 5 })
                    console.log('Randomly moved mouse to element')
                }
            } catch (e) {
                console.log('Failed to move mouse:', e.message)
            }
        },

        // 随机选择文本
        async () => {
            try {
                await page.evaluate(() => {
                    const elements = document.querySelectorAll('p, h1, h2, h3, span')
                    const visibleElements = Array.from(elements).filter(el => {
                        const rect = el.getBoundingClientRect()
                        return rect.top >= 0 &&
                            rect.left >= 0 &&
                            rect.bottom <= window.innerHeight &&
                            rect.right <= window.innerWidth &&
                            el.textContent.trim().length > 0
                    })

                    if (visibleElements.length > 0) {
                        const element = visibleElements[Math.floor(Math.random() * visibleElements.length)]
                        const selection = window.getSelection()
                        const range = document.createRange()
                        range.selectNodeContents(element)
                        selection.removeAllRanges()
                        selection.addRange(range)
                    }
                })
                console.log('Randomly selected some text')
            } catch (e) {
                console.log('Failed to select text:', e.message)
            }
        }
    ]

    // 随机执行1-3个行为
    const numBehaviors = Math.floor(Math.random() * 3) + 1
    for (let i = 0; i < numBehaviors; i++) {
        const randomBehavior = behaviors[Math.floor(Math.random() * behaviors.length)]
        try {
            await randomBehavior()
        } catch (e) {
            console.log('Failed to execute behavior:', e.message)
            continue
        }
        // 行为之间添加随机延迟
        await page.waitForTimeout(Math.random() * 2000 + 1000)
    }
}

// 打乱数组并返回一个未访问的链接
function getNextUnvisitedLink () {
    shuffleArray(allLinks)
    return allLinks.find(link => !visitedLinks.some(v => v.href === link.href))
}

async function startBrowserSession (duration) {
    // 使用 launchPersistentContext 替代 launch
    const context = await chromium.launchPersistentContext(
        path.join(app.getPath('userData'), 'ChromeProfile'),
        {
            headless: false,
            channel: 'chrome',
            slowMo: 50,
            args: [
                '--start-maximized',
                '--disable-incognito'
            ],
            viewport: null,
            acceptDownloads: true,
            incognito: false
        }
    )

    try {
        // 初始化链接列表
        allLinks = initialUrls.map(url => ({ href: url, text: url }))
        visitedLinks = []
        openPages = []

        while (isRunning) {
            // 获取下一个要访问的链接
            const nextLink = getNextUnvisitedLink()
            if (!nextLink) {
                console.log('All links have been visited')
                break
            }

            try {
                // 如果已达到最大页面数，关闭最早打开的页面
                if (openPages.length >= maxOpenPages) {
                    const oldestPage = openPages.shift()
                    console.log('Closing oldest page to maintain limit')
                    await oldestPage.close()
                }

                // 打开新页面
                console.log('Opening link:', nextLink.text)
                const page = await context.newPage()
                openPages.push(page)
                await page.goto(nextLink.href, { timeout: 30000 })
                visitedLinks.push(nextLink)

                // 检查是否是单屏页面
                const isSingleScreen = await page.evaluate(() => {
                    return document.documentElement.scrollHeight <= window.innerHeight
                })

                let newLinks = []
                if (isSingleScreen) {
                    // 单屏页面：立即收集所有链接
                    console.log('Single screen page detected, collecting links...')
                    newLinks = await collectPageLinks(page)
                } else {
                    // 需要滚动的页面：边滚动边收集
                    console.log('Scrolling page detected, collecting links while scrolling...')
                    let reachedBottom = false
                    while (!reachedBottom && isRunning) {
                        // 收集当前视图中的链接
                        const links = await collectPageLinks(page)
                        newLinks.push(...links)

                        // 检查是否到达底部
                        reachedBottom = await page.evaluate(() => {
                            const scrollPosition = window.scrollY + window.innerHeight
                            const totalHeight = document.documentElement.scrollHeight
                            return scrollPosition >= totalHeight - 100
                        })

                        if (!reachedBottom) {
                            // 向下滚动
                            await page.evaluate(() => window.scrollBy(0, 300))
                            await page.waitForTimeout(scrollInterval)
                        }
                    }
                }

                // 去重并添加新链接到总链接列表
                const uniqueNewLinks = newLinks.filter(newLink =>
                    !allLinks.some(existing => existing.href === newLink.href)
                )
                allLinks.push(...uniqueNewLinks)
                console.log(`Added ${uniqueNewLinks.length} new unique links`)

                // 等待指定时间
                console.log(`Waiting ${duration} seconds...`)
                await page.waitForTimeout(duration * 1000)

                // 随机等待一段时间（5-15秒）模拟用户浏览行为
                const randomWait = Math.floor(Math.random() * 10000) + 5000
                await page.waitForTimeout(randomWait)

                // 随机决定是否执行一些额外的用户行为
                if (Math.random() < 0.7) {
                    await simulateUserBehavior(page)
                }

            } catch (e) {
                console.log('Error processing link:', e.message)
                // 出错时也将链接标记为已访问，避免重复访问
                visitedLinks.push(nextLink)
            }
        }

        // 关闭所有剩余的页面
        for (const page of openPages) {
            await page.close()
        }

        return true // 返回true表示需要重新开始

    } finally {
        await context.close()  // 注意：这里改为关闭 context 而不是 browser
    }
}

ipcMain.handle('start-automation', async (event, { urls, duration, scrollInterval: userScrollInterval, maxPages }) => {
    try {
        isRunning = true
        initialUrls = [...urls]
        scrollInterval = userScrollInterval || 1000
        maxOpenPages = maxPages || 5
        console.log('Starting automation with URLs:', urls)

        while (isRunning) {
            console.log('Starting new automation cycle...')
            const shouldRestart = await startBrowserSession(duration)

            if (shouldRestart && isRunning) {
                console.log('Restarting automation...')
                // 等待一段时间后重新开始
                await new Promise(resolve => setTimeout(resolve, 5000))
            } else {
                break
            }
        }

        event.sender.send('automation-completed')
        return { success: true }
    } catch (error) {
        console.error('Fatal error:', error)
        return { success: false, error: error.message }
    }
})

function createWindow () {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    // Mac 系统特定处理
    if (process.platform === 'darwin') {
        app.commandLine.appendSwitch('enable-sandbox')
        app.commandLine.appendSwitch('enable-logging')
    }

    mainWindow.loadFile('index.html')
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

// 加载URL列表
ipcMain.handle('load-urls', async () => {
    try {
        if (fs.existsSync(path.join(app.getPath('userData'), 'saved-urls.json'))) {
            const urls = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'saved-urls.json'), 'utf8'))
            return { success: true, urls }
        }
        return { success: true, urls: [] }
    } catch (error) {
        return { success: false, error: error.message }
    }
})

// 停止自动化
ipcMain.handle('stop-automation', async () => {
    isRunning = false
    return { success: true }
})

// 添加错误处理
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
}) 