const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')

// 图标URL（这是一个示例图标，你可以换成你想要的）
const iconUrl = 'https://raw.githubusercontent.com/electron/electron/main/shell/browser/resources/win/electron.ico'

// 确保build目录存在
const buildDir = path.join(__dirname, 'build')
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir)
}

// 下载图标
function downloadIcon () {
    return new Promise((resolve, reject) => {
        const iconPath = path.join(buildDir, 'icon.ico')
        const file = fs.createWriteStream(iconPath)

        https.get(iconUrl, (response) => {
            response.pipe(file)
            file.on('finish', () => {
                file.close()
                console.log('Icon downloaded successfully')
                resolve()
            })
        }).on('error', (err) => {
            fs.unlink(iconPath, () => { })
            reject(err)
        })
    })
}

async function build () {
    try {
        console.log('Downloading icon...')
        await downloadIcon()

        console.log('Building application...')
        execSync('electron-builder --win --x64', { stdio: 'inherit' })

        console.log('Build completed successfully!')
    } catch (error) {
        console.error('Build failed:', error)
        process.exit(1)
    }
}

build() 