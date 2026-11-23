// The places page: shows the picked work in every place, from the tags its real page
// carries (fetched as a chat or timeline would read them), and opens the links in
// the phone frame (or, on a phone, as a chat would: in this tab).
const works = await (await fetch('/works.json')).json();
const query = new URLSearchParams(location.search);
let work = works.find(w => w.id === query.get('w')) ?? works[0];
const narrow = matchMedia('(max-width: 900px)');
const $ = id => document.getElementById(id);

const POSTS = {
  instrument: name => `made this little instrument, ${name}. you can play it right in your browser`,
  effect: name => `${name}: an effect you can try on your own voice, in the browser`,
  sound: name => `${name}, a thing that makes sound. open it`,
};
const PROSE = {
  instrument: name =>
    `${name} is a small instrument. Press play below: it plays a few notes by itself, then the keys are yours.`,
  effect: name =>
    `${name} is an effect. Press play below to hear it on a guitar or drums, then try your own voice.`,
  sound: name => `${name} makes sound by itself. Press play below.`,
};

/** The tags of a page, read from its HTML as a link preview reads them. */
async function tagsOf(path) {
  const html = await (await fetch(path)).text();
  const page = new DOMParser().parseFromString(html, 'text/html');
  const tags = {};
  for (const meta of page.querySelectorAll('meta[property], meta[name]'))
    tags[meta.getAttribute('property') ?? meta.getAttribute('name')] = meta.getAttribute('content');
  tags.title = page.title;
  return {
    tags,
    source: [
      ...page.head.querySelectorAll(
        'title, meta[property], meta[name="description"], meta[name^="twitter"]',
      ),
    ]
      .map(e => e.outerHTML)
      .join('\n'),
  };
}

function show(w) {
  work = w;
  history.replaceState(null, '', `?w=${w.id}`);
  for (const b of $('works').children)
    b.setAttribute('aria-pressed', String(b.dataset.id === w.id));
  void fill();
}

async function fill() {
  const w = work;
  const [{ tags, source }, plain] = await Promise.all([
    tagsOf(`/w/${w.id}/`),
    tagsOf(`/plain/${w.id}/`),
  ]);
  if (w !== work) return;
  const domain = location.host;
  for (const e of document.querySelectorAll('[data-tag]'))
    e.textContent = tags[e.dataset.tag] ?? '';
  for (const e of document.querySelectorAll('[data-domain]')) e.textContent = domain;
  const clip = $('clip');
  clip.src = tags['og:video'] ?? '';
  clip.closest('.preview').hidden = !tags['og:video'];
  $('card').src = tags['og:image'] ?? '';
  $('post-text').textContent = POSTS[w.kind](w.name);
  $('prose-1').textContent = PROSE[w.kind](w.name);
  $('embed').src = `/w/${w.id}/?embed`;
  $('venue-picture').src = tags['og:image'] ?? '';
  $('venue-name').textContent = w.name;
  $('qr').src = `/qr.svg?u=${encodeURIComponent(new URL(`/w/${w.id}/`, location.href).href)}`;
  $('plain-title').textContent = plain.tags.title;
  $('tags').textContent = source;
  $('phone').removeAttribute('src');
  $('phone-empty').hidden = false;
  $('phone-tab').removeAttribute('href');
}

/** Opens a place's link: in the phone frame on a wide screen, as a chat would on a phone. */
function open(which) {
  const link = which === 'plain' ? `/plain/${work.id}/?plain` : `/w/${work.id}/`;
  if (narrow.matches) {
    location.href = link;
    return;
  }
  const framed = link + (link.includes('?') ? '&' : '?') + 'touch';
  $('phone').src = framed;
  $('phone-empty').hidden = true;
  $('phone-tab').href = link;
}

for (const w of works) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.id = w.id;
  b.innerHTML = `<strong></strong><span></span>`;
  b.querySelector('strong').textContent = w.name;
  b.querySelector('span').textContent = w.kind;
  b.addEventListener('click', () => show(w));
  $('works').append(b);
}
for (const a of document.querySelectorAll('[data-open]')) {
  a.href = '#';
  a.addEventListener('click', e => {
    if (e.target.closest('.sound')) return;
    e.preventDefault();
    open(a.dataset.open);
  });
}
$('clip-sound').addEventListener('click', e => {
  e.preventDefault();
  const clip = $('clip');
  clip.muted = !clip.muted;
  if (!clip.muted) void clip.play();
  e.currentTarget.setAttribute('aria-pressed', String(!clip.muted));
  e.currentTarget.textContent = clip.muted ? 'Sound off' : 'Sound on';
});
if (!works.length)
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p class="empty">No works yet: run export-works.mjs and make-media.mjs.</p>',
  );
else show(work);
