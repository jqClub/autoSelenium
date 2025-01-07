const builder = require('electron-builder')
const readline = require('readline')

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

async function buildAll () {
    try {
        await builder.build({
            config: {
                ...require('./package.json').build,
                win: ['nsis', 'portable'],
                mac: ['dmg', 'zip']
            }
        })
        console.log('构建完成！')
    } catch (error) {
        console.error('构建失败:', error)
    }
}

async function buildApp () {
    // 检查是否有命令行参数
    if (process.argv.includes('--all')) {
        await buildAll()
        process.exit(0)
    }

    console.log('\n选择打包平台:')
    console.log('1. 仅 Windows')
    console.log('2. 仅 macOS')
    console.log('3. Windows 和 macOS (默认)')
    console.log('4. 取消')

    rl.question('\n请输入选项 (1-4) [默认: 3]: ', async (answer) => {
        let config = {}

        // 如果直接回车，默认选择选项3
        answer = answer.trim() || '3'

        switch (answer) {
            case '1':
                config = { win: ['nsis', 'portable'] }
                break
            case '2':
                config = { mac: ['dmg', 'zip'] }
                break
            case '3':
                config = {
                    win: ['nsis', 'portable'],
                    mac: ['dmg', 'zip']
                }
                break
            case '4':
                console.log('已取消构建')
                rl.close()
                return
            default:
                console.log('无效的选项')
                rl.close()
                return
        }

        try {
            await builder.build({
                config: {
                    ...require('./package.json').build,
                    ...config
                }
            })
            console.log('构建完成！')
        } catch (error) {
            console.error('构建失败:', error)
        }
        rl.close()
    })
}

buildApp() 