// ===============================
// NovelAI Image Helper for SillyTavern
// ===============================
(async function () {

  // ========= 全局状态 =========
  const state = {
    backend: 'novelai', // novelai | sd
    config: {
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
    }
  };

  // ========= UI：新 Tab =========
  function createNovelAITab() {
    const tab = document.createElement('div');
    tab.id = 'novelai-tab';
    tab.innerHTML = `
      <h3>NovelAI 生图</h3>
      <label>API Key <input type="password" id="nai-key"></label>
      <label>模型
        <select id="nai-model">
          <option value="nai-diffusion-4.5">NAI 4.5</option>
          <option value="nai-diffusion-4">NAI 4</option>
        </select>
      </label>
      <label>尺寸
        <input id="nai-w" value="832"> x
        <input id="nai-h" value="1216">
      </label>
      <label>Steps <input id="nai-steps" value="28"></label>
      <label>CFG <input id="nai-scale" value="5"></label>
      <label>Sampler <input id="nai-sampler" value="k_euler_ancestral"></label>
      <label>Seed <input id="nai-seed" value="-1"></label>
      <button id="nai-save">保存配置</button>
      <hr>
      <button id="nai-use">使用 NovelAI</button>
      <button id="sd-use">使用 SD</button>
    `;

    document.body.appendChild(tab);

    document.getElementById('nai-save').onclick = () => {
      state.config.apiKey = document.getElementById('nai-key').value;
      state.config.model = document.getElementById('nai-model').value;
      state.config.width = +document.getElementById('nai-w').value;
      state.config.height = +document.getElementById('nai-h').value;
      state.config.steps = +document.getElementById('nai-steps').value;
      state.config.scale = +document.getElementById('nai-scale').value;
      state.config.sampler = document.getElementById('nai-sampler').value;
      state.config.seed = +document.getElementById('nai-seed').value;
      alert('✅ NovelAI 配置已保存');
    };

    document.getElementById('nai-use').onclick = () => {
      state.backend = 'novelai';
      alert('✅ 已切换到 NovelAI');
    };

    document.getElementById('sd-use').onclick = () => {
      state.backend = 'sd';
      alert('✅ 已切换到 SD');
    };
  }

  // ========= NovelAI 生图 =========
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
          negative_prompt: negative
        }
      })
    });

    if (!res.ok) throw new Error('NovelAI API 错误');
    return await res.arrayBuffer();
  }

  // ========= 监听 IMG_GEN =========
  window.addEventListener('message', async (e) => {
    const text = e.data?.text;
    if (!text || !text.includes('[IMG_GEN]')) return;
    if (state.backend !== 'novelai') return;

    const m = text.match(/\[IMG_GEN\]([\s\S]*?)\[\/IMG_GEN\]/);
    if (!m) return;

    try {
      const zip = await generateNovelAI(m[1], state.config.negative);
      console.log('✅ NovelAI 生图完成', zip);
      // 这里可继续解 ZIP → 显示图片（已预留）
    } catch (err) {
      console.error(err);
      alert('❌ NovelAI 生图失败');
    }
  });

  // ========= 初始化 =========
  createNovelAITab();
  console.log('✅ NovelAI Helper 初始化完成');

})();