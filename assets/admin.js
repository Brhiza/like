// 管理面板 — 通过 Cloudflare Functions 与 GitHub 交互
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const loginView = $('#login-view');
  const appView = $('#app-view');
  const loginErrorEl = $('#login-error');

  let donations = { records: [], updated: '' };
  let sponsorsData = { sponsors: [], updated: '' };

  const fmtAmount = (n) => n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const fmtUpdated = (u) => u ? new Date(u).toLocaleString('zh-CN', { hour12: false }) : '—';
  const CHANNEL_LABELS = { txgy: '腾讯公益', xwgc: '希望工程', other: '其他' };
  const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

  // ============ Toast ============
  let toastEl = null;
  let toastTimer = null;
  function toast(msg, type = 'info', ms = 2200) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = `toast toast-${type} is-show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), ms);
  }

  function setBusy(btn, busyText) {
    if (!btn) return () => {};
    const originalText = btn.textContent;
    const originalDisabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add('is-busy');
    if (busyText) btn.textContent = busyText;
    return (newText) => {
      if (newText != null) btn.textContent = newText;
      else {
        btn.disabled = originalDisabled;
        btn.classList.remove('is-busy');
        btn.textContent = originalText;
      }
    };
  }

  // ============ Auth ============
  async function getAuthState() {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, error: data.error || '' };
    } catch (e) {
      return { ok: false, status: 0, error: e.message || '网络异常' };
    }
  }

  function setLoginError(msg) {
    if (!loginErrorEl) return;
    if (!msg) {
      loginErrorEl.hidden = true;
      loginErrorEl.textContent = '';
      return;
    }
    loginErrorEl.hidden = false;
    loginErrorEl.textContent = msg;
  }

  function formatAuthError(state) {
    if (!state) return '登录状态校验失败';
    if (state.status === 500 && state.error) return `管理接口未配置：${state.error}`;
    if (state.status === 401) return '登录未生效，请检查 HTTPS / Cookie 配置后重试';
    if (state.error) return state.error;
    if (state.status) return `登录状态校验失败 (${state.status})`;
    return '管理接口暂时不可用，请稍后重试';
  }

  function showLogin(msg = null) {
    appView.hidden = true;
    loginView.hidden = false;
    setLoginError(msg);
    setTimeout(() => $('#login-pw')?.focus(), 50);
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
    setLoginError(null);
    loadDonations();
    loadSponsors();
  }

  async function doLogin(ev) {
    ev.preventDefault();
    const btn = ev.submitter || $('#login-form button[type="submit"]');
    const update = setBusy(btn, '登录中…');
    const pw = $('#login-pw').value;
    setLoginError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `登录失败 (${res.status})`);
      }
      const authState = await getAuthState();
      if (!authState.ok) {
        throw new Error(formatAuthError(authState));
      }
      showApp();
    } catch (e) {
      setLoginError(e.message);
    } finally {
      update();
    }
  }

  async function doLogout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    showLogin();
  }

  // ============ Tabs ============
  function activateTab(name) {
    for (const tab of $$('.admin-tab')) {
      tab.classList.toggle('is-active', tab.dataset.tab === name);
    }
    for (const panel of $$('.admin-panel')) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  // ============ Donations ============
  const tbody = $('#adm-tbody');
  const setDonationStatus = (msg) => $('#adm-status').textContent = msg;

  async function loadDonations() {
    setDonationStatus('加载中…');
    try {
      const res = await fetch(`/data/donations.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`加载失败 (${res.status})`);
      donations = await res.json();
      donations.records = Array.isArray(donations.records) ? donations.records : [];
      populateFoundationList();
      renderDonationStats();
      applyDonationFilter();
      setDonationStatus(`共 ${donations.records.length} 条`);
    } catch (e) {
      setDonationStatus(`加载失败：${e.message}`);
    }
  }

  function renderDonationStats() {
    $('#adm-count').textContent = donations.records.length;
    const total = donations.records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    $('#adm-amount').textContent = '¥' + fmtAmount(total);
    $('#adm-updated').textContent = fmtUpdated(donations.updated);
  }

  function populateFoundationList() {
    const dl = $('#foundation-list');
    dl.innerHTML = '';
    const seen = new Set();
    for (const r of donations.records) {
      if (r.foundation && !seen.has(r.foundation)) {
        seen.add(r.foundation);
        const o = document.createElement('option');
        o.value = r.foundation;
        dl.appendChild(o);
      }
    }
  }

  function applyDonationFilter() {
    const q = $('#adm-q').value.trim().toLowerCase();
    const list = !q ? donations.records.slice() : donations.records.filter(r => {
      return [r.project, r.foundation, r.cert_no, r.name, r.effect, r.date].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderDonationTable(list);
  }

  function renderDonationTable(list) {
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--ink-500)">没有匹配的记录</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(r => {
      const ch = inferChannel(r.image);
      const channelTag = ch
        ? `<span class="tag tag-channel tag-channel-${ch}">${CHANNEL_LABELS[ch]}</span>`
        : '<span class="muted small">—</span>';
      return `
      <tr data-id="${escapeHtml(r.id)}">
        <td>${escapeHtml(r.date)}</td>
        <td>
          <div style="font-weight:600">${escapeHtml(r.project)}</div>
          <div class="muted small">${escapeHtml(r.name)}${r.effect ? ' · ' + escapeHtml(r.effect) : ''}</div>
        </td>
        <td>${escapeHtml(r.foundation)}</td>
        <td>${channelTag}</td>
        <td>${r.amount != null ? '¥' + fmtAmount(r.amount) : '—'}</td>
        <td><code class="muted small">${escapeHtml(r.cert_no)}</code></td>
        <td>${r.image ? `<img class="thumb" src="${escapeHtml(r.image)}" alt="" data-zoom>` : '—'}</td>
        <td class="col-action">
          <div class="row-actions">
            <button class="btn btn-secondary" data-act="edit">编辑</button>
            <button class="btn btn-danger" data-act="del">删除</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');
  }

  // Donation dialog
  const dlg = $('#record-dialog');
  const form = $('#record-form');
  const aiFillBtn = $('#btn-ai-fill');
  const aiHintEl = $('#ai-hint');
  let editingId = null;

  function setStatusText(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }

  function syncDonationImageUi({ resetAi = false } = {}) {
    const file = form.elements.image_file?.files?.[0] || null;
    const currentImage = form.elements.image.value || '';
    if (file) {
      $('#image-hint').textContent = `待上传：${file.name}（${fmtSize(file.size)}）`;
      if (aiFillBtn) aiFillBtn.disabled = false;
      if (resetAi) setStatusText(aiHintEl, '已选择证书图片，可用 AI 自动提取字段');
      return;
    }
    $('#image-hint').textContent = currentImage
      ? `当前：${currentImage}（不选择文件则保留）`
      : '请选择证书图片，将自动压缩并按日期命名上传';
    if (aiFillBtn) aiFillBtn.disabled = true;
    if (resetAi) setStatusText(aiHintEl, '选择证书图片后，可用 AI 自动提取字段');
  }

  function openNewDonation() {
    editingId = null;
    $('#record-dialog-title').textContent = '新增记录';
    form.reset();
    form.elements.name.value = '李柯';
    form.elements.date.value = new Date().toISOString().slice(0, 10);
    form.elements.id.value = '';
    form.elements.image.value = '';
    form.elements.channel.value = 'xwgc';
    syncDonationImageUi({ resetAi: true });
    showFormError('#record-error', null);
    dlg.showModal();
  }

  function openEditDonation(rec) {
    editingId = rec.id;
    $('#record-dialog-title').textContent = '编辑记录';
    form.reset();
    for (const k of ['name', 'project', 'foundation', 'amount', 'date', 'effect', 'cert_no']) {
      if (form.elements[k]) form.elements[k].value = rec[k] ?? '';
    }
    form.elements.id.value = rec.id;
    form.elements.image.value = rec.image || '';
    form.elements.channel.value = inferChannel(rec.image) || 'xwgc';
    syncDonationImageUi({ resetAi: true });
    showFormError('#record-error', null);
    dlg.showModal();
  }

  function inferChannel(imagePath) {
    if (!imagePath) return null;
    if (imagePath.includes('/txgy/')) return 'txgy';
    if (imagePath.includes('/xwgc/')) return 'xwgc';
    if (imagePath.includes('/other/')) return 'other';
    return null;
  }

  async function saveDonation(ev) {
    ev.preventDefault();
    const btn = $('#record-save');
    const isEdit = !!editingId;
    const update = setBusy(btn, '保存中…');
    showFormError('#record-error', null);
    try {
      const fd = new FormData(form);
      const file = fd.get('image_file');
      const channel = String(fd.get('channel') || '').trim();
      const date = String(fd.get('date') || '').trim();
      if (!channel) throw new Error('请选择捐赠渠道');
      let imagePath = fd.get('image') || '';

      if (file && file instanceof File && file.size > 0) {
        if (!date) throw new Error('请先填写捐赠日期再上传图片');
        update('上传图片中…');
        imagePath = await uploadImage(file, $('#image-hint'), { channel, date });
        update('保存中…');
      } else if (!imagePath) {
        throw new Error('请上传证书图片');
      }

      const amountRaw = fd.get('amount');
      const record = {
        id: fd.get('id') || fd.get('cert_no'),
        name: fd.get('name')?.trim(),
        project: fd.get('project')?.trim(),
        foundation: fd.get('foundation')?.trim(),
        amount: (amountRaw === '' || amountRaw == null) ? null : Number(amountRaw),
        amount_unit: '元',
        date,
        effect: fd.get('effect')?.trim() || null,
        cert_no: fd.get('cert_no')?.trim(),
        image: imagePath,
      };

      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/records/${encodeURIComponent(editingId)}` : '/api/records';
      const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `保存失败 (${res.status})`);
      }

      dlg.close();
      toast(isEdit ? '记录已更新' : '记录已新增', 'success');
      await loadDonations();
    } catch (e) {
      showFormError('#record-error', e.message);
      toast(e.message || '保存失败', 'error', 3200);
    } finally {
      update();
    }
  }

  // ============ Sponsors ============
  const spTbody = $('#sp-adm-tbody');
  const setSponsorStatus = (msg) => $('#sp-adm-status').textContent = msg;

  async function loadSponsors() {
    setSponsorStatus('加载中…');
    try {
      const res = await fetch(`/data/sponsors.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (res.status === 404) {
        sponsorsData = { sponsors: [], updated: '' };
      } else if (!res.ok) {
        throw new Error(`加载失败 (${res.status})`);
      } else {
        sponsorsData = await res.json();
        sponsorsData.sponsors = Array.isArray(sponsorsData.sponsors) ? sponsorsData.sponsors : [];
      }
      renderSponsorStats();
      applySponsorFilter();
      setSponsorStatus(`共 ${sponsorsData.sponsors.length} 条`);
    } catch (e) {
      setSponsorStatus(`加载失败：${e.message}`);
    }
  }

  function renderSponsorStats() {
    $('#sp-adm-count').textContent = sponsorsData.sponsors.length;
    const total = sponsorsData.sponsors.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    $('#sp-adm-amount').textContent = '¥' + fmtAmount(total);
    $('#sp-adm-updated').textContent = fmtUpdated(sponsorsData.updated);
  }

  function applySponsorFilter() {
    const q = $('#sp-adm-q').value.trim().toLowerCase();
    const list = !q ? sponsorsData.sponsors.slice() : sponsorsData.sponsors.filter(r => {
      return [r.name, r.message, r.date].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    list.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (Number(b.amount) || 0) - (Number(a.amount) || 0);
    });
    renderSponsorTable(list);
  }

  function renderSponsorTable(list) {
    if (!list.length) {
      spTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--ink-500)">没有匹配的赞赏</td></tr>`;
      return;
    }
    spTbody.innerHTML = list.map(r => `
      <tr data-id="${escapeHtml(r.id)}">
        <td>${escapeHtml(r.date)}</td>
        <td style="font-weight:600">${escapeHtml(r.name)}</td>
        <td>¥${fmtAmount(r.amount)}</td>
        <td class="muted small" style="max-width:280px">${escapeHtml(r.message || '')}</td>
        <td class="col-action">
          <div class="row-actions">
            <button class="btn btn-secondary" data-act="edit">编辑</button>
            <button class="btn btn-danger" data-act="del">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // Sponsor dialog
  const spDlg = $('#sponsor-dialog');
  const spForm = $('#sponsor-form');
  const sponsorAiFillBtn = $('#btn-sp-ai-fill');
  const sponsorAiHintEl = $('#sp-ai-hint');
  let editingSponsorId = null;

  function syncSponsorImageUi({ resetAi = false } = {}) {
    const file = spForm.elements.source_image_file?.files?.[0] || null;
    if (sponsorAiFillBtn) sponsorAiFillBtn.disabled = !file;
    if (resetAi) {
      setStatusText(
        sponsorAiHintEl,
        file ? '已选择赞赏截图，可用 AI 自动提取字段' : '选择赞赏截图后，可用 AI 自动提取字段',
      );
    }
  }

  function openNewSponsor() {
    editingSponsorId = null;
    $('#sponsor-dialog-title').textContent = '新增赞赏';
    spForm.reset();
    spForm.elements.date.value = new Date().toISOString().slice(0, 10);
    spForm.elements.id.value = '';
    syncSponsorImageUi({ resetAi: true });
    showFormError('#sponsor-error', null);
    spDlg.showModal();
  }

  function openEditSponsor(rec) {
    editingSponsorId = rec.id;
    $('#sponsor-dialog-title').textContent = '编辑赞赏';
    spForm.reset();
    spForm.elements.name.value = rec.name || '';
    spForm.elements.amount.value = rec.amount ?? '';
    spForm.elements.date.value = rec.date || '';
    spForm.elements.message.value = rec.message || '';
    spForm.elements.id.value = rec.id;
    syncSponsorImageUi({ resetAi: true });
    showFormError('#sponsor-error', null);
    spDlg.showModal();
  }

  async function saveSponsor(ev) {
    ev.preventDefault();
    const btn = $('#sponsor-save');
    const isEdit = !!editingSponsorId;
    const update = setBusy(btn, '保存中…');
    showFormError('#sponsor-error', null);
    try {
      const fd = new FormData(spForm);
      const sponsor = {
        id: fd.get('id') || undefined,
        name: fd.get('name')?.trim(),
        amount: Number(fd.get('amount')),
        date: fd.get('date'),
        message: fd.get('message')?.trim() || null,
      };
      const method = editingSponsorId ? 'PUT' : 'POST';
      const url = editingSponsorId ? `/api/sponsors/${encodeURIComponent(editingSponsorId)}` : '/api/sponsors';
      const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sponsor),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `保存失败 (${res.status})`);
      }
      spDlg.close();
      toast(isEdit ? '赞赏已更新' : '赞赏已新增', 'success');
      await loadSponsors();
    } catch (e) {
      showFormError('#sponsor-error', e.message);
      toast(e.message || '保存失败', 'error', 3200);
    } finally {
      update();
    }
  }

  // ============ Generic confirm ============
  const confirmDlg = $('#confirm-dialog');
  let pendingAction = null; // { fn, args }

  function askConfirm(text, fn) {
    pendingAction = fn;
    $('#confirm-text').textContent = text;
    confirmDlg.showModal();
  }

  async function runConfirmed() {
    const fn = pendingAction;
    pendingAction = null;
    const okBtn = $('#confirm-ok');
    const update = setBusy(okBtn, '处理中…');
    try {
      if (typeof fn === 'function') await fn();
    } finally {
      update();
      confirmDlg.close();
    }
  }

  function askDeleteDonation(rec) {
    askConfirm(`确认删除「${rec.project}」（${rec.date}）？该操作不可撤销。`, async () => {
      try {
        const res = await fetch(`/api/records/${encodeURIComponent(rec.id)}`, {
          method: 'DELETE', credentials: 'same-origin',
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `删除失败 (${res.status})`);
        }
        toast('记录已删除', 'success');
        await loadDonations();
      } catch (e) {
        setDonationStatus(`删除失败：${e.message}`);
        toast(e.message || '删除失败', 'error', 3200);
      }
    });
  }

  function askDeleteSponsor(rec) {
    askConfirm(`确认删除「${rec.name}」（${rec.date}，¥${fmtAmount(rec.amount)}）？`, async () => {
      try {
        const res = await fetch(`/api/sponsors/${encodeURIComponent(rec.id)}`, {
          method: 'DELETE', credentials: 'same-origin',
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `删除失败 (${res.status})`);
        }
        toast('赞赏已删除', 'success');
        await loadSponsors();
      } catch (e) {
        setSponsorStatus(`删除失败：${e.message}`);
        toast(e.message || '删除失败', 'error', 3200);
      }
    });
  }

  // ============ Image compression / upload ============
  async function fileToBase64(blob) {
    const buf = await blob.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function mimeFromExt(ext) {
    return MIME_BY_EXT[(ext || '').toLowerCase()] || 'application/octet-stream';
  }

  async function decodeImage(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file); } catch { /* fallback below */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法解码图片')); };
      img.src = url;
    });
  }

  async function compressImage(file, { maxDim = 1600, quality = 0.85, mime = 'image/jpeg' } = {}) {
    const originalExt = (file.name.split('.').pop() || 'bin').toLowerCase();
    if (!/^image\//.test(file.type)) {
      return {
        blob: file,
        ext: originalExt,
        mime: file.type || mimeFromExt(originalExt),
      };
    }

    const bitmap = await decodeImage(file);
    const w0 = bitmap.width, h0 = bitmap.height;
    const scale = Math.min(1, maxDim / Math.max(w0, h0));
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === 'function') bitmap.close();

    const blob = await new Promise(res => canvas.toBlob(res, mime, quality));
    if (!blob) throw new Error('压缩失败');

    if (blob.size >= file.size && scale === 1) {
      return {
        blob: file,
        ext: originalExt,
        mime: file.type || mimeFromExt(originalExt),
        original: true,
      };
    }
    return {
      blob,
      ext: mime === 'image/jpeg' ? 'jpg' : 'png',
      mime,
    };
  }

  async function uploadImage(file, hintEl, { channel, date } = {}) {
    const setHint = (msg) => { if (hintEl) hintEl.textContent = msg; };
    setHint(`压缩中… (${fmtSize(file.size)})`);

    let compressed;
    try {
      compressed = await compressImage(file, { maxDim: 1600, quality: 0.85 });
    } catch {
      compressed = { blob: file, ext: (file.name.split('.').pop() || 'png').toLowerCase() };
    }
    const { blob, ext, original } = compressed;
    const ratio = file.size > 0 ? (blob.size / file.size) * 100 : 100;
    setHint(original
      ? `已上传原图（${fmtSize(blob.size)}）`
      : `压缩 ${fmtSize(file.size)} → ${fmtSize(blob.size)}（${ratio.toFixed(0)}%），上传中…`);

    const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
    const baseName = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : `cert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const filename = `${baseName}.${safeExt}`;
    const b64 = await fileToBase64(blob);

    const res = await fetch('/api/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content_base64: b64, channel: channel || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `上传失败 (${res.status})`);
    }
    const j = await res.json();
    setHint(`已上传 ${j.path}（${fmtSize(blob.size)}）`);
    return j.path;
  }

  function applyDonationAiResult(extracted) {
    const applied = [];
    const textFields = [
      ['name', '捐赠人'],
      ['project', '项目名称'],
      ['foundation', '基金会 / 公益机构'],
      ['effect', '助力效应'],
      ['cert_no', '证书编号'],
    ];
    for (const [field, label] of textFields) {
      const value = String(extracted?.[field] ?? '').trim();
      if (!value || !form.elements[field]) continue;
      form.elements[field].value = value;
      applied.push(label);
    }
    if (extracted?.amount != null && Number.isFinite(Number(extracted.amount))) {
      form.elements.amount.value = String(extracted.amount);
      applied.push('金额');
    }
    if (typeof extracted?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
      form.elements.date.value = extracted.date;
      applied.push('捐赠日期');
    }
    if (extracted?.channel && CHANNEL_LABELS[extracted.channel]) {
      form.elements.channel.value = extracted.channel;
      applied.push('捐赠渠道');
    }
    return applied;
  }

  function applySponsorAiResult(extracted) {
    const applied = [];
    const name = String(extracted?.name ?? '').trim();
    if (name) {
      spForm.elements.name.value = name;
      applied.push('姓名 / 昵称');
    }
    if (extracted?.amount != null && Number.isFinite(Number(extracted.amount))) {
      spForm.elements.amount.value = String(extracted.amount);
      applied.push('金额');
    }
    if (typeof extracted?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
      spForm.elements.date.value = extracted.date;
      applied.push('日期');
    }
    const message = String(extracted?.message ?? '').trim();
    if (message) {
      spForm.elements.message.value = message;
      applied.push('留言');
    }
    return applied;
  }

  async function recognizeImageWithAi({ kind, file, button, statusEl, applyResult }) {
    if (!file) throw new Error('请先选择图片');

    const originalText = button?.textContent || 'AI 识别并填表';
    if (button) {
      button.disabled = true;
      button.textContent = '识别中…';
    }
    setStatusText(statusEl, '正在调用 AI 识别图片…');

    try {
      let prepared;
      try {
        prepared = await compressImage(file, { maxDim: 1400, quality: 0.82 });
      } catch {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        prepared = { blob: file, ext, mime: file.type || mimeFromExt(ext) };
      }

      const base64 = await fileToBase64(prepared.blob);
      const res = await fetch('/api/ai/extract', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          mime_type: prepared.mime || file.type || mimeFromExt(prepared.ext),
          image_base64: base64,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `识别失败 (${res.status})`);

      const applied = applyResult(data.extracted || {});
      const note = data.extracted?.notes ? ` 提示：${data.extracted.notes}` : '';
      const confidence = typeof data.extracted?.confidence === 'number'
        ? ` 置信度 ${(data.extracted.confidence * 100).toFixed(0)}%。`
        : '';
      setStatusText(
        statusEl,
        applied.length
          ? `已回填：${applied.join('、')}。请核对后再保存。${confidence}${note}`.trim()
          : `识别完成，但没有提取到可回填字段。${note}`.trim(),
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function recognizeDonationImage() {
    try {
      await recognizeImageWithAi({
        kind: 'donation',
        file: form.elements.image_file?.files?.[0] || null,
        button: aiFillBtn,
        statusEl: aiHintEl,
        applyResult: applyDonationAiResult,
      });
    } catch (e) {
      setStatusText(aiHintEl, e.message, true);
    }
  }

  async function recognizeSponsorImage() {
    try {
      await recognizeImageWithAi({
        kind: 'sponsor',
        file: spForm.elements.source_image_file?.files?.[0] || null,
        button: sponsorAiFillBtn,
        statusEl: sponsorAiHintEl,
        applyResult: applySponsorAiResult,
      });
    } catch (e) {
      setStatusText(sponsorAiHintEl, e.message, true);
    }
  }

  function showFormError(sel, msg) {
    const el = $(sel);
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  // ============ Batch — Donations ============
  const batchDlg = $('#batch-dialog');
  const batchTbody = $('#batch-tbody');
  const batchHintEl = $('#batch-hint');
  // rows: { id, file?, previewUrl?, status, statusType, fields, uploaded? }
  let batchRows = [];
  let batchRowSeq = 0;

  const BATCH_MAX = 50;

  function makeBatchRow({ file = null } = {}) {
    return {
      id: ++batchRowSeq,
      file,
      previewUrl: file ? URL.createObjectURL(file) : '',
      status: file ? '等待识别' : '待填写',
      statusType: '', // '', 'busy', 'ok', 'error'
      uploaded: '', // already-uploaded image path (after save attempt)
      fields: {
        name: '李柯',
        project: '',
        channel: 'xwgc',
        foundation: '',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        effect: '',
        cert_no: '',
      },
    };
  }

  function renderBatchRows() {
    if (!batchRows.length) {
      batchTbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--ink-500)">还没有待提交的记录,请上传图片或添加空白行</td></tr>`;
      return;
    }
    batchTbody.innerHTML = batchRows.map((row) => {
      const f = row.fields;
      const statusClass = row.statusType ? `is-${row.statusType}` : '';
      const thumb = row.previewUrl
        ? `<img src="${escapeHtml(row.previewUrl)}" alt="">`
        : '<span>无图</span>';
      return `
      <tr data-row="${row.id}">
        <td><div class="thumb-cell">${thumb}</div></td>
        <td><input name="name" value="${escapeHtml(f.name)}"></td>
        <td><input name="project" value="${escapeHtml(f.project)}"></td>
        <td>
          <select name="channel">
            <option value="txgy"${f.channel === 'txgy' ? ' selected' : ''}>腾讯公益</option>
            <option value="xwgc"${f.channel === 'xwgc' ? ' selected' : ''}>希望工程</option>
            <option value="other"${f.channel === 'other' ? ' selected' : ''}>其他</option>
          </select>
        </td>
        <td><input name="foundation" value="${escapeHtml(f.foundation)}" list="foundation-list"></td>
        <td><input name="amount" type="number" step="0.01" min="0" value="${escapeHtml(f.amount)}"></td>
        <td><input name="date" type="date" value="${escapeHtml(f.date)}"></td>
        <td><input name="effect" value="${escapeHtml(f.effect)}"></td>
        <td><input name="cert_no" value="${escapeHtml(f.cert_no)}"></td>
        <td><span class="row-status ${statusClass}">${escapeHtml(row.status || '')}</span></td>
        <td><button type="button" class="btn-row-del" data-act="del-row" title="删除该行">×</button></td>
      </tr>`;
    }).join('');
  }

  function updateBatchRowStatus(rowId, status, statusType = '') {
    const row = batchRows.find(r => r.id === rowId);
    if (!row) return;
    row.status = status;
    row.statusType = statusType;
    const span = batchTbody.querySelector(`tr[data-row="${rowId}"] .row-status`);
    if (span) {
      span.textContent = status;
      span.className = `row-status ${statusType ? 'is-' + statusType : ''}`;
    }
  }

  function readBatchRowFromDom(rowId) {
    const tr = batchTbody.querySelector(`tr[data-row="${rowId}"]`);
    const row = batchRows.find(r => r.id === rowId);
    if (!tr || !row) return null;
    for (const el of tr.querySelectorAll('input,select')) {
      const name = el.name;
      if (name && row.fields[name] !== undefined) {
        row.fields[name] = el.value;
      }
    }
    return row;
  }
  function syncAllBatchRowsFromDom() {
    for (const row of batchRows) readBatchRowFromDom(row.id);
  }

  function openBatchDonation() {
    batchRows = [];
    batchRowSeq = 0;
    setStatusText(batchHintEl, '可选择多张图片让 AI 自动识别,或先点 + 添加空白行手工填写');
    showFormError('#batch-error', null);
    populateFoundationList();
    renderBatchRows();
    batchDlg.showModal();
  }

  function closeBatchDonation() {
    // Actual cleanup happens in the dialog's `close` listener.
    batchDlg.close();
  }

  async function handleBatchFiles(files) {
    if (!files || !files.length) return;
    syncAllBatchRowsFromDom();
    const remaining = BATCH_MAX - batchRows.length;
    if (remaining <= 0) {
      setStatusText(batchHintEl, `单次最多 ${BATCH_MAX} 行,已达上限`, true);
      return;
    }
    const picked = [...files].slice(0, remaining);
    const skipped = files.length - picked.length;
    const newRows = picked.map(file => makeBatchRow({ file }));
    batchRows.push(...newRows);
    renderBatchRows();
    setStatusText(batchHintEl, `已添加 ${picked.length} 张图片,正在并发调用 AI 识别…${skipped ? `(已跳过 ${skipped} 张超出上限)` : ''}`);

    // Concurrency-limited AI recognition (3 at a time)
    let pointer = 0;
    let okCount = 0;
    let errCount = 0;
    const worker = async () => {
      while (pointer < newRows.length) {
        const row = newRows[pointer++];
        updateBatchRowStatus(row.id, 'AI 识别中…', 'busy');
        try {
          const extracted = await aiExtractFile('donation', row.file);
          const applied = applyExtractedToRow(row, extracted);
          if (applied.length) {
            updateBatchRowStatus(row.id, `已回填:${applied.join('、')}`, 'ok');
          } else {
            updateBatchRowStatus(row.id, '未识别到字段,请手动填写', 'error');
          }
          // Re-render row to reflect new values
          renderBatchRows();
          okCount++;
        } catch (e) {
          updateBatchRowStatus(row.id, `识别失败:${e.message || '未知错误'}`, 'error');
          errCount++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setStatusText(batchHintEl, `AI 识别完成:成功 ${okCount} 张,失败 ${errCount} 张。请核对后点「保存全部」。`);
  }

  function applyExtractedToRow(row, extracted) {
    const applied = [];
    const m = {
      name: '捐赠人', project: '项目', foundation: '基金会',
      effect: '助力效应', cert_no: '证书号',
    };
    for (const [k, label] of Object.entries(m)) {
      const v = String(extracted?.[k] ?? '').trim();
      if (v) { row.fields[k] = v; applied.push(label); }
    }
    if (extracted?.amount != null && Number.isFinite(Number(extracted.amount))) {
      row.fields.amount = String(extracted.amount);
      applied.push('金额');
    }
    if (typeof extracted?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
      row.fields.date = extracted.date;
      applied.push('日期');
    }
    if (extracted?.channel && CHANNEL_LABELS[extracted.channel]) {
      row.fields.channel = extracted.channel;
      applied.push('渠道');
    }
    return applied;
  }

  async function aiExtractFile(kind, file) {
    let prepared;
    try {
      prepared = await compressImage(file, { maxDim: 1400, quality: 0.82 });
    } catch {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      prepared = { blob: file, ext, mime: file.type || mimeFromExt(ext) };
    }
    const base64 = await fileToBase64(prepared.blob);
    const res = await fetch('/api/ai/extract', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        mime_type: prepared.mime || file.type || mimeFromExt(prepared.ext),
        image_base64: base64,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `识别失败 (${res.status})`);
    return data.extracted || {};
  }

  async function saveBatchDonation() {
    syncAllBatchRowsFromDom();
    showFormError('#batch-error', null);
    if (!batchRows.length) {
      showFormError('#batch-error', '请至少添加一条记录');
      return;
    }
    // Pre-validate
    for (let i = 0; i < batchRows.length; i++) {
      const f = batchRows[i].fields;
      const missing = [];
      if (!f.name?.trim()) missing.push('捐赠人');
      if (!f.project?.trim()) missing.push('项目');
      if (!f.foundation?.trim()) missing.push('基金会');
      if (!f.date?.trim()) missing.push('日期');
      if (!f.cert_no?.trim()) missing.push('证书编号');
      if (!batchRows[i].file && !batchRows[i].uploaded) missing.push('证书图片');
      if (missing.length) {
        updateBatchRowStatus(batchRows[i].id, `缺少:${missing.join('、')}`, 'error');
        showFormError('#batch-error', `第 ${i + 1} 行未填完整:${missing.join('、')}`);
        return;
      }
    }
    // Check internal cert_no duplicates
    {
      const seen = new Set();
      for (let i = 0; i < batchRows.length; i++) {
        const id = batchRows[i].fields.cert_no.trim();
        if (seen.has(id)) {
          updateBatchRowStatus(batchRows[i].id, `证书编号与第 ${[...seen].indexOf(id) + 1} 行重复`, 'error');
          showFormError('#batch-error', `第 ${i + 1} 行证书编号重复`);
          return;
        }
        seen.add(id);
      }
    }

    const saveBtn = $('#batch-save');
    const update = setBusy(saveBtn, '处理中…');
    try {
      // Step 1: upload images one by one (skip ones already uploaded)
      for (let i = 0; i < batchRows.length; i++) {
        const row = batchRows[i];
        if (row.uploaded) continue;
        if (!row.file) continue;
        updateBatchRowStatus(row.id, `上传图片中 (${i + 1}/${batchRows.length})…`, 'busy');
        try {
          const path = await uploadImage(row.file, null, {
            channel: row.fields.channel,
            date: row.fields.date,
          });
          row.uploaded = path;
          updateBatchRowStatus(row.id, '图片已上传', 'ok');
        } catch (e) {
          updateBatchRowStatus(row.id, `上传失败:${e.message}`, 'error');
          showFormError('#batch-error', `第 ${i + 1} 行图片上传失败:${e.message}`);
          return;
        }
      }

      // Step 2: build records and POST batch
      update('写入 GitHub…');
      const records = batchRows.map((row) => {
        const f = row.fields;
        const amountRaw = f.amount;
        return {
          id: f.cert_no.trim(),
          name: f.name.trim(),
          project: f.project.trim(),
          foundation: f.foundation.trim(),
          amount: (amountRaw === '' || amountRaw == null) ? null : Number(amountRaw),
          amount_unit: '元',
          date: f.date.trim(),
          effect: f.effect?.trim() || null,
          cert_no: f.cert_no.trim(),
          image: row.uploaded,
        };
      });

      const res = await fetch('/api/records', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `保存失败 (${res.status})`);

      toast(`已新增 ${data.added || records.length} 条记录`, 'success');
      closeBatchDonation();
      await loadDonations();
    } catch (e) {
      showFormError('#batch-error', e.message);
      toast(e.message || '保存失败', 'error', 3200);
    } finally {
      update();
    }
  }

  // ============ Batch — Sponsors ============
  const spBatchDlg = $('#sp-batch-dialog');
  const spBatchTbody = $('#sp-batch-tbody');
  const spBatchHintEl = $('#sp-batch-hint');
  let spBatchRows = [];
  let spBatchRowSeq = 0;

  function makeSpBatchRow() {
    return {
      id: ++spBatchRowSeq,
      status: '待填写',
      statusType: '',
      fields: {
        name: '',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        message: '',
      },
    };
  }

  function renderSpBatchRows() {
    if (!spBatchRows.length) {
      spBatchTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--ink-500)">还没有待提交的赞赏,请上传截图或添加空白行</td></tr>`;
      return;
    }
    spBatchTbody.innerHTML = spBatchRows.map((row) => {
      const f = row.fields;
      const statusClass = row.statusType ? `is-${row.statusType}` : '';
      return `
      <tr data-row="${row.id}">
        <td><input name="name" value="${escapeHtml(f.name)}"></td>
        <td><input name="amount" type="number" step="0.01" min="0" value="${escapeHtml(f.amount)}"></td>
        <td><input name="date" type="date" value="${escapeHtml(f.date)}"></td>
        <td><input name="message" value="${escapeHtml(f.message)}"></td>
        <td><span class="row-status ${statusClass}">${escapeHtml(row.status || '')}</span></td>
        <td><button type="button" class="btn-row-del" data-act="del-row" title="删除该行">×</button></td>
      </tr>`;
    }).join('');
  }

  function updateSpBatchRowStatus(rowId, status, statusType = '') {
    const row = spBatchRows.find(r => r.id === rowId);
    if (!row) return;
    row.status = status;
    row.statusType = statusType;
    const span = spBatchTbody.querySelector(`tr[data-row="${rowId}"] .row-status`);
    if (span) {
      span.textContent = status;
      span.className = `row-status ${statusType ? 'is-' + statusType : ''}`;
    }
  }

  function syncAllSpBatchRowsFromDom() {
    for (const row of spBatchRows) {
      const tr = spBatchTbody.querySelector(`tr[data-row="${row.id}"]`);
      if (!tr) continue;
      for (const el of tr.querySelectorAll('input')) {
        if (row.fields[el.name] !== undefined) row.fields[el.name] = el.value;
      }
    }
  }

  function openBatchSponsor() {
    spBatchRows = [];
    spBatchRowSeq = 0;
    setStatusText(spBatchHintEl, '可选择多张截图让 AI 自动识别,或先点 + 添加空白行手工填写');
    showFormError('#sp-batch-error', null);
    renderSpBatchRows();
    spBatchDlg.showModal();
  }

  async function handleSpBatchFiles(files) {
    if (!files || !files.length) return;
    syncAllSpBatchRowsFromDom();
    const remaining = BATCH_MAX - spBatchRows.length;
    if (remaining <= 0) {
      setStatusText(spBatchHintEl, `单次最多 ${BATCH_MAX} 行,已达上限`, true);
      return;
    }
    const picked = [...files].slice(0, remaining);
    const skipped = files.length - picked.length;
    const newRows = picked.map(() => makeSpBatchRow());
    spBatchRows.push(...newRows);
    renderSpBatchRows();
    setStatusText(spBatchHintEl, `已添加 ${picked.length} 行,正在并发调用 AI 识别…${skipped ? `(已跳过 ${skipped} 张超出上限)` : ''}`);

    let pointer = 0;
    let okCount = 0;
    let errCount = 0;
    const worker = async () => {
      while (pointer < newRows.length) {
        const i = pointer++;
        const row = newRows[i];
        const file = picked[i];
        updateSpBatchRowStatus(row.id, 'AI 识别中…', 'busy');
        try {
          const extracted = await aiExtractFile('sponsor', file);
          const applied = [];
          const v = (k, label) => {
            const val = String(extracted?.[k] ?? '').trim();
            if (val) { row.fields[k] = val; applied.push(label); }
          };
          v('name', '姓名');
          if (extracted?.amount != null && Number.isFinite(Number(extracted.amount))) {
            row.fields.amount = String(extracted.amount);
            applied.push('金额');
          }
          if (typeof extracted?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
            row.fields.date = extracted.date;
            applied.push('日期');
          }
          v('message', '留言');
          if (applied.length) {
            updateSpBatchRowStatus(row.id, `已回填:${applied.join('、')}`, 'ok');
          } else {
            updateSpBatchRowStatus(row.id, '未识别到字段,请手动填写', 'error');
          }
          renderSpBatchRows();
          okCount++;
        } catch (e) {
          updateSpBatchRowStatus(row.id, `识别失败:${e.message || '未知错误'}`, 'error');
          errCount++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setStatusText(spBatchHintEl, `AI 识别完成:成功 ${okCount} 张,失败 ${errCount} 张。请核对后点「保存全部」。`);
  }

  async function saveBatchSponsor() {
    syncAllSpBatchRowsFromDom();
    showFormError('#sp-batch-error', null);
    if (!spBatchRows.length) {
      showFormError('#sp-batch-error', '请至少添加一条赞赏');
      return;
    }
    for (let i = 0; i < spBatchRows.length; i++) {
      const f = spBatchRows[i].fields;
      const missing = [];
      if (!f.name?.trim()) missing.push('姓名');
      if (f.amount === '' || f.amount == null || !Number.isFinite(Number(f.amount))) missing.push('金额');
      if (!f.date?.trim()) missing.push('日期');
      if (missing.length) {
        updateSpBatchRowStatus(spBatchRows[i].id, `缺少:${missing.join('、')}`, 'error');
        showFormError('#sp-batch-error', `第 ${i + 1} 行未填完整:${missing.join('、')}`);
        return;
      }
    }
    const saveBtn = $('#sp-batch-save');
    const update = setBusy(saveBtn, '保存中…');
    try {
      const sponsors = spBatchRows.map(row => ({
        name: row.fields.name.trim(),
        amount: Number(row.fields.amount),
        date: row.fields.date.trim(),
        message: row.fields.message?.trim() || null,
      }));
      const res = await fetch('/api/sponsors', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsors }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `保存失败 (${res.status})`);
      toast(`已新增 ${data.added || sponsors.length} 条赞赏`, 'success');
      spBatchDlg.close();
      spBatchRows = [];
      await loadSponsors();
    } catch (e) {
      showFormError('#sp-batch-error', e.message);
      toast(e.message || '保存失败', 'error', 3200);
    } finally {
      update();
    }
  }

  // ============ Wire up ============
  function bind() {
    $('#login-form').addEventListener('submit', doLogin);
    $('#btn-logout').addEventListener('click', doLogout);

    // Tabs
    for (const tab of $$('.admin-tab')) {
      tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    }

    // Donations
    $('#btn-new').addEventListener('click', openNewDonation);
    $('#btn-batch').addEventListener('click', openBatchDonation);
    $('#adm-q').addEventListener('input', applyDonationFilter);
    $('#record-cancel').addEventListener('click', () => dlg.close());
    form.elements.image_file.addEventListener('change', () => syncDonationImageUi({ resetAi: true }));
    aiFillBtn.addEventListener('click', recognizeDonationImage);
    form.addEventListener('submit', saveDonation);
    tbody.addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-id]');
      if (!row) return;
      const rec = donations.records.find(r => r.id === row.dataset.id);
      if (!rec) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'edit') openEditDonation(rec);
      else if (act === 'del') askDeleteDonation(rec);
      else if (e.target.matches('[data-zoom]')) window.open(rec.image, '_blank');
    });

    // Batch donations
    $('#batch-files').addEventListener('change', (e) => {
      handleBatchFiles(e.target.files);
      e.target.value = ''; // allow re-selecting same files
    });
    $('#batch-add-row').addEventListener('click', () => {
      syncAllBatchRowsFromDom();
      if (batchRows.length >= BATCH_MAX) {
        setStatusText(batchHintEl, `单次最多 ${BATCH_MAX} 行,已达上限`, true);
        return;
      }
      batchRows.push(makeBatchRow());
      renderBatchRows();
    });
    $('#batch-cancel').addEventListener('click', closeBatchDonation);
    $('#batch-save').addEventListener('click', saveBatchDonation);
    batchDlg.addEventListener('close', () => {
      // Free preview URLs if dialog closed via Esc / backdrop
      for (const row of batchRows) {
        if (row.previewUrl) try { URL.revokeObjectURL(row.previewUrl); } catch {}
      }
      batchRows = [];
    });
    batchTbody.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="del-row"]')) {
        const tr = e.target.closest('tr[data-row]');
        if (!tr) return;
        const id = Number(tr.dataset.row);
        const row = batchRows.find(r => r.id === id);
        if (row?.previewUrl) try { URL.revokeObjectURL(row.previewUrl); } catch {}
        syncAllBatchRowsFromDom();
        batchRows = batchRows.filter(r => r.id !== id);
        renderBatchRows();
      }
    });

    // Sponsors
    $('#btn-sp-new').addEventListener('click', openNewSponsor);
    $('#btn-sp-batch').addEventListener('click', openBatchSponsor);
    $('#sp-adm-q').addEventListener('input', applySponsorFilter);
    $('#sponsor-cancel').addEventListener('click', () => spDlg.close());
    spForm.elements.source_image_file.addEventListener('change', () => syncSponsorImageUi({ resetAi: true }));
    sponsorAiFillBtn.addEventListener('click', recognizeSponsorImage);
    spForm.addEventListener('submit', saveSponsor);
    spTbody.addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-id]');
      if (!row) return;
      const rec = sponsorsData.sponsors.find(r => r.id === row.dataset.id);
      if (!rec) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'edit') openEditSponsor(rec);
      else if (act === 'del') askDeleteSponsor(rec);
    });

    // Batch sponsors
    $('#sp-batch-files').addEventListener('change', (e) => {
      handleSpBatchFiles(e.target.files);
      e.target.value = '';
    });
    $('#sp-batch-add-row').addEventListener('click', () => {
      syncAllSpBatchRowsFromDom();
      if (spBatchRows.length >= BATCH_MAX) {
        setStatusText(spBatchHintEl, `单次最多 ${BATCH_MAX} 行,已达上限`, true);
        return;
      }
      spBatchRows.push(makeSpBatchRow());
      renderSpBatchRows();
    });
    $('#sp-batch-cancel').addEventListener('click', () => spBatchDlg.close());
    $('#sp-batch-save').addEventListener('click', saveBatchSponsor);
    spBatchDlg.addEventListener('close', () => { spBatchRows = []; });
    spBatchTbody.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="del-row"]')) {
        const tr = e.target.closest('tr[data-row]');
        if (!tr) return;
        const id = Number(tr.dataset.row);
        syncAllSpBatchRowsFromDom();
        spBatchRows = spBatchRows.filter(r => r.id !== id);
        renderSpBatchRows();
      }
    });

    // Confirm dialog
    $('#confirm-cancel').addEventListener('click', () => { pendingAction = null; confirmDlg.close(); });
    $('#confirm-ok').addEventListener('click', runConfirmed);
  }

  async function init() {
    bind();
    const authState = await getAuthState();
    if (authState.ok) showApp();
    else showLogin(authState.status === 500 ? formatAuthError(authState) : null);
  }
  init();
})();
