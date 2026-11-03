(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const posters = window.POSTERS || [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { filtered: posters, index: 0, targetIndex: null, view: 'shelf', timer: null, zoom: 1, viewerMode: 'width', returnFocus: null, ownsFullscreen: false, effectsOn: true };
  const shelf = $('shelf'), ring = $('ringViewport'), viewer = $('viewer'), stage = $('imageStage'), image = $('fullImage');
  ring.setAttribute('role', 'region');
  ring.setAttribute('aria-label', '원형 입체 포스터 책장. 좌우로 밀거나 방향키로 회전하세요.');
  ring.tabIndex = 0;
  shelf.tabIndex = -1;
  shelf.setAttribute('aria-hidden', 'true');
  const normalize = value => String(value).normalize('NFKC').toLowerCase().replace(/\s/g, '');
  const studentText = item => item.students.map(s => `${s.id} ${s.name}`).join(' · ');
  const pad = n => String(n).padStart(3, '0');
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const subjectNames = ['통합사회', '통합과학', '한국사', '공통국어', '공통수학', '공통영어', '과학탐구실험', '생명과학', '물리학', '화학', '지구과학', '정보', '음악', '미술', '체육', '윤리', '도덕', '국어', '수학', '영어'];
  function subjectGroups(item) {
    const source = normalize(item.subject);
    if (source.includes('미기재')) return ['미기재'];
    const matches = subjectNames.filter(name => source.includes(name));
    return matches.length ? matches.filter(name => !matches.some(other => other !== name && other.endsWith(name))) : ['기타 / 원문 표기'];
  }
  posters.forEach((item, i) => { item.order = i + 1; item.groups = subjectGroups(item); item.search = normalize([item.title, item.field, item.subject, studentText(item)].join(' ')); });
  function addOptions(id, values) {
    [...new Set(values)].sort((a,b) => a.localeCompare(b, 'ko')).forEach(value => { const option = el('option', '', value); option.value = value; $(id).append(option); });
  }
  addOptions('fieldFilter', posters.map(item => item.field));
  addOptions('subjectFilter', posters.flatMap(item => item.groups));

  function makeCard(item, index) {
    const card = el('article', 'poster-card');
    card.dataset.index = index;
    const button = el('button', 'poster-open');
    button.type = 'button';
    button.setAttribute('aria-label', `${studentText(item)}, ${item.title}. 전체화면으로 보기`);
    const frame = el('div', 'poster-frame');
    const thumb = el('img');
    thumb.src = `assets/thumbs/${item.id}.webp`;
    thumb.alt = `${item.title} 포스터`;
    thumb.width = 636; thumb.height = 900; thumb.loading = index < 3 ? 'eager' : 'lazy'; thumb.decoding = 'async';
    frame.append(thumb); button.append(frame, el('span', 'open-chip', '⤢ 전체화면으로 보기'));
    button.addEventListener('click', () => { if (!suppressClick) { state.index = index; openViewer(button); } });
    const info = el('div', 'card-info');
    const topline = el('div', 'card-topline');
    topline.append(el('span', 'card-sequence', pad(item.order)), el('span', 'card-students', studentText(item)));
    const title = el('h3', '', item.title); title.title = item.title;
    const details = el('dl');
    [['관심 분야', item.field], ['교과', item.subject]].forEach(([label, value]) => { const row = el('div'); const dd = el('dd', '', value); dd.title = value + (label === '관심 분야' && item.fieldInferred ? ' · 포스터의 주제와 내용을 바탕으로 분류했습니다.' : ''); row.append(el('dt', '', label), dd); details.append(row); });
    info.append(topline, title, details); card.append(button, info);
    return card;
  }
  let cards = [], scrollFrame = 0, suppressClick = false, navigationTimer = 0, activeTurn = null, wheelTimer = 0;
  let scrollSpacer = null;
  const navigationIndex = () => state.targetIndex ?? state.index;
  function releaseNavigation() { clearTimeout(navigationTimer); state.targetIndex = null; }
  function render() {
    releaseNavigation();
    clearTimeout(wheelTimer);
    if (activeTurn) { activeTurn.animation.cancel(); activeTurn.leaf.remove(); activeTurn = null; }
    const hasResults = state.filtered.length > 0;
    $('shelfPanel').hidden = state.view !== 'shelf' || !hasResults;
    $('grid').hidden = state.view !== 'grid' || !hasResults;
    $('emptyState').hidden = hasResults;
    $('autoplay').hidden = state.view !== 'shelf' || !hasResults;
    $('resultCount').textContent = `${state.filtered.length}개의 포스터`;
    shelf.replaceChildren(); ring.replaceChildren(); $('grid').replaceChildren();
    const target = state.view === 'shelf' ? ring : $('grid');
    const fragment = document.createDocumentFragment();
    state.filtered.forEach((item, index) => fragment.append(makeCard(item, index)));
    target.append(fragment);
    cards = state.view === 'shelf' ? [...ring.children] : [];
    scrollSpacer = el('div', 'ring-scroll-spacer');
    shelf.append(scrollSpacer);
    $('position').max = Math.max(1, state.filtered.length);
    $('position').disabled = state.filtered.length < 2;
    state.index = Math.min(state.index, Math.max(0, state.filtered.length - 1));
    updateControls();
    requestAnimationFrame(() => { if (state.view === 'shelf') { syncScrollExtent(); goTo(state.index, false); updateTransforms(); } });
  }
  function cardWidth() {
    const width = cards[0]?.offsetWidth || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-width'));
    return Number.isFinite(width) && width > 0 ? width : 330;
  }
  function stride() { return cardWidth() + 64; }
  function syncScrollExtent() {
    if (scrollSpacer) {
      scrollSpacer.style.width = `${Math.max(1, shelf.clientWidth + Math.max(0, cards.length - 1) * stride())}px`;
      scrollSpacer.style.height = '1px';
    }
  }
  function turnPage(index, direction) {
    if (!state.effectsOn || !cards[index] || typeof Element.prototype.animate !== 'function') return;
    if (activeTurn) { activeTurn.animation.cancel(); activeTurn.leaf.remove(); }
    const frame = cards[index].querySelector('.poster-frame');
    const source = frame?.querySelector('img');
    if (!source) return;
    const leaf = el('div', 'page-turn-leaf');
    leaf.setAttribute('aria-hidden', 'true');
    leaf.style.transformOrigin = direction > 0 ? 'left center' : 'right center';
    const front = el('div', 'page-turn-front'), back = el('div', 'page-turn-back');
    const frontImage = source.cloneNode(false); frontImage.alt = ''; frontImage.removeAttribute('loading');
    front.append(frontImage); back.append(el('span', '', '3R&C'), el('small', '', '질문 · 탐구 · 발견'));
    leaf.append(front, back); frame.append(leaf);
    const angle = direction > 0 ? -165 : 165;
    const animation = leaf.animate([
      { transform:'rotateY(0deg) translateZ(2px)', opacity:1 },
      { transform:`rotateY(${angle * .53}deg) translateZ(22px)`, opacity:1, offset:.52 },
      { transform:`rotateY(${angle}deg) translateZ(2px)`, opacity:0 }
    ], { duration:720, easing:'cubic-bezier(.22,.68,.22,1)', fill:'forwards' });
    activeTurn = { leaf, animation };
    animation.finished.catch(() => {}).finally(() => { leaf.remove(); if (activeTurn?.leaf === leaf) activeTurn = null; });
  }
  function goTo(index, smooth = true) {
    const previous = state.index;
    const target = Math.max(0, Math.min(index, state.filtered.length - 1));
    const animate = smooth && state.effectsOn && !viewer.open && state.view === 'shelf';
    if (animate && Math.abs(target - previous) === 1) turnPage(previous, Math.sign(target - previous));
    releaseNavigation();
    state.index = target;
    if (state.view === 'shelf') {
      if (animate) { state.targetIndex = target; navigationTimer = setTimeout(() => { releaseNavigation(); updateTransforms(); }, 1400); }
      shelf.scrollTo({ left: Math.max(0, target * stride()), behavior: animate ? 'smooth' : 'instant' });
      if (!animate) updateTransforms();
    }
    updateControls();
    if (viewer.open) updateViewer();
  }
  function updateControls() {
    const count = state.filtered.length;
    $('currentNumber').textContent = pad(count ? state.index + 1 : 0);
    $('totalNumber').textContent = pad(count);
    $('position').value = state.index + 1;
    $('position').setAttribute('aria-valuetext', `${state.index + 1} / ${count}`);
    $('prev').disabled = $('viewerPrev').disabled = state.index <= 0;
    $('next').disabled = $('viewerNext').disabled = state.index >= count - 1;
    if (count) $('liveStatus').textContent = `${state.index + 1} / ${count}. ${studentText(state.filtered[state.index])}. ${state.filtered[state.index].title}`;
  }
  function updateTransforms() {
    if (state.view !== 'shelf' || !cards.length) return;
    const position = shelf.scrollLeft / stride();
    const closest = Math.max(0, Math.min(Math.round(position), cards.length - 1));
    if (state.targetIndex !== null && Math.abs(position - state.targetIndex) < .015) releaseNavigation();
    if (closest !== state.index && !viewer.open && state.targetIndex === null) { state.index = closest; updateControls(); }
    const width = cardWidth();
    const radius = width * 1.94;
    cards.forEach((card, i) => {
      const distance = i - position, absolute = Math.abs(distance);
      card.classList.toggle('is-active', i === closest);
      const visible = absolute <= (state.effectsOn ? 2.78 : 2.4);
      card.style.visibility = visible ? 'visible' : 'hidden';
      card.style.pointerEvents = visible ? '' : 'none';
      card.setAttribute('aria-hidden', String(!visible));
      card.querySelector('.poster-open').tabIndex = i === closest ? 0 : -1;
      const theta = distance * Math.PI * 32 / 180;
      const x = state.effectsOn ? Math.sin(theta) * radius : distance * (width + 38);
      const z = state.effectsOn ? (Math.cos(theta) - 1) * radius : 0;
      const y = state.effectsOn ? (1 - Math.cos(theta)) * -22 : 0;
      const angle = state.effectsOn ? distance * 32 : 0;
      card.style.transform = `translateX(-50%) translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, ${z.toFixed(3)}px) rotateY(${angle.toFixed(3)}deg)`;
      card.style.opacity = state.effectsOn ? String(Math.max(.42, 1 - absolute * .17)) : '1';
      card.style.zIndex = String(Math.round(1000 - Math.min(absolute, 20) * 100));
      if (visible) {
        const thumb = card.querySelector('.poster-frame > img');
        if (thumb) thumb.loading = 'eager';
      }
    });
    const activeHeight = `${cards[closest].offsetHeight + 70}px`;
    if (ring.style.getPropertyValue('--ring-content-height') !== activeHeight) ring.style.setProperty('--ring-content-height', activeHeight);
    const focusedCard = document.activeElement?.closest('.poster-card');
    if (focusedCard && ring.contains(focusedCard) && Number(focusedCard.dataset.index) !== closest) ring.focus({ preventScroll:true });
    ring.style.setProperty('--ring-radius', `${radius}px`);
    ring.style.setProperty('--ring-position', position.toFixed(4));
  }
  shelf.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { updateTransforms(); scrollFrame = 0; }); }, { passive:true });
  function updateEffectsToggle() {
    document.body.classList.toggle('effects-enabled', state.effectsOn);
    const toggle = $('effectsToggle');
    if (toggle) { toggle.setAttribute('aria-pressed', String(state.effectsOn)); toggle.textContent = state.effectsOn ? '입체 효과 켜짐' : '입체 효과 꺼짐'; }
  }
  $('effectsToggle')?.addEventListener('click', () => {
    state.effectsOn = !state.effectsOn;
    if (!state.effectsOn && activeTurn) { activeTurn.animation.cancel(); activeTurn.leaf.remove(); activeTurn = null; }
    updateEffectsToggle();
    if (state.view === 'shelf') goTo(navigationIndex(), false);
    updateTransforms();
  });
  updateEffectsToggle();
  window.addEventListener('resize', () => { if (!viewer.open) { syncScrollExtent(); goTo(navigationIndex(), false); } else refreshViewerLayout(); });
  $('prev').addEventListener('click', () => { stopAutoplay(); goTo(navigationIndex() - 1); });
  $('next').addEventListener('click', () => { stopAutoplay(); goTo(navigationIndex() + 1); });
  $('position').addEventListener('input', event => { stopAutoplay(); goTo(Number(event.target.value) - 1, false); });

  function setView(view, scroll = false) {
    stopAutoplay(); state.view = view;
    $('shelfView').classList.toggle('active', view === 'shelf'); $('gridView').classList.toggle('active', view === 'grid');
    $('shelfView').setAttribute('aria-pressed', String(view === 'shelf')); $('gridView').setAttribute('aria-pressed', String(view === 'grid'));
    $('navShelf').classList.toggle('selected', view === 'shelf'); $('navGrid').classList.toggle('selected', view === 'grid');
    $('collectionTitle').textContent = view === 'shelf' ? '탐구의 책장' : '모든 탐구를 한눈에';
    render();
    if (scroll) $('collection').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth' });
  }
  $('shelfView').addEventListener('click', () => setView('shelf'));
  $('gridView').addEventListener('click', () => setView('grid'));
  $('navShelf').addEventListener('click', () => setView('shelf', true));
  $('navGrid').addEventListener('click', () => setView('grid', true));
  function filter() {
    stopAutoplay();
    const query = normalize($('search').value), field = $('fieldFilter').value, subject = $('subjectFilter').value;
    state.filtered = posters.filter(item => (!query || item.search.includes(query)) && (!field || item.field === field) && (!subject || item.groups.includes(subject)));
    state.index = 0;
    $('resetFilters').hidden = !(query || field || subject);
    render();
    $('liveStatus').textContent = `검색 결과 ${state.filtered.length}개의 포스터`;
  }
  function resetFilters() { $('search').value = ''; $('fieldFilter').value = ''; $('subjectFilter').value = ''; filter(); }
  $('search').addEventListener('input', filter); $('fieldFilter').addEventListener('change', filter); $('subjectFilter').addEventListener('change', filter);
  $('resetFilters').addEventListener('click', resetFilters); $('emptyReset').addEventListener('click', resetFilters);
  function stopAutoplay() { if (state.timer) clearInterval(state.timer); state.timer = null; $('autoplay').setAttribute('aria-pressed', 'false'); $('autoplay').replaceChildren(el('span', '', '▷'), document.createTextNode(' 자동 넘김')); }
  $('autoplay').addEventListener('click', () => {
    if (state.timer) return stopAutoplay();
    if (state.filtered.length < 2) return;
    $('autoplay').setAttribute('aria-pressed', 'true'); $('autoplay').replaceChildren(el('span', '', 'Ⅱ'), document.createTextNode(' 잠시 멈춤'));
    state.timer = setInterval(() => { if (state.index >= state.filtered.length - 1) stopAutoplay(); else goTo(state.index + 1); }, 5000);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAutoplay(); });
  ring.addEventListener('wheel', event => {
    if (state.view !== 'shelf' || state.filtered.length < 2 || viewer.open) return;
    const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
    if (!horizontalIntent) return;
    const delta = event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!Number.isFinite(delta) || delta === 0) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? ring.clientWidth : 1;
    event.preventDefault(); stopAutoplay();
    if (event.shiftKey || event.deltaMode === 1) {
      clearTimeout(wheelTimer);
      goTo(navigationIndex() + Math.sign(delta));
      return;
    }
    releaseNavigation();
    shelf.scrollTo({ left: shelf.scrollLeft + delta * unit, behavior:'instant' });
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { goTo(Math.round(shelf.scrollLeft / stride())); }, 130);
  }, { passive:false });
  let drag = null;
  ring.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    stopAutoplay(); releaseNavigation(); clearTimeout(wheelTimer);
    drag = { x:event.clientX, y:event.clientY, scroll:shelf.scrollLeft, id:event.pointerId, moved:false };
  });
  ring.addEventListener('pointermove', event => {
    if (!drag) return;
    const delta = event.clientX - drag.x, vertical = event.clientY - drag.y;
    if (!drag.moved && Math.abs(vertical) > Math.abs(delta) && Math.abs(vertical) > 8) { drag = null; return; }
    if (drag.moved || Math.abs(delta) > 7) {
      drag.moved = true; suppressClick = true; ring.classList.add('dragging');
      ring.setPointerCapture(drag.id);
      shelf.scrollTo({ left:drag.scroll - delta * 1.15, behavior:'instant' });
      event.preventDefault();
    }
  });
  function endDrag() {
    if (!drag) return;
    const moved = drag.moved; drag = null; ring.classList.remove('dragging');
    if (moved) { goTo(Math.round(shelf.scrollLeft / stride())); setTimeout(() => { suppressClick = false; }, 80); }
  }
  ring.addEventListener('pointerup', endDrag); ring.addEventListener('pointercancel', endDrag); ring.addEventListener('lostpointercapture', endDrag);
  ring.addEventListener('dragstart', event => event.preventDefault());

  function openViewer(button) {
    if (!state.filtered.length) return;
    stopAutoplay(); releaseNavigation(); state.returnFocus = button;
    viewer.showModal(); document.body.style.overflow = 'hidden';
    updateViewer(); $('closeViewer').focus({preventScroll:true});
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      state.ownsFullscreen = true;
      document.documentElement.requestFullscreen().catch(() => { state.ownsFullscreen = false; });
    }
  }
  function closeViewer() {
    if (state.ownsFullscreen && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    state.ownsFullscreen = false;
    viewer.close(); document.body.style.overflow = '';
    if (state.view === 'shelf') { syncScrollExtent(); goTo(state.index, false); }
    const returnButton = state.view === 'shelf' ? cards[state.index]?.querySelector('button') : $('grid').children[state.index]?.querySelector('button');
    (returnButton || state.returnFocus)?.focus({ preventScroll:true });
  }
  function updateViewer() {
    const item = state.filtered[state.index]; if (!item) return;
    $('viewerCounter').textContent = `${pad(state.index + 1)} / ${pad(state.filtered.length)}`;
    $('viewerStudents').textContent = studentText(item);
    $('viewerTitle').textContent = item.title;
    $('viewerField').textContent = item.field; $('viewerSubject').textContent = item.subject;
    image.alt = `${studentText(item)} — ${item.title} 전체 포스터`;
    $('imageLoading').textContent = '포스터를 펼치는 중…';
    $('imageLoading').hidden = false; image.style.opacity = '.15';
    image.src = `assets/posters/${item.id}.webp`;
    state.viewerMode = 'width'; state.zoom = 1; stage.scrollTo(0, 0); setZoom(1); refreshViewerLayout(); updateControls();
    [state.index - 1, state.index + 1].forEach(index => { const next = state.filtered[index]; if (next) { const preload = new Image(); preload.src = `assets/posters/${next.id}.webp`; } });
  }
  image.addEventListener('load', () => { $('imageLoading').hidden = true; image.style.opacity = '1'; setZoom(state.zoom); });
  image.addEventListener('error', () => { $('imageLoading').textContent = '이미지를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'; $('imageLoading').hidden = false; });
  function setZoom(value) {
    state.zoom = Math.max(1, Math.min(4, value));
    const baseScale = state.zoom === 1;
    stage.classList.toggle('fit-width', state.viewerMode === 'width');
    stage.classList.toggle('fit-page', state.viewerMode === 'page');
    stage.classList.toggle('zoomed', !baseScale);
    if (viewer.open && stage.clientWidth > 0 && stage.clientHeight > 0) {
      const css = getComputedStyle(stage), availableWidth = stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight), availableHeight = stage.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      const ratio = image.naturalWidth / image.naturalHeight || .706;
      const baseWidth = Math.max(1, state.viewerMode === 'width' ? availableWidth : Math.min(availableWidth, availableHeight * ratio));
      image.style.width = `${baseWidth * state.zoom}px`; image.style.height = 'auto';
    }
    $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
    $('zoomOut').disabled = baseScale; $('zoomIn').disabled = state.zoom >= 4;
    $('fitWidth')?.setAttribute('aria-pressed', String(state.viewerMode === 'width' && baseScale));
    $('fitImage').setAttribute('aria-pressed', String(state.viewerMode === 'page' && baseScale));
  }
  let viewerLayoutFrame = 0;
  function refreshViewerLayout() {
    if (!viewer.open || viewerLayoutFrame) return;
    viewerLayoutFrame = requestAnimationFrame(() => {
      viewerLayoutFrame = 0;
      if (!viewer.open) return;
      const footer = viewer.querySelector('.viewer-info');
      if (footer) viewer.style.setProperty('--viewer-footer-height', `${footer.getBoundingClientRect().height}px`);
      setZoom(state.zoom);
    });
  }
  if (typeof ResizeObserver === 'function') {
    const layoutObserver = new ResizeObserver(refreshViewerLayout);
    const footer = viewer.querySelector('.viewer-info');
    if (footer) layoutObserver.observe(footer);
    layoutObserver.observe(stage);
  }
  document.addEventListener('fullscreenchange', refreshViewerLayout);
  function fitViewer(mode) { state.viewerMode = mode; setZoom(1); stage.scrollTo(0,0); }
  $('zoomIn').addEventListener('click', () => setZoom(state.zoom + .5));
  $('zoomOut').addEventListener('click', () => setZoom(state.zoom - .5));
  $('fitWidth')?.addEventListener('click', () => fitViewer('width'));
  $('fitImage').addEventListener('click', () => fitViewer('page'));
  image.addEventListener('click', () => { if (!panMoved) setZoom(state.zoom === 1 ? 2 : 1); });
  $('viewerPrev').addEventListener('click', () => goTo(state.index - 1, false));
  $('viewerNext').addEventListener('click', () => goTo(state.index + 1, false));
  $('closeViewer').addEventListener('click', closeViewer);
  viewer.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(() => {}); state.ownsFullscreen = false; }
    else if (document.documentElement.requestFullscreen) {
      state.ownsFullscreen = true;
      document.documentElement.requestFullscreen().catch(() => { state.ownsFullscreen = false; });
    }
  });
  let pan = null, panMoved = false;
  stage.addEventListener('pointerdown', event => { panMoved = false; if (state.zoom <= 1 || event.pointerType !== 'mouse' || event.button !== 0) return; pan = { x:event.clientX, y:event.clientY, left:stage.scrollLeft, top:stage.scrollTop }; });
  stage.addEventListener('pointermove', event => { if (!pan) return; const dx = event.clientX - pan.x, dy = event.clientY - pan.y; if (Math.abs(dx) + Math.abs(dy) > 5) { panMoved = true; stage.classList.add('panning'); stage.setPointerCapture(event.pointerId); stage.scrollLeft = pan.left - dx; stage.scrollTop = pan.top - dy; event.preventDefault(); } });
  const endPan = () => { pan = null; stage.classList.remove('panning'); if (panMoved) setTimeout(() => { panMoved = false; }, 50); };
  stage.addEventListener('pointerup', endPan); stage.addEventListener('pointercancel', endPan);
  document.addEventListener('keydown', event => {
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (!viewer.open && event.key === '/' && !editing) { event.preventDefault(); $('search').focus(); return; }
    if (editing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!viewer.open && state.view === 'shelf' && document.activeElement === ring && ['Enter', ' ', 'Spacebar'].includes(event.key)) {
      event.preventDefault();
      const current = navigationIndex();
      const button = cards[current]?.querySelector('.poster-open');
      if (button) { state.index = current; openViewer(button); }
      return;
    }
    if ((viewer.open || state.view === 'shelf') && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault(); stopAutoplay();
      if (!viewer.open && ring.contains(document.activeElement)) ring.focus({ preventScroll:true });
      goTo(event.key === 'Home' ? 0 : event.key === 'End' ? state.filtered.length - 1 : navigationIndex() + (event.key === 'ArrowRight' ? 1 : -1), !viewer.open);
    }
    if (viewer.open && ['+','=','-','0'].includes(event.key)) { event.preventDefault(); setZoom(event.key === '0' ? 1 : state.zoom + (event.key === '-' ? -.5 : .5)); }
  });
  render();
})();
