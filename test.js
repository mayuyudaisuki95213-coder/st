// ==UserScript==
// @name         生图助手 (NovelAI加强版)
// @version      v45.0
// @description  增加NovelAI直连支持、详细参数配置及顺序生图
// @author       Walkeatround & Gemini & AI Assistant
// @match        */*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // --- 工具函数：Native Fetch 与 GM_fetch 兼容 ---
    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body || undefined,
                responseType: options.responseType || undefined, // 支持 arraybuffer
                timeout: 120000, // NAI生成可能较慢，延长超时
                onload: (response) => {
                    const res = {
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        statusText: response.statusText,
                        headers: {
                            get: (name) => {
                                const header = response.responseHeaders
                                    .split('\n')
                                    .find(h => h.toLowerCase().startsWith(name.toLowerCase()));
                                return header ? header.split(': ')[1] : null;
                            }
                        },
                        text: () => Promise.resolve(response.responseText),
                        json: () => {
                            try {
                                return Promise.resolve(JSON.parse(response.responseText));
                            } catch (e) {
                                return Promise.reject(new Error('Invalid JSON'));
                            }
                        },
                        arrayBuffer: () => Promise.resolve(response.response), // 支持二进制
                        blob: () => Promise.resolve(new Blob([response.response]))
                    };
                    resolve(res);
                },
                onerror: (error) => reject(new Error(`Network error: ${error.error || 'Unknown'}`)),
                ontimeout: () => reject(new Error('Request timeout'))
            });
        });
    }

    const safeFetch = (typeof GM_xmlhttpRequest !== 'undefined') ? gmFetch : fetch;

    const SCRIPT_ID = 'sd_gen_standard_v45';
    const STORAGE_KEY = 'sd_gen_settings';
    const TEMPLATES_KEY = 'sd_gen_templates';
    const NO_GEN_FLAG = '[no_gen]';
    const SCHEDULED_FLAG = '[scheduled]';

    // 全局变量
    let aiTplCurrentIndex = 0;
    let indepTplCurrentIndex = 0;
    const RUNTIME_LOGS = [];

    function addLog(type, msg) {
        const logLine = `[${new Date().toLocaleTimeString()}] [${type}] ${msg}`;
        RUNTIME_LOGS.push(logLine);
        console.log(logLine);
    }

    // --- 默认配置 ---
    const DEFAULT_TEMPLATES = {
        "默认模版": `<IMAGE_PROMPT_TEMPLATE>
You are a Visual Novel Engine. Generate story with image prompts wrapped in [IMG_GEN]...[/IMG_GEN] tags.
## 核心规则
1. 每200-300字插入一个图片提示词
2. 标签格式: \`1girl, [特征], [表情], [服装], [动作], [环境], [质量词]\`
3. 必须包含: masterpiece, best quality, aesthetic
## 人物数据库
</IMAGE_PROMPT_TEMPLATE>`
    };

    const DEFAULT_SETTINGS = {
        enabled: true,
        startTag: '[IMG_GEN]',
        endTag: '[/IMG_GEN]',
        globalPrefix: 'masterpiece, best quality, aesthetic', // NAI推荐前缀
        globalSuffix: '',
        globalNegative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, web address',
        injectEnabled: true,
        injectDepth: 0,
        injectRole: 'system',
        selectedTemplate: "默认模版",
        characters: [],
        llmConfig: {
            baseUrl: 'https://api.deepseek.com',
            apiKey: '',
            model: 'deepseek-chat',
            maxTokens: 8192,
            temperature: 0.9,
            topP: 1.0,
            frequencyPenalty: 0.0,
            presencePenalty: 0.0
        },
        // --- NovelAI 专属配置 ---
        imageSource: 'sd', // 'sd' (原有) 或 'novelai' (新功能)
        naiConfig: {
            apiKey: '', // NovelAI API Key
            model: 'nai-diffusion-3', // nai-diffusion-3, nai-diffusion-4-curated-preview
            resolution: 'portrait', // portrait, landscape, square
            width: 832,
            height: 1216,
            steps: 28,
            scale: 5,
            sampler: 'k_euler_ancestral',
            seed: -1, // -1 随机
            smea: true, // SMEA
            dyn: true,  // SMEA DYN
            decrisp: false // NAI4特性
        },
        autoRefresh: false,
        autoRefreshInterval: 3000,
        generateIntervalSeconds: 2,
        autoSendGenRequest: true,
        retryCount: 3,
        retryDelaySeconds: 2,
        timeoutEnabled: false,
        timeoutSeconds: 120,
        independentApiEnabled: false,
        independentApiHistoryCount: 4,
        independentApiDebounceMs: 1000,
        independentApiCustomPrompt: '',
        independentApiFilterTags: '',
        worldbookEnabled: true,
        worldbookSelections: {},
        sequentialGeneration: true, // NAI建议开启顺序生成
        streamingGeneration: false,
        activePreset: '默认配置',
        apiPresets: { '默认配置': {} },
        aiModifyTemplateV2: [],
        indepGenTemplateV2: []
    };

    // 默认模版填充 (简化版，防止报错)
    if (!DEFAULT_SETTINGS.aiModifyTemplateV2.length) {
        DEFAULT_SETTINGS.aiModifyTemplateV2 = [{ label: "默认", role: "user", content: "Optimize this prompt: " }];
    }
    if (!DEFAULT_SETTINGS.indepGenTemplateV2.length) {
        DEFAULT_SETTINGS.indepGenTemplateV2 = [{ label: "默认", role: "system", content: "Generate JSON prompt based on: " }];
    }

    let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    let customTemplates = {};
    let autoRefreshTimer = null;
    let autoRefreshPaused = false;
    let sequentialQueue = [];
    let sequentialProcessing = false;
    let independentApiDebounceTimer = null;
    let independentApiLastPreview = { latest: '', history: [] };

    // --- CSS 样式 (保持原版 + NAI特定样式) ---
    const GLOBAL_CSS = `
    :root { --nm-bg: #1e1e24; --nm-shadow-dark: rgba(0,0,0,0.5); --nm-shadow-light: rgba(60,60,70,0.3); --nm-accent: #6c8cff; --nm-text: #d4d4dc; --nm-radius: 12px; }
    .sd-ui-container * { box-sizing: border-box; font-family: sans-serif; }
    .sd-ui-wrap { margin: 5px 0; width: 100%; position: relative; }
    .sd-ui-viewport { position: relative; width: 100%; min-height: 50px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .sd-ui-image { max-width: 100%; border-radius: var(--nm-radius); box-shadow: 4px 4px 12px var(--nm-shadow-dark); cursor: pointer; }
    .sd-placeholder { padding: 20px; background: var(--nm-bg); border-radius: var(--nm-radius); color: #888; text-align: center; width: 100%; box-shadow: inset 2px 2px 5px var(--nm-shadow-dark); }
    .sd-zone { position: absolute; z-index: 10; }
    .sd-zone.right { top:0; right:0; width:20%; height:100%; cursor: e-resize; }
    .sd-zone.right.gen-mode { cursor: alias; }
    .sd-zone.left { top:0; left:0; width:20%; height:100%; cursor: w-resize; }
    .sd-zone.top { top:0; left:20%; width:60%; height:30%; cursor: text; }
    .sd-zone.delete { bottom:0; left:0; width:30%; height:15%; cursor: no-drop; z-index: 20; }
    .sd-ui-msg { position: absolute; bottom: 10px; background: rgba(0,0,0,0.7); color: #fff; padding: 4px 8px; border-radius: 4px; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    .sd-ui-msg.show { opacity: 1; }
    /* Settings Popup Styles */
    .sd-settings-popup { color: var(--nm-text); font-family: 'Segoe UI', sans-serif; }
    .sd-tab-nav { display: flex; gap: 8px; margin-bottom: 15px; padding: 5px; background: rgba(0,0,0,0.2); border-radius: 8px; }
    .sd-tab-btn { padding: 8px 15px; cursor: pointer; opacity: 0.7; border-radius: 6px; transition: 0.2s; }
    .sd-tab-btn.active { opacity: 1; background: var(--nm-accent); color: #fff; box-shadow: 0 0 10px rgba(108,140,255,0.4); }
    .sd-tab-content { display: none; }
    .sd-tab-content.active { display: block; animation: fadeIn 0.3s; }
    .text_pole { background: rgba(0,0,0,0.2) !important; border: 1px solid rgba(255,255,255,0.1) !important; color: var(--nm-text) !important; padding: 8px; border-radius: 6px; }
    .sd-btn-primary { background: var(--nm-accent); color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .sd-btn-secondary { background: #444; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    .sd-nai-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .sd-full-width { grid-column: span 2; }
    `;

    // --- 初始化与加载 ---
    function loadSettings() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                settings = { ...DEFAULT_SETTINGS, ...parsed };
                // Deep merge naiConfig
                settings.naiConfig = { ...DEFAULT_SETTINGS.naiConfig, ...(parsed.naiConfig || {}) };
                if (!settings.characters) settings.characters = [];
            } catch (e) { console.error(e); }
        }
    }

    function saveSettings() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    const waitForCore = setInterval(() => {
        if (typeof SillyTavern !== 'undefined' && typeof $ !== 'undefined' && SillyTavern.chat) {
            clearInterval(waitForCore);
            $('<style>').text(GLOBAL_CSS).appendTo('head');
            loadSettings();
            initScript();
        }
    }, 500);

    function initScript() {
        addMenuItem();
        initGlobalListeners();
        setTimeout(processChatDOM, 1000);
        toastr.success(`🎨 生图助手(NAI版) 已加载`, '插件启动');
    }

    // --- 核心逻辑 ---

    // 1. DOM 处理与 UI 注入
    function processChatDOM() {
        if (!settings.enabled) return;
        const regex = new RegExp(`${escapeRegExp(settings.startTag)}([\\s\\S]*?)${escapeRegExp(settings.endTag)}`, 'g');

        $('.mes_text').each(function () {
            const $el = $(this);
            // 避免重复注入
            if ($el.find('.sd-ui-wrap').length > 0) return;

            const html = $el.html();
            if (html.indexOf(settings.startTag) === -1) return;

            let blockIdx = 0;
            const newHtml = html.replace(regex, (match, content) => {
                const parsed = parseBlockContent(content);
                const isScheduled = content.includes(SCHEDULED_FLAG);
                return createUIHtml(parsed.prompt, parsed.images, parsed.preventAuto, blockIdx++, Math.max(0, parsed.images.length - 1), isScheduled);
            });

            if (html !== newHtml) $el.html(newHtml);
        });
        
        // 绑定事件
        $('.sd-ui-wrap').each(function() {
            const $w = $(this);
            const imgs = JSON.parse(decodeURIComponent($w.attr('data-images')));
            if (imgs.length === 0 && settings.autoSendGenRequest && !settings.sequentialGeneration) {
                // 简单防抖自动生成
                if (!$w.data('auto-triggered')) {
                    $w.data('auto-triggered', true);
                    setTimeout(() => handleGeneration(getState($w.find('.sd-zone.right'))), 1000);
                }
            } else if (imgs.length === 0 && settings.sequentialGeneration && !$w.data('queued')) {
                // 顺序生成加入队列
                const mesId = $w.closest('.mes').attr('mesid');
                const bIdx = parseInt($w.attr('data-block-idx'));
                const key = `${mesId}-${bIdx}`;
                if (!sequentialQueue.find(q => q.key === key)) {
                     sequentialQueue.push({ key, $w, mesId, bIdx });
                     $w.data('queued', true);
                     processSequentialQueue();
                }
            }
        });
    }

    function createUIHtml(prompt, images, prevent, blockIdx, initIdx, isScheduled) {
        const has = images.length > 0;
        const placeholder = isScheduled ? '⏳ 队列中...' : (has ? '' : '等待生成 (点击右侧)');
        return `
        <div class="sd-ui-container">
            <div class="sd-ui-wrap" data-prompt="${encodeURIComponent(prompt)}" data-images="${encodeURIComponent(JSON.stringify(images))}" data-block-idx="${blockIdx}" data-cur-idx="${initIdx}">
                <div class="sd-ui-viewport">
                    <div class="sd-zone top" title="编辑提示词"></div>
                    <div class="sd-zone left" style="display:${initIdx > 0 ? 'block' : 'none'}"></div>
                    <div class="sd-zone right ${!has || initIdx === images.length - 1 ? 'gen-mode' : ''}" title="生成/下一张"></div>
                    <div class="sd-zone delete" style="display:${has ? 'block' : 'none'}" title="删除当前图"></div>
                    <div class="sd-ui-msg">${has ? `${initIdx + 1}/${images.length}` : ''}</div>
                    <img class="sd-ui-image" src="${has ? images[initIdx] : ''}" style="display:${has ? 'block' : 'none'}" />
                    <div class="sd-placeholder" style="display:${has ? 'none' : 'block'}">${placeholder}</div>
                </div>
            </div>
        </div>`;
    }

    function parseBlockContent(text) {
        text = text.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const urlRegex = /(https?:\/\/|\/|output\/)[^\n]+?\.(png|jpg|jpeg|webp|gif)/gi;
        const images = (text.match(urlRegex) || []).map(u => u.trim());
        const prompt = text.replace(urlRegex, '').replace(NO_GEN_FLAG, '').replace(SCHEDULED_FLAG, '').trim();
        return { prompt, images, preventAuto: text.includes(NO_GEN_FLAG) };
    }

    // 2. 交互逻辑
    function initGlobalListeners() {
        const $chat = $('#chat');
        
        $chat.on('click', '.sd-zone.right', function(e) {
            e.stopPropagation();
            const s = getState($(this));
            if (s.idx < s.images.length - 1) updateWrapperView(s.$wrap, s.images, s.idx + 1);
            else handleGeneration(s);
        });

        $chat.on('click', '.sd-zone.left', function(e) {
            e.stopPropagation();
            const s = getState($(this));
            if (s.idx > 0) updateWrapperView(s.$wrap, s.images, s.idx - 1);
        });
        
        $chat.on('click', '.sd-zone.top', function(e) {
            e.stopPropagation();
            const s = getState($(this));
            openEditPopup(s);
        });
        
        $chat.on('click', '.sd-zone.delete', async function(e) {
             e.stopPropagation();
             if(!confirm('删除此图片?')) return;
             const s = getState($(this));
             s.images.splice(s.idx, 1);
             await updateChatData(s.mesId, s.blockIdx, s.prompt, s.images);
             updateWrapperView(s.$wrap, s.images, Math.max(0, s.images.length - 1));
        });

        $chat.on('click', '.sd-ui-image', function() {
            window.open($(this).attr('src'), '_blank');
        });
    }

    function getState($el) {
        const $wrap = $el.closest('.sd-ui-wrap');
        return {
            $wrap,
            mesId: $wrap.closest('.mes').attr('mesid'),
            blockIdx: parseInt($wrap.attr('data-block-idx')),
            prompt: decodeURIComponent($wrap.attr('data-prompt')),
            images: JSON.parse(decodeURIComponent($wrap.attr('data-images'))),
            idx: parseInt($wrap.attr('data-cur-idx')) || 0,
            elMsg: $wrap.find('.sd-ui-msg'),
            elImg: $wrap.find('.sd-ui-image')
        };
    }

    // 3. 生成逻辑 (核心修改)
    async function handleGeneration(s) {
        if (s.$wrap.data('generating')) return;
        s.$wrap.data('generating', true);
        s.elMsg.text('🚀 正在请求...').addClass('show');
        s.elImg.css('opacity', 0.5);

        try {
            let newUrl = null;

            // 分支：NovelAI 模式 vs 原生 SD 模式
            if (settings.imageSource === 'novelai') {
                s.elMsg.text('🎨 NAI生成中...');
                newUrl = await generateWithNovelAI(s.prompt);
            } else {
                // 原有 SD 逻辑
                s.elMsg.text('🎨 SD生成中...');
                newUrl = await generateWithSD(s.prompt);
            }

            if (newUrl) {
                s.images.push(newUrl);
                await updateChatData(s.mesId, s.blockIdx, s.prompt, s.images);
                updateWrapperView(s.$wrap, s.images, s.images.length - 1);
                s.elMsg.text('✅ 完成');
            } else {
                throw new Error("未获取到图片URL");
            }
        } catch (e) {
            console.error(e);
            s.elMsg.text(`❌ 失败: ${e.message}`);
            toastr.error(e.message, '生图失败');
        } finally {
            s.$wrap.data('generating', false);
            s.elImg.css('opacity', 1);
            setTimeout(() => s.elMsg.removeClass('show'), 2000);
            
            // 顺序生成处理下一个
            if (settings.sequentialGeneration) {
                sequentialProcessing = false;
                processSequentialQueue();
            }
        }
    }

    // --- NovelAI 直连生成实现 ---
    async function generateWithNovelAI(prompt) {
        const conf = settings.naiConfig;
        if (!conf.apiKey) throw new Error("请在设置中填写 NovelAI API Key");

        const fullPrompt = `${settings.globalPrefix}, ${prompt}, ${settings.globalSuffix}`.replace(/,\s*,/g, ',');
        
        // 构造 NAI 请求体
        const body = {
            input: fullPrompt,
            model: conf.model,
            action: 'generate',
            parameters: {
                width: parseInt(conf.width),
                height: parseInt(conf.height),
                scale: parseFloat(conf.scale),
                sampler: conf.sampler,
                steps: parseInt(conf.steps),
                n_samples: 1,
                ucPreset: 0,
                qualityToggle: true,
                sm: conf.smea,
                sm_dyn: conf.dyn,
                dynamic_thresholding: conf.decrisp,
                controlnet_strength: 1,
                legacy: false,
                add_original_image: false,
                uncond_scale: 1,
                cfg_rescale: 0,
                noise_schedule: "native",
                negative_prompt: settings.globalNegative,
                seed: conf.seed === -1 ? Math.floor(Math.random() * 4294967295) : conf.seed
            }
        };

        addLog('NAI', `Sending request to NAI: ${conf.model} (${conf.width}x${conf.height})`);

        // 1. 请求 NAI API
        const response = await safeFetch('https://image.novelai.net/ai/generate-image', {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${conf.apiKey}`,
                "Content-Type": "application/json",
                "Origin": "https://novelai.net",
                "Referer": "https://novelai.net/"
            },
            body: JSON.stringify(body),
            responseType: 'arraybuffer' // 关键：接收二进制
        });

        if (!response.ok) {
            let errText = "Unknown Error";
            try { errText = new TextDecoder().decode(response.arrayBuffer()); } catch(e){}
            throw new Error(`NAI API Error ${response.status}: ${errText.substring(0, 100)}`);
        }

        // 2. 处理 ZIP 响应 (NAI 返回的是 zip)
        const zipData = response.arrayBuffer();
        const imageBlob = await extractImageFromZip(zipData);
        
        // 3. 上传到 SillyTavern 服务器保存
        const formData = new FormData();
        formData.append('avatar', imageBlob, `nai_${Date.now()}.png`);

        // 假设 ST 运行在同域，使用相对路径上传
        const uploadRes = await fetch('/api/images/upload', {
            method: 'POST',
            headers: { 'X-CSRF-Token': SillyTavern.token }, // 如果 ST 需要 token
            body: formData
        });

        if (!uploadRes.ok) throw new Error("Failed to upload image to SillyTavern");
        const uploadJson = await uploadRes.json();
        
        // ST 返回的通常是 url 字段
        return uploadJson.url || uploadJson.path; 
    }

    // 简易 ZIP 解压 (仅针对 NAI 返回的无加密 ZIP/Deflate)
    async function extractImageFromZip(buffer) {
        // NAI 的 zip 通常包含一个 png 文件。
        // 为了不引入大库，我们使用浏览器原生的 DecompressionStream (Chrome 80+, Edge 80+)
        // 或者简单寻找 PNG 头 (89 50 4E 47)。
        // 注意：NAI 实际上使用的是 Store (不压缩) 模式或者 Deflate。
        
        const view = new DataView(buffer);
        // ZIP Local File Header Signature: 0x04034b50
        if (view.getUint32(0, true) !== 0x04034b50) {
             throw new Error("Invalid ZIP format from NAI");
        }
        
        const compression = view.getUint16(8, true); // 0 = Store, 8 = Deflate
        const nameLen = view.getUint16(26, true);
        const extraLen = view.getUint16(28, true);
        const dataStart = 30 + nameLen + extraLen;
        
        // 切片获取压缩数据部分 (简单起见，假设只有一个文件且占满剩余部分，忽略 Central Directory)
        // 实际上 NAI 返回的 zip 很干净。
        const compressedData = buffer.slice(dataStart);
        
        let fileStream;
        if (compression === 0) {
            // Store mode
            return new Blob([compressedData], { type: 'image/png' });
        } else if (compression === 8) {
            // Deflate mode
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            writer.write(compressedData);
            writer.close();
            const chunk = await new Response(ds.readable).arrayBuffer();
            return new Blob([chunk], { type: 'image/png' });
        } else {
            throw new Error(`Unsupported ZIP compression: ${compression}`);
        }
    }

    // --- 原有 SD 生成 (保留) ---
    async function generateWithSD(prompt) {
        const finalPrompt = `${settings.globalPrefix}, ${prompt}, ${settings.globalSuffix}`.replace(/,\s*,/g, ',');
        const cmd = `/sd quiet=true ${settings.globalNegative ? `negative="${escapeArg(settings.globalNegative)}"` : ''} ${finalPrompt}`;
        
        // 触发 ST 命令
        const trigger = (window.triggerSlash || window.parent?.triggerSlash);
        const result = await trigger(cmd); // 这里 ST 会返回输出文本
        
        // 解析 URL
        const urls = (result || '').match(/(https?:\/\/|\/|output\/)[^\n]+?\.(png|jpg|jpeg|webp|gif)/gi) || [];
        return urls.length > 0 ? urls[0] : null;
    }

    // --- 顺序队列处理 ---
    async function processSequentialQueue() {
        if (sequentialProcessing || sequentialQueue.length === 0) return;
        sequentialProcessing = true;
        
        const task = sequentialQueue.shift();
        if (task && task.$wrap.find('.sd-ui-image').css('display') === 'none') {
            await handleGeneration(getState(task.$wrap.find('.sd-zone.right')));
            // 等待间隔
            await new Promise(r => setTimeout(r, settings.generateIntervalSeconds * 1000));
        } else {
            sequentialProcessing = false;
            processSequentialQueue(); // Skip if already done
        }
    }

    // --- 数据更新 ---
    async function updateChatData(mesId, blockIdx, prompt, images) {
        const chat = SillyTavern.chat[parseInt(mesId)];
        if (!chat) return;
        
        // 重新构建消息
        const regex = new RegExp(`${escapeRegExp(settings.startTag)}([\\s\\S]*?)${escapeRegExp(settings.endTag)}`, 'g');
        const matches = [...chat.mes.matchAll(regex)];
        
        if (matches[blockIdx]) {
            let inner = prompt;
            if (images.length > 0) inner += '\n' + images.join('\n');
            const newBlock = `${settings.startTag}\n${inner}\n${settings.endTag}`;
            
            chat.mes = chat.mes.substring(0, matches[blockIdx].index) + newBlock + chat.mes.substring(matches[blockIdx].index + matches[blockIdx][0].length);
            
            // 保存
            await SillyTavern.saveChat();
        }
    }

    function updateWrapperView($wrap, images, idx) {
        const s = getState($wrap.find('.sd-zone.right'));
        $wrap.attr('data-cur-idx', idx).attr('data-images', encodeURIComponent(JSON.stringify(images)));
        
        if (images.length === 0) {
            s.elImg.hide(); 
            $wrap.find('.sd-placeholder').show().text('等待生成');
        } else {
            $wrap.find('.sd-placeholder').hide();
            s.elImg.attr('src', images[idx]).show();
            s.elMsg.text(`${idx + 1}/${images.length}`).addClass('show');
            setTimeout(() => s.elMsg.removeClass('show'), 1500);
        }
        
        $wrap.find('.sd-zone.left').toggle(idx > 0);
        $wrap.find('.sd-zone.right').toggleClass('gen-mode', idx === images.length - 1);
    }

    // --- 界面辅助 ---
    function escapeArg(s) { return String(s || '').replace(/["\\]/g, '\\$&'); }
    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    
    function addMenuItem() {
        if ($('#extensionsMenu').length === 0) return setTimeout(addMenuItem, 1000);
        const $item = $(`<div class="list-group-item interactable" id="${SCRIPT_ID}_menu"><div class="fa-fw fa-solid fa-paint-brush"></div><span>生图助手(NAI)</span></div>`);
        $item.on('click', openSettingsPopup);
        $('#extensionsMenu').append($item);
    }

    // --- 设置弹窗 (包含 NAI 设置) ---
    function openSettingsPopup() {
        const conf = settings.naiConfig;
        const html = `
        <div class="sd-settings-popup">
            <h3 style="text-align:center;">🎨 生图助手 Pro <small>v45.0</small></h3>
            <div class="sd-tab-nav">
                <div class="sd-tab-btn active" data-tab="basic">基础</div>
                <div class="sd-tab-btn" data-tab="nai">NovelAI</div>
                <div class="sd-tab-btn" data-tab="prompts">模版 & 人物</div>
            </div>

            <div id="tab-basic" class="sd-tab-content active">
                <label style="display:block; margin:10px 0;">
                    <input type="checkbox" id="sd-enabled" ${settings.enabled ? 'checked' : ''}> 启用插件
                </label>
                <label style="display:block; margin:10px 0;">
                    生图源: 
                    <select id="sd-source" class="text_pole">
                        <option value="sd" ${settings.imageSource === 'sd' ? 'selected' : ''}>酒馆自带 SD (/sd)</option>
                        <option value="novelai" ${settings.imageSource === 'novelai' ? 'selected' : ''}>NovelAI 直连 (推荐)</option>
                    </select>
                </label>
                <div class="sd-nai-grid">
                    <label>全局前缀 <textarea id="sd-prefix" class="text_pole" rows="3" style="width:100%">${settings.globalPrefix}</textarea></label>
                    <label>负面提示 <textarea id="sd-neg" class="text_pole" rows="3" style="width:100%">${settings.globalNegative}</textarea></label>
                </div>
                <div style="margin-top:10px;">
                    <label><input type="checkbox" id="sd-seq" ${settings.sequentialGeneration ? 'checked' : ''}> 顺序生图 (避免并发错误)</label>
                    <br>
                    <label><input type="checkbox" id="sd-auto" ${settings.autoSendGenRequest ? 'checked' : ''}> 自动发送请求</label>
                </div>
            </div>

            <div id="tab-nai" class="sd-tab-content">
                <div style="padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; margin-bottom:10px;">
                    <label style="display:block; font-weight:bold;">API Key (Bearer Token)</label>
                    <input type="password" id="nai-key" class="text_pole" style="width:100%;" value="${conf.apiKey}" placeholder="pst-..." />
                </div>
                
                <div class="sd-nai-grid">
                    <div class="sd-full-width">
                        <label>模型</label>
                        <select id="nai-model" class="text_pole" style="width:100%;">
                            <option value="nai-diffusion-3" ${conf.model === 'nai-diffusion-3' ? 'selected' : ''}>NAI Diffusion V3</option>
                            <option value="nai-diffusion-4-curated-preview" ${conf.model === 'nai-diffusion-4-curated-preview' ? 'selected' : ''}>NAI Diffusion V4 (Preview)</option>
                            <option value="nai-diffusion-furry-3" ${conf.model === 'nai-diffusion-furry-3' ? 'selected' : ''}>NAI Furry V3</option>
                        </select>
                    </div>

                    <label>分辨率类型</label>
                    <select id="nai-res-type" class="text_pole" style="width:100%;">
                        <option value="portrait" ${conf.resolution === 'portrait' ? 'selected' : ''}>Portrait (832x1216)</option>
                        <option value="landscape" ${conf.resolution === 'landscape' ? 'selected' : ''}>Landscape (1216x832)</option>
                        <option value="square" ${conf.resolution === 'square' ? 'selected' : ''}>Square (1024x1024)</option>
                    </select>
                    
                    <label>Steps: <span id="val-steps">${conf.steps}</span></label>
                    <input type="range" id="nai-steps" min="1" max="50" value="${conf.steps}" oninput="$('#val-steps').text(this.value)">

                    <label>Guidance: <span id="val-scale">${conf.scale}</span></label>
                    <input type="range" id="nai-scale" min="1" max="10" step="0.5" value="${conf.scale}" oninput="$('#val-scale').text(this.value)">

                    <label class="sd-full-width">Sampler</label>
                    <select id="nai-sampler" class="text_pole" style="width:100%;" class="sd-full-width">
                        <option value="k_euler_ancestral" ${conf.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral (推荐)</option>
                        <option value="k_euler" ${conf.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                        <option value="k_dpmpp_2m" ${conf.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                        <option value="k_dpmpp_sde" ${conf.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                    </select>

                    <div class="sd-full-width" style="display:flex; gap:15px; margin-top:5px;">
                        <label><input type="checkbox" id="nai-smea" ${conf.smea ? 'checked' : ''}> SMEA</label>
                        <label><input type="checkbox" id="nai-dyn" ${conf.dyn ? 'checked' : ''}> DYN</label>
                        <label title="V4 Only"><input type="checkbox" id="nai-decrisp" ${conf.decrisp ? 'checked' : ''}> De-Crisp (V4)</label>
                    </div>
                </div>
            </div>

            <div id="tab-prompts" class="sd-tab-content">
                <p>请在代码中配置模版，或使用旧版界面的模版功能。</p>
            </div>

            <div style="margin-top:15px; display:flex; gap:10px;">
                <button id="sd-save" class="sd-btn-primary" style="flex:1;">💾 保存配置</button>
            </div>
        </div>
        `;

        SillyTavern.callGenericPopup(html, 1, '', { wide: false });

        // Tab 切换逻辑
        $('.sd-tab-btn').on('click', function() {
            $('.sd-tab-btn').removeClass('active');
            $(this).addClass('active');
            $('.sd-tab-content').removeClass('active');
            $('#tab-' + $(this).data('tab')).addClass('active');
        });

        // 保存逻辑
        $('#sd-save').on('click', () => {
            settings.enabled = $('#sd-enabled').is(':checked');
            settings.imageSource = $('#sd-source').val();
            settings.globalPrefix = $('#sd-prefix').val();
            settings.globalNegative = $('#sd-neg').val();
            settings.sequentialGeneration = $('#sd-seq').is(':checked');
            settings.autoSendGenRequest = $('#sd-auto').is(':checked');

            // NAI Config Save
            const resType = $('#nai-res-type').val();
            let w = 832, h = 1216;
            if (resType === 'landscape') { w = 1216; h = 832; }
            if (resType === 'square') { w = 1024; h = 1024; }

            settings.naiConfig = {
                apiKey: $('#nai-key').val(),
                model: $('#nai-model').val(),
                resolution: resType,
                width: w,
                height: h,
                steps: parseInt($('#nai-steps').val()),
                scale: parseFloat($('#nai-scale').val()),
                sampler: $('#nai-sampler').val(),
                seed: -1,
                smea: $('#nai-smea').is(':checked'),
                dyn: $('#nai-dyn').is(':checked'),
                decrisp: $('#nai-decrisp').is(':checked')
            };

            saveSettings();
            toastr.success('✅ 设置已保存');
            // 关闭弹窗
            const closeBtn = $('#dialogue_popup_ok');
            if(closeBtn.length) closeBtn.click();
            else SillyTavern.closePopup?.();
        });
    }

    function openEditPopup(s) {
        // 简易编辑弹窗
        const html = `
        <div style="padding:10px;">
            <h3>编辑提示词</h3>
            <textarea id="sd-edit-ta" class="text_pole" rows="5" style="width:100%;">${s.prompt}</textarea>
            <button id="sd-edit-save" class="sd-btn-primary" style="margin-top:10px; width:100%;">确认修改</button>
        </div>`;
        SillyTavern.callGenericPopup(html, 1);
        $('#sd-edit-save').click(async () => {
            const newPrompt = $('#sd-edit-ta').val();
            s.prompt = newPrompt;
            await updateChatData(s.mesId, s.blockIdx, s.prompt, s.images);
            // 刷新UI
            const $newWrap = $(`.mes[mesid="${s.mesId}"] .sd-ui-wrap[data-block-idx="${s.blockIdx}"]`);
            $newWrap.attr('data-prompt', encodeURIComponent(newPrompt));
            toastr.success('修改已保存');
            if(SillyTavern.closePopup) SillyTavern.closePopup();
        });
    }

})();