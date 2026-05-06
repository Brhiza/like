// 李柯公益记录 — 展示页逻辑
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const timelineEl = $('#timeline');
  const emptyEl = $('#empty');
  const qInput = $('#q');
  const yearSelect = $('#filter-year');
  const foundationSelect = $('#filter-foundation');
  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightbox-img');
  const lightboxMeta = $('#lightbox-meta');
  const lightboxClose = $('.lightbox-close');
  const sponsorListEl = $('#sponsor-list');
  const sponsorEmptyEl = $('#sponsor-empty');
  const spQInput = $('#sp-q');
  const spYearSelect = $('#sp-filter-year');
  const spSortSelect = $('#sp-sort');

  let allRecords = [];
  let allSponsors = [];
  const sponsorFilters = { q: '', year: '', sort: 'date-asc' };

  const fmtAmount = (n) => {
    if (n == null) return '—';
    return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  };

  const fmtDate = (s) => {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
  };

  const fmtShortDate = (s) => {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${y}.${String(parseInt(m, 10)).padStart(2, '0')}.${String(parseInt(d, 10)).padStart(2, '0')}`;
  };

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  const CHANNEL_LABELS = { txgy: '腾讯公益', xwgc: '希望工程', other: '其他' };
  const inferChannel = (image) => {
    if (!image) return null;
    if (image.includes('/txgy/')) return 'txgy';
    if (image.includes('/xwgc/')) return 'xwgc';
    if (image.includes('/other/')) return 'other';
    return null;
  };
  const channelLabel = (image) => CHANNEL_LABELS[inferChannel(image)] || null;

  // ===== Donations =====
  function renderStats(records) {
    const total = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const projects = new Set(records.map(r => r.project).filter(Boolean));
    const years = new Set(records.map(r => r.date?.slice(0, 4)).filter(Boolean));
    $('#stat-amount').textContent = fmtAmount(total);
    $('#stat-count').textContent = records.length.toString();
    $('#stat-projects').textContent = projects.size.toString();
    $('#stat-years').textContent = years.size.toString();
  }

  function buildFilterOptions(records) {
    const years = [...new Set(records.map(r => r.date?.slice(0, 4)).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a));
    for (const y of years) {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = `${y} 年`;
      yearSelect.appendChild(o);
    }
    const foundations = [...new Set(records.map(r => r.foundation).filter(Boolean))].sort();
    for (const f of foundations) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      foundationSelect.appendChild(o);
    }
  }

  function applyFilters() {
    const q = qInput.value.trim().toLowerCase();
    const yr = yearSelect.value;
    const fnd = foundationSelect.value;
    return allRecords.filter(r => {
      if (yr && !r.date?.startsWith(yr)) return false;
      if (fnd && r.foundation !== fnd) return false;
      if (q) {
        const hay = [
          r.project, r.foundation, r.cert_no, r.name, r.effect
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTimeline(records) {
    if (!records.length) {
      timelineEl.innerHTML = '';
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    const groups = new Map();
    for (const r of records) {
      const y = r.date?.slice(0, 4) ?? '未知';
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(r);
    }
    const years = [...groups.keys()].sort((a, b) => b.localeCompare(a));

    const html = years.map(year => {
      const items = groups.get(year);
      const cards = items.map(r => {
        const amount = r.amount != null
          ? `<span class="amount">¥${fmtAmount(r.amount)}</span>`
          : `<span class="tag">实物/物资</span>`;
        const effect = r.effect ? `<span class="tag">${escapeHtml(r.effect)}</span>` : '';
        const ch = inferChannel(r.image);
        const channelTag = ch
          ? `<span class="tag tag-channel tag-channel-${ch}">${CHANNEL_LABELS[ch]}</span>`
          : '';
        return `
          <article class="record" data-id="${escapeHtml(r.id)}" tabindex="0">
            <div class="record-thumb">
              <img src="${escapeHtml(r.image)}" alt="${escapeHtml(r.project)}证书" loading="lazy" decoding="async">
            </div>
            <div class="record-body">
              <h3 class="record-project">${escapeHtml(r.project)}</h3>
              <p class="record-foundation">${escapeHtml(r.foundation)}</p>
              <div class="record-meta">
                ${amount}
                <span>${fmtDate(r.date)}</span>
                ${channelTag}
                ${effect}
              </div>
            </div>
          </article>
        `;
      }).join('');
      return `
        <div class="year-group">
          <h2 class="year-label">${year} 年 · ${items.length} 笔</h2>
          ${cards}
        </div>
      `;
    }).join('');

    timelineEl.innerHTML = html;
  }

  function openLightbox(record) {
    lightboxImg.src = record.image;
    lightboxImg.alt = `${record.project}证书`;
    const amountTxt = record.amount != null
      ? `¥${fmtAmount(record.amount)}${record.amount_unit || '元'}`
      : '实物/物资';
    lightboxMeta.innerHTML = `
      <div><strong>${escapeHtml(record.project)}</strong></div>
      <div>${escapeHtml(record.foundation)} · ${fmtDate(record.date)}</div>
      <div>捐赠人：${escapeHtml(record.name)} · 金额：${escapeHtml(amountTxt)}</div>
      ${record.effect ? `<div>助力效应：${escapeHtml(record.effect)}</div>` : ''}
      <div style="opacity:0.7;font-size:12px;margin-top:6px">证书编号：${escapeHtml(record.cert_no)}</div>
    `;
    if (typeof lightbox.showModal === 'function') lightbox.showModal();
    else lightbox.setAttribute('open', '');
  }

  function closeLightbox() {
    if (typeof lightbox.close === 'function') lightbox.close();
    else lightbox.removeAttribute('open');
    lightboxImg.src = '';
  }

  // ===== Sponsors =====
  function applySponsorFilters() {
    const { q, year, sort } = sponsorFilters;
    const ql = q.toLowerCase();
    const filtered = allSponsors.filter(sp => {
      if (year && !sp.date?.startsWith(year)) return false;
      if (ql) {
        const hay = [sp.name, sp.message].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      const amtA = Number(a.amount) || 0;
      const amtB = Number(b.amount) || 0;
      switch (sort) {
        case 'date-desc':
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return amtB - amtA;
        case 'amount-desc':
          if (amtA !== amtB) return amtB - amtA;
          return b.date.localeCompare(a.date);
        case 'amount-asc':
          if (amtA !== amtB) return amtA - amtB;
          return a.date.localeCompare(b.date);
        case 'date-asc':
        default:
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return amtB - amtA;
      }
    });
  }

  function updateSponsorStats(sponsors) {
    $('#sp-count').textContent = sponsors.length.toString();
    const total = sponsors.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    $('#sp-total').textContent = fmtAmount(total);
    const latest = sponsors.reduce((acc, r) => (!acc || r.date > acc.date) ? r : acc, null);
    $('#sp-latest').textContent = latest ? fmtShortDate(latest.date) : '—';
  }

  function buildSponsorYearOptions(sponsors) {
    const years = [...new Set(sponsors.map(s => s.date?.slice(0, 4)).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a));
    for (const y of years) {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = `${y} 年`;
      spYearSelect.appendChild(o);
    }
  }

  function renderSponsors(sponsors) {
    if (!sponsors.length) {
      sponsorListEl.innerHTML = '';
      sponsorListEl.style.height = '';
      sponsorEmptyEl.hidden = false;
      sponsorEmptyEl.textContent = allSponsors.length === 0
        ? '暂无赞赏记录。'
        : '没有匹配的记录。';
      return;
    }
    sponsorEmptyEl.hidden = true;

    sponsorListEl.innerHTML = sponsors.map(sp => `
      <div class="sponsor-card">
        <div class="sp-top">
          <span class="sp-name">${escapeHtml(sp.name)}</span>
          <span class="sp-amount">¥${fmtAmount(sp.amount)}</span>
        </div>
        <div class="sp-date">${fmtShortDate(sp.date)}</div>
        ${sp.message ? `<div class="sp-message">${escapeHtml(sp.message)}</div>` : ''}
      </div>
    `).join('');

    layoutSponsors();
  }

  function layoutSponsors() {
    const cards = [...sponsorListEl.querySelectorAll('.sponsor-card')];
    if (!cards.length) {
      sponsorListEl.style.height = '';
      return;
    }
    const containerWidth = sponsorListEl.clientWidth;
    if (containerWidth === 0) return;

    const isNarrow = containerWidth < 480;
    const gap = isNarrow ? 8 : 12;
    const minColWidth = isNarrow ? 140 : 220;
    const cols = Math.max(1, Math.floor((containerWidth + gap) / (minColWidth + gap)));
    const colWidth = (containerWidth - (cols - 1) * gap) / cols;

    for (const card of cards) {
      card.style.position = 'absolute';
      card.style.width = `${colWidth}px`;
    }

    const heights = cards.map(c => c.offsetHeight);
    const colTops = new Array(cols).fill(0);
    for (let i = 0; i < cards.length; i++) {
      let minCol = 0;
      for (let c = 1; c < cols; c++) {
        if (colTops[c] < colTops[minCol]) minCol = c;
      }
      cards[i].style.left = `${minCol * (colWidth + gap)}px`;
      cards[i].style.top = `${colTops[minCol]}px`;
      colTops[minCol] += heights[i] + gap;
    }
    const maxTop = Math.max(...colTops);
    sponsorListEl.style.height = `${maxTop > 0 ? maxTop - gap : 0}px`;
  }

  // ===== Section nav =====
  function setupSectionNav() {
    const tabs = $$('.section-tab');
    const panels = new Map();
    for (const tab of tabs) {
      const panel = document.getElementById(tab.dataset.tab);
      if (panel) panels.set(tab.dataset.tab, panel);
    }
    const defaultTab = tabs[0]?.dataset.tab;

    const activate = (name, { updateHash = true } = {}) => {
      for (const tab of tabs) {
        const on = tab.dataset.tab === name;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      for (const [id, panel] of panels) panel.hidden = id !== name;
      if (updateHash) {
        const url = name === defaultTab
          ? location.pathname + location.search
          : `${location.pathname}${location.search}#${name}`;
        try { history.replaceState(null, '', url); } catch {}
      }
      if (name === 'sponsors') {
        requestAnimationFrame(() => layoutSponsors());
      }
    };

    const fragment = location.hash.replace('#', '');
    const initial = panels.has(fragment) ? fragment : defaultTab;
    if (initial) {
      activate(initial, { updateHash: false });
      // If the URL hash pointed at the default tab (or didn't match), strip it
      // so the browser doesn't auto-scroll past the hero on next reload.
      if (initial === defaultTab && location.hash) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch {}
        window.scrollTo(0, 0);
      }
    }

    for (const tab of tabs) {
      tab.addEventListener('click', () => activate(tab.dataset.tab));
    }
  }

  // ===== Bind & init =====
  function bindEvents() {
    qInput.addEventListener('input', () => renderTimeline(applyFilters()));
    yearSelect.addEventListener('change', () => renderTimeline(applyFilters()));
    foundationSelect.addEventListener('change', () => renderTimeline(applyFilters()));

    spQInput.addEventListener('input', () => {
      sponsorFilters.q = spQInput.value.trim();
      renderSponsors(applySponsorFilters());
    });
    spYearSelect.addEventListener('change', () => {
      sponsorFilters.year = spYearSelect.value;
      renderSponsors(applySponsorFilters());
    });
    spSortSelect.addEventListener('change', () => {
      sponsorFilters.sort = spSortSelect.value;
      renderSponsors(applySponsorFilters());
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layoutSponsors, 100);
    });

    timelineEl.addEventListener('click', (e) => {
      const card = e.target.closest('.record');
      if (!card) return;
      const id = card.dataset.id;
      const rec = allRecords.find(r => r.id === id);
      if (rec) openLightbox(rec);
    });
    timelineEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.record');
      if (!card) return;
      e.preventDefault();
      const id = card.dataset.id;
      const rec = allRecords.find(r => r.id === id);
      if (rec) openLightbox(rec);
    });

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
  }

  async function loadDonations() {
    try {
      const res = await fetch(`data/donations.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allRecords = Array.isArray(data.records) ? data.records : [];
      renderStats(allRecords);
      buildFilterOptions(allRecords);
      renderTimeline(applyFilters());
    } catch (err) {
      timelineEl.innerHTML = `<p class="empty">加载失败：${escapeHtml(err.message || err)}</p>`;
      console.error(err);
    }
  }

  async function loadSponsors() {
    try {
      const res = await fetch(`data/sponsors.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) {
        if (res.status === 404) {
          allSponsors = [];
          updateSponsorStats(allSponsors);
          renderSponsors([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      allSponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
      updateSponsorStats(allSponsors);
      buildSponsorYearOptions(allSponsors);
      renderSponsors(applySponsorFilters());
    } catch (err) {
      sponsorListEl.innerHTML = `<p class="empty">赞赏名单加载失败：${escapeHtml(err.message || err)}</p>`;
      console.error(err);
    }
  }

  function init() {
    bindEvents();
    setupSectionNav();
    loadDonations();
    loadSponsors();
  }

  init();
})();
