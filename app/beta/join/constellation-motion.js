/** Progressive motion for the Citation Constellation landing, scoped to its own root. */
export function initializeConstellation(root, libraries, translate=(copy)=>copy, forceReduced=false) {
  const {gsap, ScrollTrigger, Lenis} = libraries;
  const abort = new AbortController(), disposers=[];
  let active=true, media=null, rt=null;
  function listen(target, type, fn, options={}) { target.addEventListener(type,fn,{...options,signal:abort.signal}); }
  function run(){


  root.classList.add('js');
  var $ = function (s, c) { return (c || root).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || root).querySelectorAll(s)); };
  var params = new URLSearchParams(location.search);
  var reduced = forceReduced || params.has('reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = !params.has('nogsap') && !!(gsap && ScrollTrigger);
  var motion = !reduced && hasGsap;
  var toggle = $('.motion-toggle');
  var paused = false;
  toggle.disabled=false;toggle.removeAttribute('aria-disabled');toggle.removeAttribute('title');toggle.setAttribute('aria-pressed','false');
  toggle.setAttribute('aria-label',translate('Pause motion'));$('.mt-label').textContent=translate('Pause motion');
  var lenis = null;
  var intro = null;
  var replayTween = null;
  function isPhone() { return window.matchMedia('(max-width:640px), (max-width:1000px) and (max-height:500px)').matches; }
  function rafThrottle(fn) { var q = false; return function () { if (q) return; q = true; requestAnimationFrame(function () { q = false; fn(); }); }; }

  /* Reading progress continues through the product, checks and access. */
  var progressBar=document.createElement('span');
  progressBar.className='journey-progress';progressBar.setAttribute('aria-hidden','true');
  $('.top').appendChild(progressBar);
  function updateProgress(){
    var max=document.documentElement.scrollHeight-window.innerHeight;
    progressBar.style.transform='scaleX('+Math.max(0,Math.min(1,max?window.scrollY/max:0))+')';
  }
  listen(window,'scroll',rafThrottle(updateProgress),{passive:true});
  listen(window,'resize',rafThrottle(updateProgress));updateProgress();
  disposers.push(()=>progressBar.remove());

  disposers.push(()=>stopLenis());

  /* ---------- Hero thread: the headline is wired to its source ---------- */
  var pin = $('.pin'), stopEl = $('.stop'), htSvg = $('.hero-thread'), htPath = $('.ht-path'), htEnd = $('.ht-end');
  function layoutHero() {
    if(!active)return;
    var anc = $(isPhone() ? '.p-moodle .anc-r' : '.p-moodle .anc-l');
    var pr = pin.getBoundingClientRect(), a = stopEl.getBoundingClientRect(), b = anc.getBoundingClientRect();
    var ax = a.left + a.width / 2 - pr.left, ay = a.top + a.height / 2 - pr.top;
    var bx = b.left + b.width / 2 - pr.left, by = b.top + b.height / 2 - pr.top, d;
    if (!isPhone()) {
      var dx = Math.max(40, (bx - ax) * 0.5);
      d = 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' C' + (ax + dx).toFixed(1) + ' ' + ay.toFixed(1) + ' ' + (bx - dx).toFixed(1) + ' ' + by.toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1);
    } else {
      var gx = pr.width - 8, r = 10;
      d = 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' H' + (gx - r).toFixed(1) + ' Q' + gx + ' ' + ay.toFixed(1) + ' ' + gx + ' ' + (ay + r).toFixed(1) + ' V' + (by - r).toFixed(1) + ' Q' + gx + ' ' + by.toFixed(1) + ' ' + (gx - r).toFixed(1) + ' ' + by.toFixed(1) + ' H' + bx.toFixed(1);
    }
    htPath.setAttribute('d', d);
    htEnd.setAttribute('cx', bx.toFixed(1)); htEnd.setAttribute('cy', by.toFixed(1));
  }

  /* ---------- Anchor links (work with or without Lenis) ---------- */
  function scrollToEl(el, immediate=false) {
    var off = -($('.top').offsetHeight + 8);
    if (el.id === 'top') off = 0;
    if (lenis) { lenis.scrollTo(el, { offset: off, duration: immediate?0:1.3 }); }
    else {
      var y = el.getBoundingClientRect().top + window.pageYOffset + off;
      window.scrollTo({ top: y, behavior: (immediate || reduced || paused || !motion) ? 'instant' : 'smooth' });
    }
    if (el.hasAttribute('tabindex')) el.focus({ preventScroll: true });
  }
  listen(root,'click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var href = a.getAttribute('href');
    if (href === '#') { e.preventDefault(); return; }
    var t = document.getElementById(href.slice(1));
    if (!t) return;
    e.preventDefault();
    if(location.hash!==href)history.pushState(history.state,'',href);
    scrollToEl(t);
  });

  /* ---------- Motion toggle ---------- */
  function lenisRaf(t) { if (lenis) lenis.raf(t * 1000); }
  function startLenis() {
    if (!Lenis || lenis || isPhone()) return;
    lenis = new Lenis({ duration: 1.15, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); } });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(lenisRaf);
  }
  function stopLenis() {
    if (!lenis) return;
    gsap.ticker.remove(lenisRaf);
    lenis.destroy();
    lenis = null;
  }
  listen(toggle,'click', function () {
    if (!motion) return;
    paused = !paused;
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label',translate(paused?'Resume motion':'Pause motion'));
    $('.mt-label').textContent=translate(paused?'Resume motion':'Pause motion');
    root.classList.toggle('motion-paused', paused);
    if (paused) {
      $$('video').forEach(video => video.pause());
      if (intro) intro.progress(1);
      if (replayTween) replayTween.progress(1);
      gsap.globalTimeline.pause();
      stopLenis();
    } else {
      gsap.globalTimeline.resume();
      startLenis();
    }
    requestAnimationFrame(()=>{if(active){ScrollTrigger.refresh();updateProgress();}});
  });

  /* ---------- Static path: reduced motion, no GSAP, or forced ---------- */
  function initStatic() {
    toggle.setAttribute('aria-pressed', 'true');
    toggle.setAttribute('aria-disabled', 'true');
    toggle.disabled=true;toggle.setAttribute('aria-label',translate('Motion off'));$('.mt-label').textContent=translate('Motion off');
    toggle.title = translate(reduced ? 'Motion is off because your device asks for reduced motion.' : 'Motion is off on this page.');
    var relayout = function () { layoutHero(); };
    relayout();
    listen(window,'resize', rafThrottle(relayout));
    listen(window,'load', relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  }

  /* ---------- Motion path ---------- */
  function initMotion() {
    gsap.registerPlugin(ScrollTrigger);
    gsap.ticker.lagSmoothing(0);
    startLenis();

    var stage = $('.stage'), cam = $('.camera'), probe = $('.u-probe');
    var planes = $$('.plane', stage);
    var cache = new Map();
    var clearCache = function () { cache.clear(); };
    ScrollTrigger.addEventListener('refreshInit', clearCache);
    disposers.push(function(){ScrollTrigger.removeEventListener('refreshInit',clearCache);});

    function U() { return probe.getBoundingClientRect().width / 100; }
    function num(el, name, d) {
      var v = parseFloat(getComputedStyle(el).getPropertyValue('--' + name));
      return isNaN(v) ? d : v;
    }
    function S(el, p) {
      var key = p + planes.indexOf(el);
      if (cache.has(key)) return cache.get(key);
      var u = U();
      var s = {
        x: num(el, p + 'x', 0) * u, y: num(el, p + 'y', 0) * u, z: num(el, p + 'z', 0) * u,
        rotationX: num(el, p + 'rx', 0), rotationY: num(el, p + 'ry', 0), rotation: num(el, p + 'rz', 0),
        scale: num(el, p + 's', 1), opacity: num(el, p + 'o', 1)
      };
      cache.set(key, s);
      return s;
    }
    function fv(el, p, extra) {
      var o = {};
      ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotation', 'scale', 'opacity'].forEach(function (k) { o[k] = function () { return S(el, p)[k]; }; });
      if (extra) for (var e in extra) o[e] = extra[e];
      return o;
    }
    function cv(el, name, d) { return function () { return num(el, name, d); }; }

    media = gsap.matchMedia();
    // Phones lead straight into reflowed product UI, without a pinned paper sequence.
    media.add({ desk: '(min-width:641px) and (min-height:501px), (min-width:1001px)' }, function (ctx) {
      var desk = ctx.conditions.desk;
      var cleanups = [];
      clearCache();

      /* Story timeline: hero, chaos, clarity. One pin. */
      var tl = gsap.timeline({ defaults: { ease: 'none' } });
      planes.forEach(function (el, i) {
        var role = el.getAttribute('data-role');
        var j = (i % 7) * 0.07;
        var shade = el.querySelector('.shade'), edge = el.querySelector('.edge'), tag = el.querySelector('.tag');
        if (role === 'frag') {
          tl.fromTo(el, fv(el, 'h'), fv(el, 'c', { duration: 2.4, ease: 'expo.out' }), 1.0 + j * 2.2);
          tl.fromTo(el, fv(el, 'c'), fv(el, 'k', { duration: 2.2, ease: 'power2.inOut', immediateRender: false }), 5.0 + j);
        } else if (role === 'doc') {
          tl.fromTo(el, fv(el, 'h'), fv(el, 'c', { duration: 3.2, ease: 'power3.inOut' }), 0.4 + j);
          tl.fromTo(el, fv(el, 'c'), fv(el, 'k', { duration: 3.0, ease: 'expo.out', immediateRender: false }), 5.0 + j);
        } else {
          tl.fromTo(el, fv(el, 'c'), fv(el, 'k', { duration: 1.6, ease: 'expo.out', immediateRender: false }), 7.1 + j * 0.5);
        }
        if (shade) {
          tl.fromTo(shade, { opacity: cv(el, 'hsh', 0.22) }, { opacity: cv(el, 'csh', 0.6), duration: 2.4 }, 0.6);
          tl.fromTo(shade, { opacity: cv(el, 'csh', 0.6) }, { opacity: cv(el, 'ksh', 0), duration: 2.2, immediateRender: false }, 5.6);
        }
        if (edge) {
          tl.fromTo(edge, { opacity: cv(el, 'hed', 0.5) }, { opacity: cv(el, 'ced', 0.12), duration: 2.4 }, 0.6);
          tl.fromTo(edge, { opacity: cv(el, 'ced', 0.12) }, { opacity: cv(el, 'ked', 1), duration: 1.6, immediateRender: false }, 6.6);
        }
        if (tag) tl.fromTo(tag, { opacity: 0 }, { opacity: 1, duration: 1.0 }, 7.4 + j);
      });
      var copy = $$('.hero-copy,.hero-conversation,.story-scroll-hint'), chaosB = $('.beat-chaos'), cMain = $('.bc-main'), cCap = $('.bc-caption');
      if (desk) tl.fromTo(copy, { opacity: 1 }, { opacity: 0, duration: 1.3, ease: 'power1.in', immediateRender: false }, 0.15);
      tl.fromTo(htSvg, { opacity: 1 }, { opacity: 0, duration: 0.9, immediateRender: false }, desk ? 0.15 : 0);
      tl.fromTo(chaosB, { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out' }, 2.2);
      tl.to(chaosB, { opacity: 0, y: -24, duration: 0.8, ease: 'power2.in' }, 4.5);
      tl.fromTo(cCap, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' }, 6.1);
      tl.fromTo(cMain, { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out' }, 7.0);
      tl.to({}, { duration: 0.01 }, 10);

      ScrollTrigger.create({
        trigger: pin, start: 'top top', end: desk ? '+=320%' : '+=250%',
        pin: true, scrub: true, animation: tl, invalidateOnRefresh: true, anticipatePin: 1,
        onUpdate: function (self) { if (self.progress > 0.002 && intro && intro.isActive()) intro.progress(1); }
      });

      /* Ambient drift: autonomous, so the Pause control stops it */
      var amp = desk ? 1 : 0.55;
      $$('.drift', stage).forEach(function (d, i) {
        var tw = gsap.to(d, {
          y: (i % 2 ? -1 : 1) * gsap.utils.random(5, 10) * amp,
          rotation: gsap.utils.random(-0.8, 0.8) * amp,
          rotationY: gsap.utils.random(-2.4, 2.4) * amp,
          duration: gsap.utils.random(6, 9.5), repeat: -1, yoyo: true, ease: 'sine.inOut'
        });
        tw.seek(Math.random() * 5);
      });

      var heroConversation=$('.hero-conversation');
      if(heroConversation)gsap.to(heroConversation,{y:-7,duration:7,repeat:-1,yoyo:true,ease:'sine.inOut'});

      /* Intro: the thread draws from the headline to the course page */
      intro = gsap.timeline({ delay: 0.35 });
      intro.fromTo(htPath, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.7, ease: 'expo.inOut' })
           .fromTo(htEnd, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'expo.out' }, '-=0.35');
      if (paused) intro.progress(1);

      /* Pointer camera, desktop with a fine pointer only */
      if (desk && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        var qx = gsap.quickTo(cam, 'rotationX', { duration: 1.6, ease: 'expo.out' });
        var qy = gsap.quickTo(cam, 'rotationY', { duration: 1.6, ease: 'expo.out' });
        var onMove = function (e) { var nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5; qy(nx * 6); qx(-ny * 4); };
        listen(window,'pointermove', onMove, { passive: true });
        cleanups.push(function () { window.removeEventListener('pointermove', onMove); });
      }

      /* Keep the hero thread attached while the hero is on screen */
      var tick = function () { if (window.pageYOffset < window.innerHeight * 2.4) layoutHero(); };
      gsap.ticker.add(tick);
      cleanups.push(function () { gsap.ticker.remove(tick); });

      return function () { cleanups.forEach(function (fn) { fn(); }); };
    });

    /* Documents hand over to a shared product demonstration; copy always stays readable. */
    media.add('(min-width:1000px) and (min-height:850px)',function(){
      var steps=$$('.tour-step'),panels=$$('.tour-panel'),track=$('.tour-track > span');
      var current=-1,links=$$('.tour-nav a');
      function showStep(index,instant=false){
        if(index===current&&!instant)return;current=index;
        links.forEach((link,i)=>{if(i===index)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');});
        panels.forEach((panel,i)=>{
          panel.inert=i!==index;panel.setAttribute('aria-hidden',String(i!==index));
          gsap.killTweensOf(panel);
          if(instant||paused)gsap.set(panel,{autoAlpha:i===index?1:0,y:0,rotationX:0});
          else if(i!==index)gsap.set(panel,{autoAlpha:0,y:0});
          else {
            gsap.set(panel,{autoAlpha:1,y:0});
            var details=$$('.pd-question,.pd-next,.pd-citation,.pd-composer',panel);
            if(details.length)gsap.fromTo(details,{y:6},{y:0,duration:.45,stagger:.06,ease:'power2.out',overwrite:true});
          }
        });
        if(track)gsap.to(track,{scaleX:(index+1)/steps.length,duration:instant||paused?0:.55,ease:'power2.out',overwrite:true});
      }
      function synchronize(){
        var index=0;steps.forEach((step,i)=>{if(step.querySelector('.tour-copy').getBoundingClientRect().top<window.innerHeight*.4)index=i;});
        showStep(index,true);
      }
      steps.forEach((step,i)=>ScrollTrigger.create({trigger:step.querySelector('.tour-copy'),start:'top 40%',end:'bottom 40%',onEnter:()=>showStep(i),onEnterBack:()=>showStep(i),onRefresh:synchronize}));
      gsap.fromTo($('.tour-stage'),{rotationY:-3,y:22},{rotationY:0,y:0,ease:'none',scrollTrigger:{trigger:$('.tour-body'),start:'top 75%',end:'top 25%',scrub:true}});
      synchronize();
      return ()=>{panels.forEach(panel=>{panel.inert=false;panel.removeAttribute('aria-hidden');});links.forEach(link=>link.removeAttribute('aria-current'));};
    });

    media.add('(max-width:999px), (max-height:849px)',function(){
      $$('.tour-inline').forEach(frame=>{
        gsap.fromTo(frame,{rotationX:4,y:16,transformPerspective:1400,transformOrigin:'50% 100%'},{rotationX:0,y:0,ease:'none',scrollTrigger:{trigger:frame,start:'top bottom',end:'top 48%',scrub:true}});
      });
    });

    /* The founder invitation continues the paper-and-light visual story. */
    var sculpture=$('.pilot-sculpture');
    if(sculpture){
      gsap.fromTo($('.pilot-mark'),{rotationY:-9,y:24},{rotationY:0,y:0,ease:'none',scrollTrigger:{trigger:sculpture,start:'top bottom',end:'center center',scrub:true}});
      $$('.pilot-note').forEach((note,i)=>gsap.to(note,{y:i%2?-7:7,duration:5+i,repeat:-1,yoyo:true,ease:'sine.inOut'}));
    }

    /* Continue the same material-to-check relationship into the final sections. */
    $$('.limits-list li,.steps li').forEach(el=>{
      var rule=document.createElement('span');rule.className='continued-rule';rule.setAttribute('aria-hidden','true');el.appendChild(rule);
      gsap.fromTo(rule,{scaleX:0},{scaleX:1,ease:'none',scrollTrigger:{trigger:el,start:'top 85%',end:'top 45%',scrub:true}});
      disposers.push(()=>rule.remove());
    });

    var refresh = function () { if(active)ScrollTrigger.refresh(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
    listen(window,'load', refresh);
    rt = null;
    listen(window,'resize', function () { if (!paused) return; clearTimeout(rt); rt = setTimeout(refresh, 200); });
  }

  if (motion) {
    root.classList.add('motion-ok');
    try { initMotion(); }
    catch (err) {
      if (window.console) console.error(err);
      motion = false;
      try { media && media.revert(); } catch (e2) {}
      stopLenis();
      root.classList.remove('motion-ok');
      $$('.plane, .drift, .shade, .edge, .tag, .hero-copy, .beat-chaos, .bc-main, .bc-caption, .hero-thread, .hero-conversation, .story-scroll-hint, .player, .shot-frame').forEach(function (el) { el.removeAttribute('style'); });
      initStatic();
    }
  } else {
    initStatic();
  }
  function syncVisibility(){
    root.classList.toggle('preview-hidden',document.hidden);
    if(!hasGsap)return;
    if(document.hidden){gsap.globalTimeline.pause();if(lenis)lenis.stop();}
    else if(!paused){gsap.globalTimeline.resume();if(lenis)lenis.start();ScrollTrigger.refresh();}
  }
  listen(document,'visibilitychange',syncVisibility);
  syncVisibility();
  // Direct links and clicks before the motion libraries load must land on the
  // same section after fonts and the pinned story establish their final size.
  var initialHash=location.hash;
  if(initialHash){
    var alignInitial=()=>requestAnimationFrame(()=>{
      if(!active||location.hash!==initialHash)return;
      var id;try{id=decodeURIComponent(initialHash.slice(1));}catch{return;}
      var target=root.querySelector('[id="'+CSS.escape(id)+'"]');
      if(target)scrollToEl(target,true);
    });
    if(document.fonts?.ready)document.fonts.ready.then(alignInitial);else alignInitial();
  }

  }
  const context=gsap?gsap.context(run,root):null;
  if(!gsap)run();
  return function dispose(){
    active=false;abort.abort();clearTimeout(rt);
    media?.revert();context?.revert();disposers.forEach(fn=>fn());
    if(gsap)gsap.globalTimeline.resume();
    root.classList.remove('motion-ok','motion-paused','js','preview-hidden');
  };
}
