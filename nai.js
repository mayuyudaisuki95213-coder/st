// NovelAI Image Generator for SillyTavern
(async function () {

  const STORE_KEY = 'novelai_image_config';

  const state = {
    enabled: true,
    config: Object.assign({
      apiKey: '',
      model: 'nai-diffusion-4.5',
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5,
      sampler: 'k_euler_ancestral',
      seed: -1,
      n_samples: 1,
      negative: ''
    }, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'))
  };

  function saveConfig() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.config));
  }

  /*********************************************************
   * ✅ UI：小魔法棒（Generation Modifier）
   *********************************************************/
  window.registerGenerationModifier?.({
    name: '🖼 NovelAI 生图',
    description: '使用 NovelAI 直接生图并插入对话',
    icon: '🖼',
    onClick: openConfigUI
  });

  function openConfigUI() {
    const html = `
      <div class="nai-ui">
        <label>API Key <input id="nai-key" type="password" value="${state.config.apiKey}"></label>
        <label>模型
          <select id="nai-model">
            <option value="nai-diffusion-4.5">NAI 4.5</option>
            <option value="nai-diffusion-4">NAI 4</option>
          </select>
        </label>
        <label>尺寸
          <input id="nai-w" value="${state.config.width}" size="4"> ×
          <input id="nai-h" value="${state.config.height}" size="4">
        </label>
        <label>Steps <input id="nai-steps" value="${state.config.steps}"></label>
        <label>CFG <input id="nai-scale" value="${state.config.scale}"></label>
        <label>Sampler <input id="nai-sampler" value="${state.config.sampler}"></label>
        <label>Seed <input id="nai-seed" value="${state.config.seed}"></label>
        <button id="nai-save">保存</button>
      </div>
    `;

    window.popup?.show?.({
      title: 'NovelAI 生图设置',
      content: html,
      onClose: () => {}
    });

    setTimeout(() => {
      document.getElementById('nai-save').onclick = () => {
        state.config.apiKey = document.getElementById('nai-key').value.trim();
        state.config.model = document.getElementById('nai-model').value;
        state.config.width = +document.getElementById('nai-w').value;
        state.config.height = +document.getElementById('nai-h').value;
        state.config.steps = +document.getElementById('nai-steps').value;
        state.config.scale = +document.getElementById('nai-scale').value;
        state.config.sampler = document.getElementById('nai-sampler').value;
        state.config.seed = +document.getElementById('nai-seed').value;
        saveConfig();
        toastr.success('✅ NovelAI 设置已保存');
      };
    }, 50);
  }

  /*********************************************************
   * ✅ NovelAI 生图
   *********************************************************/
  async function generateNovelAI(prompt, negative) {
    const res = await fetch('https://api.novelai.net/ai/generate-image', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: prompt,
        model: state.config.model,
        action: 'generate',
        parameters: {
          width: state.config.width,
          height: state.config.height,
          steps: state.config.steps,
          scale: state.config.scale,
          sampler: state.config.sampler,
          seed: state.config.seed,
          n_samples: state.config.n_samples,
          negative_prompt: negative || state.config.negative
        }
      })
    });

    if (!res.ok) throw new Error('NovelAI API 请求失败');
    return await res.arrayBuffer();
  }

  /*********************************************************
   * ✅ ZIP 解包 + 插入图片气泡
   *********************************************************/
  async function insertImagesFromZip(zipBuffer) {
    const zip = await window.JSZip.loadAsync(zipBuffer);
    for (const name of Object.keys(zip.files)) {
      if (!name.endsWith('.png')) continue;
      const blob = await zip.files[name].async('blob');
      const url = URL.createObjectURL(blob);

      window.addOneMessage?.({
        role: 'assistant',
        content: [
          { type: 'image', url }
        ]
      });
    }
  }

  /*********************************************************
   * ✅ 监听 [IMG_GEN]
   *********************************************************/
  window.addEventListener('message', async (e) => {
    const text = e.data?.text;
    if (!text || !text.includes('[IMG_GEN]')) return;

    const m = text.match(/\[IMG_GEN\]([\s\S]*?)\[\/IMG_GEN\]/);
    if (!m) return;

    try {
      toastr.info('🎨 NovelAI 生图中...');
      const zip = await generateNovelAI(m[1].trim(), state.config.negative);
      await insertImagesFromZip(zip);
      toastr.success('✅ NovelAI 生图完成');
    } catch (err) {
      console.error(err);
      toastr.error('❌ NovelAI 生图失败');
    }
  });

  console.log('✅ NovelAI 生图助手（魔法棒版）已就绪');

})();
