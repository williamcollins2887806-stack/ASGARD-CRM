// Phase 2: Universal Pagination Component for ASGARD CRM
window.AsgardPagination = (function(){
  const STORAGE_KEY = 'asgard_page_size';
  const DEFAULT_SIZE = 20;
  const SIZES = [10, 20, 50];

  function getPageSize(){
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      if(SIZES.includes(v) || v === 0) return v; // 0 = show all
    } catch(_){}
    return DEFAULT_SIZE;
  }

  function setPageSize(size){
    try { localStorage.setItem(STORAGE_KEY, String(size)); } catch(_){}
  }

  function paginate(items, page, pageSize){
    if(!pageSize || pageSize <= 0) return items; // show all
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  function buildPageNumbers(totalPages, current){
    if(totalPages <= 7){
      return Array.from({length: totalPages}, (_, i) => i + 1);
    }
    const pages = [];
    // Always show first 2
    pages.push(1, 2);
    // Middle section
    if(current > 4) pages.push('...');
    for(let i = Math.max(3, current - 1); i <= Math.min(totalPages - 2, current + 1); i++){
      pages.push(i);
    }
    if(current < totalPages - 3) pages.push('...');
    // Always show last 2
    pages.push(totalPages - 1, totalPages);
    // Deduplicate
    const out = [];
    for(const p of pages){
      if(out.length && out[out.length-1] === p) continue;
      out.push(p);
    }
    return out;
  }

  function renderControls(totalItems, currentPage, pageSize){
    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
    const showAll = !pageSize || pageSize <= 0;

    let html = '<div class="asg-pagination" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:12px;padding:8px 0">';

    // Page size selector
    html += '<div style="display:flex;align-items:center;gap:6px">';
    html += '<span style="color:var(--muted);font-size:13px">Строк:</span>';
    for(const s of SIZES){
      const active = pageSize === s;
      html += `<button class="btn ghost asg-pg-size" data-size="${s}" style="padding:4px 10px;font-size:13px;${active?'background:var(--accent);color:var(--bg)':''}">${s}</button>`;
    }
    html += `<button class="btn ghost asg-pg-size" data-size="0" style="padding:4px 10px;font-size:13px;${showAll?'background:var(--accent);color:var(--bg)':''}">Все</button>`;
    html += '</div>';

    // Page numbers
    if(!showAll && totalPages > 1){
      const pages = buildPageNumbers(totalPages, currentPage);
      html += '<div style="display:flex;align-items:center;gap:4px">';
      // Prev
      html += `<button class="btn ghost asg-pg-nav" data-page="${Math.max(1, currentPage-1)}" ${currentPage<=1?'disabled':''} style="padding:4px 8px;font-size:13px">&laquo;</button>`;
      for(const p of pages){
        if(p === '...'){
          html += '<span style="color:var(--muted);padding:0 4px">...</span>';
        } else {
          const active = p === currentPage;
          html += `<button class="btn ghost asg-pg-nav" data-page="${p}" style="padding:4px 10px;font-size:13px;${active?'background:var(--accent);color:var(--bg)':''}">${p}</button>`;
        }
      }
      // Next
      html += `<button class="btn ghost asg-pg-nav" data-page="${Math.min(totalPages, currentPage+1)}" ${currentPage>=totalPages?'disabled':''} style="padding:4px 8px;font-size:13px">&raquo;</button>`;
      html += '</div>';
    }

    // Total count
    html += `<span style="color:var(--muted);font-size:13px">Всего: ${totalItems}</span>`;
    html += '</div>';
    return html;
  }

  // Helper to wire up pagination event handlers
  function attachHandlers(containerId, onPageChange, onSizeChange){
    const container = document.getElementById(containerId);
    if(!container) return;
    container.addEventListener('click', (e) => {
      const sizeBtn = e.target.closest('.asg-pg-size');
      if(sizeBtn){
        const size = parseInt(sizeBtn.getAttribute('data-size'), 10);
        setPageSize(size);
        if(onSizeChange) onSizeChange(size);
        return;
      }
      const pageBtn = e.target.closest('.asg-pg-nav');
      if(pageBtn && !pageBtn.disabled){
        const page = parseInt(pageBtn.getAttribute('data-page'), 10);
        if(onPageChange) onPageChange(page);
      }
    });
  }

  return { getPageSize, setPageSize, paginate, renderControls, buildPageNumbers, attachHandlers };
})();
