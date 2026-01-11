(async function () {

  // 等 sdHelper 就绪
  while (!window.sdHelper) {
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('✅ NovelAI backend attaching to sdHelper');

  /*************************************************
   * 1️⃣ 注入 NovelAI 配置到生图助手设置
   *************************************************/
  window.sdHelper.backends = window.sdHelper.backends || {};

  window.sdHelper.backends.novelai = {
    name: 'NovelAI',
    config: {
      apiKey: '',
      model: 'nai-diffusion-4.5',
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5,
      sampler: 'k_euler_ancestral',
      seed: -1
    },

    ui() {
      return `
        <div class="sdh-block">
          <label>API Key
            <input type="password" data-key="apiKey">
          </label>
          <label>模型
            <select data-key="model">
              <option value="nai-diffusion-4.5">NAI 4.5</option>
              <option value="nai-diffusion-4">NAI 4</option>
            </select>
          </label>
          <label>尺寸
            <input data-key="width" size="4"> ×
            <input data-key="height" size="4">
          </label>
          <label>Steps <input data-key="steps"></label>
          <label>CFG <input data-key="scale"></label>
          <label>Sampler <input data-key="sampler"></label>
          <label>Seed <input data-key="seed"></label>
        </div>
      `;
    },

    async generate(prompt, negative) {
      const res = await fetch('https://api.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: prompt,
          model: this.config.model,
          action: 'generate',
          parameters: {
            width: this.config.width,
            height: this.config.height,
            steps: this.config.steps,
            scale: this.config.scale,
            sampler: this.config.sampler,
            seed: this.config.seed,
            negative_prompt: negative
          }
        })
      });

      if (!res.ok) throw new Error('NovelAI API error');
      return await res.arrayBuffer();
    }
  };

  /*************************************************
   * 2️⃣ 解 ZIP + 插入对话气泡
   *************************************************/
  window.sdHelper.insertImagesFromZip = async function (zipBuffer) {
    const zip = await JSZip.loadAsync(zipBuffer);
    for (const name in zip.files) {
      if (!name.endsWith('.png')) continue;
      const blob = await zip.files[name].async('blob');
      const url = URL.createObjectURL(blob);

      window.addOneMessage({
        role: 'assistant',
        content: [{ type: 'image', url }]
      });
    }
  };

  console.log('✅ NovelAI backend ready (inside 生图助手)');

})();
