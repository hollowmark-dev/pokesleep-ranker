/**
 * DOM まわりの小道具（$, el, toast, busy, modal）。
 * SPEC.md の ui.js API に厳密に従う。依存ゼロ。
 */

export function $(sel, root = document) {
  return root.querySelector(sel);
}

/**
 * 要素を作る。attrs.class / dataset / on* ハンドラ / その他属性に対応。
 * 子要素は可変引数（配列を渡した場合は展開する）。
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const flat = children.flat(Infinity);
  for (const c of flat) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* ── トースト ───────────────────────────────────────── */

export function toast(message, kind = 'info') {
  const root = $('#toast');
  if (!root) return;
  const node = el('div', { class: 'toast-item' + (kind === 'error' ? ' error' : '') }, message);
  root.hidden = false;
  root.append(node);
  const life = kind === 'error' ? 4200 : 2400;
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => {
      node.remove();
      if (!root.children.length) root.hidden = true;
    }, 250);
  }, life);
}

/* ── busy オーバーレイ（閉じられない処理中表示） ───────────── */

export function openBusy(title, message) {
  const msg = el('p', { text: message || '' });
  const bar = el('i', {});
  const bg = el(
    'div',
    { class: 'busy-overlay' },
    el(
      'div',
      { class: 'busy-box' },
      el('div', { class: 'spinner' }),
      el('h3', { text: title || '' }),
      msg,
      el('div', { class: 'busy-bar' }, bar)
    )
  );
  document.body.append(bg);
  return {
    update(text, pct) {
      if (text !== undefined && text !== null) msg.textContent = text;
      if (typeof pct === 'number') bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    },
    close() {
      bg.remove();
    },
  };
}

/* ── モーダル ───────────────────────────────────────── */

export function openModal(contentEl) {
  const box = el('div', { class: 'modal' }, contentEl);
  const bg = el('div', { class: 'modal-bg' }, box);

  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close();
  });
  document.addEventListener('keydown', onKey);

  const root = $('#modal-root') || document.body;
  root.append(bg);
  return { close };
}

export function confirmModal(message) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const okBtn = el('button', { class: 'btn btn-primary' }, 'OK');
    const cancelBtn = el('button', { class: 'btn' }, 'キャンセル');
    const content = el(
      'div',
      {},
      el('p', { text: message }),
      el('div', { class: 'actions' }, cancelBtn, okBtn)
    );
    const modal = openModal(content);
    okBtn.addEventListener('click', () => {
      finish(true);
      modal.close();
    });
    cancelBtn.addEventListener('click', () => {
      finish(false);
      modal.close();
    });
    // Escキー・背景クリックで閉じた場合は「キャンセル」扱い。
    const box = content.closest ? content.closest('.modal') : null;
    const bg = box ? box.parentElement : null;
    if (bg) {
      const observer = new MutationObserver(() => {
        if (!document.body.contains(bg)) {
          finish(false);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true });
    }
  });
}

// 上位%の表示: 1%未満は小数を増やして 0.0% に潰れないようにする
export function formatTopPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return '—';
  if (pct >= 1) return pct.toFixed(1) + '%';
  if (pct >= 0.01) return pct.toFixed(2) + '%';
  return pct.toPrecision(2) + '%';
}
