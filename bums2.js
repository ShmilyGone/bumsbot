const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const md5 = require('md5');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

class Bums {
    constructor() {
        this.baseUrl = 'https://api.bums.bot';
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en",
            "Content-Type": "multipart/form-data",
            "Origin": "https://app.bums.bot",
            "Referer": "https://app.bums.bot/",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?1",
            "Sec-Ch-Ua-Platform": '"Android"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors", 
            "Sec-Fetch-Site": "same-site",
            "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36"
        };       
        this.SECRET_KEY = '7be2a16a82054ee58398c5edb7ac4a5a';
        this.loadProxies();
    }

    log(msg, type = 'info', accountIndex = null, proxyIP = null) {
        const timestamp = new Date().toLocaleTimeString();
        const accountPrefix = accountIndex !== null ? `[Tài khoản ${accountIndex + 1}]` : '';
        const ipPrefix = proxyIP ? `[${proxyIP}]` : '[Unknown IP]';
        let logMessage = '';
        
        switch(type) {
            case 'success':
                logMessage = `${timestamp} ${accountPrefix}${ipPrefix} ${msg}`.green;
                break;
            case 'error':
                logMessage = `${timestamp} ${accountPrefix}${ipPrefix} ${msg}`.red;
                break;
            case 'warning':
                logMessage = `${timestamp} ${accountPrefix}${ipPrefix} ${msg}`.yellow;
                break;
            case 'custom':
                logMessage = `${timestamp} ${accountPrefix}${ipPrefix} ${msg}`.magenta;
                break;
            default:
                logMessage = `${timestamp} ${accountPrefix}${ipPrefix} ${msg}`.blue;
        }
        
        console.log(logMessage);
    }

    loadProxies() {
        try {
            const proxyFile = path.join(__dirname, 'proxy.txt');
            if (fs.existsSync(proxyFile)) {
                this.proxies = fs.readFileSync(proxyFile, 'utf8')
                    .replace(/\r/g, '')
                    .split('\n')
                    .filter(Boolean);
            } else {
                this.proxies = [];
                this.log('Không tìm thấy file proxy.txt!', 'warning');
            }
        } catch (error) {
            this.proxies = [];
            this.log(`Lỗi khi đọc file proxy: ${error.message}`, 'error');
        }
    }

    async makeRequest(config, proxyUrl) {
        try {
            if (proxyUrl) {
                const proxyAgent = new HttpsProxyAgent(proxyUrl);
                config.httpsAgent = proxyAgent;
                config.proxy = false;
            }
            
            const response = await axios(config);
            return response;
        } catch (error) {
            throw error;
        }
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent,
                proxy: false,
                timeout: 10000
            });
            
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error khi kiểm tra IP của proxy: ${error.message}`);
        }
    }

    async login(initData, invitationCode, proxyUrl) {
        const url = `${this.baseUrl}/miniapps/api/user/telegram_auth`;
        const formData = new FormData();
        formData.append('invitationCode', invitationCode);
        formData.append('initData', initData);

        try {
            const response = await this.makeRequest({
                method: 'POST',
                url,
                data: formData,
                headers: this.headers
            }, proxyUrl);

            if (response.status === 200 && response.data.code === 0) {
                return { 
                    success: true, 
                    token: response.data.data.token,
                    data: response.data.data
                };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getGameInfo(token, proxyUrl, accountIndex = null) {
        const url = `${this.baseUrl}/miniapps/api/user_game_level/getGameInfo`;
        const headers = { 
            ...this.headers, 
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };
        
        try {
            const response = await this.makeRequest({
                method: 'GET',
                url,
                headers
            }, proxyUrl);
    
            if (response.status === 200 && response.data.code === 0) {
                return { 
                    success: true,
                    coin: response.data.data.gameInfo.coin,
                    energySurplus: response.data.data.gameInfo.energySurplus,
                    data: response.data.data
                };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi lấy thông tin game: ${error.message}`, 'error', accountIndex);
            return { success: false, error: error.message };
        }
    }

    generateHashCode(collectAmount, collectSeqNo) {
        const data = `${collectAmount}${collectSeqNo}${this.SECRET_KEY}`;
        return md5(data);
    }

    distributeEnergy(totalEnergy) {
        const parts = 10;
        let remaining = parseInt(totalEnergy);
        const distributions = [];
        
        for (let i = 0; i < parts; i++) {
            const isLast = i === parts - 1;
            if (isLast) {
                distributions.push(remaining);
            } else {
                const maxAmount = Math.min(300, Math.floor(remaining / 2));
                const amount = Math.floor(Math.random() * maxAmount) + 1;
                distributions.push(amount);
                remaining -= amount;
            }
        }
        
        return distributions;
    }
    
    async collectCoins(token, collectSeqNo, collectAmount, proxyUrl, accountIndex = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }
    
            const url = `${this.baseUrl}/miniapps/api/user_game/collectCoin`;
            const headers = { 
                ...this.headers, 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "multipart/form-data"
            };
            
            const hashCode = this.generateHashCode(collectAmount, collectSeqNo);
            const formData = new FormData();
            formData.append('hashCode', hashCode);
            formData.append('collectSeqNo', collectSeqNo.toString());
            formData.append('collectAmount', collectAmount.toString());
    
            const response = await this.makeRequest({
                method: 'POST',
                url,
                data: formData,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return {
                    success: true,
                    newCollectSeqNo: response.data.data.collectSeqNo,
                    data: response.data.data
                };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi thu thập coin: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }

    async getTaskLists(token, proxyUrl, accountIndex = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }
    
            const url = `${this.baseUrl}/miniapps/api/task/lists`;
            const headers = { 
                ...this.headers, 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json" 
            };
            
            const response = await this.makeRequest({
                method: 'GET',
                url,
                headers,
                params: {
                    _t: Date.now()
                }
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { 
                    success: true,
                    tasks: response.data.data.lists.filter(task => task.isFinish === 0)
                };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi lấy danh sách nhiệm vụ: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }

    async getMineList(token, proxyUrl, accountIndex = null) {
        const url = `${this.baseUrl}/miniapps/api/mine/getMineLists`;
        const headers = { 
            ...this.headers, 
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };
        
        try {
            const response = await this.makeRequest({
                method: 'POST',
                url,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { 
                    success: true,
                    mines: response.data.data.lists
                };
            } else {
                this.log(`Không thể lấy danh sách thẻ: ${response.data.msg}`, 'error', accountIndex);
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi lấy danh sách thẻ: ${error.message}`, 'error', accountIndex);
            return { success: false, error: error.message };
        }
    }

    async processMineUpgrades(token, currentCoin, proxyUrl, accountIndex = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        if (proxyUrl) {
            try {
                proxyIP = await this.checkProxyIP(proxyUrl);
            } catch (error) {
                this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
            }
        }
    
        const config = require('./config.json');
        const mineList = await this.getMineList(token, proxyUrl, accountIndex);
        
        if (!mineList.success) {
            this.log(`Không thể lấy danh sách thẻ: ${mineList.error}`, 'error', accountIndex, proxyIP);
            return;
        }
    
        let availableMines = mineList.mines
            .filter(mine => 
                mine.status === 1 && 
                parseInt(mine.nextLevelCost) <= Math.min(currentCoin, config.maxUpgradeCost)
            )
            .sort((a, b) => parseInt(b.nextPerHourReward) - parseInt(a.nextPerHourReward));
    
        if (availableMines.length === 0) {
            this.log('Không có thẻ nào có thể nâng cấp!', 'warning', accountIndex, proxyIP);
            return;
        }
    
        let remainingCoin = currentCoin;
        for (const mine of availableMines) {
            const cost = parseInt(mine.nextLevelCost);
            if (cost > remainingCoin) continue;
            const result = await this.upgradeMine(token, mine.mineId, proxyUrl, accountIndex, proxyIP);
            
            if (result.success) {
                remainingCoin -= cost;
                this.log(`Nâng cấp thẻ ID ${mine.mineId} thành công | Remaining coin: ${remainingCoin}`, 'success', accountIndex, proxyIP);
            } else {
                this.log(`Không thể nâng cấp thẻ ID ${mine.mineId}: ${result.error}`, 'error', accountIndex, proxyIP);
            }
    
            await new Promise(resolve => setTimeout(resolve, 5 * 1000));
        }
    }
    
    async upgradeMine(token, mineId, proxyUrl, accountIndex = null, proxyIP = 'No Proxy') {
        const url = `${this.baseUrl}/miniapps/api/mine/upgrade`;
        const headers = { 
            ...this.headers, 
            "Authorization": `Bearer ${token}`,
            "Content-Type": "multipart/form-data"
        };
        
        const formData = new FormData();
        formData.append('mineId', mineId.toString());
    
        try {
            const response = await this.makeRequest({
                method: 'POST',
                url,
                data: formData,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { success: true };
            } else {
                this.log(`Không thể nâng cấp thẻ: ${response.data.msg}`, 'error', accountIndex, proxyIP);
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi nâng cấp thẻ: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }

    async finishTask(token, taskId, taskInfo, proxyUrl, accountIndex = null) {
        const url = `${this.baseUrl}/miniapps/api/task/finish_task`;
        const headers = { 
            ...this.headers, 
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded" 
        };
        
        const getEpisodeNumber = (name) => {
            const match = name.match(/Episode (\d+)/);
            return match ? parseInt(match[1]) : null;
        };
    
        const episodeCodes = {
            0: '42858', 1: '95065', 2: '88125', 3: '51264', 4: '13527',
            5: '33270', 6: '57492', 7: '63990', 8: '19988', 9: '26483',
            10: '36624', 11: '30436', 12: '71500', 13: '48516', 14: '92317',
            15: '68948', 16: '98109', 17: '35264', 18: '86100', 19: '86100',
            20: '83273', 21: '74737', 22: '18948', 23: '16086', 24: '13458',
            25: '13458', 26: '91467', 27: '71728', 28: '97028', 29: '97028',
            30: '89349', 31: '31114', 32: '31114', 33: '37422', 34: '52860',
            35: '10300', 36: '35583', 37: '35194', 38: '26488', 39: '85133',
            40: '13116', 41: '28932', 42: '50662', 43: '83921', 44: '35176',
            45: '24345', 46: '95662', 47: '43700', 48: '36632', 49: '74507',
            50: '74507', 51: '46056', 52: '48627', 53: '39617'
        };
    
        const params = new URLSearchParams();
        params.append('id', taskId.toString());
    
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }
    
            if (taskInfo && 
                taskInfo.classifyName === 'YouTube' && 
                taskInfo.name.includes('Find hidden code')) {
                
                const episodeNum = getEpisodeNumber(taskInfo.name);
                if (episodeNum !== null && episodeCodes[episodeNum]) {
                    params.append('pwd', episodeCodes[episodeNum]);
                    this.log(`Đang gửi mã cho Episode ${episodeNum}: ${episodeCodes[episodeNum]}`, 'info', accountIndex, proxyIP);
                }
            }
            params.append('_t', Date.now().toString());
    
            const response = await this.makeRequest({
                method: 'POST',
                url,
                data: params,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { success: true };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi hoàn thành nhiệm vụ: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }
    
    async processTasks(token, proxyUrl, accountIndex = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }
    
            const taskList = await this.getTaskLists(token, proxyUrl, accountIndex);
            
            if (!taskList.success) {
                this.log(`Không thể lấy danh sách nhiệm vụ: ${taskList.error}`, 'error', accountIndex, proxyIP);
                return;
            }
    
            if (taskList.tasks.length === 0) {
                this.log('Không có nhiệm vụ mới!', 'warning', accountIndex, proxyIP);
                return;
            }
    
            for (const task of taskList.tasks) {
                const result = await this.finishTask(token, task.id, task, proxyUrl, accountIndex);
                
                if (result.success) {
                    this.log(`Làm nhiệm vụ ${task.name} thành công | Phần thưởng: ${task.rewardParty}`, 'success', accountIndex, proxyIP);
                }
    
                await new Promise(resolve => setTimeout(resolve, 5 * 1000));
            }
        } catch (error) {
            this.log(`Lỗi xử lý nhiệm vụ: ${error.message}`, 'error', accountIndex, proxyIP);
        }
    }

    async processEnergyCollection(token, energy, initialCollectSeqNo, proxyUrl, accountIndex = null) {
        let proxyIP = 'No Proxy';
        if (proxyUrl) {
            try {
                proxyIP = await this.checkProxyIP(proxyUrl);
            } catch (error) {
                this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
            }
        }
    
        const energyDistributions = this.distributeEnergy(energy);
        let currentCollectSeqNo = initialCollectSeqNo;
        let totalCollected = 0;
        
        for (let i = 0; i < energyDistributions.length; i++) {
            const amount = energyDistributions[i];
            this.log(`Thu thập lần ${i + 1}/10: ${amount} năng lượng`, 'custom', accountIndex, proxyIP);
            
            const result = await this.collectCoins(token, currentCollectSeqNo, amount, proxyUrl, accountIndex);
            
            if (result.success) {
                totalCollected += amount;
                currentCollectSeqNo = result.newCollectSeqNo;
                this.log(`Thành công! Đã thu thập: ${totalCollected}/${energy}`, 'success', accountIndex, proxyIP);
            } else {
                this.log(`Lỗi khi thu thập: ${result.error}`, 'error', accountIndex, proxyIP);
                break;
            }
            
            if (i < energyDistributions.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 5 * 1000));
            }
        }
        
        return totalCollected;
    }



    askQuestion(query) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise(resolve => rl.question(query, ans => {
            rl.close();
            resolve(ans);
        }))
    }

    async getSignLists(token, proxyUrl, accountIndex = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }
    
            const url = `${this.baseUrl}/miniapps/api/sign/getSignLists`;
            const headers = { 
                ...this.headers, 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json" 
            };
            
            const response = await this.makeRequest({
                method: 'GET',
                url,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { 
                    success: true, 
                    lists: response.data.data.lists 
                };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi lấy danh sách điểm danh: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }
    
    async sign(token, proxyUrl, accountIndex = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }
    
            const url = `${this.baseUrl}/miniapps/api/sign/sign`;
            const headers = { 
                ...this.headers, 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "multipart/form-data" 
            };
            
            const formData = new FormData();
    
            const response = await this.makeRequest({
                method: 'POST',
                url,
                data: formData,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { success: true };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi điểm danh: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }
    
    async processSignIn(token, proxyUrl, accountIndex = null) {
        const proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        
        this.log('Đang kiểm tra điểm danh...', 'info', accountIndex, proxyIP);
        const signList = await this.getSignLists(token, proxyUrl, accountIndex);
        
        if (!signList.success) {
            this.log(`Không thể lấy thông tin điểm danh: ${signList.error}`, 'error', accountIndex, proxyIP);
            return;
        }
    
        const availableDay = signList.lists.find(day => day.status === 0);
        if (!availableDay) {
            this.log('Không có ngày nào cần điểm danh!', 'warning', accountIndex, proxyIP);
            return;
        }
    
        this.log(`Đang điểm danh ngày ${availableDay.days}...`, 'info', accountIndex, proxyIP);
        const result = await this.sign(token, proxyUrl, accountIndex);
        
        if (result.success) {
            this.log(`Điểm danh ngày ${availableDay.days} thành công | Phần thưởng: ${availableDay.normal}`, 'success', accountIndex, proxyIP);
        } else {
            this.log(`Điểm danh thất bại: ${result.error}`, 'error', accountIndex, proxyIP);
        }
    
        await new Promise(resolve => setTimeout(resolve, 5 * 1000));
    }

    async getGangLists(token, proxyUrl) {
        const url = `${this.baseUrl}/miniapps/api/gang/gang_lists`;
        const headers = { 
            ...this.headers, 
            "Authorization": `Bearer ${token}`,
            "Content-Type": "multipart/form-data" 
        };
        
        const formData = new FormData();
        formData.append('boostNum', '15');
        formData.append('powerNum', '35');

        try {
            const response = await this.makeRequest({
                method: 'POST',
                url,
                data: formData,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { 
                    success: true,
                    myGang: response.data.data.myGang,
                    gangLists: response.data.data.lists 
                };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async joinGang(token, gangName = 'dancayairdrop', proxyUrl, accountIndex = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }
    
            const url = `${this.baseUrl}/miniapps/api/gang/gang_join`;
            const headers = { 
                ...this.headers, 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "multipart/form-data" 
            };
            
            const formData = new FormData();
            formData.append('name', gangName);
    
            const response = await this.makeRequest({
                method: 'POST',
                url,
                data: formData,
                headers
            }, proxyUrl);
            
            if (response.status === 200 && response.data.code === 0) {
                return { success: true };
            } else {
                return { success: false, error: response.data.msg };
            }
        } catch (error) {
            this.log(`Lỗi gia nhập gang: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }

    async processGangJoin(token, proxyUrl, accountIndex = null) {
        const proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        
        this.log('Đang kiểm tra thông tin gang...', 'info', accountIndex, proxyIP);
        const gangList = await this.getGangLists(token, proxyUrl, accountIndex);
        
        if (!gangList.success) {
            this.log(`Không thể lấy thông tin gang: ${gangList.error}`, 'error', accountIndex, proxyIP);
            return;
        }
    
        if (!gangList.myGang.gangId) {
            this.log('Bạn chưa tham gia gang nào, đang thử gia nhập Gang Dân Cày Airdrop...', 'info', accountIndex, proxyIP);
            const result = await this.joinGang(token, 'dancayairdrop', proxyUrl, accountIndex);
            
            if (result.success) {
                this.log('Bạn đã gia nhập Gang Dân Cày Airdrop thành công!', 'success', accountIndex, proxyIP);
            } else {
                this.log(`Không thể gia nhập gang: ${result.error}`, 'error', accountIndex, proxyIP);
            }
        } else {
            this.log(`Bạn đã là thành viên của gang ${gangList.myGang.name}`, 'custom', accountIndex, proxyIP);
        }
    
        await new Promise(resolve => setTimeout(resolve, 5 * 1000));
    }

    async processAccount(initData, accountIndex, proxyUrl = null) {
        let proxyIP = proxyUrl ? (proxyUrl.split('@')[1] || 'Unknown Proxy') : 'No Proxy';
        try {
            if (proxyUrl) {
                try {
                    const checkedIP = await this.checkProxyIP(proxyUrl);
                    proxyIP = checkedIP;
                } catch (error) {
                    this.log(`Lỗi kiểm tra proxy: ${error.message}`, 'warning', accountIndex, proxyIP);
                }
            }

            const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
            const firstName = userData.first_name;

            this.log(`Bắt đầu xử lý tài khoản`, 'info', accountIndex, proxyIP);
            
            const loginResult = await this.login(initData, 'SkDATcHN', proxyUrl);
            
            if (!loginResult.success) {
                this.log(`Đăng nhập không thành công: ${loginResult.error}`, 'error', accountIndex, proxyIP);
                return { success: false, error: loginResult.error };
            }

            this.log('Đăng nhập thành công!', 'success', accountIndex, proxyIP);
            const token = loginResult.token;

            await this.processSignIn(token, proxyUrl, accountIndex);
            await this.processGangJoin(token, proxyUrl, accountIndex);

            const gameInfo = await this.getGameInfo(token, proxyUrl);
            if (gameInfo.success) {
                this.log(`Coin: ${gameInfo.coin} | Energy: ${gameInfo.energySurplus}`, 'custom', accountIndex, proxyIP);
                
                if (parseInt(gameInfo.energySurplus) > 0) {
                    const collectSeqNo = gameInfo.data.tapInfo.collectInfo.collectSeqNo;
                    await this.processEnergyCollection(token, gameInfo.energySurplus, collectSeqNo, proxyUrl, accountIndex);
                } else {
                    this.log(`Không đủ năng lượng để thu thập`, 'warning', accountIndex, proxyIP);
                }
            } else {
                this.log(`Không thể lấy thông tin game: ${gameInfo.error}`, 'error', accountIndex, proxyIP);
                return { success: false, error: gameInfo.error };
            }

            if (this.hoinhiemvu) {
                await this.processTasks(token, proxyUrl);
            }

            if (this.hoinangcap) {
                await this.processMineUpgrades(token, parseInt(gameInfo.coin), proxyUrl);
            }

            this.log('Xử lý tài khoản hoàn tất', 'success', accountIndex, proxyIP);
            return { success: true };
        } catch (error) {
            this.log(`Lỗi xử lý tài khoản: ${error.message}`, 'error', accountIndex, proxyIP);
            return { success: false, error: error.message };
        }
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        if (!fs.existsSync(dataFile)) {
            this.log('Không tìm thấy file data.txt!', 'error');
            return;
        }

        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        if (data.length === 0) {
            this.log('File data.txt trống!', 'error');
            return;
        }

        this.log('Tool được chia sẻ tại kênh telegram Dân Cày Airdrop (@dancayairdrop)'.green);
        
        this.hoinhiemvu = (await this.askQuestion('Bạn có muốn làm nhiệm vụ không? (y/n): ')).toLowerCase() === 'y';
        this.hoinangcap = (await this.askQuestion('Bạn có muốn nâng cấp thẻ không? (y/n): ')).toLowerCase() === 'y';

        while (true) {
            const promises = [];
            for (let i = 0; i < data.length; i += this.maxThreads) {
                const batch = data.slice(i, i + this.maxThreads);
                const batchPromises = batch.map((initData, index) => {
                    const proxyUrl = this.proxies[i + index] || null;
                    return Promise.race([
                        this.processAccount(initData, i + index, proxyUrl),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Timeout')), 10 * 60 * 1000)
                        )
                    ]);
                });

                promises.push(...batchPromises);
                await Promise.allSettled(batchPromises);
                
                console.log('Chờ 3 giây');
                await new Promise(resolve => setTimeout(resolve, 3 * 1000));
            }

            console.log('Chờ 300 giây');
            await new Promise(resolve => setTimeout(resolve, 300 * 1000));
        }
    }
}

const client = new Bums();
client.maxThreads = 10;
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});