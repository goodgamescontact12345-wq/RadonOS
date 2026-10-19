import { icon } from '../../shared/icons.js';
import * as FS from '../../shared/fs.js';
import { loadSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';
import { promptDialog, toast, paintIcons, escapeHtml, formatBytes } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);

const audio = $('#audio');
const video = $('#video');
const yt = $('#yt');
const canvas = $('#viz');
const context = canvas.getContext('2d');

const state = {
  tracks: [],
  filter: 'all',
  index: -1,
  objectUrl: null,
  audioContext: null,
  analyser: null,
  source: null,
  shuffle: false,
  repeat: 'off',
  volume: Number(localStorage.getItem('radonos:media-volume') || 0.8),
  raf: 0,
};

const isYouTube = (url) => /^https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/i.test(url);

function youtubeId(url) {
  const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([\w-]{6,})/);
  return match ? match[1] : null;
}

const trackKind = (mime = '', name = '') => {
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) return 'audio';
  if (mime.startsWith('video/') || /\.(mp4|webm|mkv|mov)$/i.test(name)) return 'video';
  return 'audio';
};

/* --------------------------------------------------------------- library */
async function loadLibrary() {
  const nodes = await FS.allNodes();
  const mediaNodes = nodes
    .filter((node) => node.kind === 'file')
    .filter((node) => {
      const kind = FS.kindForMime(node.mime);
      return kind === 'audio' || kind === 'video';
    })
    .map((node) => ({
      id: node.id,
      name: node.name,
      mime: node.mime,
      size: node.size,
      source: 'fs',
      kind: trackKind(node.mime, node.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const streams = state.tracks.filter((track) => track.source === 'url');
  state.tracks = [...streams, ...mediaNodes];
  renderPlaylist();
}

async function renderPlaylist() {
  const list = $('#track-list');
  const visible = state.tracks.filter((track) => state.filter === 'all' || track.kind === state.filter);
  if (!visible.length) {
    list.innerHTML = `<div class="ros-empty" style="padding:22px 8px">${icon('music', { size: 24 })}<span>No ${state.filter === 'all' ? 'media' : state.filter} files yet</span></div>`;
  } else {
    list.innerHTML = visible.map((track) => {
      const index = state.tracks.indexOf(track);
      return `
        <button class="track${index === state.index ? ' active' : ''}" data-index="${index}">
          <span class="track-icon">${icon(track.kind === 'video' ? 'video' : (track.source === 'url' ? 'link' : 'music'), { size: 13 })}</span>
          <span class="track-text">
            <span class="track-name">${escapeHtml(track.name)}</span>
            <span class="track-sub">${track.source === 'url' ? 'Stream' : formatBytes(track.size || 0)}</span>
          </span>
          ${track.source === 'url' ? `<span class="track-remove" data-remove="${index}" title="Remove">${icon('close', { size: 12 })}</span>` : ''}
        </button>`;
    }).join('');
  }

  list.querySelectorAll('.track').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (event.target.closest('[data-remove]')) {
        event.stopPropagation();
        const index = Number(event.target.closest('[data-remove]').dataset.remove);
        state.tracks.splice(index, 1);
        if (state.index >= index) state.index -= 1;
        renderPlaylist();
        return;
      }
      void playTrack(Number(button.dataset.index));
    });
  });

  const audioCount = state.tracks.filter((track) => track.kind === 'audio').length;
  const videoCount = state.tracks.filter((track) => track.kind === 'video').length;
  $('#library-meta').innerHTML = `${state.tracks.length} tracks · ${audioCount} audio · ${videoCount} video<br>Streams are session-only.`;
  $('#stat-library').textContent = `${state.tracks.length} track${state.tracks.length === 1 ? '' : 's'}`;
}

/* --------------------------------------------------------------- playback */
function cleanupSources() {
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  audio.pause();
  video.pause();
  audio.removeAttribute('src');
  video.removeAttribute('src');
  yt.removeAttribute('src');
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
}

function showStage(kind) {
  $('#stage-empty').hidden = kind !== 'empty';
  audio.classList.toggle('hidden', true);
  video.hidden = kind !== 'video';
  canvas.hidden = kind !== 'audio';
  yt.hidden = kind !== 'youtube';
}

async function playTrack(index) {
  const track = state.tracks[index];
  if (!track) return;
  state.index = index;
  cleanupSources();

  $('#np-title').textContent = track.name;
  $('#np-sub').textContent = track.source === 'url'
    ? track.url
    : `${track.kind} · ${formatBytes(track.size || 0)}`;
  $('#now-label').textContent = track.name;
  $('#stat-source').textContent = track.source === 'url' ? track.url.slice(0, 60) : 'RadonOS virtual file system';
  renderPlaylist();

  if (track.source === 'url' && isYouTube(track.url)) {
    const id = youtubeId(track.url);
    showStage('youtube');
    yt.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    $('#stat-state').textContent = 'YouTube embed';
    return;
  }

  let src = track.url;
  if (track.source === 'fs') {
    const blob = await FS.readBlob(track.id);
    state.objectUrl = URL.createObjectURL(blob);
    src = state.objectUrl;
  }

  if (track.kind === 'video') {
    showStage('video');
    video.src = src;
    video.volume = state.volume;
    try {
      await video.play();
    } catch {
      toast('Press play to start (browser autoplay policy)', { type: 'info' });
    }
    $('#stat-state').textContent = 'Playing video';
  } else {
    showStage('audio');
    audio.src = src;
    audio.volume = state.volume;
    startVisualizer(src);
    try {
      await audio.play();
    } catch {
      toast('Press play to start (browser autoplay policy)', { type: 'info' });
    }
    $('#stat-state').textContent = 'Playing audio';
  }
  updateTransport();
}

function startVisualizer(src) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    drawSimulated();
    return;
  }
  try {
    if (!state.audioContext) state.audioContext = new AudioContextClass();
    if (!state.analyser) {
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 128;
      state.analyser.connect(state.audioContext.destination);
    }
    // A media element can only be wired into one MediaElementSourceNode, so
    // create it once and reuse it for every local track.
    const localSource = src && !/^https?:/i.test(src);
    if (localSource && !state.sourceCreated) {
      state.source = state.audioContext.createMediaElementSource(audio);
      state.source.connect(state.analyser);
      state.sourceCreated = true;
    }
    void state.audioContext.resume();
    // Cross-origin streams without CORS can't be analysed - fall back to a
    // synthesized waveform so the visualiser still feels alive.
    if (state.sourceCreated && localSource) drawAnalyser();
    else drawSimulated();
  } catch (err) {
    console.warn('[RadonOS] Visualiser unavailable', err);
    drawSimulated();
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  return dpr;
}

function drawBars(values, color) {
  const dpr = resizeCanvas();
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  const barWidth = width / values.length;
  values.forEach((value, index) => {
    const barHeight = Math.max(3, value * height * 0.78);
    const x = index * barWidth;
    const gradient = context.createLinearGradient(0, height - barHeight, 0, height);
    gradient.addColorStop(0, color[0]);
    gradient.addColorStop(1, color[1]);
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect
      ? context.roundRect(x + barWidth * 0.18, height - barHeight - height * 0.08, barWidth * 0.64, barHeight, barWidth * 0.3)
      : context.rect(x + barWidth * 0.18, height - barHeight - height * 0.08, barWidth * 0.64, barHeight);
    context.fill();
  });
  void dpr;
}

function drawAnalyser() {
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  const loop = () => {
    state.analyser.getByteFrequencyData(data);
    const values = [...data.slice(0, 48)].map((value) => value / 255);
    drawBars(values, ['rgba(124,245,208,.95)', 'rgba(91,157,255,.35)']);
    state.raf = requestAnimationFrame(loop);
  };
  loop();
}

function drawSimulated() {
  let phase = 0;
  const loop = () => {
    phase += 0.06;
    const playing = !audio.paused;
    const values = Array.from({ length: 48 }, (_, index) => {
      const wave = Math.sin(phase + index * 0.32) * 0.5 + 0.5;
      const falloff = 1 - index / 60;
      return playing ? wave * falloff * 0.9 : 0.05;
    });
    drawBars(values, ['rgba(196,181,253,.9)', 'rgba(244,114,182,.3)']);
    state.raf = requestAnimationFrame(loop);
  };
  loop();
}

/* -------------------------------------------------------------- transport */
const mediaElement = () => (state.tracks[state.index]?.kind === 'video' ? video : audio);

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function updateTransport() {
  const element = mediaElement();
  const playing = !element.paused && element.currentTime > 0;
  $('#play').innerHTML = icon(playing ? 'pause' : 'play', { size: 22 });
  $('#stat-state').textContent = state.index < 0
    ? 'Idle'
    : `${playing ? 'Playing' : 'Paused'} · ${state.tracks[state.index]?.kind || ''}`;
}

function togglePlay() {
  if (state.index < 0) {
    if (state.tracks.length) void playTrack(0);
    return;
  }
  const element = mediaElement();
  if (element.paused) element.play().catch(() => {});
  else element.pause();
}

function nextIndex(direction = 1) {
  if (!state.tracks.length) return -1;
  if (state.shuffle) {
    let next = state.index;
    while (next === state.index && state.tracks.length > 1) {
      next = Math.floor(Math.random() * state.tracks.length);
    }
    return next;
  }
  return (state.index + direction + state.tracks.length) % state.tracks.length;
}

function next() {
  const index = nextIndex(1);
  if (index >= 0) void playTrack(index);
}

function previous() {
  const element = mediaElement();
  if (element.currentTime > 4) {
    element.currentTime = 0;
    return;
  }
  const index = nextIndex(-1);
  if (index >= 0) void playTrack(index);
}

async function addStream() {
  const url = await promptDialog({
    title: 'Add a stream',
    label: 'Media URL',
    value: 'https://',
    placeholder: 'https://example.com/track.mp3 or a YouTube link',
    confirmText: 'Add to playlist',
    iconName: 'link',
    validate: (value) => (/^https?:\/\/\S+/i.test(value) ? null : 'Enter a full http(s) URL'),
  });
  if (!url) return;
  const kind = isYouTube(url) ? 'video' : trackKind('', url);
  state.tracks.unshift({
    id: `url-${crypto.randomUUID()}`,
    name: isYouTube(url) ? 'YouTube video' : url.split('/').pop() || url,
    url,
    source: 'url',
    kind,
    size: 0,
  });
  await renderPlaylist();
  toast('Added to the playlist', { type: 'success', iconName: 'link' });
  void playTrack(0);
}

async function importMedia(files) {
  if (!files?.length) return;
  const music = await FS.resolvePath('/Music');
  const videos = await FS.resolvePath('/Videos');
  let saved = 0;
  for (const file of files) {
    const target = file.type.startsWith('video/') ? (videos || music) : (music || videos);
    if (!target) continue;
    await FS.writeBlob(target.id, file);
    saved += 1;
  }
  toast(`${saved} file${saved === 1 ? '' : 's'} imported into the library`, { type: 'success', iconName: 'upload' });
  await loadLibrary();
}

/* --------------------------------------------------------------- wiring */
$('#play').addEventListener('click', togglePlay);
$('#next').addEventListener('click', next);
$('#prev').addEventListener('click', previous);

$('#shuffle').addEventListener('click', (event) => {
  state.shuffle = !state.shuffle;
  event.currentTarget.classList.toggle('on', state.shuffle);
});

$('#repeat').addEventListener('click', (event) => {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  event.currentTarget.classList.toggle('on', state.repeat !== 'off');
  event.currentTarget.title = `Repeat: ${state.repeat}`;
});

$('#filter').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll('.seg-btn').forEach((node) => node.classList.toggle('active', node === button));
  void renderPlaylist();
});

$('#add-url').addEventListener('click', () => void addStream());
$('#import').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async (event) => {
  await importMedia([...event.target.files]);
  event.target.value = '';
});

for (const element of [audio, video]) {
  element.addEventListener('play', updateTransport);
  element.addEventListener('pause', updateTransport);
  element.addEventListener('ended', () => {
    if (state.repeat === 'one') {
      element.currentTime = 0;
      void element.play();
      return;
    }
    if (state.repeat === 'off' && !state.shuffle && state.index === state.tracks.length - 1) {
      updateTransport();
      return;
    }
    next();
  });
  element.addEventListener('timeupdate', () => {
    const duration = element.duration || 0;
    $('#cur').textContent = formatTime(element.currentTime);
    $('#dur').textContent = formatTime(duration);
    if (duration) $('#seek').value = String((element.currentTime / duration) * 1000);
  });
  element.addEventListener('loadedmetadata', () => {
    $('#dur').textContent = formatTime(element.duration);
  });
}

$('#seek').addEventListener('input', () => {
  const element = mediaElement();
  if (!Number.isFinite(element.duration) || !element.duration) return;
  element.currentTime = (Number($('#seek').value) / 1000) * element.duration;
});

$('#volume').value = String(Math.round(state.volume * 100));
$('#volume').addEventListener('input', (event) => {
  state.volume = Number(event.target.value) / 100;
  audio.volume = state.volume;
  video.volume = state.volume;
  try {
    localStorage.setItem('radonos:media-volume', String(state.volume));
  } catch { /* ignore */ }
});

document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing) return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  } else if (event.code === 'ArrowRight' && event.shiftKey) {
    next();
  } else if (event.code === 'ArrowLeft' && event.shiftKey) {
    previous();
  }
});

FS.onFsChange(async () => {
  await loadLibrary();
});

window.addEventListener('resize', () => {
  if (state.raf) resizeCanvas();
});

/* ------------------------------------------------------------------ boot */
(async () => {
  await loadSettings();
  await initTheme();
  await FS.ready();
  paintIcons();
  await loadLibrary();

  const path = new URLSearchParams(location.search).get('path');
  if (path) {
    const node = await FS.resolvePath(path);
    if (node) {
      const index = state.tracks.findIndex((track) => track.id === node.id);
      if (index >= 0) {
        state.filter = state.tracks[index].kind;
        document.querySelectorAll('.seg-btn').forEach((button) => {
          button.classList.toggle('active', button.dataset.filter === state.filter);
        });
        await renderPlaylist();
        await playTrack(index);
        return;
      }
    }
  }
  showStage('empty');
  updateTransport();
})();
